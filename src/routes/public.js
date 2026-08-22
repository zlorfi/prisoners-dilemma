'use strict';

const express = require('express');

const dilemmas = require('../services/dilemmas');
const events = require('../lib/events');
const { isValidSlug } = require('../lib/slug');
const { ensureVoterToken, rateLimit } = require('../middleware/security');

const router = express.Router();

/**
 * Resolve :slug. Invalid or unknown slugs get the same 404 so the endpoint
 * cannot be used to distinguish "malformed" from "not allocated".
 */
function loadDilemma(req, res, next) {
  const { slug } = req.params;
  const dilemma = isValidSlug(slug) ? dilemmas.getBySlug(slug) : null;
  if (!dilemma) {
    return res.status(404).render('error', {
      title: 'Link not found',
      message:
        'This link is not valid. Check for typos, or ask the organiser for a fresh one.',
      backLink: null,
    });
  }
  req.dilemma = dilemma;
  return next();
}

/** Slow down anyone walking the slug space. */
const slugLimiter = rateLimit({
  name: 'slug',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please wait a moment.',
});

const voteLimiter = rateLimit({
  name: 'vote',
  windowMs: 60 * 1000,
  max: 15,
  message: 'Too many submissions. Please wait a moment.',
});

/* ------------------------------------------------------------------ *
 * Voting page
 * ------------------------------------------------------------------ */

router.get('/d/:slug', slugLimiter, ensureVoterToken, loadDilemma, (req, res) => {
  const { dilemma } = req;
  const existingVote = dilemmas.getVoteByToken(dilemma.id, req.voterToken);

  // Already voted, or the room is closed → show the result/confirmation view.
  if (existingVote || dilemma.status !== 'open') {
    return res.render('vote/done', {
      title: dilemma.title,
      dilemma,
      vote: existingVote,
      showResults: !!dilemma.show_results,
      tally: dilemmas.getTally(dilemma.id),
      // Only resolves once the admin closes voting; gated behind the same
      // reveal toggle as the counts so the admin controls the big moment.
      resolution: dilemma.show_results
        ? dilemmas.getResolution(dilemma)
        : null,
    });
  }

  const suggestion = dilemmas.suggestName(dilemma.id, req.voterToken);

  return res.render('vote/form', {
    title: dilemma.title,
    dilemma,
    suggestion,
    poolExhausted: suggestion === null,
    error: null,
    values: { name: suggestion ?? '', choice: '' },
  });
});

/* ------------------------------------------------------------------ *
 * Submit
 * ------------------------------------------------------------------ */

router.post(
  '/d/:slug',
  voteLimiter,
  ensureVoterToken,
  loadDilemma,
  (req, res) => {
    const { dilemma } = req;

    // A brand-new cookie on a POST means cookies are blocked (or the user is
    // replaying the form). We cannot enforce one-vote-per-person without it.
    if (req.voterTokenIsNew) {
      return res.status(400).render('vote/form', {
        title: dilemma.title,
        dilemma,
        suggestion: null,
        poolExhausted: false,
        error:
          'We could not identify your browser. Please enable cookies for this site and try again.',
        values: {
          name: String(req.body.name ?? '').slice(0, 40),
          choice: req.body.choice === 'snitch' ? 'snitch' : '',
        },
      });
    }

    try {
      dilemmas.castVote({
        dilemma,
        voterToken: req.voterToken,
        name: req.body.name,
        choice: req.body.choice,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.redirect(`/d/${dilemma.slug}`);
    } catch (err) {
      if (!(err instanceof dilemmas.VoteError)) throw err;

      // Someone else grabbed the name in the meantime → offer a fresh one.
      const retrySuggestion =
        err.code === 'name_taken'
          ? dilemmas.suggestName(dilemma.id, req.voterToken)
          : null;

      return res.status(400).render('vote/form', {
        title: dilemma.title,
        dilemma,
        suggestion: retrySuggestion,
        poolExhausted: false,
        error: err.message,
        values: {
          name: retrySuggestion ?? String(req.body.name ?? '').slice(0, 40),
          choice: ['silence', 'snitch'].includes(req.body.choice)
            ? req.body.choice
            : '',
        },
      });
    }
  },
);

/* ------------------------------------------------------------------ *
 * "Give me another alias"
 * ------------------------------------------------------------------ */

router.post(
  '/d/:slug/suggest-name',
  rateLimit({ name: 'suggest', windowMs: 60 * 1000, max: 30 }),
  ensureVoterToken,
  loadDilemma,
  (req, res) => {
    const { dilemma } = req;
    if (dilemma.status !== 'open') {
      return res.status(409).json({ error: 'This dilemma is closed.' });
    }
    if (dilemmas.getVoteByToken(dilemma.id, req.voterToken)) {
      return res.status(409).json({ error: 'You have already voted.' });
    }

    // Drop the current hold first, otherwise suggestName would hand back
    // the very same alias the visitor is trying to move away from.
    const name = dilemmas.suggestName(dilemma.id, req.voterToken, {
      forceNew: true,
    });
    if (!name) {
      return res.status(409).json({ error: 'No aliases left — please type your own.' });
    }
    return res.json({ name });
  },
);

/* ------------------------------------------------------------------ *
 * Live results for voters (only while the admin has them enabled)
 * ------------------------------------------------------------------ */

router.get('/d/:slug/stream', slugLimiter, loadDilemma, (req, res) => {
  const { dilemma } = req;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Voters only ever receive aggregates — never the individual vote log.
  const send = (payload) => {
    const current = dilemmas.getById(dilemma.id);
    if (!current) {
      res.write(`data: ${JSON.stringify({ type: 'deleted' })}\n\n`);
      return;
    }
    const reveal = !!current.show_results;
    const resolution = reveal ? dilemmas.getResolution(current) : null;
    res.write(
      `data: ${JSON.stringify({
        type: payload.type ?? 'update',
        status: current.status,
        showResults: reveal,
        tally: reveal ? dilemmas.getTally(dilemma.id) : null,
        // Strip the per-player breakdown: voters get the verdict and their
        // own damage number, never the full list of who chose what.
        resolution: resolution
          ? { ...resolution, players: undefined }
          : null,
      })}\n\n`,
    );
  };

  send({ type: 'snapshot' });
  const unsubscribe = events.subscribe(dilemma.id, send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/* ------------------------------------------------------------------ *
 * Landing
 * ------------------------------------------------------------------ */

router.get('/', (req, res) => {
  res.render('home', { title: "Prisoner's Dilemma" });
});

router.get('/healthz', (_req, res) => res.json({ ok: true }));

module.exports = router;

'use strict';

const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const auth = require('../services/auth');
const dilemmas = require('../services/dilemmas');
const events = require('../lib/events');
const {
  clearAdminCookie,
  rateLimit,
  requireAdmin,
  setAdminCookie,
} = require('../middleware/security');

const router = express.Router();

/** Absolute, shareable URL for a dilemma. */
function shareUrl(req, slug) {
  const origin =
    config.publicOrigin || `${req.protocol}://${req.get('host') || 'localhost'}`;
  return `${origin}/d/${slug}`;
}

/* ------------------------------------------------------------------ *
 * Login / logout
 * ------------------------------------------------------------------ */

const loginLimiter = rateLimit({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please wait a few minutes.',
});

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  return res.render('admin/login', {
    title: 'Admin login',
    error: null,
    next: typeof req.query.next === 'string' ? req.query.next : '/admin',
    username: '',
  });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const nextUrl =
    typeof req.body.next === 'string' && req.body.next.startsWith('/')
      ? req.body.next
      : '/admin';

  const session = auth.login(username, password);
  if (!session) {
    return res.status(401).render('admin/login', {
      title: 'Admin login',
      error: 'Wrong username or password.',
      next: nextUrl,
      username: String(username ?? '').slice(0, 60),
    });
  }

  setAdminCookie(res, session.token);
  return res.redirect(nextUrl);
});

router.post('/logout', (req, res) => {
  auth.logout(req.cookies?.[config.cookies.admin]);
  clearAdminCookie(res);
  res.redirect('/admin/login');
});

/* Everything below requires a session. */
router.use(requireAdmin);

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

router.get('/', (req, res) => {
  const list = dilemmas.listForAdmin().map((d) => ({
    ...d,
    url: shareUrl(req, d.slug),
  }));
  res.render('admin/dashboard', {
    title: 'Dilemmas',
    dilemmas: list,
    admin: req.admin,
    created: req.query.created || null,
  });
});

router.post(
  '/dilemmas',
  rateLimit({ name: 'create', windowMs: 60 * 1000, max: 20 }),
  (req, res) => {
    const dilemma = dilemmas.createDilemma({
      title: req.body.title,
      description: req.body.description,
      createdBy: req.admin.id,
    });
    res.redirect(`/admin/dilemmas/${dilemma.id}?created=1`);
  },
);

/* ------------------------------------------------------------------ *
 * Single dilemma
 * ------------------------------------------------------------------ */

/** Loads :id into req.dilemma or 404s. */
function loadDilemma(req, res, next) {
  const dilemma = dilemmas.getById(Number.parseInt(req.params.id, 10));
  if (!dilemma) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That dilemma does not exist (any more).',
      backLink: '/admin',
    });
  }
  req.dilemma = dilemma;
  return next();
}

router.get('/dilemmas/:id', loadDilemma, async (req, res) => {
  const url = shareUrl(req, req.dilemma.slug);
  let qr = null;
  try {
    qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  } catch {
    /* QR is a nicety; the link alone is enough. */
  }

  res.render('admin/dilemma', {
    title: req.dilemma.title,
    dilemma: req.dilemma,
    url,
    qr,
    admin: req.admin,
    justCreated: req.query.created === '1',
    ...dilemmas.getSnapshot(req.dilemma.id),
  });
});

router.post('/dilemmas/:id/status', loadDilemma, (req, res) => {
  const status = req.body.status === 'closed' ? 'closed' : 'open';
  dilemmas.setStatus(req.dilemma.id, status);
  res.redirect(`/admin/dilemmas/${req.dilemma.id}`);
});

router.post('/dilemmas/:id/results', loadDilemma, (req, res) => {
  dilemmas.setShowResults(req.dilemma.id, req.body.show === '1');
  res.redirect(`/admin/dilemmas/${req.dilemma.id}`);
});

router.post('/dilemmas/:id/reset', loadDilemma, (req, res) => {
  dilemmas.resetVotes(req.dilemma.id);
  res.redirect(`/admin/dilemmas/${req.dilemma.id}`);
});

router.post('/dilemmas/:id/delete', loadDilemma, (req, res) => {
  dilemmas.deleteDilemma(req.dilemma.id);
  res.redirect('/admin');
});

/* CSV export — handy for keeping a record after a session. */
router.get('/dilemmas/:id/export.csv', loadDilemma, (req, res) => {
  const rows = dilemmas.getVotes(req.dilemma.id);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    'name,choice,submitted_at',
    ...rows.map((r) =>
      [r.display_name, r.choice, r.created_at].map(escape).join(','),
    ),
  ].join('\n');

  res.type('text/csv').attachment(`dilemma-${req.dilemma.slug}.csv`).send(csv);
});

/* ------------------------------------------------------------------ *
 * Live updates (SSE)
 * ------------------------------------------------------------------ */

router.get('/dilemmas/:id/stream', loadDilemma, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // keep nginx from buffering the stream
  });
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({
    type: 'snapshot',
    status: req.dilemma.status,
    showResults: !!req.dilemma.show_results,
    ...dilemmas.getSnapshot(req.dilemma.id),
  });

  const unsubscribe = events.subscribe(req.dilemma.id, send);

  // Comment lines keep proxies from timing the connection out.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/* ------------------------------------------------------------------ *
 * Account
 * ------------------------------------------------------------------ */

router.get('/account', (req, res) => {
  res.render('admin/account', {
    title: 'Account',
    admin: req.admin,
    error: null,
    notice: null,
  });
});

router.post('/account/password', (req, res) => {
  const { current, next: newPassword, confirm } = req.body;
  const render = (error, notice) =>
    res.render('admin/account', {
      title: 'Account',
      admin: req.admin,
      error,
      notice,
    });

  if (!auth.login(req.admin.username, current)) {
    return render('Current password is not correct.', null);
  }
  if (String(newPassword ?? '').length < 8) {
    return render('New password must be at least 8 characters.', null);
  }
  if (newPassword !== confirm) {
    return render('New passwords do not match.', null);
  }

  auth.changePassword(req.admin.id, newPassword);
  clearAdminCookie(res);
  return res.redirect('/admin/login');
});

module.exports = router;

'use strict';

const config = require('../config');
const auth = require('../services/auth');
const { randomToken, sign, unsign, safeEqual } = require('../lib/crypto');

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  path: '/',
};

/* ------------------------------------------------------------------ *
 * Admin session
 * ------------------------------------------------------------------ */

function setAdminCookie(res, token) {
  res.cookie(config.cookies.admin, token, {
    ...baseCookie,
    maxAge: config.adminSessionHours * 60 * 60 * 1000,
  });
}

function clearAdminCookie(res) {
  res.clearCookie(config.cookies.admin, baseCookie);
}

/** Populates req.admin when a valid session cookie is present. */
function loadAdmin(req, _res, next) {
  req.admin = auth.resolveSession(req.cookies?.[config.cookies.admin]) || null;
  next();
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  if (req.accepts('html')) {
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect(`/admin/login?next=${target}`);
  }
  return res.status(401).json({ error: 'Authentication required' });
}

/* ------------------------------------------------------------------ *
 * Voter identity
 *
 * A signed, http-only cookie is our device identifier. It is what stops a
 * casual second vote. It is not tamper-proof against a determined user who
 * clears cookies or opens a private window — that is an accepted limitation
 * for this kind of low-stakes party/workshop tool, and the unique-name rule
 * plus the admin's visible vote log cover the rest.
 * ------------------------------------------------------------------ */

function ensureVoterToken(req, res, next) {
  const raw = req.cookies?.[config.cookies.voter];
  const verified = raw ? unsign(raw) : null;

  if (verified) {
    req.voterToken = verified;
    req.voterTokenIsNew = false;
  } else {
    req.voterToken = randomToken(24);
    req.voterTokenIsNew = true;
    res.cookie(config.cookies.voter, sign(req.voterToken), {
      ...baseCookie,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }
  next();
}

/* ------------------------------------------------------------------ *
 * CSRF — double submit cookie
 * ------------------------------------------------------------------ */

function csrf(req, res, next) {
  let token = req.cookies?.[config.cookies.csrf];
  if (!token || token.length < 20) {
    token = randomToken(24);
    res.cookie(config.cookies.csrf, token, {
      ...baseCookie,
      httpOnly: false, // readable by fetch() in the browser
      maxAge: 24 * 60 * 60 * 1000,
    });
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const sent =
    req.get('x-csrf-token') || req.body?._csrf || req.query?._csrf || '';
  if (!sent || !safeEqual(sent, token)) {
    if (req.accepts('html') && !req.xhr) {
      return res.status(403).render('error', {
        title: 'Session expired',
        message: 'Your session expired or the form was stale. Please try again.',
        backLink: req.get('referer') || '/',
      });
    }
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next();
}

/* ------------------------------------------------------------------ *
 * Rate limiting (in-memory sliding window)
 * ------------------------------------------------------------------ */

const buckets = new Map();

/**
 * @param {object}   opts
 * @param {number}   opts.windowMs  sliding window size
 * @param {number}   opts.max       allowed hits per window
 * @param {string}   opts.name      namespace so different limiters don't share buckets
 * @param {Function} [opts.key]     req => string, defaults to the client IP
 */
function rateLimit({ windowMs, max, name, key, message }) {
  const keyFor = typeof key === 'function' ? key : (req) => req.ip;
  return (req, res, next) => {
    const bucketKey = `${name}|${keyFor(req)}`;

    const now = Date.now();
    const hits = (buckets.get(bucketKey) || []).filter((t) => now - t < windowMs);
    hits.push(now);
    buckets.set(bucketKey, hits);

    if (hits.length > max) {
      const retryAfter = Math.ceil((windowMs - (now - hits[0])) / 1000);
      res.set('Retry-After', String(retryAfter));
      if (req.accepts('html') && !req.xhr) {
        return res.status(429).render('error', {
          title: 'Slow down',
          message: message || `Too many requests. Try again in ${retryAfter}s.`,
          backLink: '/',
        });
      }
      return res.status(429).json({
        error: message || 'Too many requests',
        retryAfter,
      });
    }
    return next();
  };
}

// Periodically drop stale buckets so the map cannot grow without bound.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, hits] of buckets) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length) buckets.set(k, fresh);
    else buckets.delete(k);
  }
}, 10 * 60 * 1000);
sweeper.unref?.();

module.exports = {
  clearAdminCookie,
  csrf,
  ensureVoterToken,
  loadAdmin,
  rateLimit,
  requireAdmin,
  setAdminCookie,
};

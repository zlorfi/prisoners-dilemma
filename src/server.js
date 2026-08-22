'use strict';

const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const config = require('./config');
const db = require('./db');
const auth = require('./services/auth');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const { csrf, loadAdmin } = require('./middleware/security');

const app = express();

if (config.trustProxy) app.set('trust proxy', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      // Helmet's defaults include `upgrade-insecure-requests`, which makes the
      // browser re-request every subresource over https. On a plain-HTTP
      // deployment that breaks the CSS and JS outright (Safari enforces it on
      // any origin; Chrome exempts localhost, which is why it only shows up in
      // one of them). Only emit it once we are actually serving HTTPS.
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        // QR codes are rendered as inline data: URLs.
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Everything is same-origin; the strictest COEP settings only get in the way.
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure,
  }),
);

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

app.use(
  '/static',
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: config.env === 'production' ? '7d' : 0,
    etag: true,
  }),
);

app.use(loadAdmin);
app.use(csrf);

// Defaults so views never blow up on an undefined local.
app.use((req, res, next) => {
  res.locals.admin = req.admin || null;
  res.locals.title = "Prisoner's Dilemma";
  next();
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

/* 404 */
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'There is nothing at this address.',
    backLink: '/',
  });
});

/* 500 */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    message:
      config.env === 'production'
        ? 'An unexpected error occurred. Please try again.'
        : String(err.stack || err.message),
    backLink: '/',
  });
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

auth.purgeExpiredSessions();
const bootstrapped = auth.bootstrapAdmin();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[ready] listening on http://0.0.0.0:${config.port}`);
  console.log(`[db]    ${config.databaseFile}`);

  if (bootstrapped) {
    const line = '='.repeat(62);
    console.log(`\n${line}`);
    console.log('  ADMIN ACCOUNT CREATED');
    console.log(`  username: ${bootstrapped.username}`);
    if (bootstrapped.generated) {
      console.log(`  password: ${bootstrapped.password}`);
      console.log('  (generated — copy it now, it is not shown again)');
    } else {
      console.log('  password: (from ADMIN_PASSWORD)');
    }
    console.log(`${line}\n`);
  }
});

function shutdown(signal) {
  console.log(`[${signal}] shutting down`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  // Do not hang forever on lingering SSE connections.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;

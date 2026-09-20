import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env, isProd } from './config/env';
import { errorHandler, notFoundHandler, requestContext } from './middleware';
import { authRouter } from './modules/auth/auth.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { casesRouter } from './modules/cases/cases.routes';
import { clientsRouter } from './modules/clients/clients.routes';
import { consentRouter } from './modules/consent/consent.routes';
import { extensionRouter } from './modules/extension/extension.routes';
import { devRouter } from './dev/mockForm';
import { platformRouter } from './modules/platform/platform.routes';
import { referenceRouter } from './modules/reference/reference.routes';
import { validationRouter } from './modules/validation/validation.routes';
import { logger } from './utils/logger';
import { forbidden } from './utils/problem';

export function createApp(): Express {
  const app = express();

  // Behind a proxy in deployed environments; needed for correct req.ip.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

  /**
   * The browser extension's own origin.
   *
   * A packed extension calls us from `chrome-extension://<id>`, which is not
   * and cannot be in WEB_ORIGIN — the id is per-installation.
   *
   * Letting it through is not a CSRF hole, and the reason matters. CSRF works
   * because the browser attaches a credential AMBIENTLY: a cookie rides along
   * on a request the user never meant to make. Nothing under /extension uses
   * a cookie. Pairing needs a ten-minute single-use code; every other call
   * needs `Authorization: Device …`, which lives in the extension's own
   * storage and is unreachable from any web page. There is no ambient
   * credential for a forged request to ride.
   *
   * In production the id must be named explicitly in EXTENSION_ORIGINS. In
   * development any extension origin is accepted, because an unpacked
   * extension's id changes with its path and demanding it be configured first
   * would be friction with no security gain on a laptop.
   */
  const extensionOrigins = (env.EXTENSION_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isExtensionOrigin = (origin: string): boolean =>
    origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');

  const extensionOriginAllowed = (origin: string): boolean => {
    if (!isExtensionOrigin(origin)) return false;
    if (extensionOrigins.length > 0) return extensionOrigins.includes(origin);
    return !isProd;
  };

  if (!isProd && extensionOrigins.length === 0) {
    logger.warn(
      'EXTENSION_ORIGINS is unset — any browser extension may call /extension. Development only; production requires the extension id to be named.',
    );
  }

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / curl requests have no Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (extensionOriginAllowed(origin)) return callback(null, true);
        return callback(forbidden('Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(requestContext);

  /**
   * CSRF defence for cookie-authenticated routes: SameSite=Lax on the refresh
   * cookie, plus an explicit Origin check on every state-changing request.
   */
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.header('origin');
    if (!origin || allowedOrigins.includes(origin)) return next();

    // The extension exception is scoped to its own routes. An extension has no
    // business POSTing to /clients with whatever cookie happens to be lying
    // around, and this is what stops it.
    if (extensionOriginAllowed(origin) && req.path.startsWith('/api/v1/extension')) {
      return next();
    }

    return next(forbidden('Origin not allowed'));
  });

  /**
   * A stand-in for the portal form, so the extension can be walked through
   * before anyone has portal access. Never mounted in production — the route
   * does not exist there, so there is nothing to remember to disable.
   */
  if (!isProd) {
    app.use('/dev', devRouter);
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ifp-api', time: new Date().toISOString() });
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/clients', clientsRouter);
  v1.use('/cases', casesRouter);
  v1.use('/validation', validationRouter);
  v1.use('/consent', consentRouter);
  v1.use('/reference', referenceRouter);
  v1.use('/platform', platformRouter);
  v1.use('/extension', extensionRouter);
  v1.use('/', adminRouter); // /firms/current, /users, /audit

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

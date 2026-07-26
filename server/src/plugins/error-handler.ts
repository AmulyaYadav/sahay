import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { t } from '@sahay/shared';
import { AppError } from '../lib/errors.js';

/**
 * Uniform error envelope (zApiError in @sahay/shared) with localized messages.
 * Never leaks stack traces or internal messages to clients; full details go to
 * structured logs keyed by requestId.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    const locale = req.auth?.locale ?? 'en';
    const requestId = req.id;

    if (err instanceof AppError) {
      reply.status(err.status).send({
        error: {
          code: err.code,
          message: t(locale, `errors.${err.code}`),
          requestId,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'validation',
          message: t(locale, 'errors.validation'),
          requestId,
          details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) },
        },
      });
      return;
    }
    const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof statusCode === 'number' ? statusCode : 500;
    if (status >= 500) req.log.error({ err, requestId }, 'unhandled error');
    reply.status(status).send({
      error: {
        code: status === 429 ? 'rate_limited' : 'internal',
        message: t(locale, status === 429 ? 'errors.rate_limited' : 'common.error'),
        requestId,
      },
    });
  });
}

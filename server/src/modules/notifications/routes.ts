import type { FastifyInstance } from 'fastify';

/**
 * Intentionally a no-op registration: the notification feed endpoints
 * (GET /me/notifications, POST /me/notifications/:id/read, notification prefs,
 * push-token registration) live in modules/users/routes.ts, and delivery lives
 * in workers/notify.ts + lib/push.ts. Kept so app.ts wiring stays uniform and
 * routes are never registered twice.
 */
export function registerNotificationRoutes(_app: FastifyInstance): void {
  // Intentionally empty — see modules/users/routes.ts for the feed endpoints.
}

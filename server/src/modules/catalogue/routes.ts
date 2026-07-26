import type { FastifyInstance } from 'fastify';
import { listActiveCategories } from './service.js';

export function registerCatalogueRoutes(app: FastifyInstance): void {
  // Public: the catalogue contains nothing user-specific.
  app.get('/catalogue', async () => ({ categories: await listActiveCategories() }));
}

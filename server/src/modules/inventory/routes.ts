import type { FastifyInstance } from 'fastify';
import { zAddInventory, zUpdateInventory, zUuid } from '@sahay/shared';
import { addInventory, deleteInventory, listMyInventory, updateInventory } from './service.js';

export function registerInventoryRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/events/:id/inventory',
    { preHandler: [app.authenticate] },
    async (req) => ({
      items: await listMyInventory(req.auth!.userId, zUuid.parse(req.params.id)),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/events/:id/inventory',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zAddInventory.parse(req.body);
      return addInventory(req.auth!.userId, zUuid.parse(req.params.id), body);
    },
  );

  app.patch<{ Params: { itemId: string } }>(
    '/inventory/:itemId',
    { preHandler: [app.authenticate] },
    async (req) => {
      const body = zUpdateInventory.parse(req.body);
      return updateInventory(req.auth!.userId, zUuid.parse(req.params.itemId), body);
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    '/inventory/:itemId',
    { preHandler: [app.authenticate] },
    async (req) => {
      await deleteInventory(req.auth!.userId, zUuid.parse(req.params.itemId));
      return { ok: true };
    },
  );
}

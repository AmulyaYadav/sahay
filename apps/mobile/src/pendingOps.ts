import { useCallback, useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import type { InventoryItem } from '@sahay/shared';
import { api, isOfflineError } from './api';
import { useAuth } from './auth';
import { getJson, setJson, K } from './storage';
import { qk } from './hooks';

/**
 * Offline queue for inventory adds. An item is never shown as live until the
 * server acknowledged it with a 2xx — pending ops are rendered separately with
 * honest "saved locally / waiting to upload" badges.
 */
export interface PendingInventoryOp {
  /** Doubles as the idempotencyKey, so retries can never double-create. */
  id: string;
  eventId: string;
  body: {
    categoryId: string;
    qty: number;
    unit: string;
    details: Record<string, unknown>;
    idempotencyKey: string;
  };
  createdAt: number;
  attempts: number;
  lastError?: string;
}

async function readQueue(): Promise<PendingInventoryOp[]> {
  return (await getJson<PendingInventoryOp[]>(K.pendingInventory)) ?? [];
}

async function writeQueue(ops: PendingInventoryOp[]): Promise<void> {
  await setJson(K.pendingInventory, ops);
}

export async function enqueueInventoryOp(op: PendingInventoryOp): Promise<void> {
  const q = await readQueue();
  await writeQueue([...q, op]);
}

export async function removeInventoryOp(id: string): Promise<PendingInventoryOp[]> {
  const q = (await readQueue()).filter((o) => o.id !== id);
  await writeQueue(q);
  return q;
}

/**
 * Watches connectivity and flushes pending inventory ops with backoff.
 * Returns the current pending list (for the given event) plus a manual retry.
 */
export function usePendingInventory(eventId: string | null | undefined) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingInventoryOp[]>([]);
  const [flushing, setFlushing] = useState(false);

  const reload = useCallback(async () => {
    setPending(await readQueue());
  }, []);

  const flush = useCallback(async () => {
    if (!token || flushing) return;
    setFlushing(true);
    try {
      let q = await readQueue();
      for (const op of q) {
        try {
          await api<InventoryItem>(`/events/${op.eventId}/inventory`, {
            method: 'POST',
            token,
            body: op.body,
          });
          q = await removeInventoryOp(op.id);
          void qc.invalidateQueries({ queryKey: qk.inventory(op.eventId) });
        } catch (err) {
          if (isOfflineError(err)) break; // still offline; keep the rest queued
          // Server rejected it (validation, limits…): drop after several tries
          // so a poison op cannot wedge the queue; conflict = already created.
          const status = (err as { status?: number }).status;
          if (status === 409 || op.attempts >= 4) {
            q = await removeInventoryOp(op.id);
            void qc.invalidateQueries({ queryKey: qk.inventory(op.eventId) });
          } else {
            const updated = q.map((o) =>
              o.id === op.id
                ? { ...o, attempts: o.attempts + 1, lastError: (err as Error).message }
                : o,
            );
            await writeQueue(updated);
            q = updated;
          }
        }
      }
      setPending(q);
    } finally {
      setFlushing(false);
    }
  }, [token, flushing, qc]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Retry on reconnect with a small backoff.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected !== false) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void flush(), 1500);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [flush]);

  const forEvent = eventId ? pending.filter((p) => p.eventId === eventId) : pending;
  return { pending: forEvent, flush, reload, addLocal: enqueueInventoryOp };
}

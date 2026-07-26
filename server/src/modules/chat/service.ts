/**
 * Anonymous match chat. Participants are only ever identified by their match
 * aliases; message text is redacted of long digit runs (phone numbers) before
 * storage and NEVER appears in push payloads. Conversations expire: status
 * 'open' with a past expires_at reads (and enforces) as readonly lazily, ahead
 * of the retention sweep.
 */
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { QUICK_REPLIES, type Message } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { redactContactDetails } from '../../lib/redact.js';
import { notifyQueue } from '../../queues.js';
import { publishToUser } from '../../realtime/hub.js';

type ConversationRow = typeof schema.conversations.$inferSelect;
type MatchRow = typeof schema.matches.$inferSelect;
type MessageRow = typeof schema.messages.$inferSelect;

interface ChatContext {
  conversation: ConversationRow;
  match: MatchRow;
}

async function contextForViewer(conversationId: string, viewerUserId: string): Promise<ChatContext> {
  const db = getDb();
  const [row] = await db
    .select({ conversation: schema.conversations, match: schema.matches })
    .from(schema.conversations)
    .innerJoin(schema.matches, eq(schema.conversations.matchId, schema.matches.id))
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  if (!row) throw errors.notFound();
  const { match } = row;
  if (match.requesterId !== viewerUserId && match.helperId !== viewerUserId) {
    throw errors.notFound(); // participant-only; existence is not leaked
  }
  return row;
}

/** Lazy expiry: an 'open' conversation past its expires_at reads as readonly. */
function effectiveStatus(conversation: ConversationRow): 'open' | 'readonly' | 'expired' {
  const status = conversation.status as 'open' | 'readonly' | 'expired';
  if (status === 'open' && conversation.expiresAt && conversation.expiresAt <= new Date()) {
    return 'readonly';
  }
  return status;
}

function toMessage(row: MessageRow, match: MatchRow, viewerUserId: string): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderAlias: row.senderId === match.requesterId ? match.requesterAlias : match.helperAlias,
    mine: row.senderId === viewerUserId,
    kind: row.kind as Message['kind'],
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

export async function getConversationView(conversationId: string, viewerUserId: string) {
  const { conversation, match } = await contextForViewer(conversationId, viewerUserId);
  return {
    id: conversation.id,
    matchId: match.id,
    status: effectiveStatus(conversation),
    expiresAt: conversation.expiresAt ? conversation.expiresAt.toISOString() : null,
    quickReplies: [...QUICK_REPLIES],
  };
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const idx = cursor.indexOf('|');
  const createdAt = idx > 0 ? new Date(cursor.slice(0, idx)) : new Date(NaN);
  const id = idx > 0 ? cursor.slice(idx + 1) : '';
  if (Number.isNaN(createdAt.getTime()) || !id) throw errors.validation({ field: 'cursor' });
  return { createdAt, id };
}

export async function listMessages(
  conversationId: string,
  viewerUserId: string,
  input: { cursor?: string; limit: number },
): Promise<{ items: Message[]; nextCursor: string | null }> {
  const { match } = await contextForViewer(conversationId, viewerUserId);
  const db = getDb();
  const decoded = input.cursor ? decodeCursor(input.cursor) : null;

  const rows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        ...(decoded
          ? [
              or(
                gt(schema.messages.createdAt, decoded.createdAt),
                and(
                  eq(schema.messages.createdAt, decoded.createdAt),
                  sql`${schema.messages.id} > ${decoded.id}`,
                ),
              )!,
            ]
          : []),
      ),
    )
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .limit(input.limit);

  // Fetching counts as delivery for the peer's messages in this page.
  const undelivered = rows
    .filter((m) => m.senderId !== viewerUserId && m.deliveredAt == null)
    .map((m) => m.id);
  if (undelivered.length > 0) {
    const deliveredAt = new Date();
    await db
      .update(schema.messages)
      .set({ deliveredAt })
      .where(and(inArray(schema.messages.id, undelivered), isNull(schema.messages.deliveredAt)));
    for (const m of rows) {
      if (undelivered.includes(m.id)) m.deliveredAt = deliveredAt;
    }
  }

  const items = rows.map((m) => toMessage(m, match, viewerUserId));
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === input.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
  return { items, nextCursor };
}

export async function sendMessage(
  conversationId: string,
  viewerUserId: string,
  input: { kind: 'text' | 'quick'; body: string; clientMsgId: string },
): Promise<Message> {
  const { conversation, match } = await contextForViewer(conversationId, viewerUserId);
  const db = getDb();

  // Idempotency replay wins over everything else (flaky-network retries).
  const findExisting = async () => {
    const [existing] = await db
      .select()
      .from(schema.messages)
      .where(
        and(eq(schema.messages.senderId, viewerUserId), eq(schema.messages.clientMsgId, input.clientMsgId)),
      )
      .limit(1);
    return existing ?? null;
  };
  const replay = await findExisting();
  if (replay) return toMessage(replay, match, viewerUserId);

  if (effectiveStatus(conversation) !== 'open') throw errors.conflict();

  let body: string;
  if (input.kind === 'quick') {
    if (!(QUICK_REPLIES as readonly string[]).includes(input.body)) {
      throw errors.validation({ field: 'body', allowed: [...QUICK_REPLIES] });
    }
    body = input.body;
  } else {
    // Phone numbers must not flow through chat.
    body = redactContactDetails(input.body);
  }

  let message: MessageRow;
  try {
    const [created] = await db
      .insert(schema.messages)
      .values({
        conversationId,
        senderId: viewerUserId,
        kind: input.kind,
        body,
        clientMsgId: input.clientMsgId,
      })
      .returning();
    message = created!;
  } catch (err) {
    // (sender_id, client_msg_id) unique race: the concurrent retry won.
    if ((err as { code?: string }).code === '23505') {
      const existing = await findExisting();
      if (existing) return toMessage(existing, match, viewerUserId);
    }
    throw err;
  }

  const peerId = match.requesterId === viewerUserId ? match.helperId : match.requesterId;
  // The peer receives THEIR view (mine=false, alias resolved for them).
  await publishToUser(peerId, 'message.new', toMessage(message, match, peerId));
  await notifyQueue().add('notify', {
    userId: peerId,
    type: 'new_message',
    titleKey: 'notifications.new_message',
    bodyKey: 'notifications.vaguePreview', // actual text NEVER in push payloads
    params: {},
    deepLink: `/match/${match.id}`,
    // At most one push per conversation per minute — no notification flooding.
    dedupeKey: `msg:${conversationId}:${Math.floor(Date.now() / 60_000)}`,
  });

  return toMessage(message, match, viewerUserId);
}

export async function markRead(conversationId: string, viewerUserId: string): Promise<void> {
  const { match } = await contextForViewer(conversationId, viewerUserId);
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.messages)
    .set({
      readAt: now,
      deliveredAt: sql`COALESCE(${schema.messages.deliveredAt}, ${now})`,
    })
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        ne(schema.messages.senderId, viewerUserId),
        isNull(schema.messages.readAt),
      ),
    );
  const peerId = match.requesterId === viewerUserId ? match.helperId : match.requesterId;
  await publishToUser(peerId, 'conversation.update', { id: conversationId, readBy: 'peer' });
}

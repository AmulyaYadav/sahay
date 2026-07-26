/**
 * Reports and blocks. The subject of a report is always resolved SERVER-side
 * (via the match, or an event) — reporters never supply, or learn, another
 * account's identity. Conversation evidence is snapshotted at report time with
 * ALIASES only, so it survives normal chat expiry without ever tying messages
 * to account ids for moderators beyond what the report row itself links.
 */
import { desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { zCreateReport, zReportView } from '@sahay/shared';
import { getDb, schema } from '../../db/index.js';
import { errors } from '../../lib/errors.js';
import { rateLimit } from '../../lib/redis.js';
import { redactContactDetails } from '../../lib/redact.js';
import { cancelMatchForModeration } from '../matches/service.js';

export type CreateReportInput = z.infer<typeof zCreateReport>;
export type ReportView = z.infer<typeof zReportView>;

export const REPORTS_PER_DAY = 10;
const EVIDENCE_MESSAGE_LIMIT = 50;

/** Categories that flag the subject for prioritized human review. */
export const URGENT_REPORT_CATEGORIES: ReadonlySet<string> = new Set([
  'threat',
  'unsafe_meeting',
  'hate_speech',
]);
export const URGENT_RISK_FLAG = 'urgent_report';

export interface EvidenceMessage {
  senderAlias: string;
  body: string;
  createdAt: string;
}

/** Outcome wording is a fixed key pair — resolution details stay private. */
export function resolutionKeyFor(status: string): string | null {
  if (status === 'resolved') return 'reports.resolved.action_taken';
  if (status === 'dismissed') return 'reports.resolved.no_action';
  return null;
}

function toReportView(row: typeof schema.reports.$inferSelect): ReportView {
  return {
    id: row.id,
    category: row.category as ReportView['category'],
    status: row.status as ReportView['status'],
    createdAt: row.createdAt.toISOString(),
    resolutionKey: resolutionKeyFor(row.status),
  };
}

async function loadMatchForParticipant(matchId: string, userId: string) {
  const db = getDb();
  const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).limit(1);
  if (!match) throw errors.notFound();
  if (match.requesterId !== userId && match.helperId !== userId) throw errors.notFound();
  return match;
}

/** Last N messages of the match's conversation, aliases only — no user ids. */
async function snapshotEvidence(
  match: typeof schema.matches.$inferSelect,
): Promise<EvidenceMessage[] | null> {
  const db = getDb();
  const [conv] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.matchId, match.id))
    .limit(1);
  if (!conv) return null;
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conv.id))
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(EVIDENCE_MESSAGE_LIMIT);
  if (rows.length === 0) return null;
  return rows.reverse().map((m) => ({
    senderAlias: m.senderId === match.requesterId ? match.requesterAlias : match.helperAlias,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function createReport(userId: string, input: CreateReportInput): Promise<ReportView> {
  // Fail OPEN on limiter errors: a Redis blip must never block a safety report.
  const allowed = await rateLimit('report:create', userId, REPORTS_PER_DAY, 86_400).catch(() => true);
  if (!allowed) throw errors.rateLimited();

  const db = getDb();
  let subjectUserId: string | null = null;
  let subjectEventId: string | null = null;
  let matchId: string | null = null;
  let evidence: EvidenceMessage[] | null = null;

  if (input.matchId) {
    const match = await loadMatchForParticipant(input.matchId, userId);
    subjectUserId = match.requesterId === userId ? match.helperId : match.requesterId;
    subjectEventId = match.eventId;
    matchId = match.id;
    if (input.preserveConversation) evidence = await snapshotEvidence(match);
  } else if (input.eventId) {
    const [event] = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, input.eventId))
      .limit(1);
    if (!event) throw errors.notFound();
    subjectEventId = event.id;
  } else {
    throw errors.validation({ field: 'matchId', reason: 'matchId or eventId required' });
  }

  const [report] = await db
    .insert(schema.reports)
    .values({
      reporterId: userId,
      subjectUserId,
      subjectEventId,
      matchId,
      category: input.category,
      note: input.note ? redactContactDetails(input.note) : null,
      evidence,
    })
    .returning();

  // Urgent categories mark the subject for prioritized review (idempotent).
  if (subjectUserId && URGENT_REPORT_CATEGORIES.has(input.category)) {
    await db.execute(sql`
      UPDATE users SET risk_flags = array_append(risk_flags, ${URGENT_RISK_FLAG})
      WHERE id = ${subjectUserId} AND NOT (${URGENT_RISK_FLAG} = ANY(risk_flags))
    `);
  }

  return toReportView(report!);
}

export async function listMyReports(userId: string): Promise<ReportView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.reporterId, userId))
    .orderBy(desc(schema.reports.createdAt))
    .limit(100);
  return rows.map(toReportView);
}

/**
 * Block via a match (you never know peer account ids). Any still-active match
 * is cancelled through moderation cancel: reservation released, conversation
 * readonly, request → 'moderated' (the requester may renew it afterwards).
 */
export async function blockViaMatch(userId: string, matchId: string): Promise<void> {
  const db = getDb();
  const match = await loadMatchForParticipant(matchId, userId);
  const blockedId = match.requesterId === userId ? match.helperId : match.requesterId;

  await db
    .insert(schema.blocks)
    .values({ blockerId: userId, blockedId })
    .onConflictDoNothing();

  if (match.status === 'active') {
    await cancelMatchForModeration(match.id, 'blocked');
  }
}

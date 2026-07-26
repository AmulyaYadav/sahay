/**
 * Match room: peer header with reliability chips, meeting-state stepper with quick
 * actions (incl. "I no longer feel safe"), chat with optimistic sends + retry and a
 * 10s poll fallback when the WebSocket is down, role-appropriate completion, cancel
 * with reason picker, and always-reachable Block / Report.
 */
import { LIMITS, MEETING_STATES, type MatchView, type Message, type MeetingState } from '@sahay/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  markConversationRead,
  useBlockUser,
  useCancelMatch,
  useCatalogue,
  useConfirmCompletion,
  useConversation,
  useMatch,
  useMeetingUpdate,
  useMessages,
  useSendMessage,
} from '../api/hooks';
import { Avatar } from '../components/Avatar';
import { ReliabilityChips } from '../components/ReliabilityChips';
import { ReportDialog } from '../components/ReportDialog';
import { useLocale } from '../i18n/LocaleContext';
import { categoryName, formatTime, newIdempotencyKey, unitLabel } from '../lib/format';
import { useWsConnected } from '../realtime/useWs';
import { Badge, Banner, Button, Card, SkeletonCard, Stepper } from '../ui/components';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/Toast';

interface PendingMsg {
  clientMsgId: string;
  kind: 'text' | 'quick';
  body: string;
  failed: boolean;
}

const CANCEL_REASONS = [
  ['changed_mind', 'match.reasonChangedMind'],
  ['cannot_find', 'match.reasonCannotFind'],
  ['no_longer_needed', 'match.reasonNoLongerNeeded'],
  ['unsafe', 'match.reasonUnsafe'],
  ['other', 'match.reasonOther'],
] as const;

const QUICK_ACTIONS: MeetingState[] = ['on_my_way', 'arrived', 'cannot_find', 'exchanging'];

function MeetingStepper({ match }: { match: MatchView }) {
  const { t } = useLocale();
  return (
    <div className="grid-2">
      {(
        [
          ['match.yourStatus', match.myMeetingState],
          ['match.theirStatus', match.peerMeetingState],
        ] as const
      ).map(([label, state]) => (
        <div key={label}>
          <span className="field-label">{t(label)}</span>
          <ol className="meet-steps plain" style={{ listStyle: 'none', padding: 0 }}>
            {MEETING_STATES.map((s) => (
              <li key={s} className={s === state ? 'meet-step meet-step-active' : 'meet-step'} aria-current={s === state ? 'step' : undefined}>
                <span className="meet-dot" aria-hidden="true" />
                {t(`match.${s}`)}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function MatchRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { toast } = useToast();
  const wsConnected = useWsConnected();

  const matchQuery = useMatch(id, { refetchInterval: wsConnected ? false : 15_000 });
  const match = matchQuery.data;
  const conversation = useConversation(match?.conversationId);
  const messagesQuery = useMessages(match?.conversationId, wsConnected ? false : 10_000);
  const send = useSendMessage(match?.conversationId ?? '');
  const meeting = useMeetingUpdate();
  const cancel = useCancelMatch();
  const confirm = useConfirmCompletion();
  const block = useBlockUser();
  const catalogue = useCatalogue();

  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const [unsafeOpen, setUnsafeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('changed_mind');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmQty, setConfirmQty] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [showUnsafeFollowup, setShowUnsafeFollowup] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => {
    const items = [...(messagesQuery.data?.items ?? [])];
    items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return items;
  }, [messagesQuery.data]);

  // Mark peer messages read whenever new ones arrive.
  useEffect(() => {
    if (!match?.conversationId) return;
    if (messages.some((m) => !m.mine && !m.readAt)) {
      markConversationRead(match.conversationId).catch(() => undefined);
    }
  }, [messages, match?.conversationId]);

  // Keep scrolled to the latest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending.length]);

  if (matchQuery.isLoading) return <SkeletonCard lines={6} />;
  if (!match) return <p role="alert">{t('errors.not_found')}</p>;

  const cat = catalogue.data?.categories.find((c) => c.slug === match.categorySlug);
  const active = match.status === 'active';
  const chatOpen = active || conversation.data?.status === 'open';
  const confirmLabel = match.role === 'requester' ? t('match.confirmReceipt') : t('match.confirmDelivery');

  const doSend = (kind: 'text' | 'quick', body: string, existingId?: string) => {
    if (!match.conversationId || !body.trim()) return;
    const clientMsgId = existingId ?? newIdempotencyKey();
    if (!existingId) setPending((p) => [...p, { clientMsgId, kind, body, failed: false }]);
    else setPending((p) => p.map((m) => (m.clientMsgId === clientMsgId ? { ...m, failed: false } : m)));
    send.mutate(
      { kind, body, clientMsgId },
      {
        onSuccess: () => setPending((p) => p.filter((m) => m.clientMsgId !== clientMsgId)),
        onError: () => setPending((p) => p.map((m) => (m.clientMsgId === clientMsgId ? { ...m, failed: true } : m))),
      },
    );
  };

  const submitText = () => {
    const body = text.trim().slice(0, LIMITS.maxMessageLength);
    if (!body) return;
    setText('');
    doSend('text', body);
  };

  const doCancel = (reason: string) => {
    cancel.mutate(
      { id: match.id, body: { reason } },
      {
        onSuccess: () => {
          setUnsafeOpen(false);
          setCancelOpen(false);
          if (reason === 'unsafe') setShowUnsafeFollowup(true);
          toast(t('match.cancelled'));
        },
        onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
      },
    );
  };

  const renderMessage = (m: Message) => {
    const body = m.kind === 'quick' ? t(`chat.quick.${m.body}`) : m.body;
    if (m.kind === 'system') {
      return (
        <div key={m.id} className="msg msg-system">
          {body}
        </div>
      );
    }
    return (
      <div key={m.id} className={m.mine ? 'msg msg-mine' : 'msg msg-theirs'}>
        {body}
        <span className="msg-meta">
          <span>{formatTime(m.createdAt, locale)}</span>
          {m.mine ? (
            m.readAt ? (
              <Icon name="checks" size={14} label={t('misc.read')} />
            ) : m.deliveredAt ? (
              <Icon name="check" size={14} label={t('misc.delivered')} />
            ) : null
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Peer header */}
      <Card>
        <div className="stack-sm">
          <div className="row">
            <Avatar seed={match.peer.avatarSeed} name={match.peer.alias} size={48} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 'var(--fs-lg)' }}>{match.peer.alias}</strong>
              <span className="text-xs text-soft" style={{ display: 'block' }}>
                {categoryName(cat, locale) || match.categorySlug} — {match.qtyReserved} {unitLabel(t, match.unit)} ·{' '}
                {t(`proximity.${match.proximity}`)}
              </span>
            </div>
            <Badge tone={active ? 'ok' : 'neutral'}>{active ? t('events.active') : t(`match.${match.status === 'completed' || match.status === 'partially_completed' ? 'completed' : 'cancelled'}`)}</Badge>
          </div>
          <ReliabilityChips peer={match.peer} />
          <p className="text-xs text-soft" style={{ margin: 0 }}>
            {t('match.youAre', { alias: match.myAlias })}
          </p>
        </div>
      </Card>

      {match.status === 'disputed' ? (
        <Banner tone="warn" icon="info">
          {t('match.disputeNote')}
        </Banner>
      ) : null}
      {(match.status === 'completed' || match.status === 'partially_completed') && (
        <Banner tone="ok" icon="check">
          {t('match.completed')}
        </Banner>
      )}
      {showUnsafeFollowup || match.status === 'cancelled_unsafe' ? (
        <Banner tone="danger" icon="warning" role="alert">
          <p>{t('match.cancelled')}</p>
          <div className="row-wrap">
            <Button variant="destructive" loading={block.isPending} onClick={() => block.mutate({ matchId: match.id }, { onSuccess: () => toast(t('reports.blocked')) })}>
              {t('common.block')}
            </Button>
            <Button variant="secondary" onClick={() => setReportOpen(true)}>
              {t('common.report')}
            </Button>
          </div>
        </Banner>
      ) : null}

      {/* Meeting state */}
      {active ? (
        <Card>
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>{t('match.meetingState')}</h2>
          <MeetingStepper match={match} />
          <div className="row-wrap" style={{ marginTop: 'var(--sp-3)' }}>
            {QUICK_ACTIONS.map((s) => (
              <Button
                key={s}
                variant="secondary"
                loading={meeting.isPending && meeting.variables?.body.state === s}
                disabled={match.myMeetingState === s}
                onClick={() => meeting.mutate({ id: match.id, body: { state: s } })}
              >
                {t(`match.${s}`)}
              </Button>
            ))}
            <Button variant="destructive" onClick={() => setUnsafeOpen(true)}>
              {t('match.unsafe')}
            </Button>
          </div>
          <p className="text-xs text-soft" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
            <Icon name="shield" size={14} /> {t('safety.meetPublic')} {t('safety.canCancel')}
          </p>
        </Card>
      ) : null}

      {/* Completion */}
      {active ? (
        <div className="row-wrap">
          <Button
            large
            style={{ flex: 1 }}
            disabled={match.myConfirmedQty !== null}
            onClick={() => {
              setConfirmQty(match.qtyReserved);
              setConfirmOpen(true);
            }}
          >
            <Icon name="check" /> {confirmLabel}
          </Button>
          <Button variant="secondary" onClick={() => setCancelOpen(true)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}
      {match.myConfirmedQty !== null && active ? (
        <p className="text-sm text-soft" aria-live="polite">
          {t('sync.submitted')} — {match.myConfirmedQty} {unitLabel(t, match.unit)}
        </p>
      ) : null}

      {/* Chat */}
      <Card>
        <div ref={listRef} className="chat-list" style={{ maxHeight: '46dvh', overflowY: 'auto' }} aria-live="polite">
          {messages.map(renderMessage)}
          {pending.map((m) => (
            <button
              key={m.clientMsgId}
              type="button"
              className={m.failed ? 'msg msg-mine msg-failed' : 'msg msg-mine'}
              style={{ textAlign: 'left', font: 'inherit' }}
              onClick={() => (m.failed ? doSend(m.kind, m.body, m.clientMsgId) : undefined)}
              disabled={!m.failed}
            >
              {m.kind === 'quick' ? t(`chat.quick.${m.body}`) : m.body}
              <span className="msg-meta">{m.failed ? t('chat.sendFailed') : t('misc.sending')}</span>
            </button>
          ))}
        </div>

        {chatOpen ? (
          <>
            <div className="quick-replies" role="group" aria-label={t('chat.placeholder')}>
              {(conversation.data?.quickReplies ?? []).map((qr) => (
                <button key={qr} type="button" className="chip" onClick={() => doSend('quick', qr)}>
                  {t(`chat.quick.${qr}`)}
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                submitText();
              }}
            >
              <label className="visually-hidden" htmlFor="chat-input">
                {t('chat.placeholder')}
              </label>
              <input
                id="chat-input"
                className="input"
                style={{ flex: 1 }}
                placeholder={t('chat.placeholder')}
                value={text}
                maxLength={LIMITS.maxMessageLength}
                onChange={(e) => setText(e.target.value)}
              />
              <Button type="submit" disabled={!text.trim()} aria-label={t('common.ok')}>
                <Icon name="send" />
              </Button>
            </form>
            <p className="text-xs text-soft" style={{ marginTop: 'var(--sp-2)', marginBottom: 0 }}>
              {t('chat.expiresNote')}
            </p>
          </>
        ) : (
          <p className="text-sm text-soft">{t('chat.closed')}</p>
        )}
      </Card>

      {/* Block / report always reachable */}
      <div className="row-wrap">
        <Button
          variant="ghost"
          loading={block.isPending}
          onClick={() => block.mutate({ matchId: match.id }, { onSuccess: () => toast(t('reports.blocked')) })}
        >
          <Icon name="block" size={16} /> {t('common.block')}
        </Button>
        <Button variant="ghost" onClick={() => setReportOpen(true)}>
          <Icon name="flag" size={16} /> {t('common.report')}
        </Button>
      </div>

      {/* Unsafe confirm */}
      <Dialog open={unsafeOpen} onClose={() => setUnsafeOpen(false)} title={t('match.unsafe')}>
        <div className="stack">
          <p className="text-sm">{t('match.unsafeConfirm')}</p>
          <Button variant="destructive" block loading={cancel.isPending} onClick={() => doCancel('unsafe')}>
            {t('common.confirm')}
          </Button>
          <Button variant="secondary" block onClick={() => setUnsafeOpen(false)}>
            {t('common.back')}
          </Button>
        </div>
      </Dialog>

      {/* Cancel with reason */}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('match.cancelTitle')}>
        <div className="stack">
          <div role="radiogroup" aria-label={t('match.cancelReason')} className="stack-sm">
            <span className="field-label">{t('match.cancelReason')}</span>
            <div className="row-wrap">
              {CANCEL_REASONS.map(([reason, key]) => (
                <button
                  key={reason}
                  type="button"
                  role="radio"
                  aria-checked={cancelReason === reason}
                  className="chip"
                  onClick={() => setCancelReason(reason)}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
          <Button variant="destructive" block loading={cancel.isPending} onClick={() => doCancel(cancelReason)}>
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>

      {/* Completion qty */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={confirmLabel}>
        <div className="stack">
          <span className="field-label">{t('match.confirmQty')}</span>
          <Stepper
            value={confirmQty ?? match.qtyReserved}
            min={1}
            max={match.qtyReserved}
            onChange={setConfirmQty}
            unitLabel={unitLabel(t, match.unit)}
            decreaseLabel={t('misc.decrease')}
            increaseLabel={t('misc.increase')}
          />
          <Button
            block
            loading={confirm.isPending}
            onClick={() =>
              confirm.mutate(
                { id: match.id, body: { qty: confirmQty ?? match.qtyReserved, idempotencyKey: newIdempotencyKey() } },
                {
                  onSuccess: () => {
                    setConfirmOpen(false);
                    toast(t('sync.submitted'));
                  },
                  onError: (e) => toast(e instanceof Error ? e.message : t('common.error'), 'error'),
                },
              )
            }
          >
            {t('common.confirm')}
          </Button>
        </div>
      </Dialog>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} matchId={match.id} eventId={match.eventId} />

      {match.status.startsWith('cancelled') && !showUnsafeFollowup && match.status !== 'cancelled_unsafe' ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="secondary" onClick={() => navigate('/home')}>
            {t('misc.goHome')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

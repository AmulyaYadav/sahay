import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MatchView, MeetingState, Message, ReportCategory } from '@sahay/shared';
import { LIMITS, REPORT_CATEGORIES } from '@sahay/shared';
import { api, idempotencyKey, isOfflineError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useCatalogue, useConversation, useMatch, useMessages } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryName } from '../../src/catalogue';
import { formatTime } from '../../src/format';
import { lineHeightFor, radius, spacing, TOUCH, useTheme } from '../../src/theme';
import { Icon } from '../../src/components/icons';
import {
  Avatar,
  Badge,
  Body,
  BodyBold,
  Button,
  Card,
  Chip,
  ErrorView,
  Field,
  H3,
  LoadingView,
  Muted,
  MutedCaption,
  QuickReplyChip,
  Row,
  Stepper,
} from '../../src/components/ui';

interface LocalMessage {
  clientMsgId: string;
  kind: 'text' | 'quick';
  body: string;
  status: 'sending' | 'failed';
}

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { locale } = useLocale();
  const { token } = useAuth();

  const match = useMatch(id);
  const catalogue = useCatalogue();
  const conversationId = match.data?.conversationId ?? null;
  const conversation = useConversation(conversationId);
  const messages = useMessages(conversationId);

  const [draft, setDraft] = useState('');
  const [localMsgs, setLocalMsgs] = useState<LocalMessage[]>([]);
  const [busyState, setBusyState] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmQty, setConfirmQty] = useState(1);
  const [reporting, setReporting] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const serverMsgs = messages.data?.items ?? [];

  // Drop optimistic copies once the server echoes them back.
  useEffect(() => {
    if (serverMsgs.length === 0) return;
    setLocalMsgs((prev) => prev.filter((lm) => lm.status === 'failed'));
    // Mark peer messages read (best effort).
    if (conversationId && serverMsgs.some((m) => !m.mine && !m.readAt)) {
      void api(`/conversations/${conversationId}/read`, { method: 'POST', token }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.dataUpdatedAt]);

  const m: MatchView | undefined = match.data;
  const cat = useMemo(
    () => categoryBySlug(catalogue.data?.categories, m?.categorySlug ?? ''),
    [catalogue.data, m?.categorySlug],
  );

  useEffect(() => {
    if (m) setConfirmQty(m.qtyReserved);
  }, [m?.qtyReserved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (match.isLoading) return <LoadingView />;
  if (match.isError || !m) return <ErrorView onRetry={() => void match.refetch()} />;

  const active = m.status === 'active';
  const chatOpen = conversation.data?.status === 'open';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.match(m.id) });
    void qc.invalidateQueries({ queryKey: qk.activeMatches });
    void qc.invalidateQueries({ queryKey: qk.messages(conversationId ?? 'none') });
  };

  /* ------------------------------------------------------- meeting states */

  const setMeeting = async (state: MeetingState) => {
    setBusyState(true);
    try {
      await api(`/matches/${m.id}/meeting`, { method: 'POST', token, body: { state } });
      refresh();
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusyState(false);
    }
  };

  const cancelMatch = (reason: 'changed_mind' | 'cannot_find' | 'no_longer_needed' | 'unsafe') => {
    const doCancel = async () => {
      setBusyState(true);
      try {
        await api(`/matches/${m.id}/cancel`, { method: 'POST', token, body: { reason } });
        refresh();
        if (reason === 'unsafe') {
          // Offer block/report shortcuts immediately after an unsafe cancel.
          Alert.alert(t('match.cancelled'), t('safety.reportSuspicious'), [
            { text: t('common.block'), onPress: () => void blockPeer(false) },
            { text: t('common.report'), onPress: () => setReporting(true) },
            { text: t('common.close'), style: 'cancel' },
          ]);
        }
      } catch (err) {
        Alert.alert((err as Error).message || t('common.error'));
      } finally {
        setBusyState(false);
      }
    };
    if (reason === 'unsafe') {
      Alert.alert(t('match.unsafe'), t('match.unsafeConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => void doCancel() },
      ]);
    } else {
      const reasonLabel =
        reason === 'changed_mind'
          ? t('match.reasonChangedMind')
          : reason === 'cannot_find'
            ? t('match.reasonCannotFind')
            : t('match.reasonNoLongerNeeded');
      Alert.alert(t('match.cancelTitle'), `${t('match.cancelReason')} ${reasonLabel}`, [
        { text: t('common.back'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => void doCancel() },
      ]);
    }
  };

  const blockPeer = async (ask: boolean) => {
    const doBlock = async () => {
      try {
        await api('/blocks', { method: 'POST', token, body: { matchId: m.id } });
        Alert.alert(t('reports.blocked'));
        refresh();
      } catch (err) {
        Alert.alert((err as Error).message || t('common.error'));
      }
    };
    if (!ask) return doBlock();
    Alert.alert(t('common.block'), m.peer.alias, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.block'), style: 'destructive', onPress: () => void doBlock() },
    ]);
  };

  /* --------------------------------------------------------------- chat */

  const send = async (kind: 'text' | 'quick', body: string, existingId?: string) => {
    if (!conversationId || !body.trim()) return;
    const clientMsgId = existingId ?? idempotencyKey();
    if (!existingId) {
      setLocalMsgs((prev) => [...prev, { clientMsgId, kind, body, status: 'sending' }]);
      if (kind === 'text') setDraft('');
    } else {
      setLocalMsgs((prev) =>
        prev.map((lm) => (lm.clientMsgId === clientMsgId ? { ...lm, status: 'sending' } : lm)),
      );
    }
    try {
      await api(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        token,
        body: { kind, body, clientMsgId },
      });
      setLocalMsgs((prev) => prev.filter((lm) => lm.clientMsgId !== clientMsgId));
      void qc.invalidateQueries({ queryKey: qk.messages(conversationId) });
    } catch {
      // Offline or server error: keep the bubble with tap-to-retry.
      setLocalMsgs((prev) =>
        prev.map((lm) => (lm.clientMsgId === clientMsgId ? { ...lm, status: 'failed' } : lm)),
      );
    }
  };

  /* --------------------------------------------------------- completion */

  const confirmCompletion = async () => {
    setBusyState(true);
    try {
      await api(`/matches/${m.id}/confirm`, {
        method: 'POST',
        token,
        body: { qty: confirmQty, idempotencyKey: idempotencyKey() },
      });
      setConfirming(false);
      refresh();
      // Partial fulfilment follow-up lives on the request (requester only).
      if (m.role === 'requester' && confirmQty < m.qtyReserved) {
        router.push(`/request/${m.requestId}`);
      }
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusyState(false);
    }
  };

  const meetingActions: { state: MeetingState; label: string }[] = [
    { state: 'on_my_way', label: t('match.on_my_way') },
    { state: 'arrived', label: t('match.arrived') },
    { state: 'cannot_find', label: t('match.cannot_find') },
  ];

  const quickReplies = conversation.data?.quickReplies ?? [];

  return (
    <>
      <Stack.Screen options={{ title: m.peer.alias }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {/* Peer + honest trust chips */}
          <Card>
            <Row gap={spacing.md}>
              <Avatar seed={m.peer.avatarSeed} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <H3>{m.peer.alias}</H3>
                <Row gap={spacing.xs} style={{ flexWrap: 'wrap' }}>
                  <Badge label={t(`reliability.${m.peer.reliabilityLabel}`)} tone="accent" />
                  <Badge label={t('reliability.completedAssists', { count: m.peer.completedAssists })} />
                  <Badge label={t('reliability.memberSince', { month: m.peer.memberSince })} />
                  {m.peer.emailVerifiedLabel ? (
                    <Badge label={t('reliability.emailVerified')} tone="success" />
                  ) : (
                    <Badge label={t('reliability.notVerified')} tone="warn" />
                  )}
                </Row>
              </View>
            </Row>
            <MutedCaption>{t('reliability.verifiedMeaning')}</MutedCaption>
            <Muted>
              {categoryName(cat, locale)} · {m.qtyReserved} {t(`units.${m.unit}`)} ·{' '}
              {t(`proximity.${m.proximity}`)}
            </Muted>
          </Card>

          {/* My alias banner */}
          <Card tone="accent" style={{ paddingVertical: spacing.md }}>
            <Row gap={spacing.sm}>
              <Avatar seed={m.myAlias} size={28} />
              <Body style={{ flex: 1 }}>{t('match.youAre', { alias: m.myAlias })}</Body>
            </Row>
          </Card>

          {/* Status / meeting state */}
          {!active ? (
            <Card tone={m.status === 'completed' || m.status === 'partially_completed' ? 'accent' : 'warn'}>
              <BodyBold>
                {m.status === 'completed' || m.status === 'partially_completed'
                  ? t('match.completed')
                  : m.status === 'disputed'
                    ? t('match.disputeNote')
                    : t('match.cancelled')}
              </BodyBold>
            </Card>
          ) : (
            <Card>
              <BodyBold>{t('match.meetingState')}</BodyBold>
              <Muted>
                {t('match.yourStatus')}: {t(`match.${m.myMeetingState}`)} · {t('match.theirStatus')}
                : {t(`match.${m.peerMeetingState}`)}
              </Muted>
              <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
                {meetingActions.map((a) => (
                  <Chip
                    key={a.state}
                    label={a.label}
                    selected={m.myMeetingState === a.state}
                    onPress={() => void setMeeting(a.state)}
                  />
                ))}
              </Row>
              <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
                <Button
                  title={t('common.cancel')}
                  variant="ghost"
                  small
                  disabled={busyState}
                  onPress={() =>
                    cancelMatch(m.role === 'requester' ? 'no_longer_needed' : 'changed_mind')
                  }
                />
                <Button
                  title={t('match.unsafe')}
                  variant="danger"
                  small
                  disabled={busyState}
                  onPress={() => cancelMatch('unsafe')}
                />
              </Row>
            </Card>
          )}

          {/* Completion */}
          {active ? (
            <Card>
              {m.peerConfirmed ? <Badge label={t('sync.accepted')} tone="success" /> : null}
              {m.myConfirmedQty !== null ? (
                <Muted>
                  {t('match.confirmQty')}: {m.myConfirmedQty} {t(`units.${m.unit}`)}
                </Muted>
              ) : confirming ? (
                <View style={{ gap: spacing.md }}>
                  <BodyBold>{t('match.confirmQty')}</BodyBold>
                  <Stepper
                    value={confirmQty}
                    onChange={setConfirmQty}
                    min={1}
                    max={m.qtyReserved}
                    unitLabel={t(`units.${m.unit}`)}
                  />
                  <Row gap={spacing.sm}>
                    <Button
                      title={t('common.confirm')}
                      loading={busyState}
                      onPress={() => void confirmCompletion()}
                      style={{ flex: 1 }}
                    />
                    <Button title={t('common.back')} variant="ghost" onPress={() => setConfirming(false)} />
                  </Row>
                </View>
              ) : (
                <Button
                  title={m.role === 'requester' ? t('match.confirmReceipt') : t('match.confirmDelivery')}
                  variant="success"
                  onPress={() => setConfirming(true)}
                />
              )}
            </Card>
          ) : null}

          {/* Report / block */}
          <Row gap={spacing.sm}>
            <Button
              title={t('common.report')}
              variant="ghost"
              small
              onPress={() => setReporting((v) => !v)}
            />
            <Button title={t('common.block')} variant="ghost" small onPress={() => void blockPeer(true)} />
          </Row>
          {reporting ? (
            <ReportCard matchId={m.id} onDone={() => setReporting(false)} />
          ) : null}

          {/* Chat */}
          <MutedCaption>{t('chat.expiresNote')}</MutedCaption>
          {serverMsgs.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {localMsgs.map((lm) => (
            <View key={lm.clientMsgId} style={{ alignItems: 'flex-end' }}>
              <View
                style={{
                  backgroundColor: lm.status === 'failed' ? th.colors.errorTint : th.colors.success,
                  borderRadius: radius.lg,
                  borderBottomRightRadius: 4,
                  padding: spacing.md,
                  maxWidth: '80%',
                  opacity: lm.status === 'sending' ? 0.7 : 1,
                  gap: 2,
                }}
              >
                <Body color={lm.status === 'failed' ? th.colors.text : th.colors.textOnColor}>
                  {lm.kind === 'quick' ? t(`chat.quick.${lm.body}`) : lm.body}
                </Body>
                {lm.status === 'failed' ? (
                  <Button
                    title={t('chat.sendFailed')}
                    variant="ghost"
                    small
                    onPress={() => void send(lm.kind, lm.body, lm.clientMsgId)}
                  />
                ) : (
                  <MutedCaption color="#FFFFFFB3">{t('misc.sending')}</MutedCaption>
                )}
              </View>
            </View>
          ))}
          {!chatOpen ? <Muted center>{t('chat.closed')}</Muted> : null}
        </ScrollView>

        {/* Quick replies + composer */}
        {chatOpen ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: th.colors.border,
              backgroundColor: th.colors.card,
              padding: spacing.sm,
              paddingBottom: insets.bottom + spacing.sm,
              gap: spacing.sm,
            }}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {quickReplies.map((qr) => (
                <QuickReplyChip
                  key={qr}
                  label={t(`chat.quick.${qr}`)}
                  onPress={() => void send('quick', qr)}
                />
              ))}
            </ScrollView>
            <Row gap={spacing.sm} style={{ alignItems: 'flex-end' }}>
              <TextInput
                allowFontScaling
                accessibilityLabel={t('chat.placeholder')}
                placeholder={t('chat.placeholder')}
                placeholderTextColor={th.colors.textSecondary}
                value={draft}
                onChangeText={(v) => setDraft(v.slice(0, LIMITS.maxMessageLength))}
                multiline
                style={{
                  flex: 1,
                  minHeight: TOUCH,
                  maxHeight: 120,
                  borderRadius: radius.xl,
                  borderWidth: 1,
                  borderColor: th.colors.border,
                  backgroundColor: th.colors.canvas,
                  color: th.colors.text,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  fontSize: 14,
                  lineHeight: lineHeightFor(14),
                }}
              />
              {/* Circular green send button */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.ok')}
                accessibilityState={{ disabled: !draft.trim() }}
                disabled={!draft.trim()}
                onPress={() => void send('text', draft)}
                style={({ pressed }) => ({
                  width: TOUCH,
                  height: TOUCH,
                  borderRadius: TOUCH / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: th.colors.success,
                  opacity: !draft.trim() ? 0.4 : pressed ? 0.85 : 1,
                })}
              >
                <Icon name="send" size={20} color={th.colors.textOnColor} />
              </Pressable>
            </Row>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </>
  );
}

/* ------------------------------------------------------------ components */

/** Chat bubbles (§4.11): peer = surface + border, left, small avatar; mine = green, right. */
function MessageBubble({ msg }: { msg: Message }) {
  const t = useT();
  const th = useTheme();
  const { locale } = useLocale();
  /*
    System messages store a translation key, not prose — the server writes
    'match.completed' and the like so the line reads in whichever language the
    recipient has chosen. Only quick replies were being translated, so those
    keys were printed verbatim into the conversation.
  */
  const body =
    msg.kind === 'quick'
      ? t(`chat.quick.${msg.body}`)
      : msg.kind === 'system'
        ? t(msg.body)
        : msg.body;

  if (msg.kind === 'system') {
    return <MutedCaption center>{body}</MutedCaption>;
  }
  const ticks = msg.mine ? (msg.readAt ? '✓✓' : msg.deliveredAt ? '✓✓' : '✓') : '';
  const metaColor = msg.mine ? '#FFFFFFB3' : th.colors.textSecondary;
  const tickColor = msg.mine && msg.readAt ? '#FFFFFF' : metaColor;
  const bubble = (
    <View
      accessibilityLabel={`${msg.senderAlias}: ${body}`}
      style={{
        backgroundColor: msg.mine ? th.colors.success : th.colors.surface,
        borderRadius: radius.lg,
        borderBottomRightRadius: msg.mine ? 4 : radius.lg,
        borderBottomLeftRadius: msg.mine ? radius.lg : 4,
        borderWidth: msg.mine ? 0 : 1,
        borderColor: th.colors.border,
        padding: spacing.md,
        maxWidth: '80%',
        gap: 2,
      }}
    >
      <Body color={msg.mine ? th.colors.textOnColor : th.colors.text}>{body}</Body>
      <Row gap={4} style={{ alignSelf: 'flex-end' }}>
        <MutedCaption color={metaColor}>{formatTime(msg.createdAt, locale)}</MutedCaption>
        {ticks ? (
          <MutedCaption
            color={tickColor}
            accessibilityLabel={msg.readAt ? t('misc.read') : t('misc.delivered')}
          >
            {ticks}
          </MutedCaption>
        ) : null}
      </Row>
    </View>
  );
  if (msg.mine) {
    return <View style={{ alignItems: 'flex-end' }}>{bubble}</View>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
      <Avatar seed={msg.senderAlias} size={24} />
      {bubble}
    </View>
  );
}

function ReportCard({ matchId, onDone }: { matchId: string; onDone: () => void }) {
  const t = useT();
  const th = useTheme();
  const { token } = useAuth();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [preserve, setPreserve] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!category) return;
    setBusy(true);
    try {
      await api('/reports', {
        method: 'POST',
        token,
        body: {
          category,
          note: note.trim() || undefined,
          matchId,
          preserveConversation: preserve,
        },
      });
      Alert.alert(t('reports.submitted'));
      onDone();
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
      setBusy(false);
    }
  };

  return (
    <Card tone="danger">
      <BodyBold>{t('reports.reason')}</BodyBold>
      <Row gap={spacing.xs} style={{ flexWrap: 'wrap' }}>
        {REPORT_CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={t(`reports.${c}`)}
            selected={category === c}
            tone="danger"
            onPress={() => setCategory(c)}
          />
        ))}
      </Row>
      <Field
        label={t('reports.detail')}
        value={note}
        onChangeText={(v) => setNote(v.slice(0, LIMITS.maxReportNoteLength))}
        multiline
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Body style={{ flex: 1 }}>{t('reports.preserve')}</Body>
        <Switch
          accessibilityLabel={t('reports.preserve')}
          value={preserve}
          onValueChange={setPreserve}
          trackColor={{ true: th.colors.accent, false: th.colors.border }}
        />
      </Row>
      <Row gap={spacing.sm}>
        <Button
          title={t('reports.title')}
          variant="danger"
          loading={busy}
          disabled={!category}
          onPress={() => void submit()}
          style={{ flex: 1 }}
        />
        <Button title={t('common.cancel')} variant="ghost" onPress={onDone} />
      </Row>
    </Card>
  );
}

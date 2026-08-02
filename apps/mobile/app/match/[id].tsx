import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import type { MatchView, Message, ReportCategory } from '@sahay/shared';
import { LIMITS, REPORT_CATEGORIES } from '@sahay/shared';
import { api, idempotencyKey } from '../../src/api';
import { useAuth } from '../../src/auth';
import { qk, useCatalogue, useConversation, useMatch, useMessages } from '../../src/hooks';
import { useLocale, useT } from '../../src/locale';
import { categoryBySlug, categoryName } from '../../src/catalogue';
import { formatTime } from '../../src/format';
import { lineHeightFor, mockRadius, radius, spacing, TOUCH, useTheme } from '../../src/theme';
import { Icon, type IconName } from '../../src/components/icons';
import {
  Avatar,
  Body,
  BodyBold,
  Button,
  Card,
  Caption,
  Chip,
  ErrorView,
  Field,
  H3,
  LoadingView,
  Muted,
  MutedCaption,
  QuickReplyChip,
  Row,
} from '../../src/components/ui';

/**
 * The conversation.
 *
 * It used to open on a stack of cards — peer profile, alias banner, meeting
 * state, completion, report/block — with the messages themselves last and the
 * composer squeezed underneath. The exchange is a conversation; everything else
 * is a control, and controls belong behind one entry point rather than in front
 * of the thing they act on.
 *
 * So: a header naming who you are talking to, one line of safety guidance, the
 * messages, and two pills above the composer. Meeting state ("on my way",
 * "arrived") is gone entirely — it duplicated in buttons what people were
 * already saying in words.
 */
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const serverMsgs = messages.data?.items ?? [];

  // Drop optimistic copies once the server echoes them back.
  useEffect(() => {
    if (serverMsgs.length === 0) return;
    setLocalMsgs((prev) => prev.filter((lm) => lm.status === 'failed'));
    if (conversationId && serverMsgs.some((mm) => !mm.mine && !mm.readAt)) {
      void api(`/conversations/${conversationId}/read`, { method: 'POST', token }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.dataUpdatedAt]);

  const m: MatchView | undefined = match.data;
  const cat = useMemo(
    () => categoryBySlug(catalogue.data?.categories, m?.categorySlug ?? ''),
    [catalogue.data, m?.categorySlug],
  );

  const refresh = () => {
    if (!m) return;
    void qc.invalidateQueries({ queryKey: qk.match(m.id) });
    void qc.invalidateQueries({ queryKey: qk.activeMatches });
    void qc.invalidateQueries({ queryKey: qk.messages(conversationId ?? 'none') });
    // Confirming or cancelling settles the reserved stock, so the counts on
    // home and the supplies tab are out of date the moment this returns.
    void qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  /* --------------------------------------------------------- completion */

  const confirmExchange = async () => {
    if (!m) return;
    setBusyState(true);
    try {
      await api(`/matches/${m.id}/confirm`, {
        method: 'POST',
        token,
        // The whole reserved quantity. Splitting it was a stepper nobody
        // needed for an exchange where nothing is being paid for; the server
        // still settles on the lower of the two figures if they ever differ.
        body: { qty: m.qtyReserved, idempotencyKey: idempotencyKey() },
      });
      refresh();
    } catch (err) {
      Alert.alert((err as Error).message || t('common.error'));
    } finally {
      setBusyState(false);
    }
  };

  const askConfirmExchange = () => {
    if (!m) return;
    // Guard against a misclick: this settles stock and closes the chat.
    Alert.alert(t('chat.confirmDoneTitle'), t('chat.confirmDoneBody', { alias: m.peer.alias }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chat.confirmDoneCta'), onPress: () => void confirmExchange() },
    ]);
  };

  /*
    The other side went first. Ask once, when their confirmation arrives —
    `asked` keeps a poll or a websocket refresh from re-opening the dialog on
    every render while the person is reading it.
  */
  const asked = useRef(false);
  useEffect(() => {
    if (!m || m.status !== 'active') return;
    if (!m.peerConfirmed || m.myConfirmedQty !== null || asked.current) return;
    asked.current = true;
    const item = `${Math.round(Number(m.qtyReserved))} ${categoryName(cat, locale)}`.trim();
    Alert.alert(
      t('chat.peerDoneTitle', { alias: m.peer.alias }),
      m.role === 'requester'
        ? t('chat.peerDoneReceived', { item })
        : t('chat.peerDoneGiven', { item }),
      [
        { text: t('chat.notYet'), style: 'cancel' },
        { text: t('common.confirm'), onPress: () => void confirmExchange() },
      ],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.peerConfirmed, m?.myConfirmedQty, m?.status]);

  /* ------------------------------------------------------------- actions */

  const cancelMatch = (reason: 'changed_mind' | 'cannot_find' | 'no_longer_needed' | 'unsafe') => {
    if (!m) return;
    const doCancel = async () => {
      setBusyState(true);
      try {
        await api(`/matches/${m.id}/cancel`, { method: 'POST', token, body: { reason } });
        refresh();
        if (reason === 'unsafe') {
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
      Alert.alert(t('match.cancelTitle'), t('chat.sheetEndBody'), [
        { text: t('common.back'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => void doCancel() },
      ]);
    }
  };

  const blockPeer = async (ask: boolean) => {
    if (!m) return;
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
      setLocalMsgs((prev) =>
        prev.map((lm) => (lm.clientMsgId === clientMsgId ? { ...lm, status: 'failed' } : lm)),
      );
    }
  };

  if (match.isLoading) return <LoadingView />;
  if (match.isError || !m) return <ErrorView onRetry={() => void match.refetch()} />;

  const active = m.status === 'active';
  const chatOpen = conversation.data?.status === 'open';
  // Once both sides confirm, the exchange is over and the composer goes with
  // it. The server keeps a grace window on the conversation for retention, not
  // for more talking.
  const canWrite = active && chatOpen;
  const quickReplies = conversation.data?.quickReplies ?? [];
  const iConfirmed = m.myConfirmedQty !== null;

  const sheetItem = (
    icon: IconName,
    tint: string,
    title: string,
    body: string,
    onPress: () => void,
  ) => (
    <Pressable
      key={title}
      accessibilityRole="button"
      onPress={() => {
        setSheetOpen(false);
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: pressed ? th.colors.cardAlt : 'transparent',
      })}
    >
      <Icon name={icon} size={22} color={tint} />
      <View style={{ flex: 1, gap: 2 }}>
        <Body>{title}</Body>
        <MutedCaption>{body}</MutedCaption>
      </View>
      <Icon name="chevron-right" size={18} color={th.colors.textSecondary} />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: th.colors.bg, paddingTop: insets.top }}>
        {/* Header: who, and how far away. */}
        <Row
          gap={spacing.sm}
          style={{
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.sm,
            alignItems: 'center',
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => router.back()}
            hitSlop={8}
            style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="arrow-left" size={24} color={th.colors.text} />
          </Pressable>
          <Avatar seed={m.peer.avatarSeed} size={40} />
          <View style={{ flex: 1 }}>
            <H3 numberOfLines={1}>{m.peer.alias}</H3>
            <Row gap={6} style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: th.colors.success,
                }}
              />
              <MutedCaption>{t(`proximity.${m.proximity}`)}</MutedCaption>
            </Row>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.more')}
            onPress={() => setSheetOpen(true)}
            hitSlop={8}
            style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="info" size={22} color={th.colors.text} />
          </Pressable>
        </Row>

        {/* One line of guidance, always visible, linking to the full page. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/safety')}
          style={{
            marginHorizontal: spacing.md,
            marginBottom: spacing.sm,
            padding: spacing.md,
            borderRadius: mockRadius.input,
            borderWidth: 1,
            borderColor: th.colors.border,
            backgroundColor: th.colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <Icon name="shield" size={18} color={th.colors.primary} />
          <MutedCaption style={{ flex: 1 }}>{t('chat.safetyBanner')}</MutedCaption>
          <Caption color={th.colors.primary}>{t('chat.safetyTips')}</Caption>
          <Icon name="chevron-right" size={16} color={th.colors.primary} />
        </Pressable>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.md,
              gap: spacing.sm,
            }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {serverMsgs.map((msg, i) => (
              <React.Fragment key={msg.id}>
                <DaySeparator prev={serverMsgs[i - 1]?.createdAt} current={msg.createdAt} />
                <MessageBubble msg={msg} />
              </React.Fragment>
            ))}
            {localMsgs.map((lm) => (
              <View key={lm.clientMsgId} style={{ alignItems: 'flex-end' }}>
                <View
                  style={{
                    backgroundColor: lm.status === 'failed' ? th.colors.errorTint : th.colors.primary,
                    borderRadius: radius.lg,
                    borderBottomRightRadius: 4,
                    padding: spacing.md,
                    maxWidth: '82%',
                    opacity: lm.status === 'sending' ? 0.7 : 1,
                    gap: 2,
                  }}
                >
                  <Body color={lm.status === 'failed' ? th.colors.text : '#FFFFFF'}>
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

            {!active ? (
              <Muted center style={{ marginTop: spacing.md }}>
                {m.status === 'completed' || m.status === 'partially_completed'
                  ? t('match.completed')
                  : m.status === 'disputed'
                    ? t('match.disputeNote')
                    : t('match.cancelled')}
              </Muted>
            ) : iConfirmed ? (
              <Muted center style={{ marginTop: spacing.sm }}>
                {t('chat.waitingPeer', { alias: m.peer.alias })}
              </Muted>
            ) : null}
            {active && !chatOpen ? <Muted center>{t('chat.closed')}</Muted> : null}
          </ScrollView>

          {/* Two pills: finish the exchange, or get help. Nothing else. */}
          {canWrite ? (
            <Row gap={spacing.sm} style={{ justifyContent: 'center', paddingBottom: spacing.sm }}>
              {!iConfirmed ? (
                <PillButton
                  icon="check"
                  label={t('chat.exchangeDone')}
                  tint={th.colors.success}
                  disabled={busyState}
                  onPress={askConfirmExchange}
                />
              ) : null}
              <PillButton
                icon="shield"
                label={t('chat.safety')}
                tint={th.colors.textSecondary}
                onPress={() => setSheetOpen(true)}
              />
            </Row>
          ) : null}

          {canWrite ? (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: th.colors.border,
                backgroundColor: th.colors.card,
                paddingHorizontal: spacing.sm,
                paddingTop: spacing.sm,
                paddingBottom: insets.bottom + spacing.sm,
                gap: spacing.sm,
              }}
            >
              {showQuick ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.sm }}
                >
                  {quickReplies.map((qr) => (
                    <QuickReplyChip
                      key={qr}
                      label={t(`chat.quick.${qr}`)}
                      onPress={() => {
                        setShowQuick(false);
                        void send('quick', qr);
                      }}
                    />
                  ))}
                </ScrollView>
              ) : null}
              <Row gap={spacing.sm} style={{ alignItems: 'flex-end' }}>
                {/* The quick replies used to sit above the composer permanently.
                    Behind a button they stay one tap away without taking a
                    whole row of the conversation. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.quickReplies')}
                  accessibilityState={{ expanded: showQuick }}
                  onPress={() => setShowQuick((v) => !v)}
                  style={({ pressed }) => ({
                    width: TOUCH,
                    height: TOUCH,
                    borderRadius: TOUCH / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed || showQuick ? th.colors.cardAlt : 'transparent',
                    borderWidth: 1,
                    borderColor: th.colors.border,
                  })}
                >
                  <Icon name={showQuick ? 'close' : 'plus'} size={20} color={th.colors.text} />
                </Pressable>
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
                    backgroundColor: th.colors.primary,
                    opacity: !draft.trim() ? 0.4 : pressed ? 0.85 : 1,
                  })}
                >
                  <Icon name="send" size={20} color="#FFFFFF" />
                </Pressable>
              </Row>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>

      {/* Safety menu */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => setSheetOpen(false)}
          style={{ flex: 1, backgroundColor: '#0B1220A6', justifyContent: 'flex-end' }}
        >
          <Pressable
            style={{
              backgroundColor: th.colors.surface,
              borderTopLeftRadius: mockRadius.sheet,
              borderTopRightRadius: mockRadius.sheet,
              paddingTop: spacing.sm,
              paddingBottom: insets.bottom + spacing.md,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: th.colors.border,
                marginBottom: spacing.sm,
              }}
            />
            {sheetItem(
              'alert',
              th.colors.error,
              t('chat.sheetUnsafe'),
              t('chat.sheetUnsafeBody'),
              () => cancelMatch('unsafe'),
            )}
            {sheetItem('flag', th.colors.warning, t('chat.sheetReport'), t('chat.sheetReportBody'), () =>
              setReporting(true),
            )}
            {sheetItem('eye-off', th.colors.textSecondary, t('chat.sheetBlock'), t('chat.sheetBlockBody'), () =>
              void blockPeer(true),
            )}
            {active
              ? sheetItem('log-out', th.colors.textSecondary, t('chat.sheetEnd'), t('chat.sheetEndBody'), () =>
                  cancelMatch(m.role === 'requester' ? 'no_longer_needed' : 'changed_mind'),
                )
              : null}
            {sheetItem('info', th.colors.primary, t('chat.safetyTips'), t('chat.sheetTipsBody'), () =>
              router.push('/settings/safety'),
            )}
            <MutedCaption style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
              {t('chat.expiresNote')}
            </MutedCaption>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Report form */}
      <Modal
        visible={reporting}
        transparent
        animationType="slide"
        onRequestClose={() => setReporting(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0B1220A6', justifyContent: 'flex-end' }}>
          <ScrollView
            style={{ maxHeight: '85%' }}
            contentContainerStyle={{
              backgroundColor: th.colors.bg,
              borderTopLeftRadius: mockRadius.sheet,
              borderTopRightRadius: mockRadius.sheet,
              padding: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
            }}
          >
            <ReportCard matchId={m.id} onDone={() => setReporting(false)} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------ components */

/** Outlined pill above the composer (mockup: "Exchange done" / "Safety"). */
function PillButton({
  icon,
  label,
  tint,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  tint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const th = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: TOUCH,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: tint,
        backgroundColor: pressed ? th.colors.cardAlt : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={18} color={tint} />
      <BodyBold color={tint}>{label}</BodyBold>
    </Pressable>
  );
}

/** "Today" / "Yesterday" / a date, printed once when the day changes. */
function DaySeparator({ prev, current }: { prev?: string; current: string }) {
  const t = useT();
  const th = useTheme();
  const { locale } = useLocale();
  const day = (iso: string) => new Date(iso).toDateString();
  if (prev && day(prev) === day(current)) return null;

  const d = new Date(current);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const label =
    day(current) === today.toDateString()
      ? t('chat.today')
      : day(current) === yesterday.toDateString()
        ? t('chat.yesterday')
        : d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
            day: 'numeric',
            month: 'short',
          });

  return (
    <Row gap={spacing.md} style={{ alignItems: 'center', marginVertical: spacing.sm }}>
      <View style={{ flex: 1, height: 1, backgroundColor: th.colors.border }} />
      <MutedCaption>{label}</MutedCaption>
      <View style={{ flex: 1, height: 1, backgroundColor: th.colors.border }} />
    </Row>
  );
}

/** Peer bubbles left on the surface colour, mine right in primary. */
function MessageBubble({ msg }: { msg: Message }) {
  const t = useT();
  const th = useTheme();
  const { locale } = useLocale();
  /*
    System messages store a translation key, not prose — the server writes
    'match.completed' and the like so the line reads in whichever language the
    recipient has chosen.
  */
  const body =
    msg.kind === 'quick'
      ? t(`chat.quick.${msg.body}`)
      : msg.kind === 'system'
        ? t(msg.body)
        : msg.body;

  if (msg.kind === 'system') {
    return (
      <MutedCaption center style={{ marginVertical: spacing.xs }}>
        {body}
      </MutedCaption>
    );
  }

  const ticks = msg.mine ? (msg.readAt || msg.deliveredAt ? '✓✓' : '✓') : '';
  const metaColor = msg.mine ? '#FFFFFFB3' : th.colors.textSecondary;

  return (
    <View style={{ alignItems: msg.mine ? 'flex-end' : 'flex-start' }}>
      <View
        accessibilityLabel={`${msg.senderAlias}: ${body}`}
        style={{
          backgroundColor: msg.mine ? th.colors.primary : th.colors.surface,
          borderRadius: radius.lg,
          borderBottomRightRadius: msg.mine ? 4 : radius.lg,
          borderBottomLeftRadius: msg.mine ? radius.lg : 4,
          borderWidth: msg.mine ? 0 : 1,
          borderColor: th.colors.border,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          maxWidth: '82%',
          gap: 2,
        }}
      >
        <Body color={msg.mine ? '#FFFFFF' : th.colors.text}>{body}</Body>
        <Row gap={4} style={{ alignSelf: 'flex-end' }}>
          <MutedCaption color={metaColor}>{formatTime(msg.createdAt, locale)}</MutedCaption>
          {ticks ? (
            <MutedCaption
              color={msg.readAt ? '#FFFFFF' : metaColor}
              accessibilityLabel={msg.readAt ? t('misc.read') : t('misc.delivered')}
            >
              {ticks}
            </MutedCaption>
          ) : null}
        </Row>
      </View>
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

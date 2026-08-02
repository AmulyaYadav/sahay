import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockRadius, spacing, TOUCH, useTheme } from './theme';
import { Body, BodyBold, Caption, Row, Title } from './components/ui';
import { Icon, type IconName } from './components/icons';
import { useAuth } from './auth';
import { useT } from './locale';

/**
 * App-wide navigation drawer, opened by the header's menu button.
 *
 * It is an index to the whole app: the tabs, the things that are not tabs, and a
 * Settings row that opens the existing settings screen. Settings used to BE the
 * menu, which conflated "where can I go" with "what can I change".
 *
 * Implemented here rather than with expo-router's Drawer layout so it can sit
 * above the tab navigator without restructuring routing, and so the slide and
 * scrim animate together.
 */
interface DrawerValue {
  open: () => void;
  close: () => void;
}

const DrawerContext = createContext<DrawerValue>({ open: () => {}, close: () => {} });

export function useDrawer(): DrawerValue {
  return useContext(DrawerContext);
}

const WIDTH = Math.min(320, Dimensions.get('window').width * 0.82);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const animate = useCallback(
    (to: number, after?: () => void) => {
      Animated.timing(progress, {
        toValue: to,
        duration: to === 1 ? 260 : 200,
        // Decelerate on the way in, accelerate on the way out — the drawer
        // should feel like it is being pulled, then released.
        easing: to === 1 ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(after);
    },
    [progress],
  );

  const open = useCallback(() => {
    setMounted(true);
    // Mount first, then animate, or the first frame renders already-open.
    requestAnimationFrame(() => animate(1));
  }, [animate]);

  const close = useCallback(() => animate(0, () => setMounted(false)), [animate]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <DrawerContext.Provider value={value}>
      {children}
      {mounted ? <DrawerPanel progress={progress} onClose={close} /> : null}
    </DrawerContext.Provider>
  );
}

function DrawerPanel({ progress, onClose }: { progress: Animated.Value; onClose: () => void }) {
  const t = useT();
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();

  const go = (path: string) => () => {
    onClose();
    router.push(path as never);
  };

  const item = (icon: IconName, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: TOUCH + 4,
        paddingHorizontal: spacing.lg,
        borderRadius: mockRadius.input,
        backgroundColor: pressed ? th.colors.cardAlt : 'transparent',
      })}
    >
      <Icon name={icon} size={20} color={th.colors.textSecondary} />
      <Body style={{ flex: 1 }}>{label}</Body>
    </Pressable>
  );

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Scrim fades with the slide and closes on tap. */}
      <Animated.View style={{ ...StyleSheetAbsolute, opacity: progress }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: '#0B1220A6' }}
        />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: WIDTH,
          backgroundColor: th.colors.surface,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH, 0] }) },
          ],
          shadowColor: '#0B1220',
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 8, height: 0 },
          elevation: 16,
        }}
      >
        <View style={{ paddingHorizontal: spacing.lg, gap: 2, marginBottom: spacing.lg }}>
          <Row gap={spacing.sm} style={{ alignItems: 'center' }}>
            <Icon name="hand-heart" size={22} color={th.colors.primary} />
            <Title style={{ fontSize: 20 }}>{t('common.appName')}</Title>
          </Row>
          {me?.pseudonym ? <Caption color={th.colors.textSecondary}>{me.pseudonym}</Caption> : null}
        </View>

        <ScrollView contentContainerStyle={{ gap: 2 }}>
          {item('home', t('tabs.home'), go('/(tabs)/home'))}
          {item('map-pin', t('tabs.events'), go('/(tabs)/events'))}
          {item('backpack', t('tabs.activity'), go('/(tabs)/supplies'))}
          {item('user', t('tabs.profile'), go('/(tabs)/profile'))}

          <View style={{ height: 1, backgroundColor: th.colors.border, marginVertical: spacing.sm }} />

          {/* Second route to the request flow, so it is reachable from any
              screen and not only from Home. */}
          {item('hand-heart', t('home.requestHelp'), go('/request/new'))}

          <View style={{ height: 1, backgroundColor: th.colors.border, marginVertical: spacing.sm }} />

          {item('bell', t('notifications.title'), go('/settings/notifications'))}
          {item('shield', t('safety.guidance'), go('/settings/safety'))}
          {item('info', t('settings.legal'), go('/settings/legal'))}

          <View style={{ height: 1, backgroundColor: th.colors.border, marginVertical: spacing.sm }} />

          {/* Settings is now one destination inside the index, not the index itself. */}
          {item('settings', t('settings.title'), go('/settings'))}
        </ScrollView>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
          <BodyBold color={th.colors.textSecondary} style={{ fontSize: 12 }}>
            {t('common.appName')}
          </BodyBold>
        </View>
      </Animated.View>
    </View>
  );
}

const StyleSheetAbsolute = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

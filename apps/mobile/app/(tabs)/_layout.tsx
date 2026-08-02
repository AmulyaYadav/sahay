import React from 'react';
import { PixelRatio } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../src/locale';
import { lineHeightFor, useTheme } from '../../src/theme';
import { Icon, type IconName } from '../../src/components/icons';

const TAB_ICON = 22;
/** 1.5x like the rest of the scale, so the Hindi tab labels are not clipped. */
const TAB_LABEL_LINE = lineHeightFor(12);
/** React Navigation's own vertical padding on a tab item (`padding: 5`, twice). */
const TAB_ITEM_PADDING = 10;

export default function TabsLayout() {
  const t = useT();
  const th = useTheme();
  const insets = useSafeAreaInsets();

  /*
    React Navigation hard-codes the bar at 49pt plus the safe-area inset,
    whatever is inside it. At the default font that leaves 1pt spare over the
    icon, label and item padding — so the labels sit flush against the bottom
    edge — and at a larger system font the label grows past the bar and its
    descenders are cut off. Sizing the bar to its contents fixes both; a number
    here is read as an explicit height and replaces the hard-coded one.

    The scale is clamped so a very large font setting cannot eat the screen.
  */
  const fontScale = Math.min(PixelRatio.getFontScale(), 1.6);
  const tabContent =
    TAB_ITEM_PADDING + TAB_ICON + Math.ceil(TAB_LABEL_LINE * fontScale) + 4; // +4 breathing room

  const icon = (name: IconName) =>
    function TabIcon({ color }: { color: string; focused: boolean }) {
      return <Icon name={name} size={TAB_ICON} color={color} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: th.colors.canvas },
        headerTintColor: th.colors.text,
        headerTitleStyle: { color: th.colors.text, fontWeight: '600' },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: th.colors.surface,
          borderTopWidth: 1,
          borderTopColor: th.colors.border,
          height: tabContent + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: th.colors.primary,
        tabBarInactiveTintColor: th.colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12, lineHeight: TAB_LABEL_LINE, fontWeight: '500' },
        sceneStyle: { backgroundColor: th.colors.canvas },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: t('tabs.home'), headerShown: false, tabBarIcon: icon('home') }}
      />
      <Tabs.Screen
        name="events"
        options={{ title: t('tabs.events'), headerShown: false, tabBarIcon: icon('map-pin') }}
      />
      <Tabs.Screen
        name="supplies"
        options={{ title: t('tabs.activity'), headerShown: false, tabBarIcon: icon('backpack') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('tabs.profile'), headerShown: false, tabBarIcon: icon('user') }}
      />
    </Tabs>
  );
}

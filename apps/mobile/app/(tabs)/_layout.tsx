import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useT } from '../../src/locale';
import { useTheme } from '../../src/theme';

function Glyph({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <Text allowFontScaling={false} style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>
      {symbol}
    </Text>
  );
}

export default function TabsLayout() {
  const t = useT();
  const th = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: th.colors.bg },
        headerTintColor: th.colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: th.colors.card, borderTopColor: th.colors.border },
        tabBarActiveTintColor: th.colors.accent,
        tabBarInactiveTintColor: th.colors.muted,
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: th.colors.bg },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ focused }) => <Glyph symbol="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: t('tabs.events'),
          tabBarIcon: ({ focused }) => <Glyph symbol="📍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="supplies"
        options={{
          title: t('tabs.supplies'),
          tabBarIcon: ({ focused }) => <Glyph symbol="🎒" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused }) => <Glyph symbol="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

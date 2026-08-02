import React from 'react';
import { Tabs } from 'expo-router';
import { useT } from '../../src/locale';
import { useTheme } from '../../src/theme';
import { Icon, type IconName } from '../../src/components/icons';

export default function TabsLayout() {
  const t = useT();
  const th = useTheme();
  const icon = (name: IconName) =>
    function TabIcon({ color }: { color: string; focused: boolean }) {
      return <Icon name={name} size={22} color={color} />;
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
        },
        tabBarActiveTintColor: th.colors.primary,
        tabBarInactiveTintColor: th.colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
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

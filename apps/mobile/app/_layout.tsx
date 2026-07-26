import React, { useMemo } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth';
import { LocaleProvider, useLocale, useT } from '../src/locale';
import { ActiveEventProvider } from '../src/activeEvent';
import { OfflineBanner, OnlineProvider } from '../src/offline';
import { GlobalLive } from '../src/live';
import { LoadingView } from '../src/components/ui';
import { useTheme } from '../src/theme';
import { K } from '../src/storage';

/** Query keys that are safe + useful to persist for offline reads. */
const PERSISTED_KEYS = new Set([
  'catalogue',
  'events',
  'event',
  'dashboard',
  'bring',
  'inventory',
  'notifications',
]);

export default function RootLayout() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 1000 * 60 * 60 * 24,
            retry: 1,
          },
        },
      }),
    [],
  );

  const persister = useMemo(
    () => createAsyncStoragePersister({ storage: AsyncStorage, key: K.queryCache }),
    [],
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' &&
            PERSISTED_KEYS.has(String(query.queryKey[0])),
        },
      }}
    >
      <SafeAreaProvider>
        <LocaleProvider>
          <AuthProvider>
            <ActiveEventProvider>
              <OnlineProvider>
                <AppShell />
              </OnlineProvider>
            </ActiveEventProvider>
          </AuthProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}

function AppShell() {
  const th = useTheme();
  const t = useT();
  const { ready: authReady, token } = useAuth();
  const { ready: localeReady } = useLocale();

  if (!authReady || !localeReady) {
    return <LoadingView />;
  }

  return (
    <>
      <StatusBar style={th.dark ? 'light' : 'dark'} />
      <OfflineBanner />
      {token ? <GlobalLive /> : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: th.colors.bg },
          headerTintColor: th.colors.text,
          headerTitleStyle: { color: th.colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: th.colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ title: t('events.dashboard') }} />
        <Stack.Screen name="request/new" options={{ title: t('request.title') }} />
        <Stack.Screen name="request/[id]" options={{ title: t('request.searching') }} />
        <Stack.Screen
          name="offer/[id]"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen name="match/[id]" options={{ title: t('match.matched') }} />
        <Stack.Screen name="settings/index" options={{ title: t('settings.title') }} />
        <Stack.Screen name="settings/sessions" options={{ title: t('settings.devices') }} />
        <Stack.Screen name="settings/blocked" options={{ title: t('settings.blocked') }} />
        <Stack.Screen
          name="settings/notifications"
          options={{ title: t('notifications.title') }}
        />
        <Stack.Screen name="settings/privacy" options={{ title: t('settings.privacy') }} />
        <Stack.Screen name="settings/safety" options={{ title: t('safety.guidance') }} />
        <Stack.Screen name="settings/legal" options={{ title: t('settings.legal') }} />
      </Stack>
    </>
  );
}

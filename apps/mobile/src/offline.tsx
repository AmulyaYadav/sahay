import React, { createContext, useContext, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, type as typeScale, useTheme } from './theme';
import { useT } from './locale';

const OnlineContext = createContext(true);

export function OnlineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    });
    return unsub;
  }, []);
  return <OnlineContext.Provider value={online}>{children}</OnlineContext.Provider>;
}

export function useOnline(): boolean {
  return useContext(OnlineContext);
}

/** Persistent, calm banner shown while the device is offline. */
export function OfflineBanner() {
  const online = useOnline();
  const th = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        backgroundColor: th.colors.warnSoft,
        paddingTop: insets.top,
        paddingBottom: spacing.xs,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
      }}
    >
      <Text allowFontScaling style={{ color: th.colors.warn, fontSize: typeScale.caption, fontWeight: '600' }}>
        {t('common.offline')}
      </Text>
    </View>
  );
}

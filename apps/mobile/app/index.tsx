import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../src/auth';
import { LoadingView } from '../src/components/ui';
import { K } from '../src/storage';

/** Entry gate: onboarding → auth → tabs. */
export default function Index() {
  const { token, ready } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(K.onboarded)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(false));
  }, []);

  if (!ready || onboarded === null) return <LoadingView />;
  if (!onboarded) return <Redirect href="/(onboarding)" />;
  if (!token) return <Redirect href="/auth" />;
  return <Redirect href="/(tabs)/home" />;
}

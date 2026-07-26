import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Session token storage. Native: SecureStore (Keychain/Keystore) — never
 * AsyncStorage. Web (dev/preview builds only): localStorage fallback because
 * SecureStore is unavailable there.
 */
const KEY = 'sahay.session.token';

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* noop */
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* noop */
  }
}

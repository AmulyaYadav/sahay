import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether the match-found moment has already been shown for a given match.
 *
 * Both parties are sent to that screen the first time a match exists, which
 * means something has to stop them being sent back. Without a record, leaving
 * the conversation returns you to the screen that pushed you — a request still
 * in the `matched` state — which would push you straight back into the
 * confetti, and there would be no way out of the loop.
 *
 * Stored per device rather than per account only in the sense that it lives in
 * AsyncStorage; the `sahay.` prefix means clearAccountScopedState wipes it on
 * sign-out, so a second person using the phone does not inherit the first
 * person's history.
 */
const key = (matchId: string) => `sahay.matchFoundSeen.${matchId}`;

export async function hasSeenMatchFound(matchId: string): Promise<boolean> {
  const v = await AsyncStorage.getItem(key(matchId)).catch(() => null);
  return v === '1';
}

export async function markMatchFoundSeen(matchId: string): Promise<void> {
  await AsyncStorage.setItem(key(matchId), '1').catch(() => {});
}

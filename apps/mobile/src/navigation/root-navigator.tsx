import { Stack } from 'expo-router';
import { useAuth, useRuntime } from '../auth/provider';
import { SessionStatus } from '../components/session-status';

export function RootNavigator() {
  const { status, error } = useAuth();
  const { auth } = useRuntime();
  if (status === 'loading') return <SessionStatus />;
  if (status === 'storageError') return <SessionStatus error={error} retry={() => { void auth.retryStorage(); }} />;
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
    <Stack.Protected guard={status === 'signedOut'}><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={status === 'signedIn'}><Stack.Screen name="(app)" /></Stack.Protected>
  </Stack>;
}

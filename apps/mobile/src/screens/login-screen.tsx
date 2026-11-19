import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useRuntime } from '../auth/provider';
import { ActionButton } from '../components/action-button';
import { ScreenTransition } from '../components/screen-transition';
import { layout, text } from '../theme';

export function LoginScreen() {
  const { busy, error } = useAuth();
  const { auth, sessions } = useRuntime();
  return <ScreenTransition><SafeAreaView style={layout.screen}>
    <ScrollView contentContainerStyle={layout.content}>
      <View style={layout.header}><Text accessibilityRole="header" style={text.title}>여행 동선</Text></View>
      <View style={layout.card}><Text style={text.date}>로그인</Text></View>
      {error && <Text accessibilityRole="alert" style={layout.error}>⚠ {error}</Text>}
    </ScrollView>
    <View style={layout.footer}>
      <ActionButton label={busy ? '로그인 중' : 'Google로 로그인'} busy={busy} onPress={() => { void auth.signIn(sessions); }} />
    </View>
  </SafeAreaView></ScreenTransition>;
}

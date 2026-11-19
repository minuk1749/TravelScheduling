import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useRuntime } from '../auth/provider';
import { ActionButton } from '../components/action-button';
import { ScreenTransition } from '../components/screen-transition';
import { layout, text } from '../theme';

/** Authenticated landing screen; trip input is added by T21. */
export function HomeScreen() {
  const { busy } = useAuth();
  const { auth, sessions } = useRuntime();
  return <ScreenTransition><SafeAreaView style={layout.screen}>
    <ScrollView contentContainerStyle={layout.content}>
      <View style={layout.header}><Text accessibilityRole="header" style={text.title}>여행 동선</Text></View>
      <View style={layout.card}><Text style={text.date}>내 여행</Text></View>
    </ScrollView>
    <View style={layout.footer}>
      <ActionButton label={busy ? '로그아웃 중' : '로그아웃'} busy={busy} secondary onPress={() => { void auth.signOut(sessions); }} />
    </View>
  </SafeAreaView></ScreenTransition>;
}

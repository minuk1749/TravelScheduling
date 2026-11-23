import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '../components/action-button';
import { ScreenTransition } from '../components/screen-transition';
import { layout, text } from '../theme';
import { TripList } from './trip-input/trip-list';

export function HomeScreen() {
  const router = useRouter();
  return <ScreenTransition><SafeAreaView style={layout.screen}>
    <ScrollView contentContainerStyle={layout.content}>
      <View style={layout.header}><Text accessibilityRole="header" style={text.title}>여행 동선</Text></View>
      <TripList />
    </ScrollView>
    <View style={layout.footer}>
      <ActionButton label="계정" secondary onPress={() => router.push('/account')} />
    </View>
  </SafeAreaView></ScreenTransition>;
}

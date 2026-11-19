import { useState } from 'react';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/provider';
import { createNativeRuntime } from '../src/auth/native-runtime';
import { RootNavigator } from '../src/navigation/root-navigator';
import { SessionStatus } from '../src/components/session-status';
import { GoogleResultMap } from '../src/map/google-result-map';
import { MapAdapterProvider } from '../src/map/provider';
import { fonts } from '../src/theme/fonts';

export default function RootLayout() {
  const [runtime] = useState(createNativeRuntime);
  const [loaded, error] = useFonts(fonts);
  return <SafeAreaProvider>
    <StatusBar style="dark" />
    {!loaded ? <SessionStatus error={error ? '글꼴을 불러오지 못했어요. 앱을 다시 열어 주세요.' : null} />
      : <AuthProvider runtime={runtime}><MapAdapterProvider map={GoogleResultMap}><RootNavigator /></MapAdapterProvider></AuthProvider>}
  </SafeAreaProvider>;
}

import type { ExpoConfig } from 'expo/config';

const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;

const config: ExpoConfig = {
  name: '여행 동선', slug: 'travel-scheduling', version: '0.1.0', scheme: 'travel-scheduling',
  orientation: 'portrait', userInterfaceStyle: 'light', platforms: ['ios', 'android'],
  plugins: [
    'expo-router', 'expo-font', 'expo-secure-store',
    // JS exports need no OAuth credentials. Native builds require this iOS URL scheme.
    ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, { iosUrlScheme: string }]] : []),
  ],
};

export default config;

import type { ExpoConfig } from 'expo/config';

const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
const iosGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;
const androidGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;

const config: ExpoConfig = {
  name: '여행 동선', slug: 'travel-scheduling', version: '0.1.0', scheme: 'travel-scheduling',
  orientation: 'portrait', userInterfaceStyle: 'light', platforms: ['ios', 'android'],
  // Result map "현재 위치" button (T22); the location is only shown on the map, never sent or stored.
  ios: { infoPlist: { NSLocationWhenInUseUsageDescription: '결과 지도에서 현재 위치를 보여 주기 위해 사용해요.' } },
  android: { permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'] },
  plugins: [
    'expo-router', 'expo-font', 'expo-secure-store',
    ['react-native-maps', { iosGoogleMapsApiKey, androidGoogleMapsApiKey }],
    // JS exports need no OAuth credentials. Native builds require this iOS URL scheme.
    ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, { iosUrlScheme: string }]] : []),
  ],
};

export default config;

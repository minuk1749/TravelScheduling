import type { ExpoConfig } from 'expo/config';

/** 기본 번들 ID. 무료 Apple ID로 설치하려면 본인만의 값을 `APP_BUNDLE_ID`로 지정한다(docs/mobile-install.md). */
export const DEFAULT_BUNDLE_ID = 'com.travelscheduling.app';
// iOS 번들 ID와 Android 패키지명이 같은 값을 쓰므로 둘 다 허용하는 형식(영문자로 시작하는 두 단계 이상)만 받는다.
const BUNDLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

const BRAND_BLUE = '#2A64A8'; // docs/design.md 스카이 블루 주 색

function bundleId(env: NodeJS.ProcessEnv): string {
  const value = env.APP_BUNDLE_ID?.trim() || DEFAULT_BUNDLE_ID;
  if (!BUNDLE_ID_PATTERN.test(value)) {
    throw new Error('APP_BUNDLE_ID는 com.example.app처럼 영문·숫자·밑줄로 된 두 단계 이상의 주소여야 해요.');
  }
  return value;
}

export function createConfig(env: NodeJS.ProcessEnv): ExpoConfig {
  const iosUrlScheme = env.GOOGLE_IOS_URL_SCHEME;
  const id = bundleId(env);
  return {
    name: '여행 동선', slug: 'travel-scheduling', version: '0.1.0', scheme: 'travel-scheduling',
    orientation: 'portrait', userInterfaceStyle: 'light', platforms: ['ios', 'android'],
    icon: './assets/icon.png',
    splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: BRAND_BLUE },
    ios: {
      bundleIdentifier: id,
      buildNumber: '1',
      infoPlist: {
        // Result map "현재 위치" button (T22); the location is only shown on the map, never sent or stored.
        NSLocationWhenInUseUsageDescription: '결과 지도에서 현재 위치를 보여 주기 위해 사용해요.',
        // 앱이 표준 HTTPS 암호화만 쓰므로 App Store Connect의 수출 규정 질문을 건너뛴다.
        ITSAppUsesNonExemptEncryption: false,
        // 개발 빌드가 같은 Wi-Fi의 로컬 서버(http)에 붙도록 한다. 운영 주소는 앱 코드가 HTTPS만 받는다(src/api/origin.ts).
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      },
    },
    android: {
      package: id,
      versionCode: 1,
      adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: BRAND_BLUE },
      permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    },
    plugins: [
      'expo-router', 'expo-font', 'expo-secure-store',
      ['react-native-maps', {
        iosGoogleMapsApiKey: env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY,
        androidGoogleMapsApiKey: env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY,
      }],
      // JS exports need no OAuth credentials. Native builds require this iOS URL scheme.
      ...(iosUrlScheme ? [['@react-native-google-signin/google-signin', { iosUrlScheme }] as [string, { iosUrlScheme: string }]] : []),
    ],
  };
}

export default createConfig(process.env);

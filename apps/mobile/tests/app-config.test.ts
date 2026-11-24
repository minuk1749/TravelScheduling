import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createConfig, DEFAULT_BUNDLE_ID } from '../app.config';

const root = path.resolve(__dirname, '..');
type PluginEntry = string | [string, Record<string, unknown>];
const pluginOptions = (plugins: PluginEntry[] | undefined, name: string) =>
  plugins?.find((entry): entry is [string, Record<string, unknown>] => Array.isArray(entry) && entry[0] === name)?.[1];
const expoCli = require.resolve('expo/bin/cli', { paths: [root] });

function pngSize(file: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path.join(root, file));
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe('app config', () => {
  test('앱 이름·번들 ID·패키지명을 기본값으로 정한다', () => {
    const config = createConfig({});
    expect(config.name).toBe('여행 동선');
    expect(config.ios?.bundleIdentifier).toBe(DEFAULT_BUNDLE_ID);
    expect(config.android?.package).toBe(DEFAULT_BUNDLE_ID);
    expect(config.scheme).toBe('travel-scheduling');
  });

  test('APP_BUNDLE_ID로 iOS와 Android 식별자를 함께 바꾼다', () => {
    const config = createConfig({ APP_BUNDLE_ID: ' io.github.me.travel ' });
    expect(config.ios?.bundleIdentifier).toBe('io.github.me.travel');
    expect(config.android?.package).toBe('io.github.me.travel');
  });

  test.each(['travel', 'com.my-app.travel', '1com.app', 'com..app', 'com.app.', 'com.example.한글'])(
    '형식이 틀린 APP_BUNDLE_ID %s를 거부한다', value => {
      expect(() => createConfig({ APP_BUNDLE_ID: value })).toThrow('APP_BUNDLE_ID');
    },
  );

  test('빈 APP_BUNDLE_ID는 기본값을 쓴다', () => {
    expect(createConfig({ APP_BUNDLE_ID: '  ' }).ios?.bundleIdentifier).toBe(DEFAULT_BUNDLE_ID);
  });

  test('Google 로그인 plugin은 iOS URL scheme이 있을 때만 켜고 지도 키는 플랫폼별로 전달한다', () => {
    const without = createConfig({});
    expect(JSON.stringify(without.plugins)).not.toContain('google-signin');
    const withScheme = createConfig({
      GOOGLE_IOS_URL_SCHEME: 'com.googleusercontent.apps.123',
      EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY: 'ios-key',
      EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY: 'android-key',
    });
    expect(withScheme.plugins).toContainEqual(['@react-native-google-signin/google-signin', { iosUrlScheme: 'com.googleusercontent.apps.123' }]);
    expect(withScheme.plugins).toContainEqual(['react-native-maps', { iosGoogleMapsApiKey: 'ios-key', androidGoogleMapsApiKey: 'android-key' }]);
  });

  test('아이콘·적응형 아이콘·스플래시 파일이 있고 크기가 맞다', () => {
    const config = createConfig({});
    const splash = pluginOptions(config.plugins as PluginEntry[], 'expo-splash-screen');
    expect(splash).toMatchObject({ resizeMode: 'contain', backgroundColor: '#2A64A8' });
    expect(config).not.toHaveProperty('splash');
    const files = [config.icon, config.android?.adaptiveIcon?.foregroundImage, splash?.image];
    for (const file of files) {
      expect(file).toBeDefined();
      expect(existsSync(path.join(root, file as string))).toBe(true);
    }
    expect(pngSize(config.icon as string)).toEqual({ width: 1024, height: 1024, colorType: 6 });
    expect(pngSize(config.android?.adaptiveIcon?.foregroundImage as string).width).toBe(1024);
    expect(pngSize(splash?.image as string).height).toBe(1024);
  });

  test('로컬 서버 접속과 위치 권한 설정을 유지한다', () => {
    const config = createConfig({});
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
    expect(config.ios?.infoPlist?.NSLocationWhenInUseUsageDescription).toBeTruthy();
    expect(config.android?.permissions).toEqual(['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']);
  });
});

describe('expo config CLI', () => {
  function resolved(env: Record<string, string>): {
    ios: { bundleIdentifier: string }; android: { package: string }; icon: string; name: string;
  } {
    const output = execFileSync(process.execPath, [expoCli, 'config', '--type', 'public', '--json'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, APP_BUNDLE_ID: '', ...env },
    });
    return JSON.parse(output);
  }

  test('expo config가 기본 설정을 오류 없이 읽는다', () => {
    const config = resolved({});
    expect(config.name).toBe('여행 동선');
    expect(config.ios.bundleIdentifier).toBe(DEFAULT_BUNDLE_ID);
    expect(config.android.package).toBe(DEFAULT_BUNDLE_ID);
    expect(config.icon).toBe('./assets/icon.png');
  });

  test('expo config가 APP_BUNDLE_ID를 반영한다', () => {
    const config = resolved({ APP_BUNDLE_ID: 'io.github.me.travel' });
    expect(config.ios.bundleIdentifier).toBe('io.github.me.travel');
    expect(config.android.package).toBe('io.github.me.travel');
  });
});

import * as SecureStore from 'expo-secure-store';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { NativeGoogleIdentity } from '../src/auth/google-identity';
import { SecureSessionStorage } from '../src/auth/secure-storage';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn(), signOut: jest.fn() },
  isSuccessResponse: (value: { type: string }) => value.type === 'success',
  isErrorWithCode: (value: unknown) => !!value && typeof value === 'object' && 'code' in value,
  statusCodes: { SIGN_IN_CANCELLED: 'CANCELLED' },
}));

beforeEach(() => { jest.clearAllMocks(); });

test('native SDK is configured once, extracts the ID token, and signs out', async () => {
  const google = new NativeGoogleIdentity({ webClientId: 'web-id', iosClientId: 'ios-id' });
  jest.mocked(GoogleSignin.signIn).mockResolvedValue({ type: 'success', data: { idToken: 'id-token' } } as Awaited<ReturnType<typeof GoogleSignin.signIn>>);
  expect(await google.signIn()).toBe('id-token');
  expect(await google.signIn()).toBe('id-token');
  expect(GoogleSignin.configure).toHaveBeenCalledTimes(1);
  expect(GoogleSignin.configure).toHaveBeenCalledWith({ webClientId: 'web-id', iosClientId: 'ios-id', offlineAccess: false });
  expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
  await google.signOut();
  expect(GoogleSignin.signOut).toHaveBeenCalledTimes(1);
});

test('native cancellation and missing token are distinct', async () => {
  const google = new NativeGoogleIdentity({ webClientId: 'web-id' });
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({ type: 'cancelled', data: null });
  expect(await google.signIn()).toBeNull();
  jest.mocked(GoogleSignin.signIn).mockRejectedValueOnce({ code: 'CANCELLED' });
  expect(await google.signIn()).toBeNull();
  jest.mocked(GoogleSignin.signIn).mockResolvedValueOnce({ type: 'success', data: { idToken: null } } as Awaited<ReturnType<typeof GoogleSignin.signIn>>);
  await expect(google.signIn()).rejects.toThrow('Google 로그인에 연결하지 못했어요');
});

test('unconfigured login fails without starting the native picker', async () => {
  await expect(new NativeGoogleIdentity({}).signIn()).rejects.toThrow('설정');
  expect(GoogleSignin.signIn).not.toHaveBeenCalled();
});

test('logout after app restart configures and clears the native Google session', async () => {
  await new NativeGoogleIdentity({ webClientId: 'web-id' }).signOut();
  expect(GoogleSignin.configure).toHaveBeenCalledTimes(1);
  expect(GoogleSignin.signOut).toHaveBeenCalledTimes(1);
});

test('credentials use SecureStore with device-only Keychain accessibility for all operations', async () => {
  const write = jest.spyOn(SecureStore, 'setItemAsync');
  const read = jest.spyOn(SecureStore, 'getItemAsync');
  const clear = jest.spyOn(SecureStore, 'deleteItemAsync');
  const storage = new SecureSessionStorage();
  await storage.write('session-json');
  await storage.read();
  await storage.clear();
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  expect(write).toHaveBeenCalledWith('travel.session.v1', 'session-json', options);
  expect(read).toHaveBeenCalledWith('travel.session.v1', options);
  expect(clear).toHaveBeenCalledWith('travel.session.v1', options);
});

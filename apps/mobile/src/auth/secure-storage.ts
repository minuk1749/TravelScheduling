import * as SecureStore from 'expo-secure-store';
import type { SessionStorage } from './ports';

const KEY = 'travel.session.v1';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export class SecureSessionStorage implements SessionStorage {
  read() { return SecureStore.getItemAsync(KEY, OPTIONS); }
  write(value: string) { return SecureStore.setItemAsync(KEY, value, OPTIONS); }
  clear() { return SecureStore.deleteItemAsync(KEY, OPTIONS); }
}

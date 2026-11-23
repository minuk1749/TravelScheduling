import { Platform } from 'react-native';

/** Maps SDK keys are app-restricted public values; without one the map is not drawn. */
export function isMapConfigured(): boolean {
  return !!(Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY
    : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY);
}

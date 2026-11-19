import { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import type { GoogleIdentityProvider } from './ports';

export class NativeGoogleIdentity implements GoogleIdentityProvider {
  private configured = false;

  constructor(private readonly clientIds: { webClientId?: string; iosClientId?: string }) {}

  private configure() {
    if (!this.clientIds.webClientId) throw new Error('Google 로그인 설정을 확인해 주세요.');
    if (!this.configured) {
      GoogleSignin.configure({ ...this.clientIds, offlineAccess: false });
      this.configured = true;
    }
  }

  async signIn(): Promise<string | null> {
    this.configure();
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (!isSuccessResponse(result)) return null;
      if (!result.data.idToken) throw new Error('Missing ID token');
      return result.data.idToken;
    } catch (error) {
      if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return null;
      throw new Error('Google 로그인에 연결하지 못했어요. 다시 시도해 주세요.');
    }
  }

  async signOut(): Promise<void> {
    this.configure();
    await GoogleSignin.signOut();
  }
}

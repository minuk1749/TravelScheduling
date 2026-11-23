import type { ApiSession, GoogleIdentityProvider, Session, SessionApi, SessionStorage } from './ports';
import { parseSession } from './ports';

export type AuthSnapshot = {
  status: 'loading' | 'signedOut' | 'signedIn' | 'storageError';
  busy: boolean;
  error: string | null;
};

/** Owns credentials; React snapshots never contain tokens. Native I/O is injected. */
export class SessionManager implements ApiSession {
  private session: Session | null = null;
  private snapshot: AuthSnapshot = { status: 'loading', busy: false, error: null };
  private readonly listeners = new Set<() => void>();
  private restoring: Promise<void> | null = null;
  private clearing: Promise<void> | null = null;

  constructor(
    private readonly storage: SessionStorage,
    private readonly google: GoogleIdentityProvider,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot = (): AuthSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(update: Partial<AuthSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach(listener => listener());
  }

  restore(): Promise<void> {
    this.restoring ??= this.load();
    return this.restoring;
  }

  private async load() {
    try {
      const raw = await this.storage.read();
      let value: unknown = null;
      try { value = raw ? JSON.parse(raw) : null; } catch { /* Invalid storage is cleared below. */ }
      const session = parseSession(value);
      if (session && Date.parse(session.expiresAt) > this.now()) {
        this.session = session;
        this.publish({ status: 'signedIn' });
      } else {
        await this.clear();
      }
    } catch {
      this.publish({ status: 'storageError', error: '보안 저장소를 열지 못했어요. 다시 시도해 주세요.' });
    }
  }

  async accessToken(): Promise<string | null> {
    if (this.session && Date.parse(this.session.expiresAt) <= this.now()) await this.clear();
    return this.session?.token ?? null;
  }

  async invalidate(token: string): Promise<void> {
    // A late response for a previous session must not sign out a newly signed-in user.
    if (this.session?.token === token) await this.clear();
  }

  private clear(): Promise<void> {
    if (this.clearing) return this.clearing;
    this.session = null;
    this.publish({ status: 'loading' });
    this.clearing = this.storage.clear().then(() => {
      this.publish({ status: 'signedOut' });
    }).catch(() => {
      this.publish({ status: 'storageError', error: '로그인 정보를 지우지 못했어요. 다시 시도해 주세요.' });
    }).finally(() => { this.clearing = null; });
    return this.clearing;
  }

  async retryStorage(): Promise<void> {
    if (this.snapshot.status !== 'storageError') return;
    // Fail closed: retry deletion instead of restoring possibly revoked credentials.
    this.publish({ error: null });
    await this.clear();
  }

  async signIn(api: SessionApi): Promise<void> {
    if (this.snapshot.busy || this.snapshot.status !== 'signedOut') return;
    this.publish({ busy: true, error: null });
    try {
      const idToken = await this.google.signIn();
      if (!idToken) return; // User cancelled the native account picker.
      const session = parseSession(await api.create(idToken));
      if (!session || Date.parse(session.expiresAt) <= this.now()) throw new Error('로그인 응답을 확인하지 못했어요. 다시 시도해 주세요.');
      try { await this.storage.write(JSON.stringify(session)); } catch {
        await this.clear();
        throw new Error('로그인 정보를 안전하게 저장하지 못했어요. 다시 시도해 주세요.');
      }
      this.session = session;
      this.publish({ status: 'signedIn' });
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : '로그인하지 못했어요. 다시 시도해 주세요.' });
    } finally {
      this.publish({ busy: false });
    }
  }

  async signOut(api: SessionApi): Promise<void> {
    if (this.snapshot.busy || this.snapshot.status !== 'signedIn') return;
    this.publish({ busy: true, error: null });
    try { await api.revoke(); } catch {
      this.publish({ error: '기기에서 로그아웃했어요. 서버의 로그인 종료는 확인하지 못했어요.' });
    } finally {
      await this.finishSignOut();
      this.publish({ busy: false });
    }
  }

  async withdraw(deleteAccount: () => Promise<void>): Promise<void> {
    if (this.snapshot.busy || this.snapshot.status !== 'signedIn') return;
    this.publish({ busy: true, error: null });
    try {
      await deleteAccount();
      await this.finishSignOut();
    } catch (error) {
      if (this.getSnapshot().status !== 'storageError') {
        this.publish({ error: error instanceof Error ? error.message : '탈퇴를 확인하지 못했어요. 다시 시도해 주세요.' });
      }
    } finally {
      this.publish({ busy: false });
    }
  }

  private async finishSignOut(): Promise<void> {
    await this.clear();
    try { await this.google.signOut(); } catch { /* Local session cleanup is independent of Google sign-out. */ }
  }
}

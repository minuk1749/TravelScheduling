export interface AuthStore {
  upsertGoogleUser(googleId: string, email: string): Promise<string>;
  userExists(id: string): Promise<boolean>;
}

export async function googleIdentity(account: { provider: string; providerAccountId: string }, profile: { email?: string | null; email_verified?: unknown } | undefined, store: AuthStore): Promise<string | null> {
  if (account.provider !== 'google' || !account.providerAccountId || !profile?.email || profile.email_verified !== true) return null;
  return store.upsertGoogleUser(account.providerAccountId, profile.email);
}

export async function validUserId(id: unknown, store: AuthStore): Promise<string | undefined> {
  return typeof id === 'string' && await store.userExists(id) ? id : undefined;
}

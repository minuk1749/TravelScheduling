import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { upsertGoogleUser, userExists } from './lib/auth/store';
import { googleIdentity, validUserId } from './lib/auth/callbacks';

const store = { upsertGoogleUser, userExists };

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        const id = await googleIdentity(account, profile, store);
        if (!id) return null;
        token.userId = id;
        // Keep the JWT limited to the application user identifier.
        delete token.name;
        delete token.email;
        delete token.picture;
      }
      return token;
    },
    async session({ session, token }) {
      const id = await validUserId(token.userId, store);
      if (!id) {
        return { ...session, user: undefined, expires: new Date(0).toISOString() };
      }
      return { ...session, user: { id } };
    },
  },
});

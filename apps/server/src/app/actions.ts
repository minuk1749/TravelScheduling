'use server';
import { auth, signIn, signOut } from '../auth';
import { deleteUser } from '../lib/auth/store';

export async function login() { await signIn('google', { redirectTo: '/' }); }
export async function logout() { await signOut({ redirectTo: '/' }); }
export async function withdraw() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('로그인이 필요합니다.');
  await deleteUser(session.user.id);
  await signOut({ redirectTo: '/' });
}

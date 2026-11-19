import { sessions } from '../../../sessions/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = sessions.create;
export const DELETE = sessions.delete;

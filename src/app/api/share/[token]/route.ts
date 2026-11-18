import { handlers } from '../../../../sharing/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return handlers.read(request, (await context.params).token);
}

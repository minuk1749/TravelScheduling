import { handlers } from '../../../../../sharing/server';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.rotate(request, (await context.params).id);
}

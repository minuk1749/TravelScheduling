import { handlers } from '../../../../places/server';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlers.details(request, (await params).id);
}

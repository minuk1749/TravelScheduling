import { handlers } from '../../../../../itineraries/server';

export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlers.generate(request, (await params).id);
}

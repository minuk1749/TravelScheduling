import { access } from '../../../../trips/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return access(request, (await params).id);
}

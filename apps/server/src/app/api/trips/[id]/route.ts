import { auth } from '../../../../auth';
import { authorizeTrip } from '../../../../lib/auth/authorization';
import { tripOwner } from '../../../../lib/auth/store';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const status = await authorizeTrip(session?.user?.id, id, tripOwner);
  if (status !== 200) return Response.json({ error: '접근할 수 없습니다.' }, { status });
  return Response.json({ id });
}

export async function authorizeTrip(userId: string | undefined, tripId: string, findOwner: (id: string) => Promise<string | null>): Promise<200 | 401 | 403 | 404> {
  if (!userId) return 401;
  const owner = await findOwner(tripId);
  if (!owner) return 404;
  return owner === userId ? 200 : 403;
}

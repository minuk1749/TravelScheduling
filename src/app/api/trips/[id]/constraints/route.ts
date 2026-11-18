import { handlers } from '../../../../../results/server';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handlers.get(request, (await context.params).id); }
export async function PUT(request: Request, context: Context) { return handlers.put(request, (await context.params).id); }

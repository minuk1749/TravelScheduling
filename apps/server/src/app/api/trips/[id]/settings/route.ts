import { settingsServer } from '../../../../../settings/server';
async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return settingsServer.handle(request, (await params).id);
}
export { handle as GET, handle as PUT };

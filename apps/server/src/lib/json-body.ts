import { apiError } from './http';

type JsonBody = { value: unknown } | { error: Response };

const tooLarge = () => ({ error: apiError(413, 'PAYLOAD_TOO_LARGE', '입력 크기를 줄여 주세요.') });

/** Enforce the byte limit before decoding each chunk, including requests without Content-Length. */
export async function readJsonBody(
  request: Request, maxBytes: number, invalidMessage = '올바른 JSON 입력이 필요합니다.',
): Promise<JsonBody> {
  const body = request.body;
  if (Number(request.headers.get('content-length')) > maxBytes) {
    void body?.cancel().catch(() => {});
    return tooLarge();
  }
  const invalid = () => ({ error: apiError(400, 'INVALID_JSON', invalidMessage) });
  if (!body) return invalid();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        return tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return { value: JSON.parse(text + decoder.decode()) };
  } catch {
    return invalid();
  } finally {
    reader.releaseLock();
  }
}

'use client';
import { useRef, useState } from 'react';

export function ShareControls({ tripId }: { tripId: string }) {
  const [link, setLink] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const inFlight = useRef(false);
  async function issue() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/share`, { method: 'POST', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '공유 링크를 만들지 못했습니다.');
      setLink(new URL(data.path, window.location.origin).href);
      setMessage('새 링크를 만들었습니다. 이전 링크는 더 이상 열 수 없습니다.');
    } catch (error) {
      // A lost response may follow a successful rotation: do not keep offering an old link.
      setLink(''); setMessage(error instanceof Error ? error.message : '연결을 확인해 주세요.');
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage('링크를 복사했습니다.'); }
    catch { setMessage('링크 입력란을 선택해 직접 복사해 주세요.'); }
  }
  return <section aria-label="읽기 전용 링크 공유"><h2>읽기 전용 링크 공유</h2>
    <p>링크를 가진 사람은 로그인 없이 최신 저장 일정을 볼 수 있습니다. 입력 변경 후에는 동선을 재검증해 주세요.</p>
    <p>발급할 때마다 이전 링크가 무효가 됩니다.</p>
    <button type="button" disabled={busy} onClick={issue}>{busy ? '발급 중…' : '공유 링크 발급·재발급'}</button>
    {link && <><label>공유 링크<input readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" onClick={copy}>링크 복사</button><a href={link} target="_blank" rel="noreferrer">공유 화면 열기</a></>}
    {message && <p role="status">{message}</p>}
  </section>;
}

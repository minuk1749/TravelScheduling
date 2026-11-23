import { useEffect, useRef, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { issueShareLink } from '../../api/sharing';
import { useRuntime } from '../../auth/provider';
import { ActionButton } from '../../components/action-button';
import { FormError, FormSheet, form } from '../../components/input/form-layout';
import { text } from '../../theme';

export function ShareSheet({ tripId, close }: { tripId: string; close(): void }) {
  const { api } = useRuntime();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<'issue' | 'share' | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function share(existing: string | null) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(existing ? 'share' : 'issue');
    setError('');
    // The server may rotate the link even if its response is lost.
    if (!existing) setLink(null);
    let url = existing;
    try {
      url ??= await issueShareLink(api, tripId, request.signal);
      if (request.signal.aborted) return;
      setLink(url);
      setBusy('share');
      await Share.share({ message: url });
    } catch (failure) {
      if (!request.signal.aborted) setError(url ? '공유 시트를 열지 못했어요. 다시 시도해 주세요.'
        : failure instanceof Error ? failure.message : '공유 링크를 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      pending.current = null;
      if (!request.signal.aborted) setBusy(null);
    }
  }

  return <FormSheet title="여행 일정 공유" close={busy ? undefined : close} footer={<>
    <View style={form.flex}><ActionButton label={link ? '완료' : '취소'} secondary disabled={!!busy} onPress={close} /></View>
    <View style={form.double}><ActionButton label={busy === 'issue' ? '링크 만드는 중'
      : busy === 'share' ? '공유 시트 여는 중' : link ? '링크 다시 공유' : '링크 만들고 공유'}
      busy={!!busy} onPress={() => { void share(link); }} /></View>
  </>}>
    <Text style={text.body}>링크를 가진 사람은 로그인 없이 최신 저장 일정을 볼 수 있어요.</Text>
    <Text style={text.body}>새 링크를 발급하면 이전 링크는 무효가 돼요.</Text>
    <FormError message={error} />
    {link && <ActionButton label="새 링크 발급" secondary disabled={!!busy} onPress={() => { void share(null); }} />}
  </FormSheet>;
}

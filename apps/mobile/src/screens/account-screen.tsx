import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useAuth, useRuntime } from '../auth/provider';
import { ActionButton } from '../components/action-button';
import { FormCard, FormError, FormScreen, FormSheet, form } from '../components/input/form-layout';
import { layout } from '../theme';

export function AccountScreen() {
  const router = useRouter();
  const { busy, error } = useAuth();
  const { auth, sessions, deleteAccount } = useRuntime();
  const [confirm, setConfirm] = useState(false);
  const close = () => setConfirm(false);
  const back = () => router.canGoBack() ? router.back() : router.replace('/');

  return <FormScreen title="계정" back={back} backDisabled={busy}>
    <FormCard>
      <ActionButton label={busy && !confirm ? '로그아웃 중' : '로그아웃'} busy={busy && !confirm} disabled={busy} secondary
        onPress={() => { void auth.signOut(sessions); }} />
      <ActionButton label="회원 탈퇴" disabled={busy} secondary onPress={() => setConfirm(true)} />
    </FormCard>
    {confirm && <FormSheet title="회원 탈퇴" close={busy ? undefined : close} footer={<>
      <View style={form.flex}><ActionButton label="취소" secondary disabled={busy} onPress={close} /></View>
      <View style={form.double}><ActionButton label={busy ? '탈퇴 중' : '탈퇴하기'} busy={busy}
        onPress={() => { void auth.withdraw(deleteAccount); }} /></View>
    </>}>
      <Text style={layout.error}>⚠ 탈퇴하면 계정과 모든 여행 일정이 삭제돼요.</Text>
      <FormError message={error ?? undefined} />
    </FormSheet>}
  </FormScreen>;
}

import { ActivityIndicator, Text, View } from 'react-native';
import { colors, layout, text } from '../theme';
import { ActionButton } from './action-button';

export function SessionStatus({ error, retry }: { error?: string | null; retry?: () => void }) {
  return <View style={[layout.screen, layout.status]}>
    {error ? <Text accessibilityRole="alert" style={layout.error}>⚠ {error}</Text>
      : <><ActivityIndicator color={colors.sky.primary} /><Text style={text.body}>불러오는 중</Text></>}
    {retry && <ActionButton label="다시 시도" onPress={retry} />}
  </View>;
}

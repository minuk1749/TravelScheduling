import { StyleSheet, type TextStyle } from 'react-native';
import { colors, typography, spacing, radius, size, motion } from '@travel/design-tokens';

export { colors, typography, spacing, radius, size, motion };

function textStyle(spec: { size: number; weight: 400 | 600 }): TextStyle {
  return {
    fontFamily: spec.weight === 600 ? 'Pretendard-SemiBold' : 'Pretendard-Regular',
    fontSize: spec.size,
    letterSpacing: spec.size * typography.letterSpacingEm,
    fontVariant: [typography.numbers], color: colors.gray.text,
  };
}

export const text = StyleSheet.create({
  title: textStyle(typography.title), date: textStyle(typography.date),
  place: textStyle(typography.place), body: textStyle(typography.body),
  description: textStyle(typography.description), secondary: textStyle(typography.secondary),
  small: textStyle({ size: typography.small.max, weight: typography.small.weight }),
});

export const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.screen, gap: spacing.section },
  header: { minHeight: size.topBar, justifyContent: 'center' },
  card: { padding: spacing.cardInside, borderRadius: radius.card.max, backgroundColor: colors.card, gap: spacing.cardGap },
  footer: { paddingHorizontal: spacing.screen, paddingTop: spacing.buttonTop, paddingBottom: spacing.buttonBottom },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen, gap: spacing.section },
  error: { ...text.body, color: colors.red.text },
});

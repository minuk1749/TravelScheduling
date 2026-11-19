import type { ComponentRef, PropsWithChildren, ReactNode, Ref } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, motion, radius, size, spacing, text } from '../../theme';
import { useReducedMotion } from '../../theme/use-reduced-motion';

export function FormScreen({ title, subtitle, back, backDisabled, scrollRef, footer, children }: PropsWithChildren<{
  title: string; subtitle?: string; back(): void; backDisabled?: boolean; scrollRef?: Ref<ComponentRef<typeof ScrollView>>; footer?: ReactNode;
}>) {
  return <SafeAreaView style={layout.screen}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" disabled={backDisabled}
          accessibilityState={{ disabled: backDisabled }} onPress={back} style={styles.back}>
          <Text style={text.date}>‹</Text>
        </Pressable>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={text.title}>{title}</Text>
          {subtitle && <Text style={text.secondary}>{subtitle}</Text>}
        </View>
      </View>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{children}</ScrollView>
      {footer && <View style={styles.footer}>{footer}</View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function FormCard({ title, children }: PropsWithChildren<{ title?: string }>) {
  return <View style={layout.card}>
    {title && <Text accessibilityRole="header" style={text.place}>{title}</Text>}
    {children}
  </View>;
}

export function FormSheet({ title, close, footer, children }: PropsWithChildren<{
  title: string; close?: () => void; footer?: ReactNode;
}>) {
  const reduced = useReducedMotion();
  return <Modal transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={close}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {close && <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={close} style={StyleSheet.absoluteFill} />}
      <SafeAreaView testID="form-sheet" accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <Text accessibilityRole="header" style={text.title}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        {footer && <View style={styles.buttonRow}>{footer}</View>}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}

export function FormError({ message }: { message?: string }) {
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={layout.error}>⚠ {message}</Text> : null;
}

export const form = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.cardGap, alignItems: 'center' },
  wrap: { flexDirection: 'row', gap: spacing.steps[1], flexWrap: 'wrap', alignItems: 'center' },
  stack: { gap: spacing.cardGap },
  flex: { flex: 1 },
  secondary: { ...text.secondary, color: colors.gray.secondary },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { minHeight: size.topBar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.cardOutside },
  back: { width: size.back, minHeight: size.touch, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.cardOutside, gap: spacing.cardGap },
  footer: { ...layout.footer, backgroundColor: colors.card, gap: spacing.steps[1] },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: `rgba(0,0,0,${motion.sheet.backdropOpacity})` },
  sheet: { maxHeight: '90%', backgroundColor: colors.card, borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel, padding: spacing.cardInside, gap: spacing.cardGap },
  handle: { width: size.handle.width, height: size.handle.height, borderRadius: radius.small,
    alignSelf: 'center', backgroundColor: colors.gray.line },
  sheetBody: { gap: spacing.cardGap },
  buttonRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.cardGap },
});

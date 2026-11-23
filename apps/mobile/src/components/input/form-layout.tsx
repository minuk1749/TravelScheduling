import { createContext, useContext, useEffect, useLayoutEffect, useState, type ComponentRef, type PropsWithChildren, type ReactNode, type Ref } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, motion, radius, size, spacing, text } from '../../theme';
import { useMotionPreference, useReducedMotion } from '../../theme/use-reduced-motion';

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

type SheetProps = PropsWithChildren<{ title: string; close?: () => void; footer?: ReactNode }>;

/** An edge-to-edge host can reserve the visible part of its map while a form or keyboard covers the rest. */
export const SheetTopContext = createContext<((top: number | null) => void) | null>(null);

function SheetBody({ title, footer, close, children, expanded, onLayout }: SheetProps & {
  expanded?: boolean; onLayout?(event: LayoutChangeEvent): void;
}) {
  return <SafeAreaView testID="form-sheet" accessibilityViewIsModal edges={['bottom']}
    onLayout={onLayout} style={[styles.sheet, expanded ? styles.flex : styles.contentHeight]}>
    <View style={styles.handle} />
    {expanded ? <View style={styles.sheetHeading}>
      <Text accessibilityRole="header" style={[text.title, styles.flex]}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={close} style={styles.back}>
        <Text style={text.secondary}>닫기</Text>
      </Pressable>
    </View> : <Text accessibilityRole="header" style={text.title}>{title}</Text>}
    <ScrollView testID={expanded ? 'expanded-sheet-list' : undefined} keyboardShouldPersistTaps="handled" style={expanded ? styles.flex : undefined}
      contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
    {footer && <View style={styles.buttonRow}>{footer}</View>}
  </SafeAreaView>;
}

export function FormSheet({ close, ...body }: SheetProps) {
  const reduced = useReducedMotion();
  const reportTop = useContext(SheetTopContext);
  useLayoutEffect(() => {
    if (!reportTop) return;
    reportTop(0);
    return () => reportTop(null);
  }, [reportTop]);
  const content = <KeyboardAvoidingView style={[styles.backdrop, !!reportTop && styles.clear]}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {close && <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={close} style={StyleSheet.absoluteFill} />}
    <SheetBody {...body} onLayout={reportTop ? event => reportTop(event.nativeEvent.layout.y) : undefined} />
  </KeyboardAvoidingView>;
  return <Modal transparent statusBarTranslucent={!!reportTop} navigationBarTranslucent={!!reportTop}
    animationType={reportTop || reduced ? 'none' : 'fade'} onRequestClose={close}>
    {reportTop ? <SheetFade>{content}</SheetFade> : content}
  </Modal>;
}

function useSheetProgress(reduced: boolean | null) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced === null) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: motion.sheet.duration, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  return progress;
}

/** Keep native dismissal synchronous with the restoration of the map's padding. */
function SheetFade({ children }: PropsWithChildren) {
  const reduced = useMotionPreference();
  const progress = useSheetProgress(reduced);
  return <Animated.View style={[styles.flex, { opacity: progress }]}>{children}</Animated.View>;
}

/** A full-height scrolling sheet anchored below the underlying screen's safe area and top bar. */
export function ExpandedFormSheet({ topOffset, close, ...body }: SheetProps & { topOffset: number; close(): void }) {
  const safe = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useMotionPreference();
  const progress = useSheetProgress(reduced);
  const top = safe.top + topOffset;
  const transition = reduced === false
    ? { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(0, height - top), 0] }) }] }
    : { opacity: progress };
  return <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={close}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]} />
    <Pressable accessible={false} onPress={close} style={StyleSheet.absoluteFill} />
    <Animated.View testID="expanded-sheet" style={[styles.expanded, { top, left: safe.left, right: safe.right }, transition]}>
      <SheetBody {...body} close={close} expanded />
    </Animated.View>
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
  clear: { backgroundColor: 'transparent' },
  sheetHeading: { flexDirection: 'row', alignItems: 'center' },
  contentHeight: { maxHeight: '90%' },
  expanded: { position: 'absolute', bottom: 0 },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel, padding: spacing.cardInside, gap: spacing.cardGap },
  handle: { width: size.handle.width, height: size.handle.height, borderRadius: radius.small,
    alignSelf: 'center', backgroundColor: colors.gray.line },
  sheetBody: { gap: spacing.cardGap },
  buttonRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.cardGap },
});

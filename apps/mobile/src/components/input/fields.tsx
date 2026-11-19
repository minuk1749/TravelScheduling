import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, size, spacing, text } from '../../theme';
import { FormError, form } from './form-layout';

export type FocusRequest = { field: string };
export type Errors = Record<string, string>;

export function Field({ label, error, focus, onChangeText, ...input }: TextInputProps & {
  label: string; error?: string; focus?: FocusRequest;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => { if (focus) ref.current?.focus(); }, [focus]);
  return <View style={styles.field}>
    <Text style={text.body}>{label}</Text>
    <TextInput ref={ref} accessibilityLabel={label} autoCapitalize="none" autoCorrect={false}
      placeholderTextColor={colors.gray.description} {...input} onChangeText={onChangeText}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.input, focused && styles.focused, error && styles.invalid]} />
    <FormError message={error} />
  </View>;
}

export function EditField({ name, errors, focus, ...props }: Parameters<typeof Field>[0] & {
  name: string; errors: Errors; focus?: FocusRequest;
}) {
  return <Field {...props} error={errors[name]} focus={focus?.field === name ? focus : undefined} />;
}

export function Choice<T extends string | number>({ options, value, onChange }: {
  value: T; onChange(value: T): void; options: readonly { value: T; label: string }[];
}) {
  return <View style={form.wrap}>{options.map(option => {
    const selected = value === option.value;
    return <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected }}
      onPress={() => onChange(option.value)} style={styles.chipTouch}>
      <Text style={[styles.chip, selected && styles.selected]}>{option.label}</Text>
    </Pressable>;
  })}</View>;
}

export function SmallButton({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.chipTouch}>
    <Text style={[styles.smallButton, disabled && styles.disabled]}>{label}</Text>
  </Pressable>;
}

export function Toggle({ label, value, onChange, disabled }: {
  label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean;
}) {
  return <View style={styles.toggle}>
    <Text style={text.body}>{label}</Text>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled}
      trackColor={{ true: colors.sky.primary, false: colors.gray.line }} />
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: spacing.steps[0] },
  input: { ...text.body, minHeight: size.search, paddingHorizontal: spacing.cardInside,
    borderRadius: radius.input.max, backgroundColor: colors.gray.button, borderWidth: size.focusBorder, borderColor: colors.gray.button },
  focused: { borderColor: colors.sky.primary },
  invalid: { backgroundColor: colors.red.surface, borderColor: colors.red.text },
  chipTouch: { minHeight: size.touch, minWidth: size.touch, justifyContent: 'center' },
  chip: { ...text.secondary, minHeight: size.chip, backgroundColor: colors.gray.button, borderRadius: radius.chip,
    borderWidth: size.focusBorder, borderColor: colors.gray.button, paddingVertical: spacing.steps[1], paddingHorizontal: spacing.cardGap },
  selected: { ...text.secondary, fontFamily: text.place.fontFamily, borderColor: colors.sky.primary,
    color: colors.sky.text, backgroundColor: colors.sky.surface },
  smallButton: { ...text.body, color: colors.gray.secondary, textAlign: 'center', backgroundColor: colors.gray.button,
    minHeight: size.rowButton, borderRadius: radius.small, paddingVertical: spacing.steps[1], paddingHorizontal: spacing.cardGap },
  disabled: { color: colors.gray.disabled, backgroundColor: colors.gray.disabledButton },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: size.touch },
});

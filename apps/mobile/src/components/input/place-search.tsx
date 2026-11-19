import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PlaceSummary } from '@travel/core/contracts/places';
import { useTripApi } from '../../api/trips';
import { colors, radius, size, spacing, text } from '../../theme';
import { SmallButton, type FocusRequest } from './fields';
import { form } from './form-layout';

type Search = { status: 'idle' | 'loading' } | { status: 'results'; places: PlaceSummary[]; attribution: string }
  | { status: 'error'; error: string };

export function usePlaceSearch(region?: string) {
  const api = useTripApi();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<Search>({ status: 'idle' });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), [region]);

  function change(value: string) {
    pending.current?.abort();
    setQuery(value);
    setState({ status: 'idle' });
  }

  async function search(value = query) {
    if (!value.trim()) return;
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setState({ status: 'loading' });
    try {
      const result = await api.search(value, region, request.signal);
      if (!request.signal.aborted) setState({ status: 'results', ...result });
    } catch (error) {
      if (!request.signal.aborted) setState({
        status: 'error', error: error instanceof Error ? error.message : '장소를 검색하지 못했어요.',
      });
    }
  }
  return { query, state, change, search };
}

export function SearchBox({ label, search, focus }: { label: string; search: ReturnType<typeof usePlaceSearch>; focus?: FocusRequest }) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => { if (focus) input.current?.focus(); }, [focus]);
  return <View style={styles.box}>
    <Text accessible={false} style={text.place}>⌕</Text>
    <TextInput ref={input} accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.gray.description}
      style={styles.input} value={search.query} onChangeText={search.change} maxLength={200}
      onSubmitEditing={() => { void search.search(); }} returnKeyType="search" />
    {search.query !== '' && <SmallButton label="지우기" onPress={() => search.change('')} />}
    <SmallButton label="검색" disabled={!search.query.trim() || search.state.status === 'loading'}
      onPress={() => { void search.search(); }} />
  </View>;
}

export function ExternalText({ url, children }: { url: string; children: string }) {
  let target: URL | undefined;
  try { target = new URL(url); } catch { /* Some attributions have no link. */ }
  if (!target || !['https:', 'http:'].includes(target.protocol)) return <Text style={form.secondary}>{children}</Text>;
  const href = target.href;
  return <Text accessibilityRole="link" style={styles.link} onPress={() => { void Linking.openURL(href).catch(() => {}); }}>{children}</Text>;
}

export function PlaceCredits({ place }: { place: Pick<PlaceSummary, 'attributions'> }) {
  return place.attributions.map(({ provider, providerUri }, index) =>
    <ExternalText key={`${provider}:${index}`} url={providerUri}>{provider}</ExternalText>);
}

const styles = StyleSheet.create({
  box: { ...form.row, gap: spacing.steps[0], minHeight: size.search, backgroundColor: colors.card,
    paddingHorizontal: spacing.steps[1], borderRadius: radius.search },
  input: { ...text.body, flex: 1, minHeight: size.search },
  link: { ...text.secondary, color: colors.sky.text, textDecorationLine: 'underline' },
});

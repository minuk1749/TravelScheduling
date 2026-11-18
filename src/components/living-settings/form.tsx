'use client';
import { useMemo, useRef, useState } from 'react';
import { calculateSettings } from '../../settings/calculate';
import { parseSettings } from '../../settings/input';
import type { SettingsView } from '../../settings/model';
import { TripInputError } from '../../trips/input';
import { SettingsFields } from './fields';
import { SettingsPreview } from './preview';

export function LivingSettingsForm({ tripId, initial, reload }: { tripId: string; initial: SettingsView; reload(): void }) {
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [draft, setDraft] = useState(initial.snapshot.settings);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const preview = useMemo(() => {
    try { return { calculation: calculateSettings(snapshot, parseSettings(draft, snapshot)), errors: [] }; }
    catch (error) { return { calculation: null, errors: error instanceof TripInputError ? Object.values(error.fields) : ['설정을 확인해 주세요.'] }; }
  }, [draft, snapshot]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.settings);
  async function save() {
    if (inFlight.current || !preview.calculation) return;
    inFlight.current = true; setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: snapshot.revision, settings: draft }) });
      const data = await response.json();
      if (!response.ok) { setError(data.fields ? Object.values(data.fields).join(' ') : data.error ?? '설정을 저장하지 못했습니다.'); return; }
      const view = data as SettingsView;
      setSnapshot(view.snapshot); setDraft(view.snapshot.settings); setSaved(true);
    } catch { setError('연결을 확인하고 다시 시도해 주세요. 입력 내용은 유지됩니다.'); }
    finally { inFlight.current = false; setSaving(false); }
  }
  return <>
    <p>{snapshot.startDate} – {snapshot.endDate} · 현지 시각 ({snapshot.timeZone})</p>
    <p role="status">{saving ? '저장 중…' : dirty ? '저장하지 않은 변경사항 · 시간창은 입력 즉시 재계산됩니다.' : saved ? '생활 설정을 저장하고 시간창을 재계산했습니다.' : '저장된 생활 설정입니다.'}</p>
    {error && <p className="form-errors" role="alert">{error}</p>}
    {preview.errors.length > 0 && <div className="form-errors" role="alert"><ul>{preview.errors.map((message, i) => <li key={i}>{message}</li>)}</ul></div>}
    <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="input-card" disabled={saving}><legend>생활 설정</legend><SettingsFields snapshot={snapshot} settings={draft} onChange={settings => { setDraft(settings); setSaved(false); setError(''); }} /></fieldset>
      <div className="form-navigation"><button type="button" className="secondary" disabled={saving} onClick={() => { setDraft(snapshot.settings); setError(''); setSaved(false); }}>변경 취소</button><button type="submit" disabled={saving || !preview.calculation || !dirty}>설정 저장</button></div>
    </form>
    <p><button type="button" className="secondary" disabled={saving} onClick={reload}>저장된 설정 다시 불러오기</button></p>
    {preview.calculation && <SettingsPreview calculation={preview.calculation} snapshot={snapshot} />}
  </>;
}

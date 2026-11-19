'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PlaceSummary } from '../places';
import { cities, parseTripDraft, TripInputError, type TripDraft } from '../trips/input';
import { CityProfileCard } from './city-profile-card';
import { AddRowButton, errorProps, FieldError, FieldRow, FormCard } from './form-rows';
import { PlacePicker } from './place-picker';

const steps = ['여행', '항공', '숙소', '장소'];
type FormDraft = Omit<TripDraft, 'lodgings' | 'visits'> & { lodgings: (TripDraft['lodgings'][number] & { key: number })[]; visits: (TripDraft['visits'][number] & { key: number })[] };
const initial: FormDraft = { cityCode: '', timeZone: '', startDate: '', endDate: '', taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING',
  flights: [{ direction: 'ARRIVAL', googlePlaceId: '', localDateTime: '' }, { direction: 'DEPARTURE', googlePlaceId: '', localDateTime: '' }], lodgings: [], visits: [] };
const errorId = (key: string) => `error-${key.replaceAll('.', '-')}`;
/** Error keys rendered next to their field on each step; anything else is listed above the buttons. */
function inlineKeys(step: number, draft: FormDraft): string[] {
  if (step === 0) return ['cityCode', 'timeZone', 'startDate', 'endDate', 'taxiPolicy'];
  if (step === 1) return ['flights', 'luggageOption', ...draft.flights.flatMap((_, i) => [`flights.${i}.googlePlaceId`, `flights.${i}.localDateTime`])];
  if (step === 2) return ['lodgings', ...draft.lodgings.flatMap((_, i) => [`lodgings.${i}`, `lodgings.${i}.googlePlaceId`, `lodgings.${i}.checkIn`, `lodgings.${i}.checkOut`])];
  return [];
}

export function TripInputForm() {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [step, setStep] = useState(0);
  const [customCity, setCustomCity] = useState(false);
  const [places, setPlaces] = useState<Record<string, PlaceSummary>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState('');
  const summary = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null), form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false), nextKey = useRef(1);
  const region = cities.find(city => city.code === draft.cityCode)?.region;
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); clearErrors(String(key)); };
  /** Editing a field hides its stale messages; the next submit validates again. */
  const clearErrors = (prefix: string) => setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}.`))));
  const remember = (place: PlaceSummary | undefined) => { if (place) setPlaces(current => ({ ...current, [place.googlePlaceId]: place })); return place?.googlePlaceId ?? ''; };
  const showErrors = (fields: Record<string, string>) => {
    setErrors(fields);
    setTimeout(() => (form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? summary.current)?.focus(), 0);
  };
  const move = (next: number) => { setErrors({}); setStep(next); setTimeout(() => heading.current?.focus(), 0); };
  const field = (key: string) => ({ error: errors[key], errorId: errorId(key) });
  const control = (key: string) => errorProps(errors[key], errorId(key));
  async function advance() {
    if (inFlight.current) return;
    let input: TripDraft;
    try { input = parseTripDraft(draft, step); }
    catch (error) { if (error instanceof TripInputError) showErrors(error.fields); return; }
    if (step < 3) {
      if (step === 0) {
        setDraft(current => ({ ...current, flights: current.flights.map(flight => ({ ...flight, localDateTime: flight.localDateTime || `${flight.direction === 'ARRIVAL' ? current.startDate : current.endDate}T${flight.direction === 'ARRIVAL' ? '09:00' : '18:00'}` })),
          lodgings: current.lodgings.length || current.startDate === current.endDate ? current.lodgings : [{ key: 0, googlePlaceId: '', checkIn: current.startDate, checkOut: current.endDate }] }));
      }
      move(step + 1); return;
    }
    inFlight.current = true; setSaving(true); setErrors({});
    try {
      const response = await fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) { showErrors(data.fields ?? { request: data.error ?? '저장하지 못했습니다. 다시 시도해 주세요.' }); return; }
      setSavedId(data.id);
    } catch { showErrors({ request: '연결을 확인하고 다시 시도해 주세요. 입력 내용은 유지됩니다.' }); }
    finally { inFlight.current = false; setSaving(false); }
  }
  if (savedId) return <SavedTrip id={savedId} draft={draft} />;
  const inline = new Set(inlineKeys(step, draft));
  const rest = Object.entries(errors).filter(([key]) => !inline.has(key));
  const updateFlight = (i: number, patch: Partial<FormDraft['flights'][number]>) => set('flights', draft.flights.map((row, index) => index === i ? { ...row, ...patch } : row));
  const updateLodging = (i: number, patch: Partial<FormDraft['lodgings'][number]>) => set('lodgings', draft.lodgings.map((row, index) => index === i ? { ...row, ...patch } : row));
  const updateVisit = (i: number, patch: Partial<FormDraft['visits'][number]>) => set('visits', draft.visits.map((row, index) => index === i ? { ...row, ...patch } : row));
  return <>
    <ol className="steps" aria-label="입력 단계">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void advance(); }}>
      <h2 ref={heading} tabIndex={-1}>{step + 1}. {steps[step]} 입력</h2>
      {Object.keys(errors).length > 0 && <div className="sr-only" role="alert" tabIndex={-1} ref={summary}><strong>입력 내용을 확인해 주세요.</strong><ul>{Object.entries(errors).map(([key, error]) => <li key={key}>{error}</li>)}</ul></div>}
      <fieldset disabled={saving} className="form-sections">
        <legend className="sr-only">{steps[step]} 정보</legend>
        {step === 0 && <>
          <FormCard title="여행지 · 기간">
            <FieldRow icon="pin" label="도시" note={draft.timeZone || undefined} {...field('cityCode')}><select value={customCity ? 'OTHER' : draft.cityCode} {...control('cityCode')} onChange={event => {
              const city = cities.find(city => city.code === event.target.value);
              setCustomCity(event.target.value === 'OTHER'); setDraft(current => ({ ...current, cityCode: city?.code ?? '', timeZone: city?.timeZone ?? '' })); clearErrors('cityCode'); clearErrors('timeZone');
            }}><option value="">도시 선택</option>{cities.map(city => <option key={city.code} value={city.code}>{city.name}</option>)}<option value="OTHER">다른 해외 도시</option></select></FieldRow>
            {customCity && <>
              <FieldRow icon="pin" label="도시 이름"><input value={draft.cityCode} maxLength={80} onChange={event => set('cityCode', event.target.value)} /></FieldRow>
              <FieldRow icon="globe" label="IANA 시간대" {...field('timeZone')}><input placeholder="America/New_York" value={draft.timeZone} {...control('timeZone')} onChange={event => set('timeZone', event.target.value)} /></FieldRow>
            </>}
            {!customCity && errors.timeZone && <FieldError id={errorId('timeZone')} message={errors.timeZone} />}
            <FieldRow icon="calendar" label="여행 시작일" {...field('startDate')}><input type="date" value={draft.startDate} {...control('startDate')} onChange={event => set('startDate', event.target.value)} /></FieldRow>
            <FieldRow icon="calendar" label="여행 종료일" {...field('endDate')}><input type="date" min={draft.startDate} value={draft.endDate} {...control('endDate')} onChange={event => set('endDate', event.target.value)} /></FieldRow>
          </FormCard>
          <FormCard title="이동">
            <FieldRow icon="car" label="택시 정책" {...field('taxiPolicy')}><select value={draft.taxiPolicy} {...control('taxiPolicy')} onChange={event => set('taxiPolicy', event.target.value as TripDraft['taxiPolicy'])}><option value="NEVER">사용 안 함</option><option value="WHEN_NEEDED">필요할 때만 (기본 추천)</option><option value="PREFER">선호</option></select></FieldRow>
            <CityProfileCard cityCode={draft.cityCode} />
          </FormCard>
        </>}
        {step === 1 && <>
          {draft.flights.map((flight, i) => {
            const arrival = flight.direction === 'ARRIVAL', place = field(`flights.${i}.googlePlaceId`), time = field(`flights.${i}.localDateTime`);
            return <FormCard key={flight.direction} title={arrival ? '도착 항공편' : '출발 항공편'}>
              <PlacePicker label={arrival ? '도착 공항' : '출발 공항'} region={region} value={places[flight.googlePlaceId]} invalid={!!place.error} describedBy={place.error ? place.errorId : undefined} onChange={value => updateFlight(i, { googlePlaceId: remember(value) })} />
              {place.error && <FieldError id={place.errorId} message={place.error} />}
              <FieldRow icon="clock" label={arrival ? '현지 도착 일시' : '현지 출발 일시'} note={draft.timeZone} {...time}><input type="datetime-local" value={flight.localDateTime} {...control(`flights.${i}.localDateTime`)} onChange={event => updateFlight(i, { localDateTime: event.target.value })} /></FieldRow>
              {!arrival && errors.flights && <FieldError id={errorId('flights')} message={errors.flights} />}
            </FormCard>;
          })}
          <FormCard title="짐">
            <FieldRow icon="bag" label="마지막 날 짐 처리" {...field('luggageOption')}><select value={draft.luggageOption} {...control('luggageOption')} onChange={event => set('luggageOption', event.target.value as TripDraft['luggageOption'])}><option value="VIA_LODGING">숙소에서 짐을 찾고 공항으로</option><option value="DIRECT_TO_AIRPORT">공항으로 바로 이동</option></select></FieldRow>
          </FormCard>
        </>}
        {step === 2 && <FormCard title="숙소">
          {draft.startDate === draft.endDate && draft.lodgings.length === 0 && <p className="empty-row">당일 여행 · 숙박 없음</p>}
          {draft.lodgings.map((lodging, i) => {
            const key = `lodgings.${i}`, place = field(`${key}.googlePlaceId`), checkIn = field(`${key}.checkIn`), checkOut = field(`${key}.checkOut`);
            return <div className="form-entry" key={lodging.key}>
              <div className="form-entry-head"><h4>숙소 {i + 1}</h4><button type="button" className="secondary small" onClick={() => set('lodgings', draft.lodgings.filter((_, index) => index !== i))}>숙소 {i + 1} 삭제</button></div>
              <PlacePicker label={`숙소 ${i + 1} 검색`} region={region} value={places[lodging.googlePlaceId]} invalid={!!place.error} describedBy={place.error ? place.errorId : undefined} onChange={value => updateLodging(i, { googlePlaceId: remember(value) })} />
              {place.error && <FieldError id={place.errorId} message={place.error} />}
              <FieldRow icon="calendar" label={`체크인 ${i + 1}`} {...checkIn}><input type="date" min={draft.startDate} max={draft.endDate} value={lodging.checkIn} {...control(`${key}.checkIn`)} onChange={event => updateLodging(i, { checkIn: event.target.value })} /></FieldRow>
              <FieldRow icon="calendar" label={`체크아웃 ${i + 1}`} {...checkOut}><input type="date" min={lodging.checkIn} max={draft.endDate} value={lodging.checkOut} {...control(`${key}.checkOut`)} onChange={event => updateLodging(i, { checkOut: event.target.value })} /></FieldRow>
              {errors[key] && <FieldError message={errors[key]} />}
            </div>;
          })}
          {draft.startDate !== draft.endDate && <AddRowButton label="숙소 추가" disabled={draft.lodgings.length >= 31} onClick={() => set('lodgings', [...draft.lodgings, { key: nextKey.current++, googlePlaceId: '', checkIn: draft.lodgings.at(-1)?.checkOut ?? draft.startDate, checkOut: draft.endDate }])} />}
          {errors.lodgings && <FieldError id={errorId('lodgings')} message={errors.lodgings} />}
        </FormCard>}
        {step === 3 && <FormCard title="방문 장소">
          <p>식당과 명소의 체류시간을 분 단위로 입력해 주세요. 희망 장소는 일정에 자동 배치되지 않습니다.</p>
          {draft.visits.map((visit, i) => <section className="entry" key={visit.key}><h3>방문 장소 {i + 1}</h3>
            <PlacePicker label={`방문 장소 ${i + 1} 검색`} region={region} value={places[visit.googlePlaceId]} onChange={value => updateVisit(i, { googlePlaceId: remember(value) })} />
            <label>유형 {i + 1}<select value={visit.kind} onChange={event => updateVisit(i, { kind: event.target.value as typeof visit.kind })}><option value="ATTRACTION">명소</option><option value="RESTAURANT">식당</option></select></label>
            <label>체류시간 (분) {i + 1}<input type="number" min="1" max="1440" step="1" value={Number.isNaN(visit.minutes) ? '' : visit.minutes} onChange={event => updateVisit(i, { minutes: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
            <label>우선순위 {i + 1}<select value={visit.priority} onChange={event => updateVisit(i, { priority: event.target.value as typeof visit.priority })}><option value="REQUIRED">필수</option><option value="WISH">희망 (지도에서 직접 추가)</option></select></label>
            <button type="button" className="secondary" onClick={() => set('visits', draft.visits.filter((_, index) => index !== i))}>방문 장소 {i + 1} 삭제</button>
          </section>)}
          <button type="button" disabled={draft.visits.length >= 100} onClick={() => set('visits', [...draft.visits, { key: nextKey.current++, googlePlaceId: '', kind: 'ATTRACTION', minutes: 60, priority: 'REQUIRED' }])}>장소 추가</button>
        </FormCard>}
      </fieldset>
      {rest.length > 0 && <ul className="form-errors">{rest.map(([key, error]) => <li key={key}>{error}</li>)}</ul>}
      <div className="form-navigation">{step > 0 && <button type="button" className="secondary" disabled={saving} onClick={() => move(step - 1)}>이전</button>}<button type="submit" disabled={saving}>{saving ? '저장 중…' : step === 3 ? '여행 저장' : '다음'}</button></div>
    </form>
  </>;
}

function SavedTrip({ id, draft }: { id: string; draft: FormDraft }) {
  return <section className="form-card" role="status"><h2>여행 입력을 저장했습니다</h2>
    <dl className="value-list">
      <div><dt>기간</dt><dd>{draft.startDate} – {draft.endDate} · {draft.timeZone}</dd></div>
      <div><dt>항공 · 숙소 · 장소</dt><dd>항공 {draft.flights.length}편 · 숙소 {draft.lodgings.length}곳 · 방문 장소 {draft.visits.length}곳</dd></div>
    </dl>
    <p><Link className="primary-link" href={`/trips/${encodeURIComponent(id)}/settings`}>생활 설정으로</Link></p>
    <p className="field-hint">여행 번호: {id}</p><Link href="/">홈으로</Link></section>;
}

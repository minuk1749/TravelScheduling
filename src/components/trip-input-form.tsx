'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PlaceSummary } from '../places';
import { cities, parseTripDraft, TripInputError, type TripDraft } from '../trips/input';
import { CityProfileCard } from './city-profile-card';
import { PlacePicker } from './place-picker';

const steps = ['여행', '항공', '숙소', '장소'];
type FormDraft = Omit<TripDraft, 'lodgings' | 'visits'> & { lodgings: (TripDraft['lodgings'][number] & { key: number })[]; visits: (TripDraft['visits'][number] & { key: number })[] };
const initial: FormDraft = { cityCode: '', timeZone: '', startDate: '', endDate: '', taxiPolicy: 'WHEN_NEEDED', luggageOption: 'VIA_LODGING',
  flights: [{ direction: 'ARRIVAL', googlePlaceId: '', localDateTime: '' }, { direction: 'DEPARTURE', googlePlaceId: '', localDateTime: '' }], lodgings: [], visits: [] };

export function TripInputForm() {
  const [draft, setDraft] = useState<FormDraft>(initial);
  const [step, setStep] = useState(0);
  const [customCity, setCustomCity] = useState(false);
  const [places, setPlaces] = useState<Record<string, PlaceSummary>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState('');
  const summary = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false), nextKey = useRef(1);
  const region = cities.find(city => city.code === draft.cityCode)?.region;
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const remember = (place: PlaceSummary | undefined) => { if (place) setPlaces(current => ({ ...current, [place.googlePlaceId]: place })); return place?.googlePlaceId ?? ''; };
  const showErrors = (fields: Record<string, string>) => { setErrors(fields); setTimeout(() => summary.current?.focus(), 0); };
  const move = (next: number) => { setErrors({}); setStep(next); setTimeout(() => heading.current?.focus(), 0); };
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
  if (savedId) return <section className="input-card" role="status"><h2>여행 입력을 저장했습니다</h2><p>{draft.startDate} – {draft.endDate} · {draft.timeZone}</p><p>항공 {draft.flights.length}편 · 숙소 {draft.lodgings.length}곳 · 방문 장소 {draft.visits.length}곳</p><p>생활 설정과 동선 생성 기능은 준비 중입니다.</p><p className="field-hint">여행 번호: {savedId}</p><Link href="/">홈으로</Link></section>;
  return <>
    <ol className="steps" aria-label="입력 단계">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <form noValidate onSubmit={event => { event.preventDefault(); void advance(); }}>
      <h2 ref={heading} tabIndex={-1}>{step + 1}. {steps[step]} 입력</h2>
      {Object.keys(errors).length > 0 && <div className="form-errors" role="alert" tabIndex={-1} ref={summary}><strong>입력 내용을 확인해 주세요.</strong><ul>{Object.entries(errors).map(([key, error]) => <li key={key}>{error}</li>)}</ul></div>}
      <fieldset disabled={saving} className="input-card">
        <legend>{steps[step]} 정보</legend>
        {step === 0 && <>
          <label>도시<select value={customCity ? 'OTHER' : draft.cityCode} onChange={event => {
            const city = cities.find(city => city.code === event.target.value);
            setCustomCity(event.target.value === 'OTHER'); setDraft(current => ({ ...current, cityCode: city?.code ?? '', timeZone: city?.timeZone ?? '' }));
          }}><option value="">도시 선택</option>{cities.map(city => <option key={city.code} value={city.code}>{city.name}</option>)}<option value="OTHER">다른 해외 도시</option></select></label>
          {customCity && <><label>도시 이름<input value={draft.cityCode} maxLength={80} onChange={event => set('cityCode', event.target.value)} /></label><label>IANA 시간대<input placeholder="예: America/New_York" value={draft.timeZone} onChange={event => set('timeZone', event.target.value)} /></label></>}
          <p className="field-hint">모든 날짜·시각은 여행지 현지 기준{draft.timeZone && ` (${draft.timeZone})`}입니다.</p>
          <div className="field-grid"><label>여행 시작일<input type="date" value={draft.startDate} onChange={event => set('startDate', event.target.value)} /></label><label>여행 종료일<input type="date" min={draft.startDate} value={draft.endDate} onChange={event => set('endDate', event.target.value)} /></label></div>
          <CityProfileCard cityCode={draft.cityCode} />
          <label>택시 정책<select value={draft.taxiPolicy} onChange={event => set('taxiPolicy', event.target.value as TripDraft['taxiPolicy'])}><option value="NEVER">사용 안 함</option><option value="WHEN_NEEDED">필요할 때만 (기본 추천)</option><option value="PREFER">선호</option></select></label>
        </>}
        {step === 1 && <>
          <p className="field-hint">현지 시각 · {draft.timeZone}. 도착은 여행 첫날, 출발은 마지막 날입니다.</p>
          {draft.flights.map((flight, i) => <section className="entry" key={flight.direction}><h3>{flight.direction === 'ARRIVAL' ? '도착 항공편' : '출발 항공편'}</h3>
            <PlacePicker label={flight.direction === 'ARRIVAL' ? '도착 공항' : '출발 공항'} region={region} value={places[flight.googlePlaceId]} onChange={place => set('flights', draft.flights.map((row, index) => index === i ? { ...row, googlePlaceId: remember(place) } : row))} />
            <label>{flight.direction === 'ARRIVAL' ? '현지 도착 일시' : '현지 출발 일시'}<input type="datetime-local" value={flight.localDateTime} onChange={event => set('flights', draft.flights.map((row, index) => index === i ? { ...row, localDateTime: event.target.value } : row))} /></label>
          </section>)}
          <label>마지막 날 짐 처리<select value={draft.luggageOption} onChange={event => set('luggageOption', event.target.value as TripDraft['luggageOption'])}><option value="VIA_LODGING">숙소에서 짐을 찾고 공항으로</option><option value="DIRECT_TO_AIRPORT">공항으로 바로 이동</option></select></label>
          <p className="field-hint">첫날은 숙소에 짐을 맡깁니다. 기본 공항 버퍼: 입국 90분, 출국 150분.</p>
        </>}
        {step === 2 && <>
          <p>숙소를 옮긴다면 숙박 기간별로 추가해 주세요.{draft.startDate === draft.endDate && ' 당일 여행은 숙박 없이 진행할 수 있습니다.'}</p>
          {draft.lodgings.map((lodging, i) => <section className="entry" key={lodging.key}><h3>숙소 {i + 1}</h3>
            <PlacePicker label={`숙소 ${i + 1} 검색`} region={region} value={places[lodging.googlePlaceId]} onChange={place => set('lodgings', draft.lodgings.map((row, index) => index === i ? { ...row, googlePlaceId: remember(place) } : row))} />
            <div className="field-grid"><label>체크인 {i + 1}<input type="date" min={draft.startDate} max={draft.endDate} value={lodging.checkIn} onChange={event => set('lodgings', draft.lodgings.map((row, index) => index === i ? { ...row, checkIn: event.target.value } : row))} /></label><label>체크아웃 {i + 1}<input type="date" min={lodging.checkIn} max={draft.endDate} value={lodging.checkOut} onChange={event => set('lodgings', draft.lodgings.map((row, index) => index === i ? { ...row, checkOut: event.target.value } : row))} /></label></div>
            <button type="button" className="secondary" onClick={() => set('lodgings', draft.lodgings.filter((_, index) => index !== i))}>숙소 {i + 1} 삭제</button>
          </section>)}
          {draft.startDate !== draft.endDate && <button type="button" disabled={draft.lodgings.length >= 31} onClick={() => set('lodgings', [...draft.lodgings, { key: nextKey.current++, googlePlaceId: '', checkIn: draft.lodgings.at(-1)?.checkOut ?? draft.startDate, checkOut: draft.endDate }])}>숙소 추가</button>}
        </>}
        {step === 3 && <>
          <p>식당과 명소의 체류시간을 분 단위로 입력해 주세요. 희망 장소는 일정에 자동 배치되지 않습니다.</p>
          {draft.visits.map((visit, i) => <section className="entry" key={visit.key}><h3>방문 장소 {i + 1}</h3>
            <PlacePicker label={`방문 장소 ${i + 1} 검색`} region={region} value={places[visit.googlePlaceId]} onChange={place => set('visits', draft.visits.map((row, index) => index === i ? { ...row, googlePlaceId: remember(place) } : row))} />
            <label>유형 {i + 1}<select value={visit.kind} onChange={event => set('visits', draft.visits.map((row, index) => index === i ? { ...row, kind: event.target.value as typeof visit.kind } : row))}><option value="ATTRACTION">명소</option><option value="RESTAURANT">식당</option></select></label>
            <label>체류시간 (분) {i + 1}<input type="number" min="1" max="1440" step="1" value={Number.isNaN(visit.minutes) ? '' : visit.minutes} onChange={event => set('visits', draft.visits.map((row, index) => index === i ? { ...row, minutes: event.target.value === '' ? NaN : Number(event.target.value) } : row))} /></label>
            <label>우선순위 {i + 1}<select value={visit.priority} onChange={event => set('visits', draft.visits.map((row, index) => index === i ? { ...row, priority: event.target.value as typeof visit.priority } : row))}><option value="REQUIRED">필수</option><option value="WISH">희망 (지도에서 직접 추가)</option></select></label>
            <button type="button" className="secondary" onClick={() => set('visits', draft.visits.filter((_, index) => index !== i))}>방문 장소 {i + 1} 삭제</button>
          </section>)}
          <button type="button" disabled={draft.visits.length >= 100} onClick={() => set('visits', [...draft.visits, { key: nextKey.current++, googlePlaceId: '', kind: 'ATTRACTION', minutes: 60, priority: 'REQUIRED' }])}>장소 추가</button>
        </>}
      </fieldset>
      <div className="form-navigation">{step > 0 && <button type="button" className="secondary" disabled={saving} onClick={() => move(step - 1)}>이전</button>}<button type="submit" disabled={saving}>{saving ? '저장 중…' : step === 3 ? '여행 저장' : '다음'}</button></div>
    </form>
  </>;
}

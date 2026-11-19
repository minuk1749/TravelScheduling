'use client';

import type { PlaceSummary } from '../places';
import type { TripDraft } from '../trips/input';
import { AddRowButton, errorProps, FieldError, FieldRow, FormCard, Icon } from './form-rows';
import { PlacePicker } from './place-picker';

type Visit = TripDraft['visits'][number] & { key: number };

/** Required/wish status with icon + text, never color alone (docs/design.md §3). */
export function VisitStatus({ priority }: { priority: Visit['priority'] }) {
  return priority === 'REQUIRED'
    ? <span className="visit-status is-required"><Icon name="check" size={13} />필수 · 일정에 배치</span>
    : <span className="visit-status is-wish"><Icon name="star" size={13} />희망 · 지도에만 표시</span>;
}

/** Trip creation step 4: places to visit (T18). Validation stays in `parseTripDraft`. */
export function VisitEntries({ visits, places, region, errors, errorId, onAdd, onUpdate, onRemove, remember }: {
  visits: Visit[]; places: Record<string, PlaceSummary>; region?: string; errors: Record<string, string>; errorId(key: string): string;
  onAdd(): void; onUpdate(index: number, patch: Partial<Visit>): void; onRemove(index: number): void; remember(place: PlaceSummary | undefined): string;
}) {
  const row = (key: string) => ({ error: errors[key], errorId: errorId(key) });
  const control = (key: string) => errorProps(errors[key], errorId(key));
  return <FormCard title="방문 장소">
    {visits.length === 0 && <p className="empty-row">추가한 장소 없음</p>}
    {visits.map((visit, i) => {
      const key = `visits.${i}`, place = places[visit.googlePlaceId], placeKey = `${key}.googlePlaceId`;
      const taken = new Set(visits.filter((_, index) => index !== i).map(other => other.googlePlaceId).filter(Boolean));
      const duplicate = visit.googlePlaceId !== '' && taken.has(visit.googlePlaceId);
      const placeError = errors[placeKey] ?? (duplicate ? '이미 추가한 장소예요. 다른 장소를 선택해 주세요.' : undefined);
      return <div className="form-entry visit-entry" key={visit.key}>
        <div className="form-entry-head">
          <span className="field-icon"><Icon name={visit.kind === 'RESTAURANT' ? 'meal' : 'sight'} /></span>
          <div className="visit-heading"><h4>{place?.name ?? `방문 장소 ${i + 1}`}</h4><VisitStatus priority={visit.priority} /></div>
          <button type="button" className="secondary small" aria-label={`방문 장소 ${i + 1} 삭제`} onClick={() => onRemove(i)}>삭제</button>
        </div>
        <PlacePicker label={`방문 장소 ${i + 1} 검색`} region={region} value={place} taken={taken} invalid={!!placeError} describedBy={placeError ? errorId(placeKey) : undefined} onChange={value => onUpdate(i, { googlePlaceId: remember(value) })} />
        {placeError && <FieldError id={errorId(placeKey)} message={placeError} />}
        <FieldRow icon={visit.kind === 'RESTAURANT' ? 'meal' : 'sight'} label={`유형 ${i + 1}`} {...row(`${key}.kind`)}><select value={visit.kind} {...control(`${key}.kind`)} onChange={event => onUpdate(i, { kind: event.target.value as Visit['kind'] })}><option value="ATTRACTION">명소</option><option value="RESTAURANT">식당</option></select></FieldRow>
        <FieldRow icon="timer" label={`체류시간 (분) ${i + 1}`} note="분" {...row(`${key}.minutes`)}><input type="number" inputMode="numeric" min="1" max="1440" step="1" value={Number.isNaN(visit.minutes) ? '' : visit.minutes} {...control(`${key}.minutes`)} onChange={event => onUpdate(i, { minutes: event.target.value === '' ? NaN : Number(event.target.value) })} /></FieldRow>
        <FieldRow icon={visit.priority === 'REQUIRED' ? 'check' : 'star'} label={`우선순위 ${i + 1}`} {...row(`${key}.priority`)}><select value={visit.priority} {...control(`${key}.priority`)} onChange={event => onUpdate(i, { priority: event.target.value as Visit['priority'] })}><option value="REQUIRED">필수 · 일정에 배치</option><option value="WISH">희망 · 지도에만 표시</option></select></FieldRow>
      </div>;
    })}
    <AddRowButton label="장소 추가" disabled={visits.length >= 100} onClick={onAdd} />
    {errors.visits && <FieldError id={errorId('visits')} message={errors.visits} />}
  </FormCard>;
}

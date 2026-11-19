import type { Constraints, ResultView, VisitEdit } from '../../results/model';
import type { ItineraryResult } from '../../services/itinerary/types';
import { mapMarkers, MARKER_LABELS, visitName } from '../../results/presentation';
import { PlaceCredits } from '../place-picker';
export function VisitEditor({ view, draft, result, selected, change, select }: {
  view: ResultView; draft: Constraints; result: ItineraryResult | null; selected: string | null;
  change(value: Constraints): void; select(id: string): void;
}) {
  const markers = new Map(mapMarkers(view, result).map(m => [m.id, m]));
  const update = (id: string, value: Partial<VisitEdit>) => change({ ...draft, visits: draft.visits.map(v => v.id === id ? { ...v, ...value } : v) });
  return <section aria-label="장소 선택과 고정"><h2>필수 장소 선택 · 날짜에 추가</h2><p>희망 장소는 날짜를 지정하면 일정에 추가됩니다. 고정된 희망 장소는 필수 선택을 해제해도 유지됩니다. 순서는 날짜 안에서 0부터 시작합니다.</p>
    {result?.status === 'OVER_CAPACITY' && <button type="button" onClick={() => {
      const recommended = new Set(result.capacity.recommendation?.requiredVisitIds);
      change({ ...draft, visits: draft.visits.map(v => ({ ...v, priority: recommended.has(v.id) ? 'REQUIRED' : 'WISH' })) });
    }}>추천 조합 선택</button>}
    {draft.visits.map(visit => {
      const name = visitName(view, visit.id), place = view.places[view.input.visits.find(v => v.id === visit.id)!.place.id];
      return <article className={`result-visit ${selected === visit.id ? 'is-selected' : ''}`} key={visit.id} id={`edit-${visit.id}`}>
        <h3><button type="button" className="secondary" aria-pressed={selected === visit.id} onClick={() => select(visit.id)}>{markers.has(visit.id) ? MARKER_LABELS[markers.get(visit.id)!.state] : '위치 정보 없음'} {name}</button></h3>
        {place && <PlaceCredits place={place} />}
        <label className="result-checkbox"><input type="checkbox" checked={visit.priority === 'REQUIRED'} onChange={event => update(visit.id, { priority: event.target.checked ? 'REQUIRED' : 'WISH' })} />{name} 필수</label>
        <div className="field-grid"><label>{name} 날짜<input type="date" min={view.input.startDate} max={view.input.endDate} value={visit.fixedDate ?? ''} onChange={event => update(visit.id, event.target.value ? { fixedDate: event.target.value } : { fixedDate: null, fixedTime: null, fixedOrder: null })} /></label>
          <label>{name} 시각<input type="time" disabled={!visit.fixedDate} value={visit.fixedTime ?? ''} onChange={event => update(visit.id, { fixedTime: event.target.value || null })} /></label>
          <label>{name} 순서<input type="number" min={0} max={draft.visits.length - 1} step={1} disabled={!visit.fixedDate} value={visit.fixedOrder ?? ''} onChange={event => update(visit.id, { fixedOrder: event.target.value === '' ? null : Number(event.target.value) })} /></label></div>
        <button type="button" className="secondary" onClick={() => update(visit.id, { fixedDate: null, fixedTime: null, fixedOrder: null })}>{name} 고정 해제</button>
      </article>;
    })}
  </section>;
}

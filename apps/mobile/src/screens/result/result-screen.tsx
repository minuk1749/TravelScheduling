import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { placeName } from '@travel/core/presentation';
import type { ResultMap as ResultMapAdapter } from '../../map/provider';
import { mapScene } from '../../map/scene';
import {
  dayOf, findVisit, initialSelection, pendingLegKeys, reconcileSelection, selectDate, selectedCard,
  type MapFocus, type Selection,
} from '../../map/selection';
import { conflictCauses } from '../../result/conflicts';
import { buildDays, placedVisitIds, type DayModel, type LegModel } from '../../result/days';
import { onDate, withLegMode, withVisit } from '../../result/edits';
import { freeTime, periodLabel } from '../../result/format';
import { colors, result } from '../../theme';
import { cityName } from '../trip-input/presentation';
import { EditSheet } from './edit-sheet';
import { LocateButton, Legend, ShapeRetry, Toast } from './map-controls';
import { PlacePanel, type PanelStatus } from './place-panel';
import { ScheduleSheet } from './schedule-sheet';
import { DateChips, TopBar } from './top-bar';
import type { useItinerary } from './use-itinerary';
import { useRouteShapes } from './use-route-shapes';
import { WishSheet } from './wish-sheet';

type Sheet = { kind: 'SCHEDULE' } | { kind: 'EDIT'; visitId: string } | { kind: 'WISH'; visitId: string; date: string; chooseVisit: boolean };
type Picked = { days: readonly DayModel[]; result: unknown; selection: Selection; visitId: string | null };
const NOTICE_MS = 6000;
const NOTHING: ReadonlySet<string> = new Set();

const pick = (days: readonly DayModel[], result: unknown, selection: Selection): Picked =>
  ({ days, result, selection, visitId: selectedCard(days, selection)?.visitId ?? null });

/**
 * Map-first result screen (design §6–7, states 3-1–3-9). Card, marker and legs follow one selection.
 * `map` is the injected adapter (`MapAdapterProvider`): Google in the app, a fake in tests.
 */
export function ResultScreen({ tripId, itinerary, map: ResultMap, back, editConditions }: {
  tripId: string; itinerary: ReturnType<typeof useItinerary>; map: ResultMapAdapter; back(): void; editConditions(): void;
}) {
  const { shown: calculation, base, previous, phase, notice, canUndo, focusVisit } = itinerary;
  const shown = calculation.result;
  const failed = phase.kind === 'failed', calculating = phase.kind === 'calculating';
  const conflict = shown.status === 'CONFLICT';
  // 3-9 keeps the last successful schedule together with the input that produced its cards and sheet.
  const previousSchedule = failed && base ? base : null;
  const view = (previousSchedule ?? calculation).view;
  const displayed = previousSchedule?.result ?? (conflict ? base?.result ?? null : shown);
  const causes = useMemo(() => conflictCauses(view, previousSchedule?.result ?? shown), [view, previousSchedule, shown]);
  const days = useMemo(() => buildDays(view, displayed, conflict ? null : previous, causes), [view, displayed, conflict, previous, causes]);

  const [picked, setPicked] = useState<Picked>(() => pick(days, shown, initialSelection(days, causes)));
  let current = picked;
  if (picked.days !== days || picked.result !== shown) {
    const newResult = picked.result !== shown;
    const visitId = newResult ? focusVisit ?? picked.visitId : picked.visitId;
    const selection = newResult && conflict ? initialSelection(days, causes) : reconcileSelection(days, picked.selection, visitId);
    current = pick(days, shown, selection);
    setPicked(current);
  }
  const select = (selection: Selection) => setPicked(pick(days, shown, selection));
  const selection = current.selection;
  const day = dayOf(days, selection)!;
  const card = selectedCard(days, selection);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  // "이전 일정 보기" applies to the failure it was pressed for, not to a later one.
  const [previousFor, setPreviousFor] = useState<typeof phase | null>(null);
  const showPrevious = failed && previousFor === phase;
  const [locate, setLocate] = useState(0);
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const { height } = useWindowDimensions();
  const { shapes, failed: shapesFailed, retry: retryShapes } = useRouteShapes(tripId, shown.status === 'OK' ? shown : null);
  const { dismissNotice } = itinerary;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  const placed = placedVisitIds(days);
  const wishes = view.input.visits.filter(visit => visit.priority === 'WISH' && !placed.has(visit.id))
    .map(visit => ({ visitId: visit.id, name: placeName(view, visit.place.id) }));
  const editing = sheet?.kind === 'EDIT' ? days.flatMap(row => row.cards).find(item => item.visitId === sheet.visitId) ?? null : null;
  const focus: MapFocus = calculating ? 'CALCULATING' : failed ? 'PREVIOUS' : editing ? 'EDIT' : conflict ? 'CONFLICT' : 'BROWSE';
  const scene = mapScene({ view, day, card: editing ?? card, focus, placed, shapes, causes,
    pending: calculating ? pendingLegKeys(days, phase.change) : NOTHING });
  const constraints = constraintsFrom(view.input);
  const editOf = (visitId: string) => constraints.visits.find(visit => visit.id === visitId)!;
  const currency = displayed?.efficiency?.currency ?? null;

  const status: PanelStatus = calculating ? { kind: 'CALCULATING' }
    : failed ? (showPrevious ? { kind: 'PREVIOUS' } : { kind: 'FAILED', message: phase.message, hasPrevious: !!displayed })
      : conflict ? { kind: 'CONFLICT', count: causes.length, canUndo,
        target: card?.issue ? card : day.cards.find(item => item.issue) ?? null,
        messages: causes.filter(cause => !cause.visitId && (!cause.date || cause.date === day.date)).map(cause => cause.message) }
        : { kind: 'READY' };

  const chooseDate = (date: string) => { setSheet(null); select(selectDate(date)); };
  const selectMarker = (id: string) => {
    if (wishes.some(wish => wish.visitId === id)) { if (phase.kind === 'idle') setSheet({ kind: 'WISH', visitId: id, date: day.date, chooseVisit: false }); return; }
    const index = day.cards.findIndex(item => item.visitId === id);
    if (index >= 0) select({ date: day.date, index });
  };
  const swap = (leg: LegModel | null) => {
    const mode = leg?.swap?.mode;
    if (!leg || !mode) return;
    itinerary.apply({ kind: 'MODE', leg: { key: leg.key, date: leg.date, from: leg.from, to: leg.to }, mode },
      withLegMode(constraints, leg, mode));
  };
  const lodgings = [...new Set(view.input.lodgings.map(lodging => placeName(view, lodging.place.id)))].join(', ') || '당일 여행';

  return <View style={styles.screen}>
    <ResultMap markers={scene.markers} routes={scene.routes} focusIds={scene.focusIds}
      selectedId={sheet?.kind === 'WISH' ? sheet.visitId : (editing ?? card)?.visitId ?? null} topInset={insets.top} bottomInset={insets.bottom}
      dimmed={failed} locateRequest={locate} onSelectMarker={selectMarker} />
    <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.top}
      onLayout={event => { const top = event.nativeEvent.layout.height; setInsets(value => ({ ...value, top })); }}>
      <TopBar title={cityName(view.input.cityCode)} subtitle={`${periodLabel(view.input)} · ${lodgings}`}
        back={back} edit={editConditions} disabled={calculating} />
      <DateChips days={days} selected={day.date} onSelect={chooseDate} />
    </SafeAreaView>
    {!notice && <Legend wishes={wishes.length} bottom={insets.bottom} />}
    {shapesFailed && !notice && <ShapeRetry bottom={insets.bottom} onPress={retryShapes} />}
    <LocateButton bottom={insets.bottom} onPress={() => setLocate(value => value + 1)} />
    {notice && <Toast notice={notice} bottom={insets.bottom} onClose={dismissNotice}
      onUndo={() => { dismissNotice(); itinerary.revert(); }} />}
    <PlacePanel day={day} index={selection.index} status={status} currency={currency} freeTime={freeTime(displayed?.availableByDate?.[day.date], day.timeZone)}
      canAddWish={wishes.length > 0} minHeight={height * result.panel.ratio}
      onLayout={event => { const bottom = event.nativeEvent.layout.height; setInsets(value => ({ ...value, bottom })); }}
      actions={{
        onIndex: index => select({ date: day.date, index }), onSchedule: () => setSheet({ kind: 'SCHEDULE' }),
        onEdit: target => setSheet({ kind: 'EDIT', visitId: target.visitId }), onSwap: target => swap(target.arrival),
        onAddWish: () => {
          const first = wishes[0];
          if (first) setSheet({ kind: 'WISH', visitId: first.visitId, date: day.date, chooseVisit: true });
        },
        onShowPrevious: () => setPreviousFor(phase), onRetry: itinerary.retry,
        onRevert: itinerary.revert, onEditConditions: editConditions,
      }} />
    {sheet?.kind === 'SCHEDULE' && <ScheduleSheet day={day} places={view.places} currency={currency} efficiency={displayed?.efficiency ?? null}
      onSwap={status.kind === 'READY' ? leg => { setSheet(null); swap(leg); } : undefined}
      estimated={!!displayed?.comparisons.some(leg => leg.selected.mode === 'TAXI')} close={() => setSheet(null)}
      select={visitId => { setSheet(null); const found = findVisit(days, visitId); if (found) select(found); }} />}
    {sheet?.kind === 'EDIT' && editing && <EditSheet view={view} card={editing} days={days} current={editOf(editing.visitId)}
      day={days.find(row => row.cards.includes(editing)) ?? day} close={() => setSheet(null)}
      apply={edit => { setSheet(null); itinerary.apply({ kind: 'VISIT', visitId: edit.id }, withVisit(constraints, edit)); }} />}
    {sheet?.kind === 'WISH' && <WishSheet wishes={wishes} visitId={sheet.visitId} date={sheet.date} days={days}
      onChoose={sheet.chooseVisit ? visitId => setSheet({ ...sheet, visitId }) : undefined}
      close={() => setSheet(null)} apply={(visitId, date) => {
        setSheet(null);
        itinerary.apply({ kind: 'WISH', visitId, date }, withVisit(constraints, onDate(editOf(visitId), date)));
      }} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
});

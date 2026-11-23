import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { constraintsFrom } from '@travel/core/contracts/results/model';
import { placeName } from '@travel/core/presentation';
import type { ResultMap as ResultMapAdapter } from '../../map/provider';
import { mapScene } from '../../map/scene';
import {
  dayOf, findVisit, initialSelection, pendingLegKeys, reconcileSelection, selectDate, selectedCard,
  type MapFocus, type Selection,
} from '../../map/selection';
import { conflictCauses, conflictingModeFixes } from '../../result/conflicts';
import { buildDays, placedVisitIds, type DayModel, type LegModel } from '../../result/days';
import { withLegMode, withVisit } from '../../result/edits';
import { freeTime, periodLabel } from '../../result/format';
import { colors } from '../../theme';
import { cityName, kindLabels } from '../trip-input/presentation';
import { EditSheet } from './edit-sheet';
import { LocateButton, Legend, ShapeRetry, Toast, useMapControls } from './map-controls';
import { PlacePanel, usePanelLayout, type PanelStatus } from './place-panel';
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
  const { shapes, failed: shapesFailed, retry: retryShapes } = useRouteShapes(tripId, displayed?.status === 'OK' ? displayed : null);
  const days = useMemo(() => buildDays(view, displayed, conflict ? null : previous, causes, shapes), [view, displayed, conflict, previous, causes, shapes]);

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
  const day = dayOf(days, current.selection)!;
  const modeFixes = useMemo(() => conflict
    ? conflictingModeFixes(view, day.date, causes, shown.airportTransferLimits) : null,
  [conflict, view, day.date, causes, shown.airportTransferLimits]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const editSelection = sheet?.kind === 'EDIT' ? findVisit([day], sheet.visitId) : null;
  const selection = editSelection ?? current.selection;
  const card = selectedCard(days, selection);
  // "이전 일정 보기" applies to the failure it was pressed for, not to a later one.
  const [previousFor, setPreviousFor] = useState<typeof phase | null>(null);
  // A timeline opened before or after this failure also counts as viewing the last successful result.
  if (failed && sheet?.kind === 'SCHEDULE') {
    if (!previousSchedule) setSheet(null);
    else if (previousFor !== phase) setPreviousFor(phase);
  }
  const showPrevious = failed && previousFor === phase;
  const [locate, setLocate] = useState(0);
  const safe = useSafeAreaInsets();
  const [topInset, setTopInset] = useState(0);
  const { panelHeight, wide, onLayout } = usePanelLayout(topInset);
  const showShapeRetry = shapesFailed && displayed === shown && !notice;
  const { overlay, measure, toastHeight } = useMapControls(safe.left, safe.right, notice, showShapeRetry);
  const { dismissNotice } = itinerary;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  const placed = placedVisitIds(days);
  const wishes = view.input.visits.filter(visit => visit.priority === 'WISH' && !placed.has(visit.id))
    .map((visit, index) => ({ visitId: visit.id, name: view.places[visit.place.id]?.name ??
      `희망 장소 ${index + 1} · ${kindLabels[visit.kind]} · ${visit.minutes}분` }));
  const focus: MapFocus = calculating ? 'CALCULATING' : failed ? 'PREVIOUS' : editSelection ? 'EDIT' : conflict ? 'CONFLICT' : 'BROWSE';
  const scene = mapScene({ view, day, card, focus, placed, causes,
    pending: calculating ? pendingLegKeys(days, phase.change) : NOTHING });
  const constraints = constraintsFrom(view.input);
  const editOf = (visitId: string) => constraints.visits.find(visit => visit.id === visitId)!;
  const currency = displayed?.efficiency?.currency ?? null;

  const status: PanelStatus = calculating ? { kind: 'CALCULATING' }
    : failed ? (showPrevious ? { kind: 'PREVIOUS' } : { kind: 'FAILED', message: phase.message, hasPrevious: !!previousSchedule })
      : modeFixes ? { kind: 'CONFLICT', count: causes.length, canUndo,
        target: card?.issue ? card : day.cards.find(item => item.issue) ?? null,
        modeFixes,
        messages: causes.filter(cause => !cause.visitId && (!cause.date || cause.date === day.date)).map(cause => cause.message) }
        : { kind: 'READY' };

  const chooseDate = (date: string) => { setSheet(null); select(selectDate(date)); };
  const openWishPicker = () => {
    const first = wishes[0];
    if (first) setSheet({ kind: 'WISH', visitId: first.visitId, date: day.date, chooseVisit: true });
  };
  const selectMarker = (id: string) => {
    const marker = scene.markers.find(item => item.id === id);
    if (marker?.kind === 'PLACED') {
      const index = day.cards.findIndex(item => item.visitId === id);
      if (index >= 0) select({ date: day.date, index });
    } else if (marker?.kind === 'WISH' && phase.kind === 'idle') {
      setSheet({ kind: 'WISH', visitId: id, date: day.date, chooseVisit: false });
    }
  };
  const swap = (leg: LegModel | null, mode: LegModel['mode'] | undefined) => {
    if (!leg || !mode || !leg.alternatives[mode]) return;
    itinerary.apply({ kind: 'MODE', leg: { date: leg.date, from: leg.from, to: leg.to }, mode },
      withLegMode(constraints, leg, mode));
  };
  const lodgings = [...new Set(view.input.lodgings.map(lodging => placeName(view, lodging.place.id)))].join(', ') || '당일 여행';

  return <View testID="result-screen" style={styles.screen} onLayout={onLayout}>
    <ResultMap markers={scene.markers} routes={scene.routes} focusDate={day.date} focusIds={scene.focusIds}
      selectedId={sheet?.kind === 'WISH' ? sheet.visitId : card?.visitId ?? null} topInset={topInset} bottomInset={panelHeight}
      overlay={overlay} dimmed={failed} locateRequest={locate} onSelectMarker={selectMarker} />
    <SafeAreaView testID="result-top-controls" edges={['top', 'left', 'right']} pointerEvents="box-none" style={styles.top}
      onLayout={event => setTopInset(event.nativeEvent.layout.height)}>
      <TopBar title={cityName(view.input.cityCode)} subtitle={`${periodLabel(view.input)} · ${lodgings}`}
        back={back} edit={editConditions} disabled={calculating} />
      <DateChips days={days} selected={day.date} onSelect={chooseDate} />
    </SafeAreaView>
    <View testID="result-map-controls" pointerEvents="box-none" style={[StyleSheet.absoluteFill, { left: safe.left, right: safe.right }]}>
      {!notice && <Legend onLayout={measure('legend')} wishes={wishes.length} bottom={panelHeight} onAddWish={phase.kind === 'idle' ? openWishPicker : undefined} />}
      {showShapeRetry && <ShapeRetry onLayout={measure('retry')} bottom={panelHeight} onPress={retryShapes} />}
      <LocateButton toastHeight={wide ? 0 : toastHeight} onLayout={measure('locate')} bottom={panelHeight} onPress={() => setLocate(value => value + 1)} />
      {notice && <Toast wide={wide} onLayout={measure('toast')} notice={notice} bottom={panelHeight} onClose={dismissNotice}
        onUndo={() => { dismissNotice(); itinerary.revert(); }} />}
    </View>
    <PlacePanel day={day} index={selection.index} status={status} currency={currency} freeTime={freeTime(displayed?.availableByDate?.[day.date], day.timeZone)}
      canAddWish={wishes.length > 0} height={panelHeight}
      actions={{
        onIndex: index => select({ date: day.date, index }), onSchedule: () => setSheet({ kind: 'SCHEDULE' }),
        onEdit: target => setSheet({ kind: 'EDIT', visitId: target.visitId }), onSwap: target => swap(target.arrival, target.arrival?.swap?.mode),
        onAddWish: openWishPicker,
        onReleaseMode: leg => itinerary.apply({ kind: 'MODE', leg, mode: null }, withLegMode(constraints, leg, null)),
        onShowPrevious: () => setPreviousFor(phase), onRetry: itinerary.retry,
        onRevert: itinerary.revert, onEditConditions: editConditions,
      }} />
    {sheet?.kind === 'SCHEDULE' && <ScheduleSheet day={day} places={view.places} currency={currency} efficiency={displayed?.efficiency ?? null}
      previous={showPrevious} onSwap={status.kind === 'READY' ? (leg, mode) => { setSheet(null); swap(leg, mode); } : undefined}
      estimated={!!displayed?.comparisons.some(leg => leg.selected.mode === 'TAXI')} close={() => setSheet(null)}
      select={visitId => { setSheet(null); const found = findVisit([day], visitId); if (found) select(found); }} />}
    {editSelection && card && <EditSheet view={view} card={card} days={days} current={editOf(card.visitId)}
      day={day} close={() => setSheet(null)}
      apply={edit => {
        select(editSelection);
        setSheet(null);
        const before = editOf(edit.id);
        const previousDate = card.start ? day.date : before.fixedDate;
        const placementOrder = { before: before.fixedOrder, after: edit.fixedOrder };
        itinerary.apply({ kind: 'VISIT', visitId: edit.id, date: edit.fixedDate, previousDate, placementOrder }, withVisit(constraints, edit));
      }} />}
    {sheet?.kind === 'WISH' && <WishSheet wishes={wishes} current={editOf(sheet.visitId)} input={view.input} date={sheet.date} days={days}
      onChoose={sheet.chooseVisit ? visitId => setSheet({ ...sheet, visitId }) : undefined}
      close={() => setSheet(null)} apply={edit => {
        setSheet(null);
        const previousDate = editOf(edit.id).fixedDate;
        itinerary.apply({ kind: 'WISH', visitId: edit.id, date: edit.fixedDate, previousDate }, withVisit(constraints, edit));
      }} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
});

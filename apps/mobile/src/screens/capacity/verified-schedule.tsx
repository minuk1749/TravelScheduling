import { Text, View } from 'react-native';
import type { ResultView } from '@travel/core/contracts/results/model';
import { displayedSchedule, localTime, MEALS, placeName } from '@travel/core/presentation';
import type { GeneratedTrip } from '../../api/trips';
import { FormCard, FormScreen, form } from '../../components/input/form-layout';
import { PlaceCredits } from '../../components/input/place-search';
import { text } from '../../theme';
import { titleForTrip } from '../trip-input/presentation';

export function VerifiedSchedule({ view, result, back }: { view: ResultView; result: GeneratedTrip; back(): void }) {
  const visits = new Map(view.input.visits.map(visit => [visit.id, visit.place.id]));
  return <FormScreen title="동선 결과" subtitle={titleForTrip(view.input)} back={back}>
    {displayedSchedule(result)?.days.map(day => <FormCard title={day.date} key={day.date}>
      {day.stops.length === 0 && <Text style={text.body}>배치된 장소 없음</Text>}
      {day.stops.map((stop, index) => {
        const id = stop.kind === 'VISIT' ? visits.get(stop.visitId) ?? '' : '';
        const name = stop.kind === 'MEAL' ? MEALS[stop.slot] : placeName(view, id);
        const place = view.places[id];
        return <View key={index}>
          <Text style={text.body}>{localTime(stop.start, day.timeZone)}–{localTime(stop.end, day.timeZone)} · {name}</Text>
          {place && <PlaceCredits place={place} />}
        </View>;
      })}
    </FormCard>)}
    <Text style={form.secondary}>장소 정보 · Google Maps</Text>
  </FormScreen>;
}

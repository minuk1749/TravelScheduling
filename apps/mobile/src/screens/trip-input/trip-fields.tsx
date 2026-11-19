import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { cities } from '@travel/core/contracts/trips/input';
import { Choice, EditField, SmallButton, type Errors, type FocusRequest } from '../../components/input/fields';
import { FormCard, FormError, form } from '../../components/input/form-layout';
import { PlacePicker } from './place-picker';
import { cityName } from './presentation';
import { regionFor, type TripFormDraft } from './draft';

type Props = { draft: TripFormDraft; errors: Errors; focus?: FocusRequest; change(patch: Partial<TripFormDraft>): void };

export function TripFields(props: Props) {
  return <><Destination {...props} /><Flights {...props} /><Lodgings {...props} />
    <FormCard title="짐 처리"><Choice options={[
      { value: 'VIA_LODGING', label: '숙소 경유' }, { value: 'DIRECT_TO_AIRPORT', label: '공항으로 바로 이동' },
    ]} value={props.draft.luggageOption} onChange={luggageOption => props.change({ luggageOption })} /></FormCard>
  </>;
}

function Destination({ draft, errors, focus, change }: Props) {
  const [custom, setCustom] = useState(Boolean(draft.cityCode && !cities.some(city => city.code === draft.cityCode)));
  return <FormCard title="여행지 · 기간">
    <Choice options={[...cities.map(city => ({ value: city.code, label: city.name })), { value: 'CUSTOM', label: '직접 입력' }]}
      value={custom ? 'CUSTOM' : draft.cityCode} onChange={code => {
        const city = cities.find(city => city.code === code);
        setCustom(!city);
        change({ cityCode: city?.code ?? '', timeZone: city?.timeZone ?? '' });
      }} />
    {custom ? <>
      <EditField name="cityCode" label="여행지 도시" errors={errors} focus={focus} maxLength={80}
        value={draft.cityCode} onChangeText={cityCode => change({ cityCode })} />
      <EditField name="timeZone" label="IANA 시간대" errors={errors} focus={focus} placeholder="Europe/Rome"
        value={draft.timeZone} onChangeText={timeZone => change({ timeZone })} />
    </> : <>{draft.timeZone && <Text style={form.secondary}>{draft.timeZone}</Text>}<FormError message={errors.cityCode} /></>}
    <View style={form.row}>
      {(['startDate', 'endDate'] as const).map((name, index) => <View key={name} style={form.flex}>
        <EditField name={name} label={index ? '종료일' : '시작일'} errors={errors} focus={focus} placeholder="YYYY-MM-DD"
          maxLength={10} value={draft[name]} onChangeText={date => change({ [name]: date })} />
      </View>)}
    </View>
  </FormCard>;
}

function Flights({ draft, errors, focus, change }: Props) {
  return <FormCard title="항공편">
    {draft.flights.map((flight, index) => {
      const key = `flights.${index}`;
      const id = `${key}.googlePlaceId`;
      const label = flight.direction === 'ARRIVAL' ? '도착' : '출발';
      const update = (patch: Partial<typeof flight>) => change({
        flights: draft.flights.map((row, i) => i === index ? { ...row, ...patch } : row),
      });
      return <View key={flight.direction} style={form.stack}>
        <PlacePicker key={draft.cityCode} label={`${label} 공항`} region={regionFor(draft.cityCode)} value={flight.place}
          error={errors[id]} focus={focus?.field === id ? focus : undefined} onChange={place => update({ place })} />
        <EditField name={`${key}.localDateTime`} label={`${label} 현지 시각`} errors={errors} focus={focus}
          maxLength={5} placeholder="HH:mm" value={flight.time} onChangeText={time => update({ time })} />
      </View>;
    })}
    <FormError message={errors.flights} />
  </FormCard>;
}

function Lodgings({ draft, errors, focus, change }: Props) {
  const nextKey = useRef(Math.max(0, ...draft.lodgings.map(row => row.key)) + 1);
  return <FormCard title="숙소">
    {draft.lodgings.map((lodging, index) => {
      const key = `lodgings.${index}`;
      const id = `${key}.googlePlaceId`;
      const update = (patch: Partial<typeof lodging>) => change({
        lodgings: draft.lodgings.map(row => row.key === lodging.key ? { ...row, ...patch } : row),
      });
      return <View key={lodging.key} style={form.stack}>
        <PlacePicker key={draft.cityCode} label={`숙소 ${index + 1}`} region={regionFor(draft.cityCode)} lodgingCity={cityName(draft.cityCode)}
          value={lodging.place} error={errors[id]} focus={focus?.field === id ? focus : undefined}
          onChange={place => update({ place })} />
        <View style={form.row}>{(['checkIn', 'checkOut'] as const).map((name, edge) => <View key={name} style={form.flex}>
          <EditField name={`${key}.${name}`} label={`${edge ? '체크아웃' : '체크인'} ${index + 1}`} errors={errors} focus={focus}
            maxLength={10} placeholder="YYYY-MM-DD" value={lodging[name]}
            onChangeText={value => update({ [name]: value })} />
        </View>)}</View>
        <FormError message={errors[key]} />
        <SmallButton label={`숙소 ${index + 1} 삭제`} onPress={() => change({
          lodgings: draft.lodgings.filter(row => row.key !== lodging.key),
        })} />
      </View>;
    })}
    <FormError message={errors.lodgings} />
    <SmallButton label="숙소 추가" onPress={() => change({ lodgings: [...draft.lodgings, {
      key: nextKey.current++, checkIn: draft.lodgings.at(-1)?.checkOut ?? draft.startDate, checkOut: draft.endDate,
    }] })} />
  </FormCard>;
}

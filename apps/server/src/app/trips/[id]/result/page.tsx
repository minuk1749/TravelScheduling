import Link from 'next/link';
import { ItineraryResults } from '../../../../components/itinerary';
import './result.css';
export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="trip-input itinerary-page"><Link href={`/trips/${encodeURIComponent(id)}/settings`}>← 생활 설정</Link><p className="eyebrow">여행 동선</p><h1>나의 여행 일정</h1><ItineraryResults key={id} tripId={id} /></main>;
}

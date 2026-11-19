import type { Metadata } from 'next';
import { SharedItineraryPage } from '../../../components/itinerary/shared';
import '../../trips/[id]/result/result.css';

export const metadata: Metadata = { title: '공유 여행 일정', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="trip-input itinerary-page"><p className="eyebrow">읽기 전용 공유</p><h1>공유 여행 일정</h1><SharedItineraryPage key={token} token={token} /></main>;
}

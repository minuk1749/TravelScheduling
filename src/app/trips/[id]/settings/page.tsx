import Link from 'next/link';
import { LivingSettings } from '../../../../components/living-settings';
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="trip-input"><Link href="/">← 홈</Link><p className="eyebrow">여행 준비</p><h1>생활 설정</h1><p>날짜별 활동 시간과 끼니, 택시 정책을 정해 주세요.</p><LivingSettings key={id} tripId={id} /></main>;
}

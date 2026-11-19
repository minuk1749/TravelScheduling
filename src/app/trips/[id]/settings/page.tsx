import Link from 'next/link';
import { LivingSettings } from '../../../../components/living-settings';
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="trip-input"><Link href="/">← 홈</Link><h1>생활 설정</h1><LivingSettings key={id} tripId={id} /><p className="next-link"><Link className="primary-link" href={`/trips/${encodeURIComponent(id)}/result`}>결과 보기 · 동선 생성</Link></p></main>;
}

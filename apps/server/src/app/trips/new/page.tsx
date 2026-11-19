import Link from 'next/link';
import { TripInputForm } from '../../../components/trip-input-form';
export default function NewTrip() {
  return <main className="trip-input"><Link href="/">← 홈</Link><p className="eyebrow">새 여행 준비</p><h1>어디로 떠나시나요?</h1><p>여행부터 방문 장소까지 차근차근 입력해 주세요. 검색·저장은 로그인이 필요합니다.</p><TripInputForm /></main>;
}

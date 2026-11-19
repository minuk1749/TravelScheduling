import Link from 'next/link';
import { TripInputForm } from '../../../components/trip-input-form';
export default function NewTrip() {
  return <main className="trip-input"><Link href="/">← 홈</Link><h1>여행 만들기</h1><TripInputForm /></main>;
}

import type { Metadata, Viewport } from 'next';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import { ServiceWorker } from '../components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: '여행 동선',
  description: '나의 해외여행 일정을 준비하는 여행 동선 도우미',
};
export const viewport: Viewport = { themeColor: '#f2f4f6' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}<ServiceWorker /></body></html>;
}

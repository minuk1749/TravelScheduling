import type { Metadata } from 'next';
import './globals.css';

/** Only the read-only share page (`/share/[token]`) renders HTML; every other route is an API for the app. */
export const metadata: Metadata = {
  title: '여행 동선',
  description: '나의 해외여행 일정을 준비하는 여행 동선 도우미',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}

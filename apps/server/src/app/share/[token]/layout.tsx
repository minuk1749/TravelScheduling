import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';
import { colors } from '@travel/design-tokens';
import './share.css';

export const metadata: Metadata = { title: '공유 여행 일정', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const viewport: Viewport = { themeColor: colors.background };

export default function ShareLayout({ children }: PropsWithChildren) {
  return children;
}

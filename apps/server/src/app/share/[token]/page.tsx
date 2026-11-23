import { colors, radius, size, spacing, typography } from '@travel/design-tokens';
import type { CSSProperties } from 'react';
import { SharedItineraryPage } from '../../../components/itinerary/shared';

const shareTheme: CSSProperties & Record<`--share-${string}`, string | number> = {
  '--share-background': colors.background, '--share-card': colors.card,
  '--share-text': colors.gray.text, '--share-secondary': colors.gray.secondary,
  '--share-divider': colors.gray.divider,
  '--share-primary': colors.sky.primary, '--share-primary-text': colors.sky.text,
  '--share-selected': colors.sky.surface, '--share-wish': colors.peach.text,
  '--share-wish-background': colors.peach.surface, '--share-conflict': colors.red.text,
  '--share-font': typography.family, '--share-tracking': `${typography.letterSpacingEm}em`,
  '--share-numerals': typography.numbers, '--share-regular': typography.body.weight,
  '--share-semibold': typography.title.weight, '--share-title': `${typography.title.size}px`,
  '--share-date': `${typography.date.size}px`, '--share-name': `${typography.place.size}px`,
  '--share-body': `${typography.body.size}px`, '--share-detail': `${typography.secondary.size}px`,
  '--share-small': `${typography.small.max}px`, '--share-card-radius': `${radius.card.max}px`,
  '--share-button-radius': `${radius.button}px`, '--share-small-radius': `${radius.small}px`,
  '--share-button-height': `${size.button}px`, '--share-gap': `${spacing.cardGap}px`,
  '--share-screen-padding': `${spacing.screen}px`, '--share-card-padding': `${spacing.cardInside}px`,
  '--share-section-gap': `${spacing.section}px`, '--share-label-gap': `${spacing.steps[1]}px`,
};

export const dynamic = 'force-dynamic';
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="share-page" style={shareTheme}><div className="share-content">
    <header><h1>공유 여행 일정</h1><p>읽기 전용 일정</p></header>
    <SharedItineraryPage key={token} token={token} />
  </div></main>;
}

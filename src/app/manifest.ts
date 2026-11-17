import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/', name: '여행 동선', short_name: '여행 동선',
    description: '나에게 맞는 해외여행 동선 준비',
    lang: 'ko', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f5f7f3', theme_color: '#175b4b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

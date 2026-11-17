'use client';

import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((error: unknown) => console.error('서비스워커 등록 실패', error));
    }
  }, []);
  return null;
}

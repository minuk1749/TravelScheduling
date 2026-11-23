import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@travel/core', '@travel/design-tokens'],
  async headers() {
    return [{
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    }];
  },
};
export default config;

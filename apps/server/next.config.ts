import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@travel/core', '@travel/design-tokens'],
};
export default config;

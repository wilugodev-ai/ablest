import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = process.env.CLOUD_RUN_BUILD === '1' ? {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'ablestsolutions.com' }],
      destination: 'https://www.ablestsolutions.com/:path*',
      permanent: true,
    }];
  },
} : {};
export default config;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // A stray lockfile in the parent directory makes Next infer the wrong root.
  turbopack: { root: __dirname },
  // The legacy Vite client and Express server live alongside this app and are
  // not part of the Next build.
  outputFileTracingExcludes: {
    '*': ['./client/**/*', './server/**/*'],
  },
  // Vercel's Next 16 function tracer can omit these files when Auth0's proxy
  // makes routes dynamic. The generated launcher loads setup-node-env.js,
  // which requires this module tree before any API handler can run.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/next/dist/server/**/*',
      './node_modules/next/dist/shared/**/*',
      './node_modules/next/dist/lib/**/*',
      './node_modules/next/dist/client/**/*',
      './node_modules/next/dist/compiled/source-map/**/*',
      './node_modules/next/dist/compiled/stacktrace-parser/**/*',
      './node_modules/next/dist/compiled/ws/**/*',
    ],
  },
};

export default nextConfig;

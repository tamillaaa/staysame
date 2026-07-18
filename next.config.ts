import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A stray lockfile in the parent directory makes Next infer the wrong root.
  turbopack: { root: __dirname },
  // The legacy Vite client and Express server live alongside this app and are
  // not part of the Next build.
  outputFileTracingExcludes: {
    '*': ['./client/**/*', './server/**/*'],
  },
};

export default nextConfig;

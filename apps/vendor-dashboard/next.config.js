//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/next');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withPWA = require('@ducanh2912/next-pwa').default;

const pwa = withPWA({
  dest: 'public',
  sw: 'sw.js',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
  },
});

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  output: 'standalone',
  transpilePackages: ['react-map-gl', 'mapbox-gl', '@vis.gl/react-mapbox', '@vis.gl/react-maplibre'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 's3.wasabisys.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withBundleAnalyzer,
  pwa,
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);

//@ts-check

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/next');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
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
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);

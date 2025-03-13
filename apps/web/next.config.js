/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/ui"],
  // Configure server and responses
  poweredByHeader: false,
  compress: true,
  // Configure images for static generation
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      }
    ],
    formats: ['image/avif', 'image/webp'],
    dangerouslyAllowSVG: true, // Allow SVGs for icons and UI elements
  },
  // Deal with larger content payloads
  compiler: {
    // Enabled by default in production
    reactRemoveProperties: process.env.NODE_ENV === 'production',
  }
};

export default nextConfig;

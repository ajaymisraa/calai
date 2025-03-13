/**
 * @type {import('next').NextConfig}
 */
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
  },
  
  // Vercel-specific configurations for serverless compatibility
  output: 'standalone', // Optimizes for serverless deployment
  
  // Timeouts for API routes
  experimental: {
    // Modern options for Next.js 15+
    serverActions: {
      bodySizeLimit: '10mb',
      allowedOrigins: ['*']
    }
  },
  
  // External packages to be bundled with server components
  serverExternalPackages: ["sharp"],
  
  // Fix potential Vercel deployment issues
  distDir: '.next',
  reactStrictMode: true,
  
  // Allow SVGs to be imported as React components
  webpack(config) {
    // SVG Configuration
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack']
    });
    
    return config;
  }
};

export default nextConfig;

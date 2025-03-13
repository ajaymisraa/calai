/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['ui'],
  serverRuntimeConfig: {
    // Increase API limits to prevent timeouts
    api: {
      responseLimit: '50mb',
      bodyParser: {
        sizeLimit: '50mb',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Connection',
            value: 'keep-alive',
          },
          {
            key: 'Keep-Alive',
            value: 'timeout=120',
          },
        ],
      },
    ];
  },
};

export default nextConfig; 
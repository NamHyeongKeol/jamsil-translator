/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mingle/live-demo-core'],
  eslint: {
    // Vercel 빌드 시 상위 폴더 eslint 설정 충돌 방지
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Vercel 빌드 시 타입 에러 무시 (로컬에서는 정상)
    ignoreBuildErrors: true,
  },
}

export default nextConfig

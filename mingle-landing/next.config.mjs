/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Vercel 빌드 시 상위 폴더 eslint 설정 충돌 방지
    ignoreDuringBuilds: true,
  },
}

export default nextConfig

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // apps/web 只做 UI（STACK §1）：WebSocket 与任务队列都在 apps/api，不在这里。
};

export default nextConfig;

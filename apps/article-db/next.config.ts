import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署（deploy/article-db/Dockerfile builder 阶段置 DOCKER_BUILD=1）产出
  // .next/standalone 最小运行时；本地 dev / CI 构建不受影响
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
};

export default nextConfig;

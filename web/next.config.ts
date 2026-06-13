import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /** 从 `web/` 目录执行时 cwd 即本站根，避免误选上级 lockfile */
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Disabled: Turbopack's dev filesystem cache hits EBUSY file-lock
    // errors on Windows when antivirus/indexing briefly locks the cache
    // files it's renaming.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;

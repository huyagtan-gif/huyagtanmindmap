/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build in GitHub Actions and ship a self-contained server to the VPS (1 GB RAM is too little to build there).
  output: "standalone",
  async rewrites() {
    return {
      // Until the real Next.js app exists, the home page serves the static prototype.
      beforeFiles: [{ source: "/", destination: "/prototype.html" }],
    };
  },
};

export default nextConfig;

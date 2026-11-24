/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build in GitHub Actions and ship a self-contained server to the VPS (1 GB RAM is too little to build there).
  output: "standalone",
};

export default nextConfig;

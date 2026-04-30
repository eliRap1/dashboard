/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["chokidar", "node-cron"] }
};

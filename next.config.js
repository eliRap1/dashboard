/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["better-sqlite3", "chokidar", "node-cron"] }
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve the exported Expo web app (public/index.html) at the site root.
  // /api/*, /join/*, /g/*, /privacy and /terms stay real Next routes and take
  // precedence over this rewrite.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;

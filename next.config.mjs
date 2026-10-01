/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // app/global-not-found.js, the styled 404 of unmatched URLs despite
    // several root layouts; Next ignores the file without this flag.
    globalNotFound: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "achivator.cc",
        port: "",
        pathname: "/achievements/**",
      },
    ],
  },
};

export default nextConfig;

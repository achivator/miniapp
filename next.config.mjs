/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "achivator.seniorsoftwarevlogger.com",
        port: "",
        pathname: "/achievements/**",
      },
    ],
  },
};

export default nextConfig;

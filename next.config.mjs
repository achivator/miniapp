/** @type {import('next').NextConfig} */
const nextConfig = {
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

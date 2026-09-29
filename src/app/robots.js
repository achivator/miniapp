export default function robots() {
  return {
    rules: { userAgent: "*", disallow: "/api/" },
    sitemap: "https://achivator.cc/sitemap.xml",
  };
}

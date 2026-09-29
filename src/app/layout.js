import "./globals.css";
import { LAUNCH_SCRIPT } from "@/lib/launch";

export const metadata = {
  metadataBase: new URL("https://achivator.cc"),
  title: "Achivator",
  description: "Rewards and achievements for your Telegram chats",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    // LAUNCH_SCRIPT sets data-launch on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

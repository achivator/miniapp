import { Inter } from "next/font/google";
import { SDKProvider } from "@tma.js/sdk-react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Achivator Bot",
  description: "Your achievemnts in telegram chats",
};

export default function RootLayout({ children }) {
  return (
    <SDKProvider>
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    </SDKProvider>
  );
}

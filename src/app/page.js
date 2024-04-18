"use client";

import Image from "next/image";

export default function Home() {
  return (
    <>
      <script
        async
        onLoad={() => {
          if (window) console.log(window?.Telegram?.WebApp);
        }}
        src="https://telegram.org/js/telegram-web-app.js"
      ></script>

      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <section className="flex flex-col items-center space-y-4">
          <h1 className="text-3xl font-bold">Achievements</h1>
          <ul className="flex flex-col items-center space-y-4">
            <li className="flex items-center space-x-4">
              <Image src="/images/telegram.svg" alt="Telegram logo" width={48} height={48} />
              <span>Joined Telegram</span>
            </li>
            <li className="flex items-center space-x-4">
              <Image src="/images/telegram.svg" alt="Telegram logo" width={48} height={48} />
              <span>Joined Telegram</span>
            </li>
            <li className="flex items-center space-x-4">
              <Image src="/images/telegram.svg" alt="Telegram logo" width={48} height={48} />
              <span>Joined Telegram</span>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}

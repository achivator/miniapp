"use client";

import { SDKProvider, useSDKContext, useBackButton } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";
import { TonConnectUIProvider, TonConnectButton } from "@tonconnect/ui-react";
import Image from "next/image";
import Link from "next/link";

async function loadAchievements(userId, setAchievements) {
  try {
    const result = await fetch(`/api/achievements?user_id=${userId}`).then(
      (res) => res.json()
    );
    setAchievements(result);
  } catch (e) {
    console.error(e);
  }
}

function Achievements({ data }) {
  return (
    <div className="flex flex-col space-y-4">
      {data?.map(({ chat, achievements }) => (
        <div key={chat._id} className="flex flex-col">
          <h2 className="text-1xl font-bold flex">{chat.title}</h2>
          {(!achievements || achievements.length === 0) && (
            <p>No achievements in this chat yet, try header.</p>
          )}
          <ul className="flex flex-row flex-wrap">
            {achievements?.map((achievement, i) => (
              <li key={`${achievement._id}`} className="flex m-1">
                <Link href={`/achievement/${achievement._id}`}>
                  <Image
                    width={75}
                    height={75}
                    alt={achievement.type}
                    src={`https://achivator.cc/achievements/${
                      achievement.collection || "v1"
                    }/${achievement.type}.webp`}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AchievementsList() {
  const initData = useInitData();
  const backButton = useBackButton();

  backButton.hide();

  const [achievements, setAchievements] = useState([]);

  useEffect(() => {
    loadAchievements(initData.user.id, setAchievements);
  }, [initData.user.id]);

  return (
    <main className="flex min-h-screen flex-col space-y-4 p-4">
      <header className="flex flex-row w-full justify-between">
        <div className="flex text-2xl font-bold">Achivator</div>
        <div className="flex">
          <TonConnectButton />
        </div>
      </header>
      <Achievements data={achievements} />
    </main>
  );
}

function Page() {
  const { initResult } = useSDKContext();

  if (!initResult)
    return (
      <main className="prose max-w-full text-center flex min-h-screen flex-col space-y-4 p-4">
        <p>
          <Image
            className="rounded-full inline"
            width={180}
            height={180}
            src="/ton-logo.png"
            alt="logo"
          />
        </p>
        <p>
          This is a Telegram Mini App, please{" "}
          <a href="https://t.me/achivator_bot/app">open it from Telegram</a>.
        </p>
        <p>
          <em>Loading SDK...</em>
        </p>
      </main>
    );

  return <AchievementsList />;
}

export default function Home() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null; // Disable rendering on the server

  return (
    <SDKProvider>
      <TonConnectUIProvider manifestUrl="https://achivator.cc/ton-connect.json">
        <Page />
      </TonConnectUIProvider>
    </SDKProvider>
  );
}

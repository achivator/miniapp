"use client";

import { SDKProvider, useSDKContext } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";
import { TonConnectUIProvider, TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import Image from "next/image";

import { useTonConnectUI } from "@tonconnect/ui-react";

async function loadAchievements(userId, setAchievements) {
  try {
    const result = await fetch(`/api/achievements?user_id=${userId}`).then((res) => res.json());
    setAchievements(result.achievements);
  } catch (e) {
    console.error(e);
  }
}

function Achievements({ achievements }) {
  const [tonConnectUI] = useTonConnectUI();

  const transaction = {
    messages: [
      {
        address: "UQDNkgTK6NV_Q3otfiYcpJOxrYoeUw8rqgUFeMd7mCEiePCX", // destination address
        amount: "00000001", //Toncoin in nanotons
      },
    ],
  };

  return (
    <div className="flex flex-col space-y-4">
      {achievements.map((chat) => (
        <div key={chat.chat?.id} className="flex flex-col">
          <h2 className="text-1xl font-bold flex">{chat.chat?.title}</h2>
          {(!chat.achievements || chat.achievements.length === 0) && <p>No achievements in this chat yet</p>}
          <ul className="flex flex-row flex-wrap">
            {chat.achievements?.map((achievement, i) => (
              <li key={`${chat.chat?.id}-${i}`} className="flex m-1">
                <Image
                  width={75}
                  height={75}
                  alt={achievement.type}
                  src={`https://achivator.seniorsoftwarevlogger.com/achievements/${achievement.collection || "v1"}/${
                    achievement.type
                  }.webp`}
                  onClick={() => tonConnectUI.sendTransaction(transaction)}
                />
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
  const wallet = useTonWallet();

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
      <Achievements achievements={achievements} />
      <div>{wallet && <p>Wallet address: {wallet.address}</p>}</div>
    </main>
  );
}

function Page() {
  const { initResult } = useSDKContext();
  if (!initResult)
    return (
      <main className="flex min-h-screen flex-col space-y-4 p-4">
        <p>Loading SDK...</p>
      </main>
    );

  console.log(initResult);

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
      <TonConnectUIProvider manifestUrl="https://achivator.seniorsoftwarevlogger.com/ton-connect.json">
        <Page />
      </TonConnectUIProvider>
    </SDKProvider>
  );
}

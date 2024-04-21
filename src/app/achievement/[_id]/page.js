"use client";

import { SDKProvider } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";
import { TonConnectUIProvider, TonConnectButton } from "@tonconnect/ui-react";
import Image from "next/image";
import { useTonConnectUI } from "@tonconnect/ui-react";

function Achievement({ _id }) {
  const initData = useInitData();
  const [tonConnectUI] = useTonConnectUI();
  const [achievement, setAchievement] = useState({});

  useEffect(() => {
    fetch(`/api/achievement?_id=${_id}&user_id=${initData.user.id}`)
      .then((res) => res.json())
      .then(setAchievement);
  }, [_id, initData.user.id]);

  const transaction = {
    messages: [
      {
        address: "UQDNkgTK6NV_Q3otfiYcpJOxrYoeUw8rqgUFeMd7mCEiePCX", // destination address
        amount: "1000000000", //Toncoin in nanotons
      },
    ],
  };

  return (
    <main className="flex min-h-screen flex-col space-y-4 p-4">
      <header className="flex flex-row w-full justify-between">
        <div className="flex text-2xl font-bold">Achivator</div>
        <div className="flex">
          <TonConnectButton />
        </div>
      </header>
      <div className="flex flex-col space-y-4">
        <Image
          width={348}
          height={348}
          alt={achievement.type}
          src={`https://achivator.seniorsoftwarevlogger.com/achievements/${achievement.collection || "v1"}/${
            achievement.type
          }.webp`}
        />
        <h2 className="text-1xl font-bold flex">{achievement.type}</h2>

        <button onClick={() => tonConnectUI.sendTransaction(transaction).then(console.log)}>Buy as NFT</button>
      </div>
    </main>
  );
}

export default function AchievementContainer({ params }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null; // Disable rendering on the server

  console.log(params);

  return (
    <SDKProvider>
      <TonConnectUIProvider manifestUrl="https://achivator.seniorsoftwarevlogger.com/ton-connect.json">
        <Achievement _id={params._id} />
      </TonConnectUIProvider>
    </SDKProvider>
  );
}

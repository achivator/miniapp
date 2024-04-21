"use client";

import { SDKProvider, useSDKContext } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";
import { TonConnectUIProvider, TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import Image from "next/image";
import { useTonConnectUI } from "@tonconnect/ui-react";

function Achievement({ user_id, chatId, collection, achievement_type }) {
  const [tonConnectUI] = useTonConnectUI();
  const [achievement, setAchievement] = useState({});

  useEffect(() => {
    fetch(
      `/api/achievement?user_id=${user_id}&chat_id=${chatId}&collection=${collection}&achievement_type=${achievement_type}`
    )
      .then((res) => res.json())
      .then(setAchievement);
  }, [chatId, collection, achievement_type]);

  const transaction = {
    messages: [
      {
        address: "UQDNkgTK6NV_Q3otfiYcpJOxrYoeUw8rqgUFeMd7mCEiePCX", // destination address
        amount: "1000000000", //Toncoin in nanotons
      },
    ],
  };

  return (
    <div className="flex flex-col space-y-4">
      <Image
        width={200}
        height={200}
        alt={achievement.type}
        src={`https://achivator.seniorsoftwarevlogger.com/achievements/${achievement.collection || "v1"}/${
          achievement.type
        }.webp`}
      />
      <button onClick={() => tonConnectUI.sendTransaction(transaction).then(console.log)}>Buy as NFT</button>
    </div>
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
        <Achievement
          chatId={params.chat_id}
          collection={params.collection}
          achievement_type={params.achievement_type}
        />
      </TonConnectUIProvider>
    </SDKProvider>
  );
}

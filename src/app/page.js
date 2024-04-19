"use client";

import { SDKProvider, useSDKContext } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";

async function loadAchievements(userId, setAchievements) {
  try {
    const result = await fetch(`/api/achievements?user_id=${userId}`).then((res) => res.json());
    setAchievements(result.achievements);
  } catch (e) {
    console.error(e);
  }
}

function Achievements({ achievements }) {
  return (
    <div className="flex flex-col space-y-4">
      <h1 className="text-3xl font-bold">Achievements</h1>
      {achievements.map((chat) => (
        <div key={chat.chat_id} className="flex space-x-4">
          <h2>{chat.chat_id}</h2>
          {chat.achievements.length === 0 && <p>No achievements in this chat yet</p>}
          <ul className="flex flex-col space-y-4">
            {chat.achievements?.map((achievement, i) => (
              <li key={`${chat.chat_id}-${i}`} className="flex space-x-4">
                <span>{achievement.type}</span>
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
  const [achievements, setAchievements] = useState([]);
  useEffect(() => {
    if (initData) loadAchievements(initData.user.id, setAchievements);
  }, [initData]);

  return (
    <>
      <main className="flex min-h-screen flex-col items-center justify-between p-8">
        <Achievements achievements={achievements} />
      </main>
    </>
  );
}

function Page() {
  const { initResult } = useSDKContext();
  if (!initResult) return <p>Loading SDK...</p>;

  console.log(initResult);

  return <AchievementsList />;
}

export default function Home() {
  return (
    <SDKProvider>
      <Page />
    </SDKProvider>
  );
}

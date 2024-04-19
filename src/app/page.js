"use client";

import { SDKProvider, useSDKContext } from "@tma.js/sdk-react";
import { useInitData } from "@tma.js/sdk-react";
import { useEffect, useState } from "react";

async function loadAchievements(userId, setAchievements) {
  const achievements = await fetch(`/api/achievements?user_id=${userId}`).then((res) => res.json());

  console.log(achievements);
  setAchievements(achievements);
}

function Achievements({ achievements }) {
  return (
    <div className="flex flex-col items-center space-y-4">
      <h1 className="text-3xl font-bold">Achievements</h1>
      {achievements.map((achievement) => (
        <div key={achievement.chat_id} className="flex items-center space-x-4">
          <h2>{achievement.chat_id}</h2>
          <ul className="flex flex-col items-center space-y-4">
            {achievements?.achievements.map((achievement, i) => (
              <li key={`${achievement.chat_id}-${i}`} className="flex items-center space-x-4">
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
      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <Achievements achievements={achievements} />
      </main>
    </>
  );
}

function LoadingContext() {
  const { initResult } = useSDKContext();
  if (!initResult) return <p>Loading SDK...</p>;

  console.log(initResult);

  return <AchievementsList />;
}

export default function Home() {
  return (
    <SDKProvider>
      <LoadingContext />
    </SDKProvider>
  );
}

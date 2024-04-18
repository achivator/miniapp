"use client";

import { useInitData } from "@tma.js/sdk-react";
import { useState } from "react";

async function loadAchievements(userId, setAchievements) {
  return async () => {
    const achievements = await fetch(`/api/achievements?id=${userId}`).then((res) => res.json());

    setAchievements(achievements);
  };
}

export default function Home() {
  const initData = useInitData();
  const [achievements, setAchievements] = useState([]);

  return (
    <>
      <script
        async
        onLoad={loadAchievements(initData.user.id, setAchievements)}
        src="https://telegram.org/js/telegram-web-app.js"
      ></script>

      <main className="flex min-h-screen flex-col items-center justify-between p-24">
        <section className="flex flex-col items-center space-y-4">
          <h1 className="text-3xl font-bold">Achievements</h1>
          {achievements.map((achievement) => (
            <div key={achievement.id} className="flex items-center space-x-4">
              <h2>{achievement.chat_id}</h2>
              <ul className="flex flex-col items-center space-y-4">
                {achievements?.achievements.map((achievement) => (
                  <li key={achievement.id} className="flex items-center space-x-4">
                    <span>{achievement.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

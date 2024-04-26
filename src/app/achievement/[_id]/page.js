"use client";

import { SDKProvider, useInitData, useBackButton } from "@tma.js/sdk-react";
import { Builder } from "@ton/core";
import { useEffect, useState } from "react";
import { TonConnectUIProvider, TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import Image from "next/image";
import { useTonConnectUI } from "@tonconnect/ui-react";

function Achievement({ _id }) {
  const initData = useInitData();
  const [tonConnectUI] = useTonConnectUI();
  const [achievement, setAchievement] = useState(null);
  const wallet = useTonWallet();
  const backButton = useBackButton();

  backButton.show();
  backButton.on("click", () => window.history.back());

  useEffect(() => {
    fetch(`/api/achievement?_id=${_id}&user_id=${initData.user.id}`)
      .then((res) => res.json())
      .then(setAchievement);
  }, [_id, initData.user.id]);

  return (
    <main className="flex min-h-screen flex-col space-y-4 p-4">
      <header className="flex flex-row w-full justify-between">
        <div className="flex text-2xl font-bold">Achivator</div>
        <div className="flex">
          <TonConnectButton />
        </div>
      </header>
      {achievement === null ? (
        <p>Loading...</p>
      ) : (
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

          {wallet ? (
            <button
              className="shadow-md bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => {
                let builder = new Builder();
                builder.storeUint(3137207270, 32); // Mint
                builder.storeUint(0, 64); // query_id
                builder.storeStringRefTail(`${achievement.collection}/${achievement.type}`); // item_template

                tonConnectUI
                  .sendTransaction({
                    validUntil: Math.floor(Date.now() / 1000) + 600, // 60 sec
                    messages: [
                      {
                        address:
                          process.env.NODE_ENV === "development"
                            ? "EQCE3SuQEOpb1ouP9Fa17ec3gyv0M13v-Tk_t_NobhXEctrZ"
                            : "UQCOzy4iPwPulDxnPFlEpEB4jFf9_5jnzwE25EGnv6CooRlA", // destination address
                        amount: "1000000000", //Toncoin in nanotons
                        payload: builder.asCell().toBoc().toString("base64"),
                      },
                    ],
                  })
                  .then((response) => {
                    console.log(response);
                  });
              }}
            >
              Buy as NFT
            </button>
          ) : (
            <p>Connect your wallet to buy this NFT</p>
          )}
        </div>
      )}
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

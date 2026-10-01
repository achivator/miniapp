"use client";

import { useEffect, useState } from "react";
import { fetchChatPhoto } from "@/lib/client-api";
import { useSDKContext } from "./TelegramSDK";
import { LetterAvatar } from "./ui";

// A chat's photo (api/chats/<id>/photo, the economy id or the supergroup's),
// round and the size of the letter avatar it replaces; the letter avatar
// while the photo loads, and for a chat without one or on any error. Its own
// module, so that pages without chats (help) do not load the Telegram SDK.
export function ChatAvatar({ title, id, size = 44 }) {
  const initDataRaw = useSDKContext().initResult?.initDataRaw;
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (id === null || id === undefined || !initDataRaw) return undefined;
    let live = true;
    let url = null;
    fetchChatPhoto(id, initDataRaw).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      live = false;
      setSrc(null);
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, initDataRaw]);
  if (!src) return <LetterAvatar title={title} id={id} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      onError={() => setSrc(null)}
    />
  );
}

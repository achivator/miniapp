// Browser-side helper: every API call carries the raw Telegram init data.
export async function apiFetch(path, { method = "GET", body, initDataRaw } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(initDataRaw ? { authorization: `tma ${initDataRaw}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Chat photos for ChatAvatar, kept for the session: chat id -> Promise of
// the image Blob, or of null when the chat has none or the caller may not
// see it (404, 403). A failure that may pass (network, 5xx) is forgotten,
// so the next avatar asks again. Blobs, not object URLs: each avatar makes
// its own URL and revokes it when it unmounts.
const chatPhotos = new Map();
const CHAT_PHOTOS_KEPT = 100;

// The photo is behind the Telegram init data like every API call, which an
// <img> cannot send: it is fetched here, with the browser's HTTP cache
// (the ETag lets it revalidate).
export function fetchChatPhoto(chatId, initDataRaw) {
  const key = String(chatId);
  const known = chatPhotos.get(key);
  if (known) return known;
  const request = fetch(`/api/chats/${encodeURIComponent(key)}/photo`, {
    headers: initDataRaw ? { authorization: `tma ${initDataRaw}` } : {},
  })
    .then(async (response) => {
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return blob.type.startsWith("image/") ? blob : null;
    })
    .catch(() => {
      chatPhotos.delete(key);
      return null;
    });
  if (chatPhotos.size >= CHAT_PHOTOS_KEPT) chatPhotos.delete(chatPhotos.keys().next().value);
  chatPhotos.set(key, request);
  return request;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls the claim status until the pool reports the nonce as used or the
// attempts run out. Resolves with the last known status.
export async function pollClaimStatus(chatId, nonce, initDataRaw, { attempts = 12, delayMs = 5000 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    await sleep(i === 0 ? 4000 : delayMs);
    try {
      last = await apiFetch(`/api/claim-status?chatId=${chatId}&nonce=${nonce}`, { initDataRaw });
      if (last.status === "claimed") return last;
    } catch {
      // keep polling; transient RPC errors are expected right after send
    }
  }
  return last;
}

export function shortenAddress(address, size = 4) {
  if (!address) return "";
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

// TonConnect chain ids (CHAIN.MAINNET / CHAIN.TESTNET).
const TON_CHAINS = { mainnet: "-239", testnet: "-3" };

// Sends a transaction pinned to the backend's network. Contracts exist only
// there, so a wallet on the other network must not send: its TON (or jettons)
// would go to an address that has no contract on that chain.
export async function sendTonTransaction(tonConnectUI, network, messages) {
  const chain = TON_CHAINS[network] || TON_CHAINS.testnet;
  const walletChain = tonConnectUI.wallet?.account?.chain;
  if (walletChain && walletChain !== chain) {
    throw new Error(
      chain === TON_CHAINS.testnet
        ? "Your wallet is on mainnet. Switch it to testnet (or connect a testnet wallet) and try again."
        : "Your wallet is on testnet. Switch it to mainnet and try again.",
    );
  }
  return tonConnectUI.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 300,
    network: chain,
    messages,
  });
}

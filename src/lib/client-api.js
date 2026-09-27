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

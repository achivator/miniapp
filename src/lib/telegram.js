const memberCountCache = new Map(); // chatId -> { value, expiresAt }
const MEMBER_COUNT_TTL_MS = 10 * 60 * 1000;

async function botApi(method, params) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!body || !body.ok) {
        throw new Error(`telegram ${method} failed: ${body ? body.description : `HTTP ${response.status}`}`);
    }
    return body.result;
}

// Returns null when the bot token is absent (dev) or the bot has no access.
async function getChatMemberCount(chatId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    const cached = memberCountCache.get(chatId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
        const value = await botApi('getChatMemberCount', { chat_id: chatId });
        memberCountCache.set(chatId, { value, expiresAt: Date.now() + MEMBER_COUNT_TTL_MS });
        return value;
    } catch {
        return null;
    }
}

async function getChat(chatId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    try {
        return await botApi('getChat', { chat_id: chatId });
    } catch {
        return null;
    }
}

const CHAT_TTL_MS = 60 * 60 * 1000;
const CHAT_MISS_TTL_MS = 10 * 60 * 1000; // no access (kicked, chat gone): asked again sooner
const CHAT_CACHE_MAX = 2000;
const chatCache = new Map(); // chatId -> { value, expiresAt }, oldest first
const chatInFlight = new Map(); // chatId -> Promise, one getChat per chat at a time

// getChat, cached per chat for an hour (a chat Telegram does not answer for:
// ten minutes). Returns { chat, fresh }: `chat` is Telegram's Chat or null,
// `fresh` is true for the one caller whose call asked Telegram, so that work
// to do when Telegram's answer changes (a title to store) is done once per
// refresh, not on every request. Asks getChat through the exports, so that
// a stub of it (the integration tests') is what the cache wraps.
async function getChatCached(chatId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return { chat: null, fresh: false };
    const cached = chatCache.get(chatId);
    if (cached && cached.expiresAt > Date.now()) return { chat: cached.value, fresh: false };
    const inFlight = chatInFlight.get(chatId);
    if (inFlight) return { chat: await inFlight, fresh: false };
    const request = (async () => {
        const value = (await module.exports.getChat(chatId)) || null;
        chatCache.delete(chatId);
        if (chatCache.size >= CHAT_CACHE_MAX) chatCache.delete(chatCache.keys().next().value);
        chatCache.set(chatId, { value, expiresAt: Date.now() + (value ? CHAT_TTL_MS : CHAT_MISS_TTL_MS) });
        return value;
    })();
    chatInFlight.set(chatId, request);
    try {
        return { chat: await request, fresh: true };
    } finally {
        chatInFlight.delete(chatId);
    }
}

// A file's { file_id, file_unique_id, file_size, file_path } for
// downloadFile, or null when Telegram does not give it.
async function getFile(fileId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    try {
        const file = await botApi('getFile', { file_id: fileId });
        return file?.file_path ? file : null;
    } catch {
        return null;
    }
}

// The bytes of a file getFile returned: { bytes (Buffer), contentType }, or
// null when the download fails or the file is larger than `maxBytes`.
// The download URL holds the bot token: it is built here, used here and
// never leaves this function - not in an error, not in a log, not in a
// response - which is why the mini app proxies chat photos instead of
// linking to them. `cache: 'no-store'` keeps it out of Next's data cache.
async function downloadFile(filePath, { maxBytes = 1024 * 1024 } = {}) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || typeof filePath !== 'string' || !/^[\w\-./]+$/.test(filePath) || filePath.includes('..')) return null;
    let response;
    try {
        response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
        });
    } catch {
        return null; // the error may quote the URL: dropped, not rethrown
    }
    if (!response.ok || !response.body) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body.cancel().catch(() => {});
        return null;
    }
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel().catch(() => {});
                return null;
            }
            chunks.push(value);
        }
    } catch {
        return null;
    }
    return { bytes: Buffer.concat(chunks, size), contentType: response.headers.get('content-type') || null };
}

// Forgets the cached chats (tests).
function clearChatCache() {
    chatCache.clear();
    chatInFlight.clear();
}

// Live membership status ("creator", "administrator", ...) or null when the
// bot cannot see it. Used where a stale database flag must not be trusted.
async function getChatMemberStatus(chatId, userId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    try {
        const member = await botApi('getChatMember', { chat_id: chatId, user_id: userId });
        return member?.status || null;
    } catch {
        return null;
    }
}

const memberCache = new Map(); // `${chatId}:${userId}` -> { value, expiresAt }
const MEMBER_TTL_MS = 30 * 60 * 1000;

// A chat member as Telegram knows them ({ status, user }), or null when the
// bot cannot see them. The database keeps only user ids, so this is where
// the pool admin's member list gets its names from; cached to keep a page of
// members from costing a Bot API call per row on every load.
async function getChatMember(chatId, userId) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    const key = `${chatId}:${userId}`;
    const cached = memberCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let value = null;
    try {
        const member = await botApi('getChatMember', { chat_id: chatId, user_id: userId });
        value = member?.user ? { status: member.status || null, user: member.user } : null;
    } catch {
        value = null;
    }
    if (memberCache.size >= 5000) memberCache.clear(); // bound memory, it is only a cache
    memberCache.set(key, { value, expiresAt: Date.now() + MEMBER_TTL_MS });
    return value;
}

module.exports = {
    botApi,
    getChatMemberCount,
    getChat,
    getChatCached,
    getFile,
    downloadFile,
    clearChatCache,
    getChatMemberStatus,
    getChatMember,
};

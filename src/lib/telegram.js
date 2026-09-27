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

module.exports = { botApi, getChatMemberCount, getChat, getChatMemberStatus };

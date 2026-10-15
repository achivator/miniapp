// Achievement SBT identifiers (protocol v3 AchievementRegistry,
// ton-contracts/contracts/achievement_messages.tact).
//
// Privacy: the contracts never see a raw Telegram id. Users and chats are
// named by tags:
//   userTag = HMAC-SHA256(tagKey, "user:" + tgUserId)
//   chatTag = HMAC-SHA256(tagKey, "chat:" + chatId)
// read as 256-bit unsigned integers. Without the key, a tag cannot be linked
// back to an id (Telegram ids are small enough to enumerate, so a plain hash
// would not hide them).
//
// tagKey is ACHIEVEMENT_TAG_KEY, 32 bytes of hex, its own secret and not
// derived from BACKEND_SECRET: the voucher signing key must stay rotatable
// (the registry's RotateBackendKey), while the tags key on-chain uniqueness
// (one SBT per template and user, at an address derived from the userTag).
// Changing the tag key would let every user mint every achievement a second
// time. Set it once per network and never change it; keep it as secret as
// BACKEND_SECRET (a leak only de-anonymises, it signs nothing).
const crypto = require('node:crypto');
const { beginCell } = require('@ton/core');

// chatTag of platform-wide templates (scripts/registerTemplates.ts): they
// belong to no chat.
const PLATFORM_CHAT_TAG = 0n;

// Content URL policy: the registry accepts one cell (8-126 bytes) starting
// with https:// or ipfs://; the backend signs only ipfs:// and https URLs
// under these prefixes (ACHIEVEMENT_CONTENT_PREFIXES, comma-separated, adds
// to them).
const CONTENT_URL_MIN_BYTES = 8;
const CONTENT_URL_MAX_BYTES = 126;
const DEFAULT_CONTENT_PREFIXES = ['https://achivator.cc/metadata/'];

function tagKey(env = process.env) {
    const hex = String(env.ACHIEVEMENT_TAG_KEY || '').trim().replace(/^0x/i, '');
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('ACHIEVEMENT_TAG_KEY must be 32 bytes of hex');
    return Buffer.from(hex, 'hex');
}

function hasTagKey(env = process.env) {
    try {
        tagKey(env);
        return true;
    } catch {
        return false;
    }
}

function hmacTag(kind, id, key) {
    const text = BigInt(id).toString(); // canonical decimal: "-100123", never "-100123n" or "0x..."
    return BigInt('0x' + crypto.createHmac('sha256', key).update(`${kind}:${text}`).digest('hex'));
}

function userTag(tgUserId, key = tagKey()) {
    return hmacTag('user', tgUserId, key);
}

function chatTag(chatId, key = tagKey()) {
    return hmacTag('chat', chatId, key);
}

const cellHash = (b) => BigInt('0x' + b.endCell().hash().toString('hex'));

// templateKey = hash(uint256 chatTag ++ uint256 contentHash)
function templateKeyOf(chatTagValue, contentHash) {
    return cellHash(beginCell().storeUint(BigInt(chatTagValue), 256).storeUint(BigInt(contentHash), 256));
}

// SBT index = hash(uint256 templateKey ++ uint256 userTag)
function itemIndexOf(templateKey, userTagValue) {
    return cellHash(beginCell().storeUint(BigInt(templateKey), 256).storeUint(BigInt(userTagValue), 256));
}

function contentPrefixes(env = process.env) {
    const extra = String(env.ACHIEVEMENT_CONTENT_PREFIXES || '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.startsWith('https://') && p.length > 'https://'.length);
    return [...DEFAULT_CONTENT_PREFIXES, ...extra];
}

// Throws unless the backend may sign `url` as template content.
function assertAllowedContentUrl(url, env = process.env) {
    const text = String(url || '');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes < CONTENT_URL_MIN_BYTES || bytes > CONTENT_URL_MAX_BYTES) {
        throw new Error(`content url must be ${CONTENT_URL_MIN_BYTES}-${CONTENT_URL_MAX_BYTES} bytes`);
    }
    if (/[\s\u0000-\u001f\u007f]/.test(text)) throw new Error('content url has whitespace or control characters');
    if (text.startsWith('ipfs://')) return text;
    if (!text.startsWith('https://')) throw new Error('content url must be ipfs:// or https://');
    if (!contentPrefixes(env).some((prefix) => text.startsWith(prefix))) {
        throw new Error('content url host is not allowed');
    }
    return text;
}

// The content URL as RegisterVoucher carries it: one cell of its bytes.
function contentUrlCell(url, env = process.env) {
    return beginCell().storeBuffer(Buffer.from(assertAllowedContentUrl(url, env), 'utf8')).endCell();
}

// 0x-prefixed 64-digit hex, the form ACHIEVEMENT_TEMPLATES and the database use.
function toHex256(value) {
    return '0x' + BigInt(value).toString(16).padStart(64, '0');
}

module.exports = {
    PLATFORM_CHAT_TAG,
    CONTENT_URL_MIN_BYTES,
    CONTENT_URL_MAX_BYTES,
    tagKey,
    hasTagKey,
    userTag,
    chatTag,
    templateKeyOf,
    itemIndexOf,
    contentPrefixes,
    assertAllowedContentUrl,
    contentUrlCell,
    toHex256,
};

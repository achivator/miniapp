// Chat covers: the photo and the current title of a chat, as Telegram has
// them (getChat). api/chats/[chatId]/photo serves the photo; me/chats and
// achievements use the title when the bot stored none. The pure parts (the
// LRU, the ETag and access decisions, when to store a title) come first.
//
// The photo is proxied, not linked: Telegram's download URL carries the bot
// token (lib/telegram.js, downloadFile), so the bytes are fetched here and
// passed on, and the URL never reaches a client.
const telegram = require('./telegram');
const { canSeeRating } = require('./rating');
const { telegramChatId } = require('./chat-ids');

const MAX_PHOTO_BYTES = 1024 * 1024; // a small chat photo is 160x160, about 10 KB
const PHOTO_CACHE_ENTRIES = 200;
const PHOTO_CACHE_BYTES = 4 * 1024 * 1024;
const PHOTO_MAX_AGE_S = 60 * 60; // what the browser may keep without asking
const TITLE_REFRESH_LIMIT = 5; // getChat calls one dashboard load may wait for
const TITLE_REFRESH_TIMEOUT_MS = 1500;

// A Map with a bound on entries and on the total size of its values
// (sizeOf), dropping the least recently used first. A value larger than the
// whole budget is not kept.
class LruCache {
    constructor({ maxEntries, maxBytes = Infinity, sizeOf = () => 0 }) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.sizeOf = sizeOf;
        this.map = new Map();
        this.bytes = 0;
    }

    get size() {
        return this.map.size;
    }

    get(key) {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key);
        this.map.delete(key);
        this.map.set(key, value); // most recently used last
        return value;
    }

    set(key, value) {
        this.delete(key);
        const size = this.sizeOf(value);
        if (size > this.maxBytes || this.maxEntries < 1) return false;
        this.map.set(key, value);
        this.bytes += size;
        while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
            this.delete(this.map.keys().next().value);
        }
        return true;
    }

    delete(key) {
        if (!this.map.has(key)) return false;
        this.bytes -= this.sizeOf(this.map.get(key));
        this.map.delete(key);
        return true;
    }

    clear() {
        this.map.clear();
        this.bytes = 0;
    }
}

// The small photo of a Telegram Chat: { file_id, unique_id } or null.
function chatPhotoOf(tgChat) {
    const photo = tgChat?.photo;
    if (!photo?.small_file_id || !photo?.small_file_unique_id) return null;
    return { file_id: photo.small_file_id, unique_id: photo.small_file_unique_id };
}

// The photo's ETag: its file_unique_id, which Telegram keeps for the same
// file and changes with a new photo.
function etagOf(uniqueId) {
    return `"${String(uniqueId).replace(/["\\]/g, '')}"`;
}

// Whether If-None-Match names `etag` (a list, weak tags and * included):
// the browser then keeps its copy (304).
function isNotModified(ifNoneMatch, etag) {
    if (!ifNoneMatch || !etag) return false;
    const strip = (tag) => tag.trim().replace(/^W\//, '');
    return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === strip(etag));
}

// Who may see a chat's photo: its members, the way the rating decides it
// (lib/rating.js), and the creator the bot recorded.
function canSeeChatPhoto({ status, hasRecord, isCreator }) {
    return Boolean(isCreator) || canSeeRating({ status, hasRecord });
}

// The title to store for a chat, or null to leave it: Telegram's, when it
// is new and differs from the stored one - and only on the request that
// refreshed the cached getChat (`fresh`), so a request served from the cache
// never writes.
function titleUpdate({ stored, current, fresh }) {
    if (!fresh || typeof current !== 'string') return null;
    const title = current.trim();
    if (!title || title === stored) return null;
    return title;
}

// The image type to answer with: Telegram's when it is an image type, else
// read from the bytes (JPEG, PNG, WebP, GIF), else JPEG - chat photos are.
function imageContentType(bytes, declared) {
    const type = String(declared || '').split(';')[0].trim().toLowerCase();
    if (/^image\/(jpeg|png|webp|gif)$/.test(type)) return type;
    const b = bytes || [];
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return 'image/jpeg';
}

// ---- Telegram (cached) ----

// Images by file_unique_id: { bytes, type }.
const photoCache = new LruCache({
    maxEntries: PHOTO_CACHE_ENTRIES,
    maxBytes: PHOTO_CACHE_BYTES,
    sizeOf: (image) => image.bytes.length,
});
const photoInFlight = new Map(); // file_unique_id -> Promise

// What Telegram says about a chat document (the economy's: telegramChatId
// is where Telegram knows it now): { title, photo } or null. Stores a new
// title on the document when the cached getChat was refreshed.
async function chatProfile(chat, chatsCol) {
    const tgChatId = telegramChatId(chat);
    if (tgChatId === null) return null;
    const { chat: tgChat, fresh } = await telegram.getChatCached(tgChatId);
    if (!tgChat) return null;
    const title = titleUpdate({ stored: chat.title ?? null, current: tgChat.title, fresh });
    if (title && chatsCol) {
        try {
            await chatsCol.updateOne({ id: chat.id }, { $set: { title } });
        } catch {
            // only a cache of Telegram's: the next refresh writes it
        }
    }
    return { title: typeof tgChat.title === 'string' && tgChat.title.trim() ? tgChat.title.trim() : null, photo: chatPhotoOf(tgChat) };
}

// The photo's { bytes, type }, from the cache or downloaded (getFile, then
// the file, at most MAX_PHOTO_BYTES); null when Telegram does not give it.
async function chatPhotoImage(photo) {
    const cached = photoCache.get(photo.unique_id);
    if (cached) return cached;
    if (!photoInFlight.has(photo.unique_id)) {
        const request = (async () => {
            const file = await telegram.getFile(photo.file_id);
            if (!file || (Number(file.file_size) || 0) > MAX_PHOTO_BYTES) return null;
            const download = await telegram.downloadFile(file.file_path, { maxBytes: MAX_PHOTO_BYTES });
            if (!download || !download.bytes.length) return null;
            const image = { bytes: download.bytes, type: imageContentType(download.bytes, download.contentType) };
            photoCache.set(photo.unique_id, image);
            return image;
        })().finally(() => photoInFlight.delete(photo.unique_id));
        photoInFlight.set(photo.unique_id, request);
    }
    return photoInFlight.get(photo.unique_id);
}

// Current titles for the chat documents that have none: Map id -> title.
// At most `limit` getChat calls, in parallel, each given `timeoutMs` (one
// that takes longer still fills the cache and stores the title for the next
// load). Never throws: a chat Telegram does not answer for keeps no title.
async function missingTitles(chats, chatsCol, { limit = TITLE_REFRESH_LIMIT, timeoutMs = TITLE_REFRESH_TIMEOUT_MS } = {}) {
    const seen = new Set();
    const untitled = [];
    for (const chat of chats) {
        if (!chat || chat.title || seen.has(chat.id)) continue;
        seen.add(chat.id);
        untitled.push(chat);
    }
    const titles = new Map();
    await Promise.all(
        untitled.slice(0, limit).map(async (chat) => {
            let timer;
            const timeout = new Promise((resolve) => {
                timer = setTimeout(resolve, timeoutMs, null);
            });
            const profile = await Promise.race([chatProfile(chat, chatsCol).catch(() => null), timeout]);
            clearTimeout(timer);
            if (profile?.title) titles.set(chat.id, profile.title);
        }),
    );
    return titles;
}

// Forgets the cached images (tests).
function clearPhotoCache() {
    photoCache.clear();
    photoInFlight.clear();
}

module.exports = {
    MAX_PHOTO_BYTES,
    PHOTO_MAX_AGE_S,
    LruCache,
    chatPhotoOf,
    etagOf,
    isNotModified,
    canSeeChatPhoto,
    titleUpdate,
    imageContentType,
    chatProfile,
    chatPhotoImage,
    missingTitles,
    clearPhotoCache,
};

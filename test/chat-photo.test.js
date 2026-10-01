// Unit tests for chat covers (src/lib/chat-photo.js and the cached getChat
// and file download of src/lib/telegram.js): the photo cache, the ETag
// answer, who may see a photo, when a title is stored, and the bounds on
// what is asked of Telegram.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const telegram = require('../src/lib/telegram');
const {
    LruCache,
    canSeeChatPhoto,
    chatPhotoOf,
    etagOf,
    imageContentType,
    isNotModified,
    missingTitles,
    titleUpdate,
} = require('../src/lib/chat-photo');

const TOKEN = '123:SECRET_token_value';

function withToken(fn) {
    return async (t) => {
        const saved = process.env.TELEGRAM_BOT_TOKEN;
        process.env.TELEGRAM_BOT_TOKEN = TOKEN;
        telegram.clearChatCache();
        try {
            await fn(t);
        } finally {
            if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
            else process.env.TELEGRAM_BOT_TOKEN = saved;
            telegram.clearChatCache();
        }
    };
}

// replaces telegram[name] for the test, put back afterwards
function stub(t, name, impl) {
    const original = telegram[name];
    telegram[name] = impl;
    t.after(() => {
        telegram[name] = original;
    });
}

test('LruCache drops the least recently used past its entry bound', () => {
    const lru = new LruCache({ maxEntries: 2 });
    lru.set('a', 1);
    lru.set('b', 2);
    assert.equal(lru.get('a'), 1); // a is now the most recent
    lru.set('c', 3);
    assert.equal(lru.get('b'), undefined);
    assert.equal(lru.get('a'), 1);
    assert.equal(lru.get('c'), 3);
    assert.equal(lru.size, 2);
});

test('LruCache keeps its values under the byte budget and refuses one larger than it', () => {
    const lru = new LruCache({ maxEntries: 10, maxBytes: 10, sizeOf: (v) => v.length });
    lru.set('a', 'xxxx');
    lru.set('b', 'yyyy');
    lru.set('c', 'zzzz'); // 12 bytes: a goes
    assert.equal(lru.get('a'), undefined);
    assert.equal(lru.bytes, 8);
    assert.equal(lru.set('big', 'x'.repeat(11)), false);
    assert.equal(lru.get('big'), undefined);
    assert.equal(lru.bytes, 8);
    lru.set('b', 'y'); // replacing counts the new size only
    assert.equal(lru.bytes, 5);
    lru.delete('c');
    assert.equal(lru.bytes, 1);
    lru.clear();
    assert.equal(lru.size, 0);
    assert.equal(lru.bytes, 0);
});

test('chatPhotoOf takes the small photo, null without one', () => {
    assert.deepEqual(chatPhotoOf({ photo: { small_file_id: 'f', small_file_unique_id: 'u', big_file_id: 'F' } }), {
        file_id: 'f',
        unique_id: 'u',
    });
    assert.equal(chatPhotoOf({ title: 'x' }), null);
    assert.equal(chatPhotoOf(null), null);
    assert.equal(chatPhotoOf({ photo: { small_file_id: 'f' } }), null);
});

test('the ETag is the quoted file_unique_id, and If-None-Match decides the 304', () => {
    const etag = etagOf('AQADabc');
    assert.equal(etag, '"AQADabc"');
    assert.equal(etagOf('a"b'), '"ab"');
    assert.equal(isNotModified('"AQADabc"', etag), true);
    assert.equal(isNotModified('W/"AQADabc"', etag), true);
    assert.equal(isNotModified('"old", "AQADabc"', etag), true);
    assert.equal(isNotModified('*', etag), true);
    assert.equal(isNotModified('"old"', etag), false);
    assert.equal(isNotModified(null, etag), false);
    assert.equal(isNotModified('', etag), false);
});

test('members (the rating rule) and the creator see the photo, nobody else', () => {
    assert.equal(canSeeChatPhoto({ status: 'member', hasRecord: false, isCreator: false }), true);
    assert.equal(canSeeChatPhoto({ status: 'administrator', hasRecord: false, isCreator: false }), true);
    assert.equal(canSeeChatPhoto({ status: null, hasRecord: true, isCreator: false }), true);
    assert.equal(canSeeChatPhoto({ status: 'left', hasRecord: true, isCreator: false }), false);
    assert.equal(canSeeChatPhoto({ status: 'kicked', hasRecord: false, isCreator: false }), false);
    assert.equal(canSeeChatPhoto({ status: null, hasRecord: false, isCreator: false }), false);
    assert.equal(canSeeChatPhoto({ status: null, hasRecord: false, isCreator: true }), true);
    assert.equal(canSeeChatPhoto({ status: 'left', hasRecord: false, isCreator: true }), true);
});

test('a title is stored only on a refresh, when Telegram has a new one', () => {
    assert.equal(titleUpdate({ stored: null, current: 'Memes', fresh: true }), 'Memes');
    assert.equal(titleUpdate({ stored: 'Old', current: ' Memes ', fresh: true }), 'Memes');
    assert.equal(titleUpdate({ stored: 'Memes', current: 'Memes', fresh: true }), null);
    assert.equal(titleUpdate({ stored: null, current: 'Memes', fresh: false }), null);
    assert.equal(titleUpdate({ stored: 'Old', current: '', fresh: true }), null);
    assert.equal(titleUpdate({ stored: 'Old', current: undefined, fresh: true }), null);
});

test('the image type: an image type Telegram gives, else read from the bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ');
    assert.equal(imageContentType(jpeg, 'image/png; charset=binary'), 'image/png');
    assert.equal(imageContentType(jpeg, 'application/octet-stream'), 'image/jpeg');
    assert.equal(imageContentType(png, null), 'image/png');
    assert.equal(imageContentType(webp, ''), 'image/webp');
    assert.equal(imageContentType(Buffer.from('GIF89a'), 'text/html'), 'image/gif');
    assert.equal(imageContentType(Buffer.from('<svg'), 'image/svg+xml'), 'image/jpeg');
});

test(
    'getChatCached asks Telegram once per chat, and only that caller is told it is fresh',
    withToken(async (t) => {
        let calls = 0;
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        stub(t, 'getChat', async (chatId) => {
            calls += 1;
            await gate;
            return { id: chatId, title: 'Memes' };
        });
        const first = telegram.getChatCached(-100);
        const second = telegram.getChatCached(-100);
        release();
        const results = await Promise.all([first, second]);
        assert.deepEqual(
            results.map((r) => r.fresh),
            [true, false],
        );
        assert.equal(results[1].chat.title, 'Memes');
        assert.deepEqual(await telegram.getChatCached(-100), { chat: { id: -100, title: 'Memes' }, fresh: false });
        assert.equal(calls, 1);
    }),
);

test(
    'getChatCached keeps a chat Telegram does not answer for as null',
    withToken(async (t) => {
        let calls = 0;
        stub(t, 'getChat', async () => {
            calls += 1;
            return null;
        });
        assert.deepEqual(await telegram.getChatCached(-200), { chat: null, fresh: true });
        assert.deepEqual(await telegram.getChatCached(-200), { chat: null, fresh: false });
        assert.equal(calls, 1);
    }),
);

test(
    'missingTitles asks only for untitled chats, at most `limit`, and does not wait past the timeout',
    withToken(async (t) => {
        const asked = [];
        stub(t, 'getChatCached', async (chatId) => {
            asked.push(chatId);
            if (chatId === -3) return new Promise(() => {}); // never answers
            return { chat: { id: chatId, title: `T${chatId}` }, fresh: false };
        });
        const chats = [{ id: -1, title: 'Has one' }, { id: -2 }, { id: -3 }, { id: -4, title: '' }, { id: -5 }, { id: -2 }];
        const started = Date.now();
        const titles = await missingTitles(chats, null, { limit: 3, timeoutMs: 50 });
        assert.ok(Date.now() - started < 1000);
        assert.deepEqual(asked, [-2, -3, -4]);
        assert.deepEqual([...titles], [
            [-2, 'T-2'],
            [-4, 'T-4'],
        ]);
    }),
);

test(
    'downloadFile streams up to maxBytes and never puts the token in what it returns',
    withToken(async (t) => {
        const saved = globalThis.fetch;
        t.after(() => {
            globalThis.fetch = saved;
        });
        const urls = [];
        globalThis.fetch = async (url) => {
            urls.push(url);
            const body = url.endsWith('big.jpg') ? new Uint8Array(2048) : new Uint8Array([0xff, 0xd8, 0xff]);
            // no content-length: the cap must hold while streaming
            return new Response(new Blob([body]).stream(), { headers: { 'content-type': 'image/jpeg' } });
        };
        const small = await telegram.downloadFile('profile_photos/file_1.jpg', { maxBytes: 1024 });
        assert.deepEqual([...small.bytes], [0xff, 0xd8, 0xff]);
        assert.equal(small.contentType, 'image/jpeg');
        assert.ok(!JSON.stringify(small).includes(TOKEN));
        assert.equal(await telegram.downloadFile('profile_photos/big.jpg', { maxBytes: 1024 }), null);
        assert.equal(urls[0], `https://api.telegram.org/file/bot${TOKEN}/profile_photos/file_1.jpg`);

        globalThis.fetch = async (url) => {
            throw new Error(`failed: ${url}`);
        };
        assert.equal(await telegram.downloadFile('profile_photos/file_1.jpg'), null);
        assert.equal(await telegram.downloadFile('../etc/passwd'), null);
        assert.equal(await telegram.downloadFile('a b'), null);
    }),
);

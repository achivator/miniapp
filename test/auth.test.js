// Unit tests for the Telegram init-data auth gate. Valid init data is built
// with node:crypto exactly the way Telegram signs it:
//   secret = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   hash   = HMAC_SHA256(key=secret, msg=data_check_string)
// No network, no Telegram — the token here is a throwaway string.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { authenticate } = require('../src/lib/auth');

const BOT_TOKEN = '1234567890:AAFAKEtok3n_for_unit_tests_ONLY0123';

function makeInitData(user, { authDate, signWith = BOT_TOKEN, extra = {} } = {}) {
    const secret = crypto.createHmac('sha256', 'WebAppData').update(signWith).digest();
    // @tma.js/init-data-node parses with URLSearchParams, so the data-check
    // string is built from DECODED values; the wire form stays URL-encoded.
    const decoded = {
        auth_date: String(authDate ?? Math.floor(Date.now() / 1000)),
        query_id: 'AAHdqI0QAAAAAN2ojRCX3b0J',
        user: JSON.stringify(user),
        ...extra,
    };
    const keys = Object.keys(decoded).sort();
    const dataCheckString = keys.map((k) => `${k}=${decoded[k]}`).join('\n');
    const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const qs = keys.map((k) => `${k}=${encodeURIComponent(decoded[k])}`).join('&');
    return `${qs}&hash=${hash}`;
}

function fakeRequest({ headers = {}, url = 'http://localhost/api/achievements' } = {}) {
    const map = {};
    for (const [k, v] of Object.entries(headers)) map[k.toLowerCase()] = v;
    return {
        headers: { get: (name) => map[String(name).toLowerCase()] ?? null },
        url,
    };
}

function withEnv(overrides, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(overrides)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

test('authenticates a valid init data from the Authorization header', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        const initData = makeInitData({ id: 424242, first_name: 'Test' });
        const req = fakeRequest({ headers: { authorization: `tma ${initData}` } });
        const { user, dev } = authenticate(req);
        assert.equal(user.id, 424242);
        assert.equal(dev, false);
    }));

test('authenticates init data passed via the init_data query param', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        const initData = makeInitData({ id: 777, first_name: 'Query' });
        const req = fakeRequest({ url: `http://localhost/api/x?init_data=${encodeURIComponent(initData)}` });
        assert.equal(authenticate(req).user.id, 777);
    }));

test('rejects a tampered init data (wrong hash)', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        const initData = makeInitData({ id: 424242 });
        const tampered = initData.replace('auth_date=', 'auth_date=1');
        const req = fakeRequest({ headers: { authorization: `tma ${tampered}` } });
        assert.throws(() => authenticate(req), (e) => e.status === 401);
    }));

test('rejects init data signed for another bot token', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        const initData = makeInitData({ id: 424242 }, { signWith: '999999:OTHER_bot_token_xxxxxxxxxxxxx' });
        const req = fakeRequest({ headers: { authorization: `tma ${initData}` } });
        assert.throws(() => authenticate(req), (e) => e.status === 401);
    }));

test('rejects expired init data', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        const old = Math.floor(Date.now() / 1000) - 90000; // > 86400s ago
        const initData = makeInitData({ id: 424242 }, { authDate: old });
        const req = fakeRequest({ headers: { authorization: `tma ${initData}` } });
        assert.throws(() => authenticate(req), (e) => e.status === 401);
    }));

test('rejects a request without init data (no dev override configured)', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: undefined }, () => {
        assert.throws(() => authenticate(fakeRequest({})), (e) => e.status === 401);
    }));

test('DEV_TELEGRAM_USER_ID bypass works only outside production and only without init data', () =>
    withEnv({ NODE_ENV: 'test', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: '515151' }, () => {
        const dev = authenticate(fakeRequest({}));
        assert.equal(dev.user.id, 515151);
        assert.equal(dev.dev, true);

        // real init data still wins over the bypass
        const initData = makeInitData({ id: 424242, first_name: 'Test' });
        const req = fakeRequest({ headers: { authorization: `tma ${initData}` } });
        assert.equal(authenticate(req).user.id, 424242);
    }));

test('DEV_TELEGRAM_USER_ID never applies in production', () =>
    withEnv({ NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: BOT_TOKEN, DEV_TELEGRAM_USER_ID: '515151' }, () => {
        assert.throws(() => authenticate(fakeRequest({})), (e) => e.status === 401);
    }));

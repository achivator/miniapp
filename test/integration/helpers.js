// Shared setup for the integration tests: the API route handlers run as they
// are, against a real MongoDB (mongodb-memory-server, a one-node replica set
// so transactions work too), with toncenter and Telegram replaced by
// in-memory fakes. Require this file FIRST in every test file: the fakes are
// installed by replacing exports of src/lib/ton/rpc.js and src/lib/telegram.js,
// which only reaches modules that read them afterwards (several libs
// destructure them when first required).
//
// mongodb-memory-server downloads a mongod binary on first use (cached in
// ~/.cache/mongodb-binaries). Where that is impossible, point
// MONGOMS_SYSTEM_BINARY at a mongod 7.x. Outside CI the suite skips with a
// message when no mongod can be started; in CI (process.env.CI) it fails.
const path = require('node:path');
const crypto = require('node:crypto');
const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
const { test, before, beforeEach, after } = require('node:test');
const { Address, beginCell } = require('@ton/core');

const SRC = path.join(__dirname, '..', '..', 'src');

// ---- environment: set before any src module reads it ----

const BOT_TOKEN = '1234567890:AAFAKEtok3n_for_integration_tests_01';

function address(tag) {
    return new Address(0, crypto.createHash('sha256').update(String(tag)).digest()).toString();
}

const MASTER_ADDRESS = address('distributor-master');

Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    BACKEND_SECRET: crypto.createHash('sha256').update('integration-backend-key').digest('hex'),
    MASTER_ADDRESS,
    NEXT_PUBLIC_TON_NETWORK: 'testnet',
    JETTONS_PER_POINT: '0.01',
    POINT_PRICE_NOTICE_DAYS: '7',
    MATURATION_DAYS: '3',
});
for (const key of ['DEV_TELEGRAM_USER_ID', 'NEXT_PUBLIC_MASTER_ADDRESS', 'TONCENTER_URL', 'TONCENTER_API_KEY', 'SUBSCRIPTIONS_ENABLED']) {
    delete process.env[key];
}

// ---- fakes for the chain (toncenter) and Telegram ----

// Replaces `names` on the module's exports with calls into `impl`. A call
// with no implementation fails the test instead of reaching the network.
// `hooks[name]`, when set, runs first: tests use it to pause a request at a
// known point (e.g. to line two claims up) or to change the database while a
// request is in flight.
function stubExports(file, names, impl, hooks) {
    const mod = require(file);
    for (const name of names) {
        if (typeof mod[name] !== 'function') throw new Error(`${file} has no export ${name}`);
        mod[name] = async function stubbed(...args) {
            impl.calls.push({ name, args });
            if (hooks[name]) await hooks[name](...args);
            const fn = impl[name];
            if (!fn) throw new Error(`unexpected ${path.basename(file)} ${name}() in an integration test`);
            return fn(...args);
        };
    }
}

const chain = {
    jettons: new Map(), // jetton master (as stored) -> { decimals, symbol }
    pools: new Map(), // chatId -> pool (see addPool)
    hooks: {},
    calls: [],

    reset() {
        this.jettons.clear();
        this.pools.clear();
        this.hooks = {};
        this.calls.length = 0;
    },

    addJetton(master, { decimals = 9, symbol = 'TST' } = {}) {
        this.jettons.set(master, { decimals, symbol });
        return master;
    },

    // A deployed ChatPool. Amounts are jetton units (BigInt); limit 0 means
    // the default daily share.
    addPool(chatId, { active = true, ledger = 10n ** 15n, claimableToday = 10n ** 15n, limit = 0n, paused = false, admin = null } = {}) {
        const pool = {
            chatId,
            address: Address.parse(address(`pool:${chatId}`)),
            active,
            ledger,
            claimableToday,
            limit,
            paused,
            admin: admin ? Address.parse(admin) : null,
            usedNonces: new Set(),
        };
        this.pools.set(chatId, pool);
        return pool;
    },

    poolAt(addr) {
        const parsed = Address.parse(String(addr));
        for (const pool of this.pools.values()) if (pool.address.equals(parsed)) return pool;
        throw new Error(`no fake pool at ${addr}`);
    },
};

const ton = {
    calls: [],
    // Like the real one, never throws: an unreadable jetton has decimals null.
    async fetchJettonMetadata(master) {
        const meta = chain.jettons.get(String(master));
        if (!meta) return { decimals: null, name: null, symbol: null, mintable: null, totalSupply: null };
        return { decimals: meta.decimals, name: meta.symbol, symbol: meta.symbol, mintable: true, totalSupply: 0n };
    },
    async fetchPoolAddress(_master, chatId) {
        const pool = chain.pools.get(Number(chatId));
        return pool ? pool.address : null;
    },
    async getPoolStatus(_master, chatId) {
        const pool = chain.pools.get(Number(chatId));
        if (!pool) return { poolAddress: null, active: false, balance: 0n };
        return { poolAddress: pool.address, active: pool.active, balance: 0n };
    },
    async fetchPoolLedgerBalance(poolAddress) {
        return chain.poolAt(poolAddress).ledger;
    },
    async fetchPoolClaimControls(poolAddress) {
        const pool = chain.poolAt(poolAddress);
        return { paused: pool.paused, limit: pool.limit, claimableToday: pool.claimableToday };
    },
    // Raw getters, in toncenter's stack format (the real stackItemTo* parse them).
    async runGetMethod(addr, method, stack = []) {
        const pool = chain.poolAt(addr);
        if (method === 'isNonceUsed') {
            const nonce = Number(BigInt(stack[0][1]));
            return [['num', pool.usedNonces.has(nonce) ? '-0x1' : '0x0']];
        }
        if (method === 'poolAdmin') {
            if (!pool.admin) return [['list', { '@type': 'tvm.list', elements: [] }]];
            return [['slice', { bytes: beginCell().storeAddress(pool.admin).endCell().toBoc().toString('base64') }]];
        }
        throw new Error(`fake toncenter: unexpected getter ${method}`);
    },
};
ton.calls = chain.calls;

stubExports(
    path.join(SRC, 'lib/ton/rpc.js'),
    [
        'toncenterRequest',
        'runGetMethod',
        'getAddressInformation',
        'fetchPoolAddress',
        'fetchJettonWalletAddress',
        'fetchJettonMetadata',
        'fetchPoolLedgerBalance',
        'fetchPoolClaimControls',
        'fetchIsMinted',
        'getPoolStatus',
    ],
    ton,
    new Proxy({}, { get: (_, name) => chain.hooks[name] }),
);

// What Telegram says about chat members: setStatus(chatId, userId, status).
// Unknown members read as null (the bot cannot see them).
const telegram = {
    statuses: new Map(),
    hooks: {},
    calls: [],
    reset() {
        this.statuses.clear();
        this.hooks = {};
        this.calls.length = 0;
    },
    setStatus(chatId, userId, status) {
        this.statuses.set(`${chatId}:${userId}`, status);
    },
};
const telegramImpl = {
    calls: telegram.calls,
    async getChatMemberStatus(chatId, userId) {
        return telegram.statuses.get(`${chatId}:${userId}`) ?? null;
    },
    async getChatMember(chatId, userId) {
        const status = telegram.statuses.get(`${chatId}:${userId}`);
        return status ? { status, user: { id: userId, first_name: `User${userId}` } } : null;
    },
    async getChatMemberCount() {
        return null;
    },
    async getChat() {
        return null;
    },
};
stubExports(
    path.join(SRC, 'lib/telegram.js'),
    ['botApi', 'getChatMemberCount', 'getChat', 'getChatMemberStatus', 'getChatMember'],
    telegramImpl,
    new Proxy({}, { get: (_, name) => telegram.hooks[name] }),
);

// Route modules are ESM with "@/..." imports; this hook resolves them.
register(pathToFileURL(path.join(__dirname, 'alias-loader.mjs')));

const { getClient, getDb, getCollection } = require(path.join(SRC, 'lib/mongo.js'));

// ---- MongoDB lifecycle ----

const state = { replSet: null, skip: null };

// Registers the per-file hooks: one replica set per test file, an empty
// database and fresh fakes for every test.
function setupIntegration() {
    before(async () => {
        try {
            const { MongoMemoryReplSet } = require('mongodb-memory-server');
            state.replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
            process.env.MONGODB_URI = state.replSet.getUri();
            await getClient();
        } catch (e) {
            if (process.env.CI) throw e;
            state.skip =
                `no MongoDB for the integration tests (${e.message.split('\n')[0]}); ` +
                'let mongodb-memory-server download mongod or set MONGOMS_SYSTEM_BINARY to a mongod 7.x';
            console.warn(`# SKIPPED: ${state.skip}`);
        }
    });
    beforeEach(async () => {
        chain.reset();
        telegram.reset();
        if (!state.skip) await (await getDb()).dropDatabase();
    });
    after(async () => {
        if (globalThis.__achivatorMongoClientPromise) {
            await (await globalThis.__achivatorMongoClientPromise).close();
            delete globalThis.__achivatorMongoClientPromise;
        }
        if (state.replSet) await state.replSet.stop();
    });
}

// test() that skips (with the reason) when MongoDB could not be started.
function itest(name, fn) {
    return test(name, async (t) => {
        if (state.skip) return t.skip(state.skip);
        return fn(t);
    });
}

// ---- requests ----

// Telegram WebApp init data, signed exactly the way Telegram signs it (see
// test/auth.test.js).
function initData(user) {
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const decoded = {
        auth_date: String(Math.floor(Date.now() / 1000)),
        query_id: 'AAHdqI0QAAAAAN2ojRCX3b0J',
        user: JSON.stringify(user),
    };
    const keys = Object.keys(decoded).sort();
    const hash = crypto
        .createHmac('sha256', secret)
        .update(keys.map((k) => `${k}=${decoded[k]}`).join('\n'))
        .digest('hex');
    return `${keys.map((k) => `${k}=${encodeURIComponent(decoded[k])}`).join('&')}&hash=${hash}`;
}

function apiRequest(route, { method = 'GET', user = null, query = {}, body } = {}) {
    const url = new URL(`http://localhost/api/${route}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const headers = {};
    if (user !== null) {
        const tgUser = typeof user === 'number' ? { id: user, first_name: `User${user}` } : user;
        headers.authorization = `tma ${initData(tgUser)}`;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const routeCache = new Map();
function loadRoute(route) {
    if (!routeCache.has(route)) {
        routeCache.set(route, import(pathToFileURL(path.join(SRC, 'app', 'api', route, 'route.js')).href));
    }
    return routeCache.get(route);
}

// Calls the route's exported handler; returns { status, body } (body parsed).
async function callApi(route, options = {}) {
    const method = options.method || 'GET';
    const handler = (await loadRoute(route))[method];
    if (typeof handler !== 'function') throw new Error(`api/${route} exports no ${method}`);
    const res = await handler(apiRequest(route, { ...options, method }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ---- fixtures ----

const DAY_MS = 86400 * 1000;
const ago = (days, now = Date.now()) => new Date(now - days * DAY_MS);

// The bot's documents, in the shapes it writes them.
const seed = {
    async chat(doc) {
        await (await getCollection('chats')).insertOne({ title: `Chat ${doc.id}`, ...doc });
        return doc;
    },
    async rewards(chatId, userId, points, claimed = 0) {
        await (await getCollection('rewards')).insertOne({ chat_id: chatId, user_id: userId, points, claimed_points: claimed });
    },
    // reaction_points.date is a Date
    async reaction(chatId, userId, points, date, reactorId = 999) {
        await (await getCollection('reaction_points')).insertOne({
            chat_id: chatId,
            receiver_id: userId,
            reactor_id: reactorId,
            points,
            date,
        });
    },
    // grants.date is epoch ms (a number)
    async grant(chatId, userId, points, date, reason = 'test') {
        await (await getCollection('grants')).insertOne({ chat_id: chatId, user_id: userId, points, date: date.getTime(), reason });
    },
};

// Resolves once `n` callers are waiting: lines concurrent requests up at one
// point of the handler. Rejects after `timeoutMs` instead of hanging the test
// when fewer arrive.
function barrier(n, timeoutMs = 5000) {
    let waiting = 0;
    let release;
    let fail;
    const all = new Promise((resolve, reject) => {
        release = resolve;
        fail = reject;
    });
    all.catch(() => {}); // only callers observe the timeout
    const timer = setTimeout(() => fail(new Error(`barrier: ${waiting} of ${n} callers arrived`)), timeoutMs);
    timer.unref();
    return () => {
        waiting += 1;
        if (waiting >= n) {
            clearTimeout(timer);
            release();
        }
        return all;
    };
}

module.exports = {
    SRC,
    BOT_TOKEN,
    MASTER_ADDRESS,
    DAY_MS,
    address,
    ago,
    chain,
    telegram,
    seed,
    barrier,
    setupIntegration,
    itest,
    initData,
    apiRequest,
    callApi,
    getDb,
    getCollection,
};

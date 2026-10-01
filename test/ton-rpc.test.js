// Unit tests for the pure/mocked-HTTP parts of the TON rpc lib:
// the SSRF guard on metadata URLs and jetton-metadata decimals resolution
// (USDT-scale bug class: a wrong decimals guess pays out 10^difference x).
// toncenter calls and metadata fetches are stubbed via globalThis.fetch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Address, beginCell, Dictionary } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');

const { TonRpcError, resolveMetadataUrl, fetchJettonMetadata, stackItemToAddress } = require('../src/lib/ton/rpc');

const originalFetch = globalThis.fetch;

function stubFetch(fn) {
    globalThis.fetch = fn;
}

test.after(() => {
    globalThis.fetch = originalFetch;
});

// ---- resolveMetadataUrl: SSRF guard ----

test('resolveMetadataUrl accepts a plain https URL', () => {
    const url = resolveMetadataUrl('https://meta.example.com/jetton.json');
    assert.equal(url.href, 'https://meta.example.com/jetton.json');
});

test('resolveMetadataUrl rewrites ipfs:// through the configured gateway', () => {
    const saved = process.env.IPFS_GATEWAY;
    process.env.IPFS_GATEWAY = 'https://gw.example.com/ipfs/';
    try {
        const url = resolveMetadataUrl('ipfs://bafyCID123/meta.json');
        assert.equal(url.href, 'https://gw.example.com/ipfs/bafyCID123/meta.json');
    } finally {
        if (saved === undefined) delete process.env.IPFS_GATEWAY;
        else process.env.IPFS_GATEWAY = saved;
    }
});

test('resolveMetadataUrl rejects non-https schemes', () => {
    assert.throws(() => resolveMetadataUrl('http://meta.example.com/x.json'), TonRpcError);
    assert.throws(() => resolveMetadataUrl('ftp://meta.example.com/x.json'), TonRpcError);
});

test('resolveMetadataUrl rejects userinfo and non-443 ports', () => {
    assert.throws(() => resolveMetadataUrl('https://user:pass@meta.example.com/x.json'), TonRpcError);
    assert.throws(() => resolveMetadataUrl('https://meta.example.com:8443/x.json'), TonRpcError);
    assert.doesNotThrow(() => resolveMetadataUrl('https://meta.example.com:443/x.json'));
});

test('resolveMetadataUrl rejects internal/literal hosts', () => {
    for (const bad of [
        'https://127.0.0.1/x.json',
        'https://localhost/x.json',
        'https://foo.localhost/x.json',
        'https://foo.local/x.json',
        'https://foo.internal/x.json',
        'https://[::1]/x.json',
        'https://2130706433/x.json', // decimal IPv4
        'https://127.1/x.json', // short IPv4
        'https://0x7f000001/x.json', // hex IPv4
    ]) {
        assert.throws(() => resolveMetadataUrl(bad), TonRpcError, bad);
    }
});

// ---- fetchJettonMetadata: decimals resolution (module-level cache: unique
// jetton master address per test) ----

function fieldKey(field) {
    return BigInt('0x' + sha256_sync(field).toString('hex'));
}

function snake(text) {
    return beginCell().storeUint(0, 8).storeStringTail(text).endCell();
}

function onchainContent(fields) {
    const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
    for (const [k, v] of Object.entries(fields)) dict.set(fieldKey(k), snake(v));
    return beginCell().storeUint(0, 8).storeDict(dict).endCell();
}

function offchainContentCell(url) {
    return beginCell().storeUint(1, 8).storeStringTail(url).endCell();
}

function jettonDataResponse(contentCell) {
    return {
        ok: true,
        result: {
            exit_code: 0,
            stack: [
                ['num', '1000000'], // total_supply
                ['num', '-1'], // mintable
                ['slice', { bytes: beginCell().storeAddress(new Address(0, Buffer.alloc(32, 9))).endCell().toBoc().toString('base64') }],
                ['cell', { bytes: contentCell.toBoc().toString('base64') }],
            ],
        },
    };
}

function jsonResponse(obj, { status = 200 } = {}) {
    return {
        ok: status === 200,
        status,
        headers: { get: () => null },
        json: async () => obj,
        text: async () => JSON.stringify(obj),
    };
}

// metadataCache is module-level: every test mints its own jetton master.
let masterSeed = 0;
function freshMaster() {
    masterSeed += 1;
    return new Address(0, Buffer.alloc(32, masterSeed));
}

test('reads decimals from on-chain (TEP-64 tag 0) metadata', async () => {
    const master = freshMaster();
    stubFetch(async (url) => {
        assert.match(String(url), /\/api\/v2\/runGetMethod/);
        return jsonResponse(jettonDataResponse(onchainContent({ name: 'T', symbol: 'T', decimals: '6' })));
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.decimals, 6);
    assert.equal(meta.name, 'T');
    assert.equal(meta.symbol, 'T');
});

test('reads decimals from off-chain (TEP-64 tag 1) metadata JSON', async () => {
    const master = freshMaster();
    const content = offchainContentCell('https://meta.example.com/j.json');
    stubFetch(async (url) => {
        if (String(url).includes('/api/v2/')) return jsonResponse(jettonDataResponse(content));
        assert.match(String(url), /meta\.example\.com/);
        return jsonResponse({ name: 'Off', symbol: 'OFF', decimals: 8 });
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.decimals, 8);
    assert.equal(meta.name, 'Off');
});

test('on-chain fields win over the off-chain JSON (TEP-64)', async () => {
    const master = freshMaster();
    const content = beginCell()
        .storeUint(0, 8)
        .storeDict(
            (() => {
                const d = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
                d.set(fieldKey('name'), snake('OnName'));
                d.set(fieldKey('uri'), snake('https://meta.example.com/j.json'));
                return d;
            })(),
        )
        .endCell();
    stubFetch(async (url) => {
        if (String(url).includes('/api/v2/')) return jsonResponse(jettonDataResponse(content));
        return jsonResponse({ name: 'OffName', symbol: 'OFFS', decimals: 2 });
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.name, 'OnName');
    assert.equal(meta.symbol, 'OFFS'); // only in the JSON
    assert.equal(meta.decimals, 2);
});

test('missing decimals defaults to 9 (TEP-64 default)', async () => {
    const master = freshMaster();
    const content = offchainContentCell('https://meta.example.com/j.json');
    stubFetch(async (url) => {
        if (String(url).includes('/api/v2/')) return jsonResponse(jettonDataResponse(content));
        return jsonResponse({ name: 'NoDec' });
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.decimals, 9);
});

test('out-of-range decimals never reaches callers (null instead of a guess)', async () => {
    const master = freshMaster();
    const content = offchainContentCell('https://meta.example.com/j.json');
    stubFetch(async (url) => {
        if (String(url).includes('/api/v2/')) return jsonResponse(jettonDataResponse(content));
        return jsonResponse({ name: 'Bad', decimals: 300 });
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.decimals, null);
});

test('unreachable metadata host leaves decimals null (no guessing on error)', async () => {
    const master = freshMaster();
    const content = offchainContentCell('https://meta.example.com/j.json');
    stubFetch(async (url) => {
        if (String(url).includes('/api/v2/')) return jsonResponse(jettonDataResponse(content));
        throw new Error('ECONNREFUSED');
    });
    const meta = await fetchJettonMetadata(master);
    assert.equal(meta.decimals, null);
});

test('stackItemToAddress reads a null Address? returned as an empty toncenter list', () => {
    assert.equal(stackItemToAddress(['list', { '@type': 'tvm.list', elements: [] }]), null);
    assert.equal(stackItemToAddress(['null', null]), null);
    const addr = Address.parse('EQDjDOaz6YU6q1MjLlNWsLpLutDMF70Svv8Yq-Hhz2wBjvrl');
    const boc = beginCell().storeAddress(addr).endCell().toBoc().toString('base64');
    assert.ok(stackItemToAddress(['slice', { bytes: boc }]).equals(addr));
    assert.throws(() => stackItemToAddress(['list', { elements: [['num', '0x1']] }]), TonRpcError);
});

// Tact getters return Bool true as -1 (toncenter: "-0x1"). Reading it as
// "=== 1" once made every confirmed claim look unsent, so expiry released
// the points again and allowed a second payout.
test('isNonceUsedOnChain reads Tact true (-1) as used and false (0) as unused', async () => {
    const { isNonceUsedOnChain } = require('../src/lib/rewards');
    const pool = freshMaster();
    for (const [value, expected] of [['-0x1', true], ['0x0', false]]) {
        stubFetch(async () =>
            jsonResponse({ ok: true, result: { exit_code: 0, stack: [['num', value]] } }),
        );
        assert.equal(await isNonceUsedOnChain(pool, 1), expected);
    }
});

// ---- fetchContractVersion: refuse vouchers an older contract would reject ----

const { fetchContractVersion } = require('../src/lib/ton/rpc');

function getMethodStub(handler) {
    const calls = [];
    stubFetch(async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push(body);
        return jsonResponse({ ok: true, result: handler(body) });
    });
    return calls;
}

test('fetchContractVersion reads the version() getter and caches it', async () => {
    const pool = new Address(0, Buffer.alloc(32, 21));
    const calls = getMethodStub(() => ({ exit_code: 0, stack: [['num', '0x2']] }));
    assert.equal(await fetchContractVersion(pool), 2);
    assert.equal(await fetchContractVersion(pool.toString()), 2, 'same contract, any address form');
    assert.equal(calls.length, 1, 'code is immutable: asked once');
    assert.equal(calls[0].method, 'version');
});

test('fetchContractVersion treats a contract without the getter as version 1', async () => {
    // TVM exit code 11: no such get method (contracts deployed before version())
    getMethodStub(() => ({ exit_code: 11, stack: [] }));
    assert.equal(await fetchContractVersion(new Address(0, Buffer.alloc(32, 22))), 1);
});

test('fetchContractVersion lets network failures through instead of guessing', async () => {
    stubFetch(async () => jsonResponse({ ok: false, error: 'backend down', code: 503 }));
    await assert.rejects(() => fetchContractVersion(new Address(0, Buffer.alloc(32, 23))), TonRpcError);
});

// ---- isClaimPaid: a master redeploy must never make a paid claim look unsent ----

const { isClaimPaid } = require('../src/lib/rewards');

// A toy chain: masters map chat pools, pools list their used nonces.
function chainStub({ masters, pools }) {
    const slice = (address) => ['slice', { bytes: beginCell().storeAddress(address).endCell().toBoc().toString('base64') }];
    const key = (address) => Address.parse(address).toRawString();
    stubFetch(async (url, init) => {
        const body = JSON.parse(init.body);
        const method = url.split('/').pop();
        if (method === 'getAddressInformation') {
            const known = pools.has(key(body.address));
            return jsonResponse({ ok: true, result: { state: known ? 'active' : 'uninitialized', balance: '0' } });
        }
        if (body.method === 'poolAddress') {
            return jsonResponse({ ok: true, result: { exit_code: 0, stack: [slice(masters.get(key(body.address)))] } });
        }
        if (body.method === 'isNonceUsed') {
            const used = pools.get(key(body.address))?.has(BigInt(body.stack[0][1]));
            return jsonResponse({ ok: true, result: { exit_code: 0, stack: [['num', used ? '-0x1' : '0x0']] } });
        }
        throw new Error(`unexpected call ${method} ${body.method}`);
    });
}

test('isClaimPaid asks the pool recorded on the claim', async () => {
    const oldPool = freshMaster();
    chainStub({ masters: new Map(), pools: new Map([[oldPool.toRawString(), new Set([7n])]]) });
    assert.equal(await isClaimPaid({ chat_id: -100, nonce: 7, pool_address: oldPool.toString() }), true);
    assert.equal(await isClaimPaid({ chat_id: -100, nonce: 8, pool_address: oldPool.toString() }), false);
});

test('isClaimPaid finds an older claim paid by the pool of a replaced master', async () => {
    const [newMaster, oldMaster, newPool, oldPool] = [freshMaster(), freshMaster(), freshMaster(), freshMaster()];
    const saved = { master: process.env.MASTER_ADDRESS, legacy: process.env.LEGACY_MASTER_ADDRESSES, pub: process.env.NEXT_PUBLIC_MASTER_ADDRESS };
    delete process.env.NEXT_PUBLIC_MASTER_ADDRESS;
    process.env.MASTER_ADDRESS = newMaster.toString();
    chainStub({
        masters: new Map([
            [newMaster.toRawString(), newPool],
            [oldMaster.toRawString(), oldPool],
        ]),
        pools: new Map([
            [newPool.toRawString(), new Set()],
            [oldPool.toRawString(), new Set([42n])],
        ]),
    });
    try {
        const claim = { chat_id: -100, nonce: 42 }; // issued before claims recorded their pool
        // without the old master the payout looks unsent: its points would be released twice
        process.env.LEGACY_MASTER_ADDRESSES = '';
        assert.equal(await isClaimPaid(claim), false);
        process.env.LEGACY_MASTER_ADDRESSES = ` ${oldMaster.toString()} `;
        assert.equal(await isClaimPaid(claim), true);
    } finally {
        for (const [name, value] of [['MASTER_ADDRESS', saved.master], ['LEGACY_MASTER_ADDRESSES', saved.legacy], ['NEXT_PUBLIC_MASTER_ADDRESS', saved.pub]]) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});

test('isClaimPaid skips a pool that was never deployed', async () => {
    const master = freshMaster();
    const saved = process.env.MASTER_ADDRESS;
    process.env.MASTER_ADDRESS = master.toString();
    chainStub({ masters: new Map([[master.toRawString(), freshMaster()]]), pools: new Map() });
    try {
        assert.equal(await isClaimPaid({ chat_id: -100, nonce: 1 }), false);
    } finally {
        if (saved === undefined) delete process.env.MASTER_ADDRESS;
        else process.env.MASTER_ADDRESS = saved;
    }
});

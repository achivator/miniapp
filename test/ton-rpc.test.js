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

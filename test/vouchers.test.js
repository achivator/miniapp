// Unit tests for the voucher envelope (src/lib/ton/vouchers.js): protocol v3
// contracts verify a network-bound envelope, legacy v2 contracts the
// network-less one, and the backend must sign exactly what the target checks.
// The byte-for-byte match against the compiled contract bindings and the real
// contracts lives in ton-contracts/tests/MiniappIntegration.spec.ts and
// NetworkBinding.spec.ts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Address, beginCell } = require('@ton/core');
const { keyPairFromSeed, signVerify } = require('@ton/crypto');

const { signedVoucherCell, signVoucher, buildClaimVoucherCell } = require('../src/lib/ton/vouchers');
const { CONTRACTS_VERSION, SIGNABLE_VERSIONS, GLOBAL_ID, VOUCHER_TAG } = require('../src/lib/ton/constants');
const { getTonConfig } = require('../src/lib/ton/config');

const SECRET = Buffer.alloc(32, 7).toString('hex');
const PUBLIC_KEY = keyPairFromSeed(Buffer.from(SECRET, 'hex')).publicKey;
const POOL = new Address(0, Buffer.alloc(32, 5));
const voucher = buildClaimVoucherCell({
    chatId: -1001234567890n,
    recipient: new Address(0, Buffer.alloc(32, 6)),
    jettonMaster: new Address(0, Buffer.alloc(32, 3)),
    amount: 50n,
    nonce: 1n,
    expiry: 1n << 40n,
});

const v3Envelope = (globalId) =>
    beginCell().storeUint(VOUCHER_TAG.Claim, 32).storeInt(globalId, 32).storeAddress(POOL).storeRef(voucher).endCell();
const v2Envelope = () => beginCell().storeUint(VOUCHER_TAG.Claim, 32).storeAddress(POOL).storeRef(voucher).endCell();

test('the backend speaks protocol v3 and still signs for legacy v2 contracts', () => {
    assert.equal(CONTRACTS_VERSION, 3);
    assert.deepEqual(SIGNABLE_VERSIONS, [2, 3]);
    assert.deepEqual(GLOBAL_ID, { mainnet: -239, testnet: -3 });
});

test('a v3 envelope is tag, network global id, target, ref(voucher)', () => {
    for (const globalId of [GLOBAL_ID.mainnet, GLOBAL_ID.testnet]) {
        const cell = signedVoucherCell(voucher, { tag: VOUCHER_TAG.Claim, target: POOL, version: 3, globalId });
        assert.ok(cell.equals(v3Envelope(globalId)));
        const s = cell.beginParse();
        assert.equal(s.loadUint(32), VOUCHER_TAG.Claim);
        assert.equal(s.loadInt(32), globalId);
        assert.ok(s.loadAddress().equals(POOL));
        assert.ok(s.loadRef().equals(voucher));
        s.endParse();
    }
});

test('a v3 signature covers the network: testnet and mainnet signatures differ', () => {
    const sign = (globalId) =>
        signVoucher(voucher, SECRET, { tag: VOUCHER_TAG.Claim, target: POOL.toString(), version: 3, globalId });
    const testnet = sign(GLOBAL_ID.testnet);
    const mainnet = sign(GLOBAL_ID.mainnet);
    assert.ok(signVerify(v3Envelope(GLOBAL_ID.testnet).hash(), testnet, PUBLIC_KEY));
    assert.ok(signVerify(v3Envelope(GLOBAL_ID.mainnet).hash(), mainnet, PUBLIC_KEY));
    assert.ok(
        !signVerify(v3Envelope(GLOBAL_ID.mainnet).hash(), testnet, PUBLIC_KEY),
        'a testnet voucher fails on mainnet',
    );
    assert.ok(!signVerify(v2Envelope().hash(), testnet, PUBLIC_KEY));
});

test('a v2 (legacy) envelope names no network, whatever globalId is passed', () => {
    for (const globalId of [undefined, GLOBAL_ID.mainnet, GLOBAL_ID.testnet]) {
        const cell = signedVoucherCell(voucher, { tag: VOUCHER_TAG.Claim, target: POOL, version: 2, globalId });
        assert.ok(cell.equals(v2Envelope()));
    }
    const signature = signVoucher(voucher, SECRET, { tag: VOUCHER_TAG.Claim, target: POOL, version: 2 });
    assert.ok(signVerify(v2Envelope().hash(), signature, PUBLIC_KEY));
    assert.ok(!signVerify(v3Envelope(GLOBAL_ID.testnet).hash(), signature, PUBLIC_KEY));
});

test('signing refuses to guess the envelope', () => {
    const sign = (opts) => () => signVoucher(voucher, SECRET, { tag: VOUCHER_TAG.Claim, target: POOL, ...opts });
    // no version, or one no contract verifies with this envelope
    assert.throws(sign({ globalId: GLOBAL_ID.testnet }), /contract version/);
    assert.throws(sign({ version: 1, globalId: GLOBAL_ID.testnet }), /contract version 1/);
    assert.throws(sign({ version: 4, globalId: GLOBAL_ID.testnet }), /contract version 4/);
    // v3 without a valid network
    assert.throws(sign({ version: 3 }), /globalId/);
    assert.throws(sign({ version: 3, globalId: null }), /globalId/);
    assert.throws(sign({ version: 3, globalId: '-3' }), /globalId/);
    assert.throws(sign({ version: 3, globalId: 2 ** 31 }), /globalId/);
    // no kind or no target
    assert.throws(() => signVoucher(voucher, SECRET, { target: POOL, version: 3, globalId: -3 }), /tag/);
    assert.throws(() => signVoucher(voucher, SECRET, { tag: VOUCHER_TAG.Claim, version: 3, globalId: -3 }), /target/);
});

test('getTonConfig signs for the global id of NEXT_PUBLIC_TON_NETWORK', () => {
    const saved = process.env.NEXT_PUBLIC_TON_NETWORK;
    try {
        process.env.NEXT_PUBLIC_TON_NETWORK = 'mainnet';
        assert.equal(getTonConfig().globalId, -239);
        process.env.NEXT_PUBLIC_TON_NETWORK = 'testnet';
        assert.equal(getTonConfig().globalId, -3);
        delete process.env.NEXT_PUBLIC_TON_NETWORK;
        assert.equal(getTonConfig().network, 'testnet');
        assert.equal(getTonConfig().globalId, -3);
        // an unknown network signs nothing rather than the wrong network
        process.env.NEXT_PUBLIC_TON_NETWORK = 'devnet';
        assert.equal(getTonConfig().globalId, null);
        process.env.NEXT_PUBLIC_TON_NETWORK = 'toString';
        assert.equal(getTonConfig().globalId, null);
    } finally {
        if (saved === undefined) delete process.env.NEXT_PUBLIC_TON_NETWORK;
        else process.env.NEXT_PUBLIC_TON_NETWORK = saved;
    }
});

// Unit tests for the protocol v3 pool messages built in src/lib/ton/vouchers.js
// (CP-1/CP-9 deposits, CP-5/CP-13 withdrawals, CP-12 admin recovery). The
// byte-for-byte match against the compiled contract bindings lives in
// ton-contracts/tests/MiniappIntegration.spec.ts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Address } = require('@ton/core');

const {
    buildDepositVoucherCell,
    buildAdminProposalVoucherCell,
    buildRegisterJettonBody,
    buildSweepUntrackedBody,
    buildWithdrawTonBody,
    buildProposeAdminBody,
    buildCancelAdminProposalBody,
    buildExecuteAdminProposalBody,
} = require('../src/lib/ton/vouchers');
const { OP, SECONDS, VOUCHER_TAG, GAS } = require('../src/lib/ton/constants');

const CHAT = -1001234567890n;
const JETTON = new Address(0, Buffer.alloc(32, 3));
const POOL_WALLET = new Address(0, Buffer.alloc(32, 4));
const WALLET = new Address(0, Buffer.alloc(32, 6));
const EXPIRY = 1n << 40n;

test('a v3 deposit voucher names no wallet; a v2 one still does', () => {
    const v3 = buildDepositVoucherCell({ chatId: CHAT, jettonMaster: JETTON, expiry: EXPIRY, version: 3 }).beginParse();
    assert.equal(v3.loadIntBig(64), CHAT);
    assert.ok(v3.loadAddress().equals(JETTON));
    assert.equal(v3.loadUintBig(64), EXPIRY);
    v3.endParse();
    // the wallet is ignored for v3 (the pool trusts only its registered one)
    const withWallet = buildDepositVoucherCell({
        chatId: CHAT,
        jettonMaster: JETTON,
        expectedJettonWallet: POOL_WALLET,
        expiry: EXPIRY,
        version: 3,
    });
    assert.ok(withWallet.equals(buildDepositVoucherCell({ chatId: CHAT, jettonMaster: JETTON, expiry: EXPIRY, version: 3 })));

    const v2 = buildDepositVoucherCell({
        chatId: CHAT,
        jettonMaster: JETTON,
        expectedJettonWallet: POOL_WALLET,
        expiry: EXPIRY,
        version: 2,
    }).beginParse();
    assert.equal(v2.loadIntBig(64), CHAT);
    assert.ok(v2.loadAddress().equals(JETTON));
    assert.ok(v2.loadAddress().equals(POOL_WALLET));
    assert.equal(v2.loadUintBig(64), EXPIRY);
    v2.endParse();
});

test('the deposit layout is never guessed', () => {
    const base = { chatId: CHAT, jettonMaster: JETTON, expectedJettonWallet: POOL_WALLET, expiry: EXPIRY };
    assert.throws(() => buildDepositVoucherCell(base), /contract version undefined/);
    assert.throws(() => buildDepositVoucherCell({ ...base, version: 1 }), /contract version 1/);
    assert.throws(() => buildDepositVoucherCell({ ...base, expectedJettonWallet: undefined, version: 2 }), /jetton wallet/);
});

test('admin recovery voucher: int64 chatId, address newAdmin, uint32 seq, uint64 expiry', () => {
    const s = buildAdminProposalVoucherCell({ chatId: CHAT, newAdmin: WALLET, seq: 7n, expiry: EXPIRY }).beginParse();
    assert.equal(s.loadIntBig(64), CHAT);
    assert.ok(s.loadAddress().equals(WALLET));
    assert.equal(s.loadUint(32), 7);
    assert.equal(s.loadUintBig(64), EXPIRY);
    s.endParse();
    assert.equal(VOUCHER_TAG.AdminProposal, 0x41505231);
});

test('v3 pool message bodies carry the contract opcodes', () => {
    const op = (cell) => cell.beginParse().loadUint(32);
    const register = buildRegisterJettonBody(JETTON).beginParse();
    assert.equal(register.loadUint(32), OP.RegisterJetton);
    assert.ok(register.loadAddress().equals(JETTON));
    register.endParse();

    const sweep = buildSweepUntrackedBody({ jettonMaster: JETTON, amount: 5n, to: WALLET }).beginParse();
    assert.equal(sweep.loadUint(32), OP.SweepUntracked);
    assert.ok(sweep.loadAddress().equals(JETTON));
    assert.equal(sweep.loadCoins(), 5n);
    assert.ok(sweep.loadAddress().equals(WALLET));
    sweep.endParse();

    const ton = buildWithdrawTonBody({ to: WALLET, amount: 9n }).beginParse();
    assert.equal(ton.loadUint(32), OP.WithdrawTon);
    assert.ok(ton.loadAddress().equals(WALLET));
    assert.equal(ton.loadCoins(), 9n);
    ton.endParse();

    const voucher = buildAdminProposalVoucherCell({ chatId: CHAT, newAdmin: WALLET, seq: 0n, expiry: EXPIRY });
    const propose = buildProposeAdminBody({ voucherCell: voucher, signature: Buffer.alloc(64, 1) }).beginParse();
    assert.equal(propose.loadUint(32), OP.ProposeAdmin);
    assert.ok(propose.loadRef().equals(voucher));
    assert.deepEqual(propose.loadBuffer(64), Buffer.alloc(64, 1));
    propose.endParse();

    assert.equal(op(buildCancelAdminProposalBody()), OP.CancelAdminProposal);
    assert.equal(op(buildExecuteAdminProposalBody()), OP.ExecuteAdminProposal);
    assert.deepEqual(
        [OP.RegisterJetton, OP.SweepUntracked, OP.WithdrawTon, OP.ProposeAdmin, OP.CancelAdminProposal, OP.ExecuteAdminProposal],
        [0x8203dc56, 0x8063d8b0, 0x317e7d2a, 0xd2eb61aa, 0xf16d1048, 0x73e50f21],
    );
});

test('claim vouchers stay within what a v3 pool accepts, and the gas covers its minimums', () => {
    assert.ok(SECONDS.claimVoucherTtl <= SECONDS.maxClaimVoucherTtl);
    assert.equal(SECONDS.maxClaimVoucherTtl, 86400);
    assert.ok(SECONDS.claimReconcileMargin >= 600);
    assert.equal(SECONDS.adminRecoveryDelay, 7 * 86400);
    // chat_pool.tact: PoolMinClaimValue + PoolClaimStorageFee, PoolMinWithdrawValue,
    // PoolRegisterJettonValue; distributor_master.tact: PoolDeployValue + CreatePoolGas
    assert.ok(BigInt(GAS.claimTon) >= 82_000_000n);
    assert.ok(BigInt(GAS.withdrawTon) >= 80_000_000n);
    assert.ok(BigInt(GAS.registerJettonTon) >= 50_000_000n);
    assert.ok(BigInt(GAS.createPoolTon) >= 200_000_000n);
    assert.equal(GAS.poolReserveTon, '150000000');
});

// Unit tests for the deposit confirmation (src/lib/ton/deposit-trace.js,
// miniapp #47): what became of ONE submitted deposit is read from the trace
// of its own message, so a claim or another top-up moving the pool's ledger
// can neither fake nor hide it. The traces are synthetic, in the shape
// toncenter v3 /traces returns them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Address, beginCell } = require('@ton/core');

const { OP } = require('../src/lib/ton/constants');
const { QUERY_REFUND, classifyDepositTrace, externalMessageHashes } = require('../src/lib/ton/deposit-trace');

const OP_EXCESSES = 0xd53276db;

function addr(n) {
    return new Address(0, Buffer.alloc(32, n));
}
const raw = (a) => a.toRawString().toUpperCase();

const POOL = addr(1);
const POOL_JETTON_WALLET = addr(2);
const ADMIN = addr(3);
const USER_JETTON_WALLET = addr(4);
const AMOUNT = 10_000_000_000n;

const expected = { pool: POOL, poolJettonWallet: POOL_JETTON_WALLET, depositor: ADMIN, amount: AMOUNT };

function notification({ amount = AMOUNT, sender = ADMIN } = {}) {
    return beginCell()
        .storeUint(OP.JettonTransferNotification, 32)
        .storeUint(0n, 64)
        .storeCoins(amount)
        .storeAddress(sender)
        .storeBit(0)
        .endCell()
        .toBoc()
        .toString('base64');
}

function transferOut(queryId) {
    return beginCell()
        .storeUint(OP.JettonTransfer, 32)
        .storeUint(queryId, 64)
        .storeCoins(AMOUNT)
        .storeAddress(ADMIN)
        .storeAddress(ADMIN)
        .storeBit(0)
        .storeCoins(0n)
        .storeBit(0)
        .endCell()
        .toBoc()
        .toString('base64');
}

const hex = (n) => `0x${n.toString(16).padStart(8, '0')}`;

function out(opcode, destination, body) {
    return { opcode: hex(opcode), destination: raw(destination), message_content: body ? { body } : {} };
}

function poolTx({ aborted = false, computeOk = true, outMsgs, body = notification(), source = POOL_JETTON_WALLET, emulated = false } = {}) {
    return {
        account: raw(POOL),
        hash: 'POOLTX',
        emulated,
        in_msg: { opcode: hex(OP.JettonTransferNotification), source: raw(source), message_content: { body } },
        description: { aborted, compute_ph: { success: computeOk }, action: { success: true } },
        out_msgs: outMsgs ?? [out(OP_EXCESSES, ADMIN)],
    };
}

function walletTx() {
    return {
        account: raw(ADMIN),
        hash: 'WALLETTX',
        in_msg: { opcode: '0x7369676e', source: null },
        description: { aborted: false, compute_ph: { success: true }, action: { success: true } },
        out_msgs: [out(OP.JettonTransfer, USER_JETTON_WALLET)],
    };
}

function traceOf(transactions, { state = 'complete' } = {}) {
    return {
        trace_id: 'T',
        is_incomplete: state !== 'complete',
        trace_info: { trace_state: state },
        transactions: Object.fromEntries(transactions.map((tx) => [tx.hash, tx])),
    };
}

test('ordinary success: the pool kept the transfer', () => {
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx()]), expected);
    assert.equal(result.outcome, 'credited');
    assert.equal(result.poolTx, 'POOLTX');
});

test('credited even when the ledger stayed flat: a concurrent claim is not this trace', () => {
    // the classifier never sees the ledger: own deposit +10 and a member claim
    // -10 leave it at 100, and the transfer is still credited
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx()]), expected);
    assert.equal(result.outcome, 'credited');
});

test('credited without the excess message back (it is sent ignoring errors)', () => {
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ outMsgs: [] })]), expected);
    assert.equal(result.outcome, 'credited');
});

test('not credited while the own transfer is not at the pool yet, whatever else moved the ledger', () => {
    // a separate earlier top-up raised the ledger by 1; this trace has no
    // pool transaction of its own yet
    const running = traceOf([walletTx()], { state: 'pending' });
    assert.equal(classifyDepositTrace(running, expected).outcome, 'pending');
});

test('RPC delay: a trace toncenter has not indexed is pending, not failed', () => {
    assert.deepEqual(classifyDepositTrace(null, expected), { outcome: 'pending', reason: 'trace-not-found' });
});

test('an emulated pool transaction is a prediction, not a credit', () => {
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ emulated: true })], { state: 'pending' }), expected);
    assert.equal(result.outcome, 'pending');
});

test('rejection: the pool sent the jettons back', () => {
    const refund = out(OP.JettonTransfer, POOL_JETTON_WALLET, transferOut(QUERY_REFUND));
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ outMsgs: [refund] })]), expected);
    assert.equal(result.outcome, 'refunded');
});

test('an outgoing transfer with another query id is not a refund', () => {
    const claimPayout = out(OP.JettonTransfer, POOL_JETTON_WALLET, transferOut(7n));
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ outMsgs: [claimPayout] })]), expected);
    assert.equal(result.outcome, 'credited');
});

test('unknown is distinct from refunded: a finished trace that never reached the pool failed', () => {
    const result = classifyDepositTrace(traceOf([walletTx()]), expected);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.reason, 'never-reached-pool');
    assert.notEqual(result.outcome, 'refunded');
});

test('a pool transaction that aborted credited nothing', () => {
    assert.equal(classifyDepositTrace(traceOf([walletTx(), poolTx({ aborted: true })]), expected).outcome, 'failed');
    assert.equal(classifyDepositTrace(traceOf([walletTx(), poolTx({ computeOk: false })]), expected).outcome, 'failed');
});

test('a notification from another jetton wallet is not the expected transfer', () => {
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ source: addr(9) })]), expected);
    assert.equal(result.outcome, 'failed');
});

test('another amount or another sender is a mismatch, never a credit', () => {
    const wrongAmount = classifyDepositTrace(traceOf([walletTx(), poolTx({ body: notification({ amount: AMOUNT + 1n }) })]), expected);
    assert.equal(wrongAmount.outcome, 'mismatch');
    const wrongSender = classifyDepositTrace(traceOf([walletTx(), poolTx({ body: notification({ sender: addr(8) }) })]), expected);
    assert.equal(wrongSender.outcome, 'mismatch');
});

test('a notification whose body is unreadable is a mismatch', () => {
    const result = classifyDepositTrace(traceOf([walletTx(), poolTx({ body: 'not a boc' })]), expected);
    assert.equal(result.outcome, 'mismatch');
});

// An external message captured from testnet toncenter (trace
// 25y8eiEs4ndhjXT8mvOZQfIIt0FE+c3cbOYVKFvSMc0=): the hash and hash_norm
// toncenter indexes it under.
test('externalMessageHashes reproduces toncenter hash and hash_norm', () => {
    const body =
        'te6cckECCAEAAVQAAZTUN35Y08OEg+w55jmJnmCzR4Wcdwoj4rS2EyV7xPADigDkXHG2VoK9cs0cugGKpet+5N4ZtckrVjskcmDyKaEJAAfMrgAAatfnNgECCK1N4I4CAwIKDsPIbQMEBQDG/wAg3SCCAUyXupYwgggHzK/gpPJggQIA1xjTHwGCCAfMr7ry4FLTLyH4I77y4E3XTAGCCAfMr6hYgvA4yMrZtPAWNqt0nIvSH4TCCrh5dGzLCOLtJeqR+3/XjfkQ8qP4AO1VAAABaGIAN17awU9eR9NeZb+HA2w0T3l95nyyeBxLGM8rA2N2MuogF9eEAAAAAAAAAAAAAAAAAAEGAaQPin6lAAAAAAAAAAAQGAH019dlHEAv5AjNafFtna68CJLFh0NWC106gC8Z5hKg+QAzKPcSSLeqjIWCYOZboSCtfF5ESVSlD3joKwNDkSaE4GICBwABYLtHuSU=';
    const dest = Address.parse('0:CCA3DC4922DEAA32160983996E8482B5F179112552943DE3A0AC0D0E449A1381');
    const { Cell, storeMessage } = require('@ton/core');
    const message = beginCell()
        .store(storeMessage({ info: { type: 'external-in', dest, importFee: 0n }, body: Cell.fromBase64(body) }))
        .endCell()
        .toBoc()
        .toString('base64');
    const hashes = externalMessageHashes(message);
    assert.equal(hashes.raw, 'D2R/VZjO6YuiKbP0K2MTenPxF94V9evYLYJOP2VSalk=');
    assert.equal(hashes.normalized, 'L+/I7Sd4vXGndGqIf0hHunsBCCoFo4FdhzQYU8bTDjc=');
});

test('externalMessageHashes refuses what is not an external message', () => {
    const internal = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64');
    assert.throws(() => externalMessageHashes(internal));
    assert.throws(() => externalMessageHashes('not a boc'));
});

const { Address, Cell, beginCell, loadMessage, storeMessage } = require('@ton/core');
const { getTonConfig } = require('./config');
const { OP } = require('./constants');

// What happened to ONE submitted deposit, read from the transaction trace the
// wallet's own message started (toncenter v3 /traces), not from the pool's
// ledger moving: claims and other top-ups move the ledger too, so aggregate
// growth neither proves nor disproves this transfer (miniapp #47).
//
// A deposit is a chain of messages: wallet -> jetton wallet -> pool's jetton
// wallet -> pool (transfer_notification). The pool then either credits it (no
// refund message out) or refunds it with query id QueryRefund
// (ton-contracts/contracts/chat_pool.tact refundDeposit).

const OP_EXCESSES = 0xd53276db;
const QUERY_REFUND = 0x8000000000000003n; // chat_pool.tact QueryRefund

// 'pending'  the trace is not there yet or still running
// 'credited' the pool processed the notification of this transfer and kept it
// 'refunded' the pool sent the jettons back
// 'failed'   the trace is complete and the pool never credited or refunded
// 'mismatch' a notification reached the pool but is not the expected transfer
const OUTCOMES = ['pending', 'credited', 'refunded', 'failed', 'mismatch'];

// The two hashes toncenter knows an external message by: `hash` of the
// message as the wallet sent it and `hash_norm`, the normalized form (body
// in a reference, no import fee) that stays the same however the wallet
// packed it. The BOC TonConnect returns is that very message.
function externalMessageHashes(boc) {
    const cell = Cell.fromBase64(boc);
    const message = loadMessage(cell.beginParse());
    if (message.info.type !== 'external-in') {
        throw new Error('the BOC is not an external message');
    }
    const normalized = beginCell()
        .store(
            storeMessage(
                { info: { type: 'external-in', dest: message.info.dest, importFee: 0n }, body: message.body },
                { forceRef: true },
            ),
        )
        .endCell();
    return { normalized: normalized.hash().toString('base64'), raw: cell.hash().toString('base64') };
}

function sameAddress(a, b) {
    if (!a || !b) return false;
    try {
        return Address.parse(String(a)).equals(Address.parse(String(b)));
    } catch {
        return false;
    }
}

function bodyOf(message) {
    const body = message?.message_content?.body;
    if (!body) return null;
    try {
        return Cell.fromBase64(body).beginParse();
    } catch {
        return null;
    }
}

// transfer_notification#7362d09c query_id:uint64 amount:Coins sender:Address
function parseNotification(message) {
    const s = bodyOf(message);
    if (!s || s.remainingBits < 32 + 64) return null;
    try {
        if (s.loadUint(32) !== OP.JettonTransferNotification) return null;
        const queryId = s.loadUintBig(64);
        const amount = s.loadCoins();
        const sender = s.loadAddress();
        return { queryId, amount, sender };
    } catch {
        return null;
    }
}

function opcodeOf(message) {
    const raw = message?.opcode;
    if (raw === null || raw === undefined) return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n >>> 0 : null;
}

// transfer#0f8a7ea5 query_id:uint64 ... the refund the pool sends back
function isRefund(message) {
    if (opcodeOf(message) !== OP.JettonTransfer) return false;
    const s = bodyOf(message);
    if (!s || s.remainingBits < 32 + 64) return false;
    try {
        s.loadUint(32);
        return s.loadUintBig(64) === QUERY_REFUND;
    } catch {
        return false;
    }
}

function succeeded(tx) {
    const d = tx?.description;
    if (!d || d.aborted) return false;
    if (d.compute_ph && d.compute_ph.success === false) return false;
    if (d.action && d.action.success === false) return false;
    return Boolean(d.compute_ph && d.compute_ph.success === true);
}

function traceRunning(trace) {
    const state = trace?.trace_info?.trace_state;
    return trace?.is_incomplete === true || (state !== undefined && state !== 'complete');
}

// `trace`: one toncenter v3 trace (null when it is not indexed yet).
// `expected`: { pool, poolJettonWallet, depositor, amount (bigint) } as read
// from the chain, never from the trace.
function classifyDepositTrace(trace, expected) {
    if (!trace || !trace.transactions) return { outcome: 'pending', reason: 'trace-not-found' };

    const txs = Object.values(trace.transactions);
    // an emulated transaction is toncenter's prediction, not a block yet
    const final = txs.filter((tx) => tx.emulated !== true);

    const poolTx = final.find(
        (tx) =>
            sameAddress(tx.account, expected.pool) &&
            opcodeOf(tx.in_msg) === OP.JettonTransferNotification &&
            sameAddress(tx.in_msg?.source, expected.poolJettonWallet),
    );

    if (!poolTx) {
        if (traceRunning(trace) || final.length < txs.length) return { outcome: 'pending', reason: 'trace-running' };
        return { outcome: 'failed', reason: 'never-reached-pool' };
    }

    const note = parseNotification(poolTx.in_msg);
    if (!note) return { outcome: 'mismatch', reason: 'unreadable-notification', poolTx: poolTx.hash };
    if (note.amount !== expected.amount || !sameAddress(note.sender, expected.depositor)) {
        return { outcome: 'mismatch', reason: 'other-transfer', poolTx: poolTx.hash };
    }

    if (!succeeded(poolTx)) return { outcome: 'failed', reason: 'pool-aborted', poolTx: poolTx.hash };

    const out = poolTx.out_msgs || [];
    if (out.some(isRefund)) return { outcome: 'refunded', reason: 'pool-refunded', poolTx: poolTx.hash };

    // The pool's excess message back to the depositor corroborates a credit
    // but is sent ignoring errors, so only the refund's absence is required.
    const excess = out.some((m) => opcodeOf(m) === OP_EXCESSES && sameAddress(m.destination, expected.depositor));
    return { outcome: 'credited', reason: excess ? 'credited-with-excess' : 'credited', poolTx: poolTx.hash };
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// The trace that contains the external message with this hash (raw or
// normalized), or null when toncenter has not indexed it yet.
async function fetchTraceByMessage(hash) {
    const cfg = getTonConfig();
    const url = new URL(`${cfg.toncenterBase}/api/v3/traces`);
    url.searchParams.set('msg_hash', hash);
    url.searchParams.set('include_actions', 'false');
    url.searchParams.set('limit', '1');
    const headers = cfg.toncenterApiKey ? { 'X-API-Key': cfg.toncenterApiKey } : {};

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(1000 * attempt);
        let response;
        try {
            response = await fetch(url, { headers, cache: 'no-store' });
        } catch (e) {
            lastError = e;
            continue;
        }
        if (response.status === 429) {
            lastError = new Error('toncenter rate limit');
            continue;
        }
        if (response.status === 404) return null;
        const body = await response.json().catch(() => null);
        if (body && body.ok === false && body.code === 429) {
            lastError = new Error('toncenter rate limit');
            continue;
        }
        if (!response.ok) {
            lastError = new Error(`toncenter traces failed: HTTP ${response.status}`);
            continue;
        }
        return body?.traces?.[0] ?? null;
    }
    throw lastError || new Error('toncenter traces failed');
}

// Looks the submitted message up under both of its hashes
// (externalMessageHashes).
async function findDepositTrace(hashes) {
    const first = await fetchTraceByMessage(hashes.normalized);
    if (first) return first;
    return fetchTraceByMessage(hashes.raw);
}

module.exports = {
    OUTCOMES,
    QUERY_REFUND,
    classifyDepositTrace,
    externalMessageHashes,
    fetchTraceByMessage,
    findDepositTrace,
};

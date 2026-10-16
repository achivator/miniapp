// Integration tests for the protocol v3 pool flows against MongoDB:
// deposit vouchers only for the pool admin wallet and only through a
// registered jetton wallet (CP-9, CP-1), the v2 layout for legacy pools, the
// admin's v3 transactions (RegisterJetton, SweepUntracked, WithdrawTon,
// recovery cancel/execute), the admin recovery route (CP-12) and what
// pool-status shows for them. Envelopes are rebuilt here byte by byte:
// uint32 tag, [int32 globalId for v3], address target, ref(voucher).
const h = require('./helpers');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Address, Cell, beginCell } = require('@ton/core');
const { keyPairFromSeed, signVerify } = require('@ton/crypto');

const { itest, seed, chain, telegram, callApi, getCollection, address } = h;
const { GLOBAL_ID, OP, VOUCHER_TAG, GAS, SECONDS } = require(path.join(h.SRC, 'lib/ton/constants.js'));

h.setupIntegration();

const CHAT = -1008888888888;
const CREATOR = 111;
const ALICE = 222;
const JETTON = address('jetton');
const CREATOR_WALLET = address('creator-wallet');
const OTHER_WALLET = address('other-wallet');
const RECOVERY_WALLET = address('recovery-wallet');

const nowSec = () => Math.floor(Date.now() / 1000);
const backendPublicKey = () => keyPairFromSeed(Buffer.from(process.env.BACKEND_SECRET, 'hex')).publicKey;
const raw = (a) => Address.parse(String(a)).toRawString();
// what the fake jetton master answers for the pool's wallet
const poolJettonWallet = (pool) => address(`jetton-wallet:${raw(JETTON)}:${raw(pool.address)}`);

function envelope(tag, pool, voucher, version) {
    const b = beginCell().storeUint(tag, 32);
    if (version === 3) b.storeInt(GLOBAL_ID.testnet, 32);
    return b.storeAddress(pool.address).storeRef(voucher).endCell();
}
const signedFor = (tag, pool, voucher, signature, version) =>
    signVerify(envelope(tag, pool, voucher, version).hash(), signature, backendPublicKey());

async function seedPool(opts = {}) {
    chain.addJetton(JETTON, { decimals: 9, symbol: 'TST' });
    const pool = chain.addPool(CHAT, { admin: CREATOR_WALLET, ...opts });
    await seed.chat({ id: CHAT, creator: CREATOR, jetton_master: JETTON });
    return pool;
}

const deposit = (wallet = CREATOR_WALLET, user = CREATOR) =>
    callApi('deposit-voucher', { method: 'POST', user, body: { chatId: CHAT, wallet, amount: '10' } });

// JettonTransfer body -> { voucher, signature } of its ref-wrapped deposit payload
function depositPayload(res) {
    const s = Cell.fromBase64(res.body.payload_b64).beginParse();
    assert.equal(s.loadUint(32), OP.JettonTransfer);
    s.loadUintBig(64);
    s.loadCoins();
    s.loadAddress();
    s.loadAddress();
    assert.equal(s.loadBit(), false);
    s.loadCoins();
    assert.equal(s.loadBit(), true, 'ref-wrapped forward payload');
    const inner = s.loadRef().beginParse();
    return { voucher: inner.loadRef(), signature: inner.loadBuffer(64) };
}

// ---- deposits ----

itest('deposit vouchers go to the pool admin wallet only', async () => {
    const pool = await seedPool({ jettonWallet: null });
    pool.jettonWallet = Address.parse(poolJettonWallet(pool));

    const other = await deposit(OTHER_WALLET);
    assert.equal(other.status, 409, JSON.stringify(other.body));
    assert.match(other.body.error, /only the pool admin wallet/);
    assert.ok(Address.parse(other.body.admin).equals(Address.parse(CREATOR_WALLET)));

    pool.admin = null;
    const noAdmin = await deposit();
    assert.equal(noAdmin.status, 409);
    assert.match(noAdmin.body.error, /admin wallet first/);

    // and only for the chat creator
    pool.admin = Address.parse(CREATOR_WALLET);
    const notCreator = await deposit(CREATOR_WALLET, ALICE);
    assert.equal(notCreator.status, 403);
});

itest('a v3 pool registers its jetton first: the route hands out RegisterJetton', async () => {
    const pool = await seedPool();
    const res = await deposit();
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /register this jetton/);
    const tx = res.body.register_jetton;
    assert.equal(tx.to, pool.address.toString());
    assert.equal(tx.amount, GAS.registerJettonTon);
    const body = Cell.fromBase64(tx.payload_b64).beginParse();
    assert.equal(body.loadUint(32), OP.RegisterJetton);
    assert.ok(body.loadAddress().equals(Address.parse(JETTON)));

    // a registered wallet the jetton master does not confirm is refused
    pool.jettonWallet = Address.parse(OTHER_WALLET);
    const mismatch = await deposit();
    assert.equal(mismatch.status, 409);
    assert.match(mismatch.body.error, /does not match/);
});

itest('a v3 deposit voucher names no wallet and is signed for the network', async () => {
    const pool = await seedPool();
    pool.jettonWallet = Address.parse(poolJettonWallet(pool));
    const res = await deposit();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.pool_jetton_wallet, Address.parse(poolJettonWallet(pool)).toString());
    const { voucher, signature } = depositPayload(res);
    const v = voucher.beginParse();
    assert.equal(Number(v.loadIntBig(64)), CHAT);
    assert.ok(v.loadAddress().equals(Address.parse(JETTON)));
    assert.equal(Number(v.loadUintBig(64)), res.body.expiry);
    v.endParse();
    assert.ok(signedFor(VOUCHER_TAG.Deposit, pool, voucher, signature, 3));
    assert.ok(!signedFor(VOUCHER_TAG.Deposit, pool, voucher, signature, 2));
});

itest('a legacy v2 pool still gets the v2 deposit voucher (with the wallet) in the v2 envelope', async () => {
    const pool = await seedPool({ version: 2 });
    const res = await deposit();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { voucher, signature } = depositPayload(res);
    const v = voucher.beginParse();
    assert.equal(Number(v.loadIntBig(64)), CHAT);
    assert.ok(v.loadAddress().equals(Address.parse(JETTON)));
    assert.ok(v.loadAddress().equals(Address.parse(poolJettonWallet(pool))));
    v.loadUintBig(64);
    v.endParse();
    assert.ok(signedFor(VOUCHER_TAG.Deposit, pool, voucher, signature, 2));
    // v2 pools have no registration to ask about
    assert.ok(!chain.calls.some((c) => c.name === 'runGetMethod' && c.args[1] === 'jettonWallet'));
});

// ---- the admin's v3 transactions ----

const adminTx = (body) => callApi('pool-admin-tx', { method: 'POST', user: CREATOR, body: { chatId: CHAT, ...body } });
const opOf = (res) => Cell.fromBase64(res.body.payload_b64).beginParse().loadUint(32);

itest("the admin's v3 transactions: register, sweep, TON, recovery cancel / execute", async () => {
    const pool = await seedPool();
    const register = await adminTx({ action: 'register' });
    assert.equal(register.status, 200, JSON.stringify(register.body));
    assert.equal(opOf(register), OP.RegisterJetton);
    assert.equal(register.body.amount, GAS.registerJettonTon);

    const sweep = await adminTx({ action: 'sweep', amount: '1.5', to: CREATOR_WALLET });
    assert.equal(sweep.status, 200, JSON.stringify(sweep.body));
    const s = Cell.fromBase64(sweep.body.payload_b64).beginParse();
    assert.equal(s.loadUint(32), OP.SweepUntracked);
    assert.ok(s.loadAddress().equals(Address.parse(JETTON)));
    assert.equal(s.loadCoins(), 1_500_000_000n);

    const ton = await adminTx({ action: 'withdraw_ton', amount: '0.25', to: CREATOR_WALLET });
    assert.equal(ton.status, 200, JSON.stringify(ton.body));
    const t = Cell.fromBase64(ton.body.payload_b64).beginParse();
    assert.equal(t.loadUint(32), OP.WithdrawTon);
    assert.ok(t.loadAddress().equals(Address.parse(CREATOR_WALLET)));
    assert.equal(t.loadCoins(), 250_000_000n);

    assert.equal(opOf(await adminTx({ action: 'cancel_proposal' })), OP.CancelAdminProposal);
    assert.equal(opOf(await adminTx({ action: 'execute_proposal' })), OP.ExecuteAdminProposal);

    // a v2 pool has none of them; its withdraw still works
    pool.version = 2;
    for (const action of ['register', 'sweep', 'withdraw_ton', 'cancel_proposal', 'execute_proposal']) {
        const res = await adminTx({ action, amount: '1', to: CREATOR_WALLET });
        assert.equal(res.status, 409, action);
    }
    const withdraw = await adminTx({ action: 'withdraw', amount: '1', to: CREATOR_WALLET });
    assert.equal(withdraw.status, 200);
    assert.equal(opOf(withdraw), OP.WithdrawRemainder);
});

// ---- admin recovery ----

const recover = (body, user = ALICE) => callApi('admin-recovery', { method: 'POST', user, body: { chatId: CHAT, ...body } });

itest('only a chat administrator or the creator, as Telegram says now, can start a recovery', async () => {
    await seedPool();
    for (const status of [null, 'member', 'left', 'kicked', 'restricted']) {
        if (status) telegram.setStatus(CHAT, ALICE, status);
        const res = await recover({ wallet: RECOVERY_WALLET });
        assert.equal(res.status, 403, `${status}: ${JSON.stringify(res.body)}`);
    }
    assert.equal(await (await getCollection('admin_proposals')).countDocuments({}), 0);
    for (const status of ['administrator', 'creator']) {
        telegram.setStatus(CHAT, ALICE, status);
        const res = await recover({ wallet: RECOVERY_WALLET });
        assert.equal(res.status, 200, `${status}: ${JSON.stringify(res.body)}`);
    }
});

itest('the recovery voucher names the wallet and the pool seq, signed as APR1 for the network', async () => {
    const pool = await seedPool();
    pool.proposalSeq = 5n;
    telegram.setStatus(CHAT, ALICE, 'administrator');
    const res = await recover({ wallet: RECOVERY_WALLET });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.to, pool.address.toString());
    assert.equal(res.body.amount, GAS.proposeAdminTon);
    assert.equal(res.body.timelock_seconds, 7 * 86400);
    const body = Cell.fromBase64(res.body.payload_b64).beginParse();
    assert.equal(body.loadUint(32), OP.ProposeAdmin);
    const voucher = body.loadRef();
    const signature = body.loadBuffer(64);
    const v = voucher.beginParse();
    assert.equal(Number(v.loadIntBig(64)), CHAT);
    assert.ok(v.loadAddress().equals(Address.parse(RECOVERY_WALLET)));
    assert.equal(v.loadUint(32), 5);
    const expiry = Number(v.loadUintBig(64));
    v.endParse();
    assert.equal(expiry, res.body.expiry);
    assert.ok(expiry - nowSec() <= SECONDS.adminProposalVoucherTtl);
    assert.ok(signedFor(VOUCHER_TAG.AdminProposal, pool, voucher, signature, 3));
    assert.ok(!signedFor(VOUCHER_TAG.Admin, pool, voucher, signature, 3), 'not an ADM1 voucher');

    const [doc] = await (await getCollection('admin_proposals')).find({}).toArray();
    assert.deepEqual(
        [doc.chat_id, doc.user_id, doc.role, doc.wallet, doc.seq],
        [CHAT, ALICE, 'administrator', Address.parse(RECOVERY_WALLET).toString(), 5],
    );
});

itest('recovery refusals: v2 pool, no admin yet, already the admin, one already pending', async () => {
    const pool = await seedPool();
    telegram.setStatus(CHAT, ALICE, 'administrator');

    pool.version = 2;
    assert.equal((await recover({ wallet: RECOVERY_WALLET })).status, 409);
    pool.version = 3;

    pool.admin = null;
    const noAdmin = await recover({ wallet: RECOVERY_WALLET });
    assert.equal(noAdmin.status, 409);
    assert.match(noAdmin.body.error, /no admin yet/);
    pool.admin = Address.parse(CREATOR_WALLET);

    const same = await recover({ wallet: CREATOR_WALLET });
    assert.equal(same.status, 409);
    assert.match(same.body.error, /already is the pool admin/);

    pool.proposal = { admin: Address.parse(OTHER_WALLET), executableAt: nowSec() + 86400 };
    const pending = await recover({ wallet: RECOVERY_WALLET });
    assert.equal(pending.status, 409);
    assert.match(pending.body.error, /already pending/);
    assert.equal(pending.body.pending_admin, Address.parse(OTHER_WALLET).toString());
    assert.equal(await (await getCollection('admin_proposals')).countDocuments({}), 0);
});

itest('a recovery is executed only once its timelock is over', async () => {
    const pool = await seedPool();
    telegram.setStatus(CHAT, ALICE, 'administrator');
    const none = await recover({ action: 'execute' });
    assert.equal(none.status, 409);
    assert.match(none.body.error, /no admin recovery/);

    pool.proposal = { admin: Address.parse(RECOVERY_WALLET), executableAt: nowSec() + 3600 };
    const early = await recover({ action: 'execute' });
    assert.equal(early.status, 409);
    assert.match(early.body.error, /timelock/);
    assert.equal(early.body.executable_at, pool.proposal.executableAt);

    pool.proposal.executableAt = nowSec() - 1;
    const ready = await recover({ action: 'execute' });
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    assert.equal(opOf(ready), OP.ExecuteAdminProposal);
    assert.equal(ready.body.to, pool.address.toString());
});

// ---- pool-status ----

itest('pool-status shows a v3 pool its jetton registration and recovery state', async () => {
    const pool = await seedPool();
    const status = () => callApi('pool-status', { user: CREATOR, query: { chatId: CHAT } });

    let res = await status();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.jetton_registration, { wallet: null, pending: false });
    assert.deepEqual(res.body.admin_proposal, { pending_admin: null, executable_at: null });
    assert.equal(res.body.register_jetton_ton, GAS.registerJettonTon);

    pool.pendingRegistration = 3n;
    pool.proposal = { admin: Address.parse(RECOVERY_WALLET), executableAt: 1_900_000_000 };
    res = await status();
    assert.deepEqual(res.body.jetton_registration, { wallet: null, pending: true });
    assert.deepEqual(res.body.admin_proposal, {
        pending_admin: Address.parse(RECOVERY_WALLET).toString(),
        executable_at: 1_900_000_000,
    });

    pool.jettonWallet = Address.parse(poolJettonWallet(pool));
    res = await status();
    assert.equal(res.body.jetton_registration.wallet, Address.parse(poolJettonWallet(pool)).toString());

    pool.version = 2;
    res = await status();
    assert.equal(res.body.jetton_registration, null);
    assert.equal(res.body.admin_proposal, null);
});

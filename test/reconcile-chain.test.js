// Unit tests for how lib/rewards.js reads a claim's fate from the chain
// (CP-10): v3 pools keep a nonce burnt (nonceState 0/1/2/3), v2 pools only
// say isNonceUsed. The chain is a stub of lib/ton/rpc.js exports, installed
// before lib/rewards.js is first required.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Address } = require('@ton/core');

const rpc = require('../src/lib/ton/rpc');

const POOL = new Address(0, Buffer.alloc(32, 5)).toString();
const OTHER = new Address(0, Buffer.alloc(32, 6)).toString();
const chain = { pools: new Map(), asked: [] }; // address -> { version, active, states: Map, used: Set }

rpc.getAddressInformation = async (addr) => ({ state: chain.pools.get(String(addr))?.active ? 'active' : 'uninitialized', balance: 0n });
rpc.fetchContractVersion = async (addr) => chain.pools.get(String(addr)).version;
rpc.fetchPoolAddress = async () => null;
rpc.runGetMethod = async (addr, method, stack) => {
    const pool = chain.pools.get(String(addr));
    const nonce = Number(BigInt(stack[0][1]));
    chain.asked.push(method);
    if (method === 'nonceState') return [['num', String(pool.states.get(nonce) ?? 0)]];
    if (method === 'isNonceUsed') return [['num', pool.used.has(nonce) ? '-0x1' : '0x0']];
    throw new Error(`unexpected getter ${method}`);
};

const { claimChainState, isClaimPaid } = require('../src/lib/rewards');

function pool(addr, { version = 3, active = true, states = {}, used = [] } = {}) {
    chain.pools.set(addr, { version, active, states: new Map(Object.entries(states).map(([k, v]) => [Number(k), v])), used: new Set(used) });
}
const claim = (nonce, pools = [POOL]) => ({ nonce, chat_id: -1, pool_address: pools.length === 1 ? pools[0] : undefined });

beforeEach(() => {
    chain.pools.clear();
    chain.asked.length = 0;
});

test('v3: used is paid; unused and bounced are unpaid (released, reissued under a new nonce)', async () => {
    pool(POOL, { states: { 1: 1, 2: 2 } });
    assert.equal(await claimChainState(claim(1)), 'paid');
    assert.equal(await claimChainState(claim(2)), 'unpaid');
    assert.equal(await claimChainState(claim(3)), 'unpaid');
    assert.equal(await isClaimPaid(claim(1)), true);
    assert.equal(await isClaimPaid(claim(2)), false);
    assert.deepEqual([...new Set(chain.asked)], ['nonceState']);
});

test('v3: a retired nonce is unknown, never released', async () => {
    pool(POOL, { states: { 4: 3 } });
    assert.equal(await claimChainState(claim(4)), 'unknown');
    assert.equal(await isClaimPaid(claim(4)), false);
});

test('v2: isNonceUsed decides', async () => {
    pool(POOL, { version: 2, used: [5] });
    assert.equal(await claimChainState(claim(5)), 'paid');
    assert.equal(await claimChainState(claim(6)), 'unpaid');
    assert.deepEqual([...new Set(chain.asked)], ['isNonceUsed']);
});

test('no deployed pool to ask: the claim cannot be settled', async () => {
    pool(POOL, { active: false });
    await assert.rejects(claimChainState(claim(1)), /no deployed pool/);
});

// Unit tests for the pure parts of the pool admin's member views: how claims
// are bucketed into paid / pending / unconfirmed / released and summed.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { claimState, summarizeClaims, serializeSummary, displayName } = require('../src/lib/pool-members');

const JETTON = 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA';
const OTHER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const NOW = 1_800_000_000;

const claim = (over) => ({ points: 100, amount: '1000000000', jetton_master: JETTON, status: 'issued', expiry: NOW + 60, ...over });

test('claimState maps stored status and expiry to what the admin sees', () => {
    assert.equal(claimState(claim({ status: 'claimed' }), NOW), 'paid');
    assert.equal(claimState(claim({ status: 'expired' }), NOW), 'expired');
    assert.equal(claimState(claim({ expiry: NOW + 1 }), NOW), 'pending');
    // lapsed but not reconciled: may still have been used on-chain
    assert.equal(claimState(claim({ expiry: NOW }), NOW), 'unconfirmed');
});

test('summarizeClaims buckets points and sums units of the current jetton', () => {
    const s = summarizeClaims(
        [
            claim({ status: 'claimed' }),
            claim({ status: 'claimed', points: 50, amount: '500000000' }),
            claim({}),
            claim({ expiry: NOW - 1, points: 7, amount: '70000000' }),
            claim({ status: 'expired', points: 30, amount: '300000000' }),
        ],
        JETTON,
        NOW,
    );
    assert.deepEqual(serializeSummary(s), {
        paid: { count: 2, points: 150, units: '1500000000' },
        pending: { count: 1, points: 100, units: '1000000000' },
        unconfirmed: { count: 1, points: 7, units: '70000000' },
        expired: { count: 1, points: 30, units: '300000000' },
        other_jetton: false,
    });
});

test('payouts in a previous jetton count as points but never add units', () => {
    const s = summarizeClaims([claim({ status: 'claimed', jetton_master: OTHER })], JETTON, NOW);
    assert.equal(s.paid.points, 100);
    assert.equal(s.paid.units, 0n);
    assert.equal(s.other_jetton, true);
});

test('same jetton in another address form still matches', () => {
    // raw form of JETTON's workchain:hash
    const { Address } = require('@ton/core');
    const raw = Address.parse(JETTON).toRawString();
    const s = summarizeClaims([claim({ status: 'claimed', jetton_master: raw })], JETTON, NOW);
    assert.equal(s.paid.units, 1000000000n);
    assert.equal(s.other_jetton, false);
});

test('a chat without a jetton sums no units', () => {
    const s = summarizeClaims([claim({ status: 'claimed' })], null, NOW);
    assert.equal(s.paid.units, 0n);
});

test('displayName prefers the full name, then the username', () => {
    assert.equal(displayName({ first_name: 'Ada', last_name: 'Lovelace', username: 'ada' }), 'Ada Lovelace');
    assert.equal(displayName({ first_name: 'Ada' }), 'Ada');
    assert.equal(displayName({ username: 'ada' }), '@ada');
    assert.equal(displayName({}), null);
    assert.equal(displayName(null), null);
});

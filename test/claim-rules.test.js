// Unit tests for what the claim rules may not do while a price decrease is
// pending (claimRulesConflict, the claim-settings route's 409): members were
// told to claim at the current price first, so claims cannot be paused and
// the rules must leave a full claim day before the decrease. Pure, no Mongo
// (lib/mongo.js only connects when a query runs).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CLAIM_RULES_CONFLICT, claimRulesConflict, normalizeClaimSettings } = require('../src/lib/claim-rules');

process.env.JETTONS_PER_POINT = '0.01';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Monday 5 Oct 2026, 00:00 UTC
const MON = Date.UTC(2026, 9, 5);
const utc = (days, hours = 0) => new Date(MON + days * DAY_MS + hours * HOUR_MS);
const sec = (date) => Math.floor(date.getTime() / 1000);
const rules = (extra = {}) => normalizeClaimSettings({ maturation_days: 3, ...extra });

function chatWith(effectiveAt, claimSettings = {}) {
    return {
        id: 5,
        point_price: '0.02',
        claim_settings: claimSettings,
        point_price_pending: {
            price: '0.015',
            to_default: false,
            from: '0.02',
            symbol: 'PTS',
            effective_at: effectiveAt,
            requested_at: utc(-2),
            by: 42,
            maturation_days: 3,
        },
    };
}

test('no pending decrease: any rules may be saved', () => {
    const chat = { id: 5, point_price: '0.02' };
    assert.equal(claimRulesConflict(rules(), rules({ paused: true }), chat, utc(1)), null);
    assert.equal(claimRulesConflict(rules(), rules({ claim_days: [0] }), chat, utc(1)), null);
    // a decrease already in effect protects nothing any more
    assert.equal(claimRulesConflict(rules(), rules({ paused: true }), chatWith(utc(0)), utc(1)), null);
    // a malformed pending is not a decrease anyone was told about
    const malformed = { ...chatWith(utc(5)), point_price_pending: { price: 'junk' } };
    assert.equal(claimRulesConflict(rules(), rules({ paused: true }), malformed, utc(1)), null);
});

test('pausing claims while a decrease is pending: 409 pause', () => {
    const now = utc(1, 10);
    const chat = chatWith(utc(4, 10));
    for (const next of [
        rules({ paused: true }),
        rules({ paused: true, paused_until: sec(utc(2)) }),
        // even one that ends before the decrease
        rules({ paused: true, paused_until: sec(utc(1, 12)) }),
    ]) {
        const conflict = claimRulesConflict(rules(), next, chat, now);
        assert.equal(conflict.code, 'pause');
        assert.equal(conflict.error, CLAIM_RULES_CONFLICT.pause);
        assert.deepEqual(conflict.effective_at, utc(4, 10));
    }
    // a pause whose date already passed is no pause
    assert.equal(claimRulesConflict(rules(), rules({ paused: true, paused_until: sec(utc(1)) }), chat, now), null);
});

test('a pause saved before the decrease can be lifted or shortened, not lengthened', () => {
    const now = utc(1, 10);
    const chat = chatWith(utc(8));
    const current = rules({ paused: true, paused_until: sec(utc(3)) });
    assert.equal(claimRulesConflict(current, rules(), chat, now), null);
    assert.equal(claimRulesConflict(current, rules({ paused: true, paused_until: sec(utc(2)) }), chat, now), null);
    // unchanged, while saving another maturation
    assert.equal(claimRulesConflict(current, { ...current, maturation_days: 7 }, chat, now), null);
    assert.equal(claimRulesConflict(current, rules({ paused: true, paused_until: sec(utc(4)) }), chat, now).code, 'pause');
    assert.equal(claimRulesConflict(current, rules({ paused: true }), chat, now).code, 'pause');
});

test('claim days that leave no full claim day before the decrease: 409 no_window', () => {
    const now = utc(1, 10); // Tuesday
    const chat = chatWith(utc(4, 10)); // Friday 10:00
    // Mondays only: nothing before Friday
    const conflict = claimRulesConflict(rules(), rules({ claim_days: [1] }), chat, now);
    assert.equal(conflict.code, 'no_window');
    assert.equal(conflict.error, CLAIM_RULES_CONFLICT.no_window);
    // Thursdays only: Thursday is a full day before Friday 10:00
    assert.equal(claimRulesConflict(rules(), rules({ claim_days: [4] }), chat, now), null);
    // Fridays only: only 10 hours of Friday before the decrease
    assert.equal(claimRulesConflict(rules(), rules({ claim_days: [5] }), chat, now).code, 'no_window');
});

test('rules that do not narrow claims before the decrease are fine even without a full day left', () => {
    // two hours left: no full claim day under any rules
    const now = utc(3, 8);
    const chat = chatWith(utc(3, 10));
    // another maturation, same days
    assert.equal(claimRulesConflict(rules(), rules({ maturation_days: 7 }), chat, now), null);
    // opening more days
    assert.equal(claimRulesConflict(rules({ claim_days: [1] }), rules({ claim_days: [1, 3] }), chat, now), null);
    // closing a day outside what is left (Thursday is today)
    assert.equal(claimRulesConflict(rules({ claim_days: [1, 4] }), rules({ claim_days: [4] }), chat, now), null);
    // closing today, the last open time before the decrease
    assert.equal(claimRulesConflict(rules({ claim_days: [4] }), rules({ claim_days: [1] }), chat, now).code, 'no_window');
});

// Unit tests for the "can everyone claim before the decrease?" check the
// point price card shows: budget days, capacity under the default and an
// explicit daily limit, and the suggested limit. Pure functions.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    budgetDays,
    defaultDailyBudget,
    readableCeil,
    payoutCoverage,
    serializeCoverage,
} = require('../src/lib/payout-coverage');

const DAY_MS = 86400 * 1000;
const MIDNIGHT = Date.UTC(2026, 8, 1);
const U = 10n ** 9n;

test('budgetDays counts the fresh UTC-day budgets before the decrease', () => {
    const now = MIDNIGHT + 15 * 3600 * 1000; // 15:00 UTC
    assert.equal(budgetDays(now, now + 7 * DAY_MS), 7);
    // applying exactly at a midnight: that day's budget comes too late
    assert.equal(budgetDays(now, MIDNIGHT + 7 * DAY_MS), 6);
    assert.equal(budgetDays(now, MIDNIGHT + 7 * DAY_MS + 1), 7);
    // same day, or already due: no fresh budget
    assert.equal(budgetDays(now, now), 0);
    assert.equal(budgetDays(now, now + 3600 * 1000), 0);
    assert.equal(budgetDays(now, now - DAY_MS), 0);
    // requested exactly at midnight: today's budget is not counted
    assert.equal(budgetDays(MIDNIGHT, MIDNIGHT + 7 * DAY_MS), 6);
});

test('defaultDailyBudget is 10% of the balance, floored like the contract', () => {
    assert.equal(defaultDailyBudget(1000n), 100n);
    assert.equal(defaultDailyBudget(1009n), 100n);
    assert.equal(defaultDailyBudget(9n), 0n);
    assert.equal(defaultDailyBudget(0n), 0n);
    assert.equal(defaultDailyBudget(-5n), 0n);
});

test('readableCeil rounds up to two significant digits', () => {
    assert.equal(readableCeil(0n), 0n);
    assert.equal(readableCeil(7n), 7n);
    assert.equal(readableCeil(99n), 99n);
    assert.equal(readableCeil(100n), 100n);
    assert.equal(readableCeil(101n), 110n);
    assert.equal(readableCeil(1_234_500_000_000n), 1_300_000_000_000n);
    assert.equal(readableCeil(1_300_000_000_000n), 1_300_000_000_000n);
    assert.equal(readableCeil(37_200_001n), 38_000_000n);
});

test('default limit: capacity shrinks as the balance drains (pessimistic)', () => {
    const c = payoutCoverage({ debt: 600n * U, poolBalance: 1000n * U, limit: 0n, days: 7 });
    assert.equal(c.daily_limit_is_default, true);
    assert.equal(c.daily_limit, 100n * U);
    // 100 + 90 + 81 + 72.9 + 65.61 + 59.049 + 53.1441 = 521.7031, not 700
    assert.equal(c.capacity, 521_703_100_000n);
    assert.equal(c.enough_balance, true);
    assert.equal(c.enough_limit, false);
    // 600 / 7 = 85.71.. -> 86 -> never below today's 100
    assert.equal(c.suggested_daily_limit, 100n * U);

    const big = payoutCoverage({ debt: 900n * U, poolBalance: 1000n * U, limit: 0n, days: 7 });
    // 900 / 7 = 128.57.. -> 130
    assert.equal(big.suggested_daily_limit, 130n * U);
    assert.equal(big.enough_limit, false);
});

test('explicit limit: limit x days; the balance is checked on its own', () => {
    const c = payoutCoverage({ debt: 500n * U, poolBalance: 400n * U, limit: 80n * U, days: 7 });
    assert.equal(c.daily_limit_is_default, false);
    assert.equal(c.daily_limit, 80n * U);
    assert.equal(c.capacity, 560n * U);
    assert.equal(c.enough_limit, true);
    assert.equal(c.enough_balance, false);
    assert.equal(c.suggested_daily_limit, 80n * U); // 500/7 = 72 < 80: keep 80

    const low = payoutCoverage({ debt: 1000n * U, poolBalance: 5000n * U, limit: 50n * U, days: 7 });
    assert.equal(low.capacity, 350n * U);
    assert.equal(low.enough_limit, false);
    assert.equal(low.enough_balance, true);
    // 1000 / 7 = 142.86 -> 150
    assert.equal(low.suggested_daily_limit, 150n * U);
    // the suggestion is enough by construction
    assert.ok(low.suggested_daily_limit * 7n >= 1000n * U);
});

test('the suggested limit always covers the debt in time and is never below the current one', () => {
    for (const debt of [1n, 7n, 999n, 123_456_789n, 10n ** 20n + 3n]) {
        for (const days of [1, 2, 7, 30]) {
            for (const limit of [0n, 1n, 10n ** 9n]) {
                const c = payoutCoverage({ debt, poolBalance: 10n ** 12n, limit, days });
                assert.ok(c.suggested_daily_limit * BigInt(days) >= debt, `${debt} ${days} ${limit}`);
                assert.ok(c.suggested_daily_limit >= c.daily_limit);
                // it is no more than ~10% above the exact need, unless the current limit is higher
                const need = (debt + BigInt(days) - 1n) / BigInt(days);
                if (c.suggested_daily_limit > c.daily_limit) assert.ok(c.suggested_daily_limit <= need + need / 9n + 1n);
            }
        }
    }
});

test('nothing owed: everything is enough', () => {
    const c = payoutCoverage({ debt: 0n, poolBalance: 0n, limit: 0n, days: 7 });
    assert.equal(c.enough_balance, true);
    assert.equal(c.enough_limit, true);
    assert.equal(c.suggested_daily_limit, 0n);
});

test('no budget day before the decrease: capacity 0, the suggestion asks for all of it in one day', () => {
    const c = payoutCoverage({ debt: 250n * U, poolBalance: 1000n * U, limit: 0n, days: 0 });
    assert.equal(c.capacity, 0n);
    assert.equal(c.enough_limit, false);
    assert.equal(c.suggested_daily_limit, 250n * U);
});

test('an empty pool: nothing is enough', () => {
    const c = payoutCoverage({ debt: 1n, poolBalance: 0n, limit: 0n, days: 7 });
    assert.equal(c.enough_balance, false);
    assert.equal(c.enough_limit, false);
    assert.equal(c.daily_limit, 0n);
    assert.equal(c.suggested_daily_limit, 1n);
});

test('serializeCoverage turns amounts into unit strings', () => {
    const c = payoutCoverage({ debt: 5n, poolBalance: 100n, limit: 0n, days: 1 });
    assert.deepEqual(serializeCoverage(c, { decimals: 9 }), {
        debt: '5',
        pool_balance: '100',
        daily_limit: '10',
        daily_limit_is_default: true,
        notice_days: 1,
        capacity: '10',
        enough_balance: true,
        enough_limit: true,
        suggested_daily_limit: '10',
        decimals: 9,
    });
});

const { limitAbove, limitRaiseRecord, limitRestore } = require('../src/lib/payout-coverage');

test('budgetDays counts only claim days when told which they are', () => {
    const now = MIDNIGHT + 15 * 3600 * 1000; // Tue 1 Sep 2026, 15:00 UTC
    const mondays = (dayMs) => new Date(dayMs).getUTCDay() === 1;
    // Wed..Tue next week: one Monday
    assert.equal(budgetDays(now, now + 7 * DAY_MS, mondays), 1);
    assert.equal(budgetDays(now, now + 3 * DAY_MS, mondays), 0);
    assert.equal(budgetDays(now, now + 7 * DAY_MS, () => true), 7);
});

test('limitAbove: 0 is the default share, not an amount', () => {
    assert.equal(limitAbove(100n, 50n), true);
    assert.equal(limitAbove(50n, 50n), false);
    assert.equal(limitAbove(40n, 50n), false);
    // from the default to any amount is a raise; back to the default restores
    assert.equal(limitAbove(100n, 0n), true);
    assert.equal(limitAbove(0n, 0n), false);
    // from an amount to the default: not comparable, still raised
    assert.equal(limitAbove(0n, 50n), true);
});

const JETTON = 'EQjetton';
const EFF = new Date(MIDNIGHT + 7 * DAY_MS);
const NOW = new Date(MIDNIGHT);

test('limitRaiseRecord records the limit to go back to', () => {
    const record = limitRaiseRecord(null, { jettonMaster: JETTON, currentLimit: 0n, target: 500n, effectiveAt: EFF, now: NOW, by: 42 });
    assert.deepEqual(record, { jetton_master: JETTON, from: '0', to: '500', effective_at: EFF, requested_at: NOW, by: 42 });
    // not a raise: nothing to remind about
    assert.equal(limitRaiseRecord(null, { jettonMaster: JETTON, currentLimit: 500n, target: 300n, effectiveAt: EFF, now: NOW }), null);
    // a second raise while the first is in force keeps the first baseline
    const again = limitRaiseRecord(record, { jettonMaster: JETTON, currentLimit: 500n, target: 900n, effectiveAt: EFF, now: NOW });
    assert.equal(again.from, '0');
    assert.equal(again.to, '900');
    // the first was set back meanwhile (or never landed): a fresh baseline
    const old = { ...record, from: '100' };
    assert.equal(limitRaiseRecord(old, { jettonMaster: JETTON, currentLimit: 80n, target: 900n, effectiveAt: EFF, now: NOW }).from, '80');
    // another jetton's record is no baseline
    const other = { ...record, jetton_master: 'EQother', from: '10' };
    assert.equal(limitRaiseRecord(other, { jettonMaster: JETTON, currentLimit: 500n, target: 900n, effectiveAt: EFF, now: NOW }).from, '500');
});

test('limitRestore: the banner shows after the decrease while the limit is still raised', () => {
    const record = { jetton_master: JETTON, from: '100', to: '500', effective_at: EFF, requested_at: NOW, by: 42 };
    const after = new Date(EFF.getTime() + 1000);
    const at = (now, limit, upcoming = false) => limitRestore(record, { jettonMaster: JETTON, limit, now, upcoming })?.state;
    assert.equal(limitRestore(null, { jettonMaster: JETTON, limit: 500n }), null);
    // before the decrease: the raise is still needed (and may be confirming)
    assert.equal(at(NOW, 500n), 'waiting');
    assert.equal(at(NOW, 100n), 'waiting');
    // after it, still raised: remind
    const due = limitRestore(record, { jettonMaster: JETTON, limit: 500n, now: after });
    assert.deepEqual(due, { state: 'due', from: '100', to: '500', effective_at: Math.floor(EFF.getTime() / 1000) });
    assert.equal(at(after, 101n), 'due');
    // ...from an amount to the 10% default is not "back"
    assert.equal(at(after, 0n), 'due');
    // back at or below the original (or the raise never landed): done
    assert.equal(at(after, 100n), 'clear');
    assert.equal(at(after, 60n), 'clear');
    // a later decrease replaced the one it was for: wait for that one
    assert.equal(at(after, 500n, true), 'waiting');
    // the limit cannot be read: decide nothing
    assert.equal(at(after, null), 'waiting');
    // raised from the default: only the default is back
    const fromDefault = { ...record, from: '0' };
    assert.equal(limitRestore(fromDefault, { jettonMaster: JETTON, limit: 0n, now: after }).state, 'clear');
    assert.equal(limitRestore(fromDefault, { jettonMaster: JETTON, limit: 10n, now: after }).state, 'due');
    // another jetton, or a broken record: drop it
    assert.equal(limitRestore(record, { jettonMaster: 'EQother', limit: 500n, now: after }).state, 'clear');
    assert.equal(limitRestore({ ...record, from: 'x' }, { jettonMaster: JETTON, limit: 500n, now: after }).state, 'clear');
    assert.equal(limitRestore({ ...record, effective_at: 'soon' }, { jettonMaster: JETTON, limit: 500n, now: after }).state, 'clear');
});

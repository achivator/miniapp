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

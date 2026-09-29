// Can members actually claim what they are owed before a price decrease
// takes effect?
//
// Two on-chain limits stand between a member and a claim: the pool's jetton
// balance, and its daily payout limit (per UTC day: an explicit amount the
// pool admin sets with a transaction, or by default 10% of the balance at
// the day's first claim). The backend cannot change either. A notice period
// is only worth something if everyone's claims fit through both before the
// decrease, so the creator is warned (never blocked) when they do not.
//
// Pure: amounts are BigInt jetton units, dates epoch ms.

const DAY_MS = 86400 * 1000;
// The pool contract's default daily budget: this share of the balance.
const DEFAULT_LIMIT_PERCENT = 10n;

// Fresh daily budgets members get before a decrease at `effectiveAtMs`: the
// UTC midnights strictly between now and then (a budget that starts at the
// moment the decrease applies is of no use). Today's remaining budget is not
// counted: it may be spent already, and the estimate must not be optimistic.
function budgetDays(nowMs, effectiveAtMs) {
    const firstMidnight = Math.floor(nowMs / DAY_MS) * DAY_MS + DAY_MS;
    if (!(effectiveAtMs > firstMidnight)) return 0;
    return Math.floor((effectiveAtMs - 1 - firstMidnight) / DAY_MS) + 1;
}

function defaultDailyBudget(balance) {
    return balance > 0n ? (balance * DEFAULT_LIMIT_PERCENT) / 100n : 0n;
}

// Rounds a positive amount up to two significant digits (1234.5 -> 1300,
// 0.0372 -> 0.038) so the suggested limit is a number a person can read and
// type. Works on units, so it is the same for any number of decimals.
function readableCeil(units) {
    if (units <= 0n) return 0n;
    const digits = units.toString().length;
    if (digits <= 2) return units;
    const step = 10n ** BigInt(digits - 2);
    return ((units + step - 1n) / step) * step;
}

// debt          what all members hold, valued as they would be paid (units)
// poolBalance   the pool's jetton ledger balance (units)
// limit         the explicit daily limit, 0n when the default applies
// days          budgetDays() until the decrease
//
// capacity is what the daily budgets let out over those days. With the
// default budget it shrinks as claims drain the balance (10% of what is left
// each day), so it is summed day by day as if every day's budget were used
// in full - the pessimistic case, and the one that matters when everybody
// hurries to claim. With an explicit limit it is limit x days (the balance
// is checked separately: enough_balance).
//
// suggested_daily_limit: the explicit limit that lets the debt out in time,
// rounded up to two significant digits, never below today's budget.
function payoutCoverage({ debt, poolBalance, limit, days }) {
    const balance = poolBalance > 0n ? poolBalance : 0n;
    const isDefault = !(limit > 0n);
    const dailyLimit = isDefault ? defaultDailyBudget(balance) : limit;

    let capacity = 0n;
    if (isDefault) {
        let left = balance;
        for (let i = 0; i < days; i++) {
            const budget = defaultDailyBudget(left);
            capacity += budget;
            left -= budget;
        }
    } else {
        capacity = limit * BigInt(Math.max(0, days));
    }

    const perDay = debt > 0n ? (debt + BigInt(Math.max(1, days)) - 1n) / BigInt(Math.max(1, days)) : 0n;
    const suggested = readableCeil(perDay);
    return {
        debt,
        pool_balance: balance,
        daily_limit: dailyLimit,
        daily_limit_is_default: isDefault,
        notice_days: days,
        capacity,
        enough_balance: balance >= debt,
        enough_limit: capacity >= debt,
        suggested_daily_limit: suggested > dailyLimit ? suggested : dailyLimit,
    };
}

// JSON-safe (amounts as unit strings).
function serializeCoverage(coverage, extra = {}) {
    const out = {};
    for (const [key, value] of Object.entries(coverage)) out[key] = typeof value === 'bigint' ? value.toString() : value;
    return { ...out, ...extra };
}

module.exports = {
    DEFAULT_LIMIT_PERCENT,
    budgetDays,
    defaultDailyBudget,
    readableCeil,
    payoutCoverage,
    serializeCoverage,
};

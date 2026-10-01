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
// `isClaimDay(dayStartMs)`, when given, keeps only the days members can
// claim on (the claim rules' weekdays and pause): a closed day's budget
// goes unused.
function budgetDays(nowMs, effectiveAtMs, isClaimDay = null) {
    const firstMidnight = Math.floor(nowMs / DAY_MS) * DAY_MS + DAY_MS;
    if (!(effectiveAtMs > firstMidnight)) return 0;
    const days = Math.floor((effectiveAtMs - 1 - firstMidnight) / DAY_MS) + 1;
    if (!isClaimDay) return days;
    let open = 0;
    for (let i = 0; i < days; i++) if (isClaimDay(firstMidnight + i * DAY_MS)) open++;
    return open;
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

// ---- Setting a raised daily limit back ----
//
// The price card offers the pool admin to raise the daily limit so everyone
// can claim before a decrease. The limit is the pool's safety cap for a
// leaked bot key, so once the decrease is behind it should go back. The app
// cannot see whether the admin's wallet sent the transaction, so the request
// is recorded when the admin asks pool-admin-tx for it, in
// chats.claim_limit_raise:
//   { jetton_master, from, to, effective_at, requested_at, by }
// from/to: the daily limit before and as requested, jetton units as decimal
// strings ("0" = the contract's default 10% of the balance); effective_at:
// the decrease it was for (Date). The pool page then shows a "set it back"
// banner (limitRestore) until the on-chain limit is back at or below `from`
// or the creator dismisses it (the record is removed either way).

// Whether an on-chain limit is above `from`. 0 is the default share of the
// balance, not comparable with an amount: away from the default counts as
// raised, and so does going from an amount to the default.
function limitAbove(limit, from) {
    if (from === 0n) return limit !== 0n;
    return limit === 0n || limit > from;
}

function unitsOf(value) {
    try {
        const n = BigInt(String(value));
        return n >= 0n ? n : null;
    } catch {
        return null;
    }
}

// The record to store when the admin requests a limit of `target` (units)
// for a decrease at `effectiveAt`, or null when that is no raise. A second
// raise while the first is still in force keeps the first one's `from`: the
// limit to go back to is the one before any of them.
function limitRaiseRecord(existing, { jettonMaster, currentLimit, target, effectiveAt, now = new Date(), by = null }) {
    let from = currentLimit;
    const prior = existing && existing.jetton_master === jettonMaster ? unitsOf(existing.from) : null;
    if (prior !== null && limitAbove(currentLimit, prior)) from = prior;
    if (!limitAbove(target, from)) return null;
    return {
        jetton_master: jettonMaster,
        from: from.toString(),
        to: target.toString(),
        effective_at: effectiveAt,
        requested_at: now,
        by,
    };
}

// What the pool page does with a recorded raise:
//   null      nothing recorded;
//   'clear'   remove the record: the limit is back at or below `from` after
//             the decrease (or the raise never landed), or it is for another
//             jetton, or unreadable;
//   'waiting' the decrease is still ahead (the record's date, or a pending
//             decrease that replaced it): the raised limit is still needed;
//   'due'     show the banner: set the limit back to `from`.
// Before the decrease the record is kept even when the limit is not raised
// yet: the admin's transaction may still be confirming. `limit` is the
// on-chain daily limit (BigInt units), null when it cannot be read (then
// nothing is decided). `upcoming`: a decrease is pending now.
function limitRestore(record, { jettonMaster, limit, now = new Date(), upcoming = false }) {
    if (!record) return null;
    const from = unitsOf(record.from);
    const to = unitsOf(record.to);
    const effectiveAt = record.effective_at instanceof Date ? record.effective_at : new Date(NaN);
    if (from === null || to === null || Number.isNaN(effectiveAt.getTime())) return { state: 'clear' };
    if (record.jetton_master !== jettonMaster) return { state: 'clear' };
    const base = { from: from.toString(), to: to.toString(), effective_at: Math.floor(effectiveAt.getTime() / 1000) };
    if (upcoming || now.getTime() < effectiveAt.getTime() || limit === null || limit === undefined) {
        return { state: 'waiting', ...base };
    }
    return { state: limitAbove(limit, from) ? 'due' : 'clear', ...base };
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
    limitAbove,
    limitRaiseRecord,
    limitRestore,
};

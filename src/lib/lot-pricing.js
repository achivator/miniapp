const { pointsToJettons } = require('./ton/amounts');
const { canonicalDecimal, compareDecimal, effectivePriceHistory, pointPriceFor } = require('./point-price');

// Which price a point is paid at, once the price has moved.
//
// Product rule: a decrease gives members a notice period to claim first.
// Points that were already claimable during it and were not claimed are paid
// at the new price (the member had the chance); points that were still
// maturing when the price dropped could not be claimed in time, so they keep
// the price in force just before the drop.
//
// Points are modelled as lots: each reaction_points doc and each grants doc
// of the member in the chat (amount + earned date). Claims consume points
// oldest first (FIFO): rewards.claimed_points counts the oldest lots as used.
// Whatever part of rewards.points no lot explains (older data) is the oldest
// lot, earned at epoch 0.
//
// A lot earned at `e` matures at `m = e + maturation_days` (the chat's
// current setting). If some decrease took effect at `d` with e < d < m, the
// lot is paid at max(current price, price in force just before the earliest
// such decrease); otherwise at the current price. A lot earned exactly at `d`
// was earned at the new price; one maturing exactly at `d` was claimable at
// `d` (the same `date <= now - maturation` rule claim-rules uses).
//
// Rounding: points are grouped by the price they are paid at and each group
// is converted with pointsToJettons (floor). A price that fits the jetton's
// decimals converts exactly, so rounding only bites for an old price finer
// than a (switched) jetton's unit, and then it loses less than one unit per
// price group. The total is never above the sum of the exact values.
//
// Everything here is pure (no Mongo, no clock): callers pass `now`.

const DAY_MS = 86400 * 1000;

function toMs(at) {
    if (at instanceof Date) return at.getTime();
    if (typeof at === 'number') return at;
    return NaN;
}

function canonicalPrice(value) {
    if (typeof value !== 'string') return null;
    const price = canonicalDecimal(value.trim());
    if (price === null || /^0(\.0*)?$/.test(price)) return null;
    return price;
}

function maxPrice(a, b) {
    return compareDecimal(a, b) >= 0 ? a : b;
}

// The chat's price over time, from one read of the chat document (so the
// current price and the history can never disagree about which save they
// saw): point_price_history plus a due pending decrease the bot has not
// written out yet. Throws like pointPriceFor() on a corrupted price.
//   current   the effective price at `now`
//   initial   the price before the first retained change (null if unknown)
//   steps     [{ at (ms), price }] in time order: `price` applies from `at`
function priceTimeline(chat, now = new Date()) {
    const current = pointPriceFor(chat, now);
    const nowMs = now.getTime();
    const entries = [];
    effectivePriceHistory(chat, now).forEach((h, index) => {
        const at = toMs(h?.at);
        const price = canonicalPrice(h?.new);
        // an unreadable entry (hand-edited) is skipped: without it a drop is
        // not seen and its lots are paid at the current price - never more
        if (!Number.isFinite(at) || at > nowMs || price === null) return;
        entries.push({ at, price, old: canonicalPrice(h?.old), index });
    });
    entries.sort((a, b) => a.at - b.at || a.index - b.index);
    return {
        current,
        initial: entries.length ? entries[0].old : null,
        steps: entries.map((e) => ({ at: e.at, price: e.price })),
    };
}

// The price in force at `atMs` (inclusive: a change at `atMs` counts).
function priceAt(timeline, atMs) {
    let price = null;
    for (const step of timeline.steps) {
        if (step.at <= atMs) price = step.price;
        else break;
    }
    if (price !== null) return price;
    return timeline.steps.length ? timeline.initial : timeline.current;
}

// The price in force just before `atMs`.
function priceBefore(timeline, atMs) {
    let price = null;
    for (const step of timeline.steps) {
        if (step.at < atMs) price = step.price;
        else break;
    }
    if (price !== null) return price;
    return timeline.steps.length ? timeline.initial : timeline.current;
}

// Moments the price went down: [{ at, before, after }], oldest first. Several
// changes at the same instant count as one move (the last one wins).
function priceDecreases(timeline) {
    const out = [];
    const seen = new Set();
    for (const step of timeline.steps) {
        if (seen.has(step.at)) continue;
        seen.add(step.at);
        const before = priceBefore(timeline, step.at);
        const after = priceAt(timeline, step.at);
        if (before !== null && after !== null && compareDecimal(after, before) < 0) {
            out.push({ at: step.at, before, after });
        }
    }
    return out;
}

function maturationMs(maturationDays) {
    return Number.isInteger(maturationDays) && maturationDays > 0 ? maturationDays * DAY_MS : 0;
}

// The price one lot earned at `earnedMs` is paid at. `decreases` is
// priceDecreases(timeline), passed in so a batch computes it once.
function lotPrice(earnedMs, timeline, maturationDays, decreases = priceDecreases(timeline)) {
    const matures = earnedMs + maturationMs(maturationDays);
    const hit = decreases.find((d) => earnedMs < d.at && d.at < matures);
    return hit ? maxPrice(timeline.current, hit.before) : timeline.current;
}

// A member's lots, oldest first, adding up to exactly `totalPoints`
// (rewards.points). Raw lots: [{ points, at }] where `at` is a Date
// (reaction_points) or epoch ms (grants). Lots without a readable date or a
// positive whole amount are ignored (their points end up in the legacy lot).
// Points no lot explains become the oldest lot, at epoch 0; lots beyond the
// total are cut from the newest end (the bot inserts a reaction doc before it
// increments rewards.points, so a doc can briefly be ahead of the total).
function normalizeLots(rawLots, totalPoints) {
    const total = Number.isSafeInteger(totalPoints) && totalPoints > 0 ? totalPoints : 0;
    const lots = [];
    for (const lot of rawLots || []) {
        const at = toMs(lot?.at);
        const points = lot?.points;
        if (!Number.isFinite(at) || !Number.isSafeInteger(points) || points <= 0) continue;
        lots.push({ at, points });
    }
    lots.sort((a, b) => a.at - b.at);
    let sum = lots.reduce((s, l) => s + l.points, 0);
    while (sum > total && lots.length) {
        const last = lots[lots.length - 1];
        const cut = Math.min(last.points, sum - total);
        last.points -= cut;
        sum -= cut;
        if (last.points === 0) lots.pop();
    }
    if (sum < total) lots.unshift({ at: 0, points: total - sum, legacy: true });
    return lots;
}

function groupUnits(points, price, decimals) {
    return pointsToJettons(points, price, decimals);
}

// Values the points a member would claim next.
//   lots      normalizeLots() output
//   claimed   rewards.claimed_points: the oldest `claimed` points are used
//   count     how many points to claim after them (the claimable ones)
//   timeline  priceTimeline() at `now`
//   maturationDays, decimals (the jetton's; an integer)
//   payable   optional BigInt: jetton units the pool can pay right now; lots
//             are taken oldest first while they fit, then as many points of
//             the next lot as fit, and the claim stops there (never skipping
//             ahead to a cheaper lot: FIFO positions must stay contiguous)
// Returns { points, units (BigInt), breakdown: [{ price, points, units }] }
// with the breakdown in the order the prices were first met.
function valueClaim({ lots, claimed = 0, count, timeline, maturationDays, decimals, payable = null }) {
    if (!Number.isInteger(decimals) || decimals < 0) throw new Error('jetton decimals are required to value points');
    const decreases = priceDecreases(timeline);
    const groups = new Map(); // price -> points
    let units = 0n;
    let taken = 0;
    let skip = Math.max(0, Number.isSafeInteger(claimed) ? claimed : 0);
    let want = Math.max(0, Number.isSafeInteger(count) ? count : 0);

    for (const lot of lots) {
        if (want === 0) break;
        let available = lot.points;
        if (skip >= available) {
            skip -= available;
            continue;
        }
        available -= skip;
        skip = 0;
        const n = Math.min(available, want);
        const price = lotPrice(lot.at, timeline, maturationDays, decreases);
        const had = groups.get(price) || 0;
        const before = groupUnits(had, price, decimals);
        const totalWith = (k) => units - before + groupUnits(had + k, price, decimals);

        let k = n;
        if (payable !== null && totalWith(n) > payable) {
            // the largest k with totalWith(k) <= payable (monotonic in k)
            let lo = 0;
            let hi = n - 1;
            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (totalWith(mid) <= payable) lo = mid;
                else hi = mid - 1;
            }
            k = totalWith(lo) <= payable ? lo : 0;
        }
        if (k > 0) {
            units = totalWith(k);
            groups.set(price, had + k);
            taken += k;
            want -= k;
        }
        if (k < n) break;
    }

    const breakdown = [...groups].map(([price, points]) => ({ price, points, units: groupUnits(points, price, decimals) }));
    return { points: taken, units, breakdown };
}

// JSON-safe breakdown (units as strings).
function serializeBreakdown(breakdown) {
    return breakdown.map((b) => ({ price: b.price, points: b.points, units: b.units.toString() }));
}

// The earliest decrease that can still affect a lot, and the last one: lots
// earned at or before (first decrease - maturation) or at or after the last
// decrease are paid at the current price whatever their exact date. Loaders
// use it to sum those instead of reading every doc. null when no decrease.
function affectedWindow(timeline, maturationDays) {
    const decreases = priceDecreases(timeline);
    if (decreases.length === 0) return null;
    return {
        from: decreases[0].at - maturationMs(maturationDays),
        to: decreases[decreases.length - 1].at,
    };
}

module.exports = {
    DAY_MS,
    priceTimeline,
    priceAt,
    priceBefore,
    priceDecreases,
    lotPrice,
    normalizeLots,
    valueClaim,
    serializeBreakdown,
    affectedWindow,
};

// Unit tests for the stored platform default (miniapp#12): how it follows
// JETTONS_PER_POINT (an increase at once, a decrease with notice, a
// cancellation), and how chats on the default get a platform decrease like
// their own - the drop ahead, the history, maturing points protected - while
// "back to default" aims at one well-defined price. Pure functions, no Mongo.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { planPlatformSync, platformState } = require('../src/lib/platform-price');
const {
    setPlatformDefault,
    platformPointPrice,
    platformTargetPrice,
    pointPriceFor,
    hasCustomPointPrice,
    upcomingPointPrice,
    effectivePriceHistory,
    recentPointPriceChange,
    planPointPriceChange,
    landsOnDefault,
    pendingPointPrice,
} = require('../src/lib/point-price');
const { priceTimeline, lotPrice } = require('../src/lib/lot-pricing');

const DAY_MS = 86400 * 1000;
const T0 = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
const at = (days) => new Date(T0.getTime() + days * DAY_MS);
const OPTS = { now: T0, noticeDays: 7, by: 42, symbol: 'PTS', maturationDays: 3 };

afterEach(() => setPlatformDefault(null));

test('planPlatformSync: the env applies at once when it raises the default', () => {
    const doc = { price: '0.01', history: [], rev: 3 };
    assert.equal(planPlatformSync(doc, '0.01', T0, 7), null);
    const up = planPlatformSync(doc, '0.02', T0, 7);
    assert.deepEqual(up.$set, { price: '0.02' });
    assert.deepEqual(up.$push, { history: { $each: [{ old: '0.01', new: '0.02', at: T0 }] } });
    assert.deepEqual(up.$inc, { rev: 1 });
});

test('planPlatformSync: a lower env becomes a platform decrease with notice', () => {
    const doc = { price: '0.01', history: [] };
    const down = planPlatformSync(doc, '0.005', T0, 7);
    assert.deepEqual(down.$set, { pending: { price: '0.005', from: '0.01', effective_at: at(7), requested_at: T0 } });
    assert.equal(down.$push, undefined, 'the stored price stays in force');

    const pending = down.$set.pending;
    // the same env again: nothing
    assert.equal(planPlatformSync({ ...doc, pending }, '0.005', at(1), 7), null);
    // another lower target: replaced, with a fresh notice
    assert.deepEqual(planPlatformSync({ ...doc, pending }, '0.008', at(1), 7).$set.pending, {
        price: '0.008',
        from: '0.01',
        effective_at: at(8),
        requested_at: at(1),
    });
    // back to the stored price: cancelled, and remembered for the chats told
    const back = planPlatformSync({ ...doc, pending }, '0.01', at(1), 7);
    assert.deepEqual(back.$unset, { pending: '' });
    assert.deepEqual(back.$set, { cancelled: { ...pending, stays: '0.01', at: at(1) } });
    // above it: cancelled and raised
    const above = planPlatformSync({ ...doc, pending }, '0.02', at(1), 7);
    assert.equal(above.$set.price, '0.02');
    assert.equal(above.$set.cancelled.stays, '0.02');
    // once due, it is written out first
    const due = planPlatformSync({ ...doc, pending }, '0.005', at(8), 7);
    assert.deepEqual(due.$set, { price: '0.005' });
    assert.deepEqual(due.$unset, { pending: '' });
    assert.deepEqual(due.$push.history.$each, [{ old: '0.01', new: '0.005', at: at(7), requested_at: T0 }]);
});

test('platformState refuses a corrupted stored default instead of paying a guess', () => {
    assert.throws(() => platformState({ price: 'abc' }), (e) => e.status === 500);
    assert.throws(() => platformState({ price: '0.01', pending: { price: 'x', from: '0.01', effective_at: T0 } }), (e) => e.status === 500);
    assert.deepEqual(platformState({ price: '0.010', history: [{ old: '1', new: 'junk', at: T0 }] }), {
        price: '0.01',
        pending: null,
        history: [],
    });
});

// The default was 0.01 and drops to 0.005 at T0 (requested a week before).
const DROP = { price: '0.01', pending: { price: '0.005', from: '0.01', effective_at: T0, requested_at: at(-7) }, history: [] };

test('the platform default pays its stored price until a decrease is due', () => {
    setPlatformDefault(DROP);
    assert.equal(platformPointPrice(at(-1)), '0.01');
    assert.equal(platformPointPrice(T0), '0.005');
    assert.equal(platformTargetPrice(), '0.005');
    assert.equal(pointPriceFor({ id: 1 }, at(-1)), '0.01');
    assert.equal(pointPriceFor({ id: 1 }, at(1)), '0.005');
    // a chat's own price is untouched
    assert.equal(pointPriceFor({ id: 1, point_price: '0.01' }, at(1)), '0.01');
});

test('a chat on the default sees the platform decrease ahead like its own', () => {
    setPlatformDefault(DROP);
    const upcoming = upcomingPointPrice({ id: 1 }, at(-1));
    assert.equal(upcoming.platform, true);
    assert.equal(upcoming.price, '0.005');
    assert.equal(upcoming.from, '0.01');
    assert.deepEqual(upcoming.effective_at, T0);
    assert.equal(upcomingPointPrice({ id: 1 }, T0), null, 'in effect');
    assert.equal(upcomingPointPrice({ id: 1, point_price: '0.02' }, at(-1)), null, 'its own price');
});

test('a platform decrease enters the history and protects points of chats on the default', () => {
    setPlatformDefault(DROP);
    const chat = { id: 1, claim_settings: { maturation_days: 3 } };
    const history = effectivePriceHistory(chat, at(1));
    assert.deepEqual(history, [
        { old: '0.01', new: '0.005', at: T0, by: null, maturation_days: null, reason: 'platform_default' },
    ]);
    assert.deepEqual(recentPointPriceChange(chat, Math.floor(at(1).getTime() / 1000)), {
        old: '0.01',
        new: '0.005',
        at: Math.floor(T0.getTime() / 1000),
        changes: 1,
        reason: 'platform_default',
    });
    // points still maturing at the drop keep the earlier price; matured ones
    // and later ones are paid the new one
    const timeline = priceTimeline(chat, at(1));
    assert.equal(lotPrice(at(-1).getTime(), timeline, 3), '0.01');
    assert.equal(lotPrice(at(-5).getTime(), timeline, 3), '0.005');
    assert.equal(lotPrice(at(0.5).getTime(), timeline, 3), '0.005');
    // a chat with its own price all along: not touched
    assert.deepEqual(effectivePriceHistory({ id: 2, point_price: '0.01' }, at(1)), []);
});

test('which stretches a chat spent on the default decides which platform changes reach it', () => {
    setPlatformDefault({ price: '0.005', pending: null, history: [{ old: '0.01', new: '0.005', at: T0 }] });
    // on the default at the drop, its own price since: the drop still counts
    const left = {
        id: 1,
        point_price: '0.02',
        point_price_history: [{ old: '0.005', new: '0.02', at: at(2), by: 7, from_default: true }],
    };
    assert.equal(effectivePriceHistory(left, at(3)).length, 2);
    assert.equal(lotPrice(at(-1).getTime(), priceTimeline(left, at(3)), 3), '0.02', 'max(current, before)');
    // its own price at the drop, on the default since: not
    const joined = {
        id: 1,
        point_price_history: [{ old: '0.01', new: '0.005', at: at(2), by: 7, from_default: false }],
    };
    assert.deepEqual(
        effectivePriceHistory(joined, at(3)).map((h) => h.reason ?? null),
        [null],
    );
    // a switch at the same price is logged, so it is not missed either
    const same = {
        id: 1,
        point_price: '0.005',
        point_price_history: [{ old: '0.005', new: '0.005', at: at(1), by: 7, from_default: true }],
    };
    assert.equal(effectivePriceHistory(same, at(3)).filter((h) => h.reason === 'platform_default').length, 1);
    // an entry from before `from_default`: on the default if its old price was
    // the default then
    const legacy = { id: 1, point_price: '0.02', point_price_history: [{ old: '0.005', new: '0.02', at: at(2), by: 7 }] };
    assert.equal(effectivePriceHistory(legacy, at(3)).length, 2);
    const legacyCustom = { id: 1, point_price: '0.02', point_price_history: [{ old: '0.03', new: '0.02', at: at(2), by: 7 }] };
    assert.equal(effectivePriceHistory(legacyCustom, at(3)).length, 1);
});

test('"back to default" aims at where the default is heading, and both apps pay that price', () => {
    setPlatformDefault({ ...DROP, pending: { ...DROP.pending, effective_at: at(10) } });
    // custom 0.02 -> default: a decrease to the platform's target, not before
    // the platform decrease itself takes effect
    const plan = planPointPriceChange({ id: 5, point_price: '0.02' }, null, OPTS);
    const pending = plan.update.$set.point_price_pending;
    assert.equal(pending.price, '0.005');
    assert.equal(pending.to_default, true);
    assert.deepEqual(pending.effective_at, at(10));
    assert.equal(pending.from_default, false);
    assert.deepEqual(plan.announcements[0].params, { from: '0.02', to: '0.005', symbol: 'PTS', effective_at: at(10) });
    // once due it lands on the default, which is that price by then
    const chat = { id: 5, point_price: '0.02', point_price_pending: pending };
    assert.equal(pointPriceFor(chat, at(11)), '0.005');
    assert.equal(landsOnDefault(pendingPointPrice(chat), at(11)), true);
    assert.equal(hasCustomPointPrice(chat, at(11)), false);

    // a chat already on the default has nothing to schedule
    assert.equal(planPointPriceChange({ id: 5 }, null, OPTS), null);
    // custom below the target: on the default at once, paying the default in
    // force (the platform decrease then reaches it with its notice)
    const up = planPointPriceChange({ id: 5, point_price: '0.001' }, null, OPTS);
    assert.deepEqual(up.update.$unset, { point_price: '' });
    assert.equal(up.after, '0.01');
    assert.deepEqual(up.announcements[0].params, { from: '0.001', to: '0.01', symbol: 'PTS', cancelled_pending: false });
    assert.equal(upcomingPointPrice({ id: 5 }, T0).platform, true);
});

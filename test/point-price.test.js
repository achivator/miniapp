// Unit tests for per-chat point prices: validation/normalization of what a
// chat creator submits, the effective price every route converts with, and
// the member-facing "rate changed" notice, and the notice period for
// decreases (what a save writes and announces). Pure functions, no Mongo.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_POINT_PRICE,
    compareDecimal,
    normalizePointPrice,
    platformPointPrice,
    pointPriceFor,
    hasCustomPointPrice,
    priceFitsDecimals,
    chatPointsToUnits,
    recentPointPriceChange,
    serializePriceHistory,
    pointPriceNoticeDays,
    pendingPointPrice,
    upcomingPointPrice,
    isPriceDecrease,
    decreaseEffectiveAt,
    effectivePriceHistory,
    serializePendingPrice,
    planPointPriceChange,
    planPointPriceCancel,
    announcementDoc,
    scheduledAnnouncement,
} = require('../src/lib/point-price');

const NOW = 1_800_000_000;
const DAY = 86400;

function withRate(rate, fn) {
    const saved = process.env.JETTONS_PER_POINT;
    if (rate === undefined) delete process.env.JETTONS_PER_POINT;
    else process.env.JETTONS_PER_POINT = rate;
    try {
        return fn();
    } finally {
        if (saved === undefined) delete process.env.JETTONS_PER_POINT;
        else process.env.JETTONS_PER_POINT = saved;
    }
}

test('normalizePointPrice returns one canonical spelling', () => {
    assert.equal(normalizePointPrice('0.01'), '0.01');
    assert.equal(normalizePointPrice(' 0.0100 '), '0.01');
    assert.equal(normalizePointPrice('007.50'), '7.5');
    assert.equal(normalizePointPrice('5.000'), '5');
    assert.equal(normalizePointPrice('0.000000001'), '0.000000001');
    assert.equal(normalizePointPrice(MAX_POINT_PRICE), MAX_POINT_PRICE);
    assert.equal(normalizePointPrice('999999.999999999'), '999999.999999999');
});

test('normalizePointPrice rejects non-strings, junk, zero and out-of-bounds prices', () => {
    // numbers already went through float rounding
    assert.throws(() => normalizePointPrice(0.01), /decimal string/);
    assert.throws(() => normalizePointPrice(null), /decimal string/);
    for (const bad of ['', '  ', 'abc', '-1', '1e-2', '.5', '1.', '1,5', '0x10', '1.2.3', '1'.repeat(40)]) {
        assert.throws(() => normalizePointPrice(bad), /decimal string/, bad);
    }
    assert.throws(() => normalizePointPrice('0'), /greater than 0/);
    assert.throws(() => normalizePointPrice('0.000'), /greater than 0/);
    assert.throws(() => normalizePointPrice('1000000.000000001'), /at most/);
    assert.throws(() => normalizePointPrice('2000000'), /at most/);
});

test('normalizePointPrice keeps one point worth at least one jetton unit', () => {
    // unknown decimals: validated against 9
    assert.throws(() => normalizePointPrice('0.0000000001'), /9 decimals/);
    assert.throws(() => normalizePointPrice('0.0000000001', null), /9 decimals/);
    assert.equal(normalizePointPrice('0.000001', 6), '0.000001');
    assert.throws(() => normalizePointPrice('0.0000001', 6), /6 decimals/);
    assert.equal(normalizePointPrice('3', 0), '3');
    assert.throws(() => normalizePointPrice('2.5', 0), /0 decimals/);
    // trailing zeros do not count
    assert.equal(normalizePointPrice('0.1000000000', 1), '0.1');
});

test('priceFitsDecimals re-checks a saved price against the jetton at claim time', () => {
    assert.equal(priceFitsDecimals('0.01', 9), true);
    assert.equal(priceFitsDecimals('0.01', 2), true);
    assert.equal(priceFitsDecimals('0.001', 2), false);
    assert.equal(priceFitsDecimals('5', 0), true);
    assert.equal(priceFitsDecimals('0.01', null), false);
});

test('compareDecimal compares exactly', () => {
    assert.equal(compareDecimal('0.01', '0.010'), 0);
    assert.equal(compareDecimal('0.009', '0.01'), -1);
    assert.equal(compareDecimal('10', '9.999999999'), 1);
    assert.equal(compareDecimal('0.1', '0.3'), -1);
});

test('pointPriceFor: the chat price when set, else the platform default', () => {
    withRate('0.0100', () => {
        assert.equal(platformPointPrice(), '0.01');
        assert.equal(pointPriceFor({ id: 1 }), '0.01');
        assert.equal(pointPriceFor({ id: 1, point_price: null }), '0.01');
        assert.equal(pointPriceFor(null), '0.01');
        assert.equal(pointPriceFor({ id: 1, point_price: '0.5' }), '0.5');
        assert.equal(hasCustomPointPrice({ point_price: '0.5' }), true);
        assert.equal(hasCustomPointPrice({}), false);
    });
    withRate(undefined, () => assert.equal(platformPointPrice(), '0.01'));
    withRate('2', () => assert.equal(pointPriceFor({ id: 1 }), '2'));
});

test('pointPriceFor refuses a corrupted stored price instead of paying another rate', () => {
    for (const bad of ['0', 'abc', 0.5, '-1']) {
        assert.throws(
            () => pointPriceFor({ point_price: bad }),
            (e) => e.status === 500 && /invalid/.test(e.message),
            String(bad),
        );
    }
    withRate('oops', () => assert.throws(() => pointPriceFor({}), /JETTONS_PER_POINT/));
});

test('chatPointsToUnits converts with the chat price, exactly', () => {
    withRate('0.01', () => {
        // platform: 150 points at 0.01 = 1.5 jettons of 9 decimals
        assert.equal(chatPointsToUnits({}, 150, 9), 1_500_000_000n);
        // chat price 0.3 (not representable as a float): 3 points = 0.9 exactly
        assert.equal(chatPointsToUnits({ point_price: '0.3' }, 3, 9), 900_000_000n);
        assert.equal(chatPointsToUnits({ point_price: '0.000001' }, 1, 6), 1n);
        assert.equal(chatPointsToUnits({ point_price: '1000000' }, 1_000_000_000, 9), 10n ** 24n);
    });
});

test('recentPointPriceChange reports the latest change of the last 7 days', () => {
    const chat = {
        point_price_history: [
            { old: '0.01', new: '0.02', at: new Date((NOW - 30 * DAY) * 1000), by: 1 },
            { old: '0.02', new: '0.005', at: new Date((NOW - 3 * DAY) * 1000), by: 1 },
            { old: '0.005', new: '0.01', at: new Date((NOW - DAY) * 1000), by: 1 },
        ],
    };
    assert.deepEqual(recentPointPriceChange(chat, NOW), { old: '0.005', new: '0.01', at: NOW - DAY, changes: 2, reason: null });
    // only the old change: nothing to warn about
    assert.equal(recentPointPriceChange({ point_price_history: chat.point_price_history.slice(0, 1) }, NOW), null);
    assert.equal(recentPointPriceChange({}, NOW), null);
    assert.equal(recentPointPriceChange(null, NOW), null);
    // exactly 7 days ago is out of the window
    assert.equal(
        recentPointPriceChange({ point_price_history: [{ old: '1', new: '2', at: new Date((NOW - 7 * DAY) * 1000) }] }, NOW),
        null,
    );
});

test('serializePriceHistory lists changes newest first', () => {
    const chat = {
        point_price_history: [
            { old: '0.01', new: '0.02', at: new Date(1000 * 1000), by: 7 },
            { old: '0.02', new: '0.03', at: new Date(2000 * 1000), by: 7 },
        ],
    };
    assert.deepEqual(serializePriceHistory(chat), [
        { old: '0.02', new: '0.03', at: 2000, by: 7, reason: null },
        { old: '0.01', new: '0.02', at: 1000, by: 7, reason: null },
    ]);
    assert.deepEqual(serializePriceHistory(chat, 1), [{ old: '0.02', new: '0.03', at: 2000, by: 7, reason: null }]);
    // a switch to or from the default at the same price is kept for lot
    // pricing, not shown; a jetton switch is shown even at the same price
    const quiet = { point_price_history: [...chat.point_price_history, { old: '0.03', new: '0.03', at: new Date(3000 * 1000), by: 7 }] };
    assert.equal(serializePriceHistory(quiet).length, 2);
    const jetton = { old: '0.03', new: '0.03', at: new Date(3000 * 1000), by: 7, reason: 'jetton_changed' };
    assert.deepEqual(serializePriceHistory({ point_price_history: [jetton] })[0].reason, 'jetton_changed');
    assert.deepEqual(serializePriceHistory({}), []);
});

// --- notice period for decreases -------------------------------------------

const T0 = new Date(NOW * 1000);
const at = (days) => new Date(T0.getTime() + days * DAY * 1000);
const OPTS = { now: T0, noticeDays: 7, by: 42, symbol: 'PTS', maturationDays: 3 };

function withEnv(name, value, fn) {
    const saved = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
        return fn();
    } finally {
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
    }
}

function pendingOf(price, effectiveAt, extra = {}) {
    return {
        price,
        to_default: false,
        from: '0.01',
        symbol: 'PTS',
        effective_at: effectiveAt,
        requested_at: at(-1),
        by: 7,
        ...extra,
    };
}

test('pointPriceNoticeDays reads POINT_PRICE_NOTICE_DAYS, 0-30, default 7', () => {
    withEnv('POINT_PRICE_NOTICE_DAYS', undefined, () => assert.equal(pointPriceNoticeDays(), 7));
    withEnv('POINT_PRICE_NOTICE_DAYS', '', () => assert.equal(pointPriceNoticeDays(), 7));
    withEnv('POINT_PRICE_NOTICE_DAYS', '0', () => assert.equal(pointPriceNoticeDays(), 0));
    withEnv('POINT_PRICE_NOTICE_DAYS', '30', () => assert.equal(pointPriceNoticeDays(), 30));
    // a typo must not silently remove the notice
    for (const bad of ['31', '-1', '2.5', 'week']) {
        withEnv('POINT_PRICE_NOTICE_DAYS', bad, () => assert.equal(pointPriceNoticeDays(), 7, bad));
    }
});

test('decreaseEffectiveAt is now + notice days; notice 0 means now', () => {
    assert.deepEqual(decreaseEffectiveAt(T0, 7), at(7));
    assert.deepEqual(decreaseEffectiveAt(T0, 0), T0);
    assert.equal(isPriceDecrease('0.01', '0.005'), true);
    assert.equal(isPriceDecrease('0.01', '0.010'), false);
    assert.equal(isPriceDecrease('0.01', '0.02'), false);
});

test('pointPriceFor: a pending decrease counts only from its effective_at, applied by the bot or not', () => {
    withRate('0.01', () => {
        const chat = { id: 1, point_price: '0.02', point_price_pending: pendingOf('0.005', at(3), { from: '0.02' }) };
        assert.equal(pointPriceFor(chat, T0), '0.02');
        assert.equal(pointPriceFor(chat, at(3)), '0.005');
        assert.equal(pointPriceFor(chat, at(4)), '0.005');
        assert.equal(upcomingPointPrice(chat, T0).price, '0.005');
        assert.equal(upcomingPointPrice(chat, at(3)), null);
        assert.equal(upcomingPointPrice({ id: 1 }, T0), null);
        assert.equal(hasCustomPointPrice(chat, at(4)), true);
        assert.deepEqual(serializePendingPrice(upcomingPointPrice(chat, T0)), {
            price: '0.005',
            to_default: false,
            from: '0.02',
            symbol: 'PTS',
            effective_at: NOW + 3 * DAY,
            platform: false,
        });

        // back to the default: once due, the price it was scheduled to pays,
        // and the chat is on the default when that is the default in force
        const toDefault = { id: 1, point_price: '0.02', point_price_pending: pendingOf('0.01', at(3), { to_default: true }) };
        assert.equal(pointPriceFor(toDefault, at(4)), '0.01');
        assert.equal(hasCustomPointPrice(toDefault, at(4)), false);
        assert.equal(hasCustomPointPrice(toDefault, T0), true);
        // the default moved since: still that price (the bot logs the same
        // one), kept as the chat's own rather than moving it unannounced
        withRate('0.008', () => {
            assert.equal(pointPriceFor(toDefault, at(4)), '0.01');
            assert.equal(serializePendingPrice(upcomingPointPrice(toDefault, T0)).price, '0.01');
            assert.equal(hasCustomPointPrice(toDefault, at(4)), true);
        });
    });
});

test('pointPriceFor refuses a malformed pending decrease', () => {
    for (const pending of [pendingOf('abc', at(1)), pendingOf('0', at(1)), pendingOf('0.005', 'tomorrow')]) {
        assert.throws(
            () => pointPriceFor({ point_price: '0.02', point_price_pending: pending }, T0),
            (e) => e.status === 500 && /invalid/.test(e.message),
        );
    }
    assert.equal(pendingPointPrice({ point_price_pending: null }), null);
});

test('a due but unapplied decrease shows in the history members see', () => {
    withRate('0.01', () => {
        const chat = {
            point_price: '0.02',
            point_price_history: [{ old: '0.01', new: '0.02', at: at(-20), by: 7 }],
            point_price_pending: pendingOf('0.005', at(-1), { from: '0.02' }),
        };
        assert.equal(effectivePriceHistory(chat, at(-2)).length, 1);
        // a pending scheduled before maturation snapshots: null (valued with
        // the chat's current setting)
        assert.deepEqual(effectivePriceHistory(chat, T0).at(-1), {
            old: '0.02',
            new: '0.005',
            at: at(-1),
            by: 7,
            maturation_days: null,
            from_default: false,
        });
        const snapped = { ...chat, point_price_pending: { ...chat.point_price_pending, maturation_days: 5 } };
        assert.equal(effectivePriceHistory(snapped, T0).at(-1).maturation_days, 5);
        assert.deepEqual(recentPointPriceChange(chat, NOW), { old: '0.02', new: '0.005', at: NOW - DAY, changes: 1, reason: null });
        assert.deepEqual(serializePriceHistory(chat, 10, T0)[0], { old: '0.02', new: '0.005', at: NOW - DAY, by: 7, reason: null });
        // not due yet: nothing changed for members
        assert.equal(recentPointPriceChange(chat, NOW - 2 * DAY), null);
    });
});

test('planPointPriceChange: an increase applies at once and is announced', () => {
    withRate('0.01', () => {
        const plan = planPointPriceChange({ id: 5, point_price: '0.02' }, '0.03', OPTS);
        assert.deepEqual(plan.filter, { id: 5, point_price: '0.02', point_price_pending: null });
        assert.deepEqual(plan.update, {
            $set: { point_price: '0.03' },
            // no $slice: the history is never trimmed
            $push: {
                point_price_history: { $each: [{ old: '0.02', new: '0.03', at: T0, by: 42, maturation_days: 3, from_default: false }] },
            },
        });
        assert.deepEqual(plan.announcements, [
            {
                type: 'price_increased',
                params: { from: '0.02', to: '0.03', symbol: 'PTS', cancelled_pending: false },
                ref: T0.getTime(),
            },
        ]);
        assert.equal(plan.after, '0.03');
        // same price: nothing to do
        assert.equal(planPointPriceChange({ id: 5, point_price: '0.02' }, '0.02', OPTS), null);
        assert.equal(planPointPriceChange({ id: 5 }, null, OPTS), null);
        // custom price equal to the default -> default: the effective price
        // does not move, so nothing is announced, but the switch to the
        // default is logged (which platform changes reach the chat's points
        // depends on it)
        const same = planPointPriceChange({ id: 5, point_price: '0.01' }, null, OPTS);
        assert.deepEqual(same.update, {
            $unset: { point_price: '' },
            $push: { point_price_history: { $each: [{ old: '0.01', new: '0.01', at: T0, by: 42, maturation_days: 3, from_default: false }] } },
        });
        assert.deepEqual(same.announcements, []);
        assert.equal(
            planPointPriceChange({ id: 5 }, '0.01', OPTS).update.$push.point_price_history.$each[0].from_default,
            true,
        );
    });
});

test('planPointPriceChange: a decrease is scheduled, not applied', () => {
    withRate('0.01', () => {
        const plan = planPointPriceChange({ id: 5, point_price: '0.02' }, '0.015', OPTS);
        assert.deepEqual(plan.filter, { id: 5, point_price: '0.02', point_price_pending: null });
        assert.deepEqual(plan.update, {
            $set: {
                point_price_pending: {
                    price: '0.015',
                    to_default: false,
                    from: '0.02',
                    symbol: 'PTS',
                    effective_at: at(7),
                    requested_at: T0,
                    by: 42,
                    maturation_days: 3,
                    from_default: false,
                },
            },
        });
        assert.deepEqual(plan.announcements, [
            {
                type: 'price_decrease_scheduled',
                params: { from: '0.02', to: '0.015', symbol: 'PTS', effective_at: at(7) },
                // the outbox key: the decrease's requested_at
                ref: T0.getTime(),
            },
        ]);
        assert.equal(plan.after, '0.02');

        // "Use default" with a lower default is a decrease too
        const reset = planPointPriceChange({ id: 5, point_price: '0.02' }, null, OPTS);
        assert.equal(reset.update.$set.point_price_pending.to_default, true);
        assert.equal(reset.update.$set.point_price_pending.price, '0.01');
        assert.equal(reset.update.$unset, undefined);
        // ...but with a higher default it applies at once
        const up = planPointPriceChange({ id: 5, point_price: '0.005' }, null, OPTS);
        assert.deepEqual(up.update.$unset, { point_price: '' });
        assert.deepEqual(up.announcements.map((a) => a.type), ['price_increased']);
        // from the default to a lower custom price
        const fromDefault = planPointPriceChange({ id: 5 }, '0.001', OPTS);
        assert.equal(fromDefault.update.$set.point_price_pending.from, '0.01');
        assert.equal(fromDefault.filter.point_price, null);
    });
});

test('planPointPriceChange: notice 0 schedules the decrease for right now, unannounced ahead', () => {
    withRate('0.01', () => {
        const plan = planPointPriceChange({ id: 5, point_price: '0.02' }, '0.015', { ...OPTS, noticeDays: 0 });
        assert.deepEqual(plan.update.$set.point_price_pending.effective_at, T0);
        // the bot's own "price decreased" message covers it when it applies it
        assert.deepEqual(plan.announcements, []);
        // and it already pays
        const chat = { id: 5, point_price: '0.02', point_price_pending: plan.update.$set.point_price_pending };
        assert.equal(pointPriceFor(chat, T0), '0.015');
    });
});

test('planPointPriceChange: a new decrease replaces the pending one with a fresh notice', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02', point_price_pending: pendingOf('0.015', at(2), { from: '0.02' }) };
        const plan = planPointPriceChange(chat, '0.012', OPTS);
        assert.deepEqual(plan.filter, { id: 5, point_price: '0.02', 'point_price_pending.requested_at': at(-1) });
        assert.equal(plan.update.$set.point_price_pending.price, '0.012');
        assert.equal(plan.update.$set.point_price_pending.from, '0.02');
        assert.deepEqual(plan.update.$set.point_price_pending.effective_at, at(7));
        assert.equal(plan.update.$push, undefined);
        assert.deepEqual(plan.announcements.map((a) => a.type), ['price_decrease_scheduled']);
    });
});

test('planPointPriceChange: the same target as the pending decrease is a no-op', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02', point_price_pending: pendingOf('0.015', at(2), { from: '0.02' }) };
        // no new effective_at, no new announcement
        assert.equal(planPointPriceChange(chat, '0.015', OPTS), null);
        // the route canonicalizes first, so another spelling is the same target
        assert.equal(planPointPriceChange(chat, normalizePointPrice('0.0150'), OPTS), null);
        // "Use default" while the same "back to default" decrease waits
        const toDefault = { ...chat, point_price_pending: pendingOf('0.01', at(2), { from: '0.02', to_default: true }) };
        assert.equal(planPointPriceChange(toDefault, null, OPTS), null);
        // a custom price equal to the default is a different target (it stays
        // put if the default changes): replaced
        assert.equal(planPointPriceChange(toDefault, '0.01', OPTS).update.$set.point_price_pending.to_default, false);
        assert.equal(planPointPriceChange(chat, null, OPTS).update.$set.point_price_pending.to_default, true);
        // once due it is no longer "scheduled": a new request is a new decrease
        assert.notEqual(planPointPriceChange(chat, '0.012', { ...OPTS, now: at(3) }), null);
    });
});

test('planPointPriceChange: an equal price or an increase cancels the pending decrease', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02', point_price_pending: pendingOf('0.015', at(2), { from: '0.02' }) };
        const equal = planPointPriceChange(chat, '0.02', OPTS);
        assert.deepEqual(equal.update, { $unset: { point_price_pending: '' } });
        assert.deepEqual(equal.announcements, [
            {
                type: 'price_decrease_cancelled',
                params: { from: '0.02', to: '0.015', symbol: 'PTS' },
                ref: at(-1).getTime(),
            },
        ]);

        const up = planPointPriceChange(chat, '0.05', OPTS);
        assert.deepEqual(up.update.$set, { point_price: '0.05' });
        assert.deepEqual(up.update.$unset, { point_price_pending: '' });
        assert.deepEqual(up.announcements, [
            {
                type: 'price_increased',
                params: { from: '0.02', to: '0.05', symbol: 'PTS', cancelled_pending: true },
                ref: T0.getTime(),
            },
        ]);
    });
});

test('planPointPriceChange writes out a due decrease the bot has not applied yet', () => {
    withRate('0.01', () => {
        const chat = {
            id: 5,
            point_price: '0.02',
            point_price_pending: pendingOf('0.005', at(-1), { from: '0.02' }),
        };
        // scheduled before snapshots: it gets the current setting when written out
        const dueEntry = { old: '0.02', new: '0.005', at: at(-1), by: 7, maturation_days: 3, from_default: false };

        const decreased = { type: 'price_decreased', params: { from: '0.02', to: '0.005', symbol: 'PTS' }, ref: at(-1).getTime() };

        // an increase from the due price: both changes are logged and
        // announced, the written-out drop first
        const up = planPointPriceChange(chat, '0.008', OPTS);
        assert.deepEqual(up.announcements, [
            decreased,
            {
                type: 'price_increased',
                params: { from: '0.005', to: '0.008', symbol: 'PTS', cancelled_pending: false },
                ref: T0.getTime(),
            },
        ]);
        assert.deepEqual(up.update.$push.point_price_history.$each, [
            dueEntry,
            { old: '0.005', new: '0.008', at: T0, by: 42, maturation_days: 3, from_default: false },
        ]);
        assert.deepEqual(up.update.$unset, { point_price_pending: '' });

        // a new decrease: the due one lands in point_price, the new one waits
        const down = planPointPriceChange(chat, '0.004', OPTS);
        assert.equal(down.update.$set.point_price, '0.005');
        assert.equal(down.update.$set.point_price_pending.from, '0.005');
        assert.deepEqual(down.update.$push.point_price_history.$each, [dueEntry]);
        assert.deepEqual(down.announcements.map((a) => a.type), ['price_decreased', 'price_decrease_scheduled']);
        // the pending's symbol when the jetton cannot be read now
        assert.deepEqual(planPointPriceChange(chat, '0.004', { ...OPTS, symbol: null }).announcements[0], decreased);

        // the due price itself: written out and announced, nothing else
        const same = planPointPriceChange(chat, '0.005', OPTS);
        assert.deepEqual(same.update, {
            $set: { point_price: '0.005' },
            $unset: { point_price_pending: '' },
            $push: { point_price_history: { $each: [dueEntry] } },
        });
        assert.deepEqual(same.announcements, [decreased]);

        // the stored price again: an increase from the due price
        assert.deepEqual(
            planPointPriceChange(chat, '0.02', OPTS).announcements.map((a) => a.type),
            ['price_decreased', 'price_increased'],
        );

        // a due "back to default": point_price is unset
        const toDefault = { ...chat, point_price_pending: pendingOf('0.01', at(-1), { from: '0.02', to_default: true }) };
        const again = planPointPriceChange(toDefault, '0.001', OPTS);
        assert.deepEqual(again.update.$unset, { point_price: '' });
        assert.equal(again.update.$set.point_price_pending.from, '0.01');
        assert.equal(again.update.$set.point_price_pending.from_default, true);
        // `to` is the price it was scheduled to, as the bot logs it; with the
        // default moved since, the chat keeps that price as its own
        withRate('0.012', () => {
            const moved = planPointPriceChange(toDefault, '0.001', OPTS);
            assert.deepEqual(moved.announcements[0], {
                type: 'price_decreased',
                params: { from: '0.02', to: '0.01', symbol: 'PTS' },
                ref: at(-1).getTime(),
            });
            assert.equal(moved.update.$set.point_price, '0.01');
            assert.equal(moved.update.$set.point_price_pending.from_default, false);
        });
    });
});

test('planPointPriceChange replaces corrupted state at once', () => {
    withRate('0.01', () => {
        const corrupt = planPointPriceChange({ id: 5, point_price: 'abc' }, '0.001', OPTS);
        assert.deepEqual(corrupt.update.$set, { point_price: '0.001' });
        assert.deepEqual(corrupt.announcements, []);

        const malformed = { id: 5, point_price: '0.02', point_price_pending: { price: 'x', requested_at: at(-1) } };
        const plan = planPointPriceChange(malformed, '0.001', OPTS);
        assert.deepEqual(plan.update.$set, { point_price: '0.001' });
        assert.deepEqual(plan.update.$unset, { point_price_pending: '' });
        assert.deepEqual(plan.filter, { id: 5, point_price: '0.02', 'point_price_pending.requested_at': at(-1) });
        // even saving the stored price clears it
        assert.deepEqual(planPointPriceChange(malformed, '0.02', OPTS).update, { $unset: { point_price_pending: '' } });
    });
});

test('planPointPriceCancel cancels a pending decrease explicitly', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02', point_price_pending: pendingOf('0.015', at(2), { from: '0.02' }) };
        const plan = planPointPriceCancel(chat, { now: T0, symbol: 'PTS' });
        assert.deepEqual(plan.filter, { id: 5, point_price: '0.02', 'point_price_pending.requested_at': at(-1) });
        assert.deepEqual(plan.update, { $unset: { point_price_pending: '' } });
        assert.deepEqual(plan.announcements, [
            {
                type: 'price_decrease_cancelled',
                params: { from: '0.02', to: '0.015', symbol: 'PTS' },
                ref: at(-1).getTime(),
            },
        ]);

        assert.throws(() => planPointPriceCancel({ id: 5 }, { now: T0 }), (e) => e.status === 409);
        assert.throws(() => planPointPriceCancel(chat, { now: at(2) }), (e) => e.status === 409 && /already/.test(e.message));

        const malformed = planPointPriceCancel({ id: 5, point_price_pending: { price: 'x' } }, { now: T0 });
        assert.deepEqual(malformed.announcements, []);
        assert.deepEqual(malformed.update, { $unset: { point_price_pending: '' } });
    });
});

test('announcementDoc is the outbox row the bot drains, keyed so it is queued once', () => {
    const doc = announcementDoc(
        -100123,
        { type: 'price_increased', params: { from: '1', to: '2', symbol: null, cancelled_pending: false }, ref: at(-1).getTime() },
        T0,
    );
    assert.deepEqual(doc, {
        key: `-100123:price_increased:${at(-1).getTime()}`,
        chat_id: -100123,
        type: 'price_increased',
        params: { from: '1', to: '2', symbol: null, cancelled_pending: false },
        created_at: T0,
        sent_at: null,
        claimed_at: null,
        attempts: 0,
    });
    // without a ref the row is about its own moment
    assert.equal(announcementDoc(1, { type: 'price_increased', params: {} }, T0).key, `1:price_increased:${T0.getTime()}`);
});

test('scheduledAnnouncement rebuilds the row a pending decrease was announced with', () => {
    withRate('0.01', () => {
        const plan = planPointPriceChange({ id: 5, point_price: '0.02' }, '0.015', OPTS);
        const chat = { id: 5, point_price: '0.02', point_price_pending: plan.update.$set.point_price_pending };
        // the same row, under the same key, as the save queued
        assert.deepEqual(scheduledAnnouncement(chat, T0), plan.announcements[0]);
        assert.equal(
            announcementDoc(5, scheduledAnnouncement(chat, at(1)), T0).key,
            announcementDoc(5, plan.announcements[0], T0).key,
        );
        // none once due, without a pending, or for a malformed one
        assert.equal(scheduledAnnouncement(chat, at(7)), null);
        assert.equal(scheduledAnnouncement({ id: 5 }, T0), null);
        assert.equal(scheduledAnnouncement({ id: 5, point_price_pending: { price: 'x' } }, T0), null);
        // nor for a decrease scheduled with no notice (nothing was announced ahead)
        const now = planPointPriceChange({ id: 5, point_price: '0.02' }, '0.015', { ...OPTS, noticeDays: 0 });
        assert.equal(scheduledAnnouncement({ id: 5, point_price_pending: now.update.$set.point_price_pending }, at(-1)), null);
    });
});

test('planPointPriceChange snapshots the maturation into history entries and the pending decrease', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02' };
        const opts = { ...OPTS, maturationDays: 5 };
        assert.equal(planPointPriceChange(chat, '0.03', opts).update.$push.point_price_history.$each[0].maturation_days, 5);
        assert.equal(planPointPriceChange(chat, '0.015', opts).update.$set.point_price_pending.maturation_days, 5);
        assert.equal(planPointPriceChange(chat, '0.015', { ...OPTS, maturationDays: 0 }).update.$set.point_price_pending.maturation_days, 0);
        // a due decrease keeps the maturation it was scheduled (or last kept in
        // step) with, not the setting at the time it is written out
        const due = { ...chat, point_price_pending: pendingOf('0.005', at(-1), { from: '0.02', maturation_days: 10 }) };
        const plan = planPointPriceChange(due, '0.008', opts);
        assert.deepEqual(
            plan.update.$push.point_price_history.$each.map((h) => h.maturation_days),
            [10, 5],
        );
        assert.equal(pendingPointPrice(due).maturation_days, 10);
        // unreadable snapshots read as none
        for (const bad of ['3', -1, 1.5, null]) {
            assert.equal(pendingPointPrice({ point_price_pending: pendingOf('0.005', at(1), { maturation_days: bad }) }).maturation_days, null);
        }
    });
});

// ---- Claim windows during the notice (issue #14) ----

const {
    claimWindows,
    noticeEffectiveAt,
    decreasePreview,
    serializeClaimWindows,
    CLAIMS_PAUSED_NO_END,
} = require('../src/lib/point-price');

const HOUR_MS = 3600 * 1000;
const DAY_MS = DAY * 1000;
// Monday 5 Oct 2026, 00:00 UTC
const MON = Date.UTC(2026, 9, 5);
const utc = (days, hours = 0) => new Date(MON + days * DAY_MS + hours * HOUR_MS);
const rules = (extra = {}) => ({ maturation_days: 3, claim_days: [], paused: false, paused_until: null, ...extra });

test('claimWindows lists the open stretches in UTC, consecutive days merged', () => {
    // Mon and Thu, from Tuesday noon over 9 days
    const weekly = rules({ claim_days: [1, 4] });
    assert.deepEqual(claimWindows(weekly, utc(1, 12).getTime(), utc(10, 12).getTime()), [
        { start: utc(3).getTime(), end: utc(4).getTime() },
        { start: utc(7).getTime(), end: utc(8).getTime() },
        { start: utc(10).getTime(), end: utc(10, 12).getTime() },
    ]);
    // every day: one stretch, clipped at both ends
    assert.deepEqual(claimWindows(rules(), utc(0, 5).getTime(), utc(3, 7).getTime()), [
        { start: utc(0, 5).getTime(), end: utc(3, 7).getTime() },
    ]);
    // Mon + Tue merge into one window
    assert.deepEqual(claimWindows(rules({ claim_days: [1, 2] }), utc(0).getTime(), utc(7).getTime()), [
        { start: utc(0).getTime(), end: utc(2).getTime() },
    ]);
    // a pause until Wednesday noon removes everything before it
    const paused = rules({ paused: true, paused_until: utc(2, 12).getTime() / 1000 });
    assert.deepEqual(claimWindows(paused, utc(0).getTime(), utc(4).getTime()), [
        { start: utc(2, 12).getTime(), end: utc(4).getTime() },
    ]);
    // paused with no end date: nothing
    assert.deepEqual(claimWindows(rules({ paused: true }), utc(0).getTime(), utc(30).getTime()), []);
    assert.deepEqual(claimWindows(rules(), utc(2).getTime(), utc(1).getTime()), []);
});

test('noticeEffectiveAt: claims open every day leave the notice unchanged', () => {
    for (const settings of [rules(), rules({ claim_days: [0, 1, 2, 3, 4, 5, 6] })]) {
        for (const days of [1, 3, 7]) {
            const now = utc(0, 13.5);
            const eff = new Date(now.getTime() + days * DAY_MS);
            assert.equal(noticeEffectiveAt(settings, now, eff), eff);
        }
    }
    // a pause that already ended counts for nothing
    const ended = rules({ paused: true, paused_until: utc(-1).getTime() / 1000 });
    const eff = utc(3, 13);
    assert.equal(noticeEffectiveAt(ended, utc(0, 13), eff), eff);
});

test('noticeEffectiveAt: a weekly window and a 3-day notice: extended to the end of the next claim day', () => {
    const mondays = rules({ claim_days: [1] });
    // Tuesday 10:00, notice ends Friday 10:00: no Monday in it
    assert.deepEqual(noticeEffectiveAt(mondays, utc(1, 10), utc(4, 10)), utc(8));
    // requested on the Monday itself, mid-day: the rest of it is not a full
    // claim day, so it waits for the next Monday
    assert.deepEqual(noticeEffectiveAt(mondays, utc(0, 12), utc(3, 12)), utc(8));
    // ...but from Monday 00:00 sharp the whole day is in the notice
    const eff = utc(3);
    assert.equal(noticeEffectiveAt(mondays, utc(0), eff), eff);
    // a 7-day notice from Tuesday holds the next Monday: unchanged
    const week = utc(8, 10);
    assert.equal(noticeEffectiveAt(mondays, utc(1, 10), week), week);
    // a notice ending inside the claim day is extended to its end
    assert.deepEqual(noticeEffectiveAt(mondays, utc(1, 10), utc(7, 10)), utc(8));
});

test('noticeEffectiveAt counts UTC days, not the viewer\'s', () => {
    // Sunday 23:30 UTC is already Monday in Moscow: not a claim day for a
    // Monday-only chat until 00:00 UTC
    const mondays = rules({ claim_days: [1] });
    assert.deepEqual(noticeEffectiveAt(mondays, utc(-1, 23.5), utc(0, 23.5)), utc(1));
    // a decrease landing exactly at the end of the claim day is covered
    const exact = utc(1);
    assert.equal(noticeEffectiveAt(mondays, utc(-1, 23.5), exact), exact);
    // one millisecond short of the end is not
    assert.deepEqual(noticeEffectiveAt(mondays, utc(-1, 23.5), new Date(exact.getTime() - 1)), exact);
});

test('noticeEffectiveAt waits for a full claim day after a pause; none when paused for good', () => {
    // paused until Thursday 00:00, every day open: Thursday is the window
    const untilThu = rules({ paused: true, paused_until: utc(3).getTime() / 1000 });
    assert.deepEqual(noticeEffectiveAt(untilThu, utc(0, 9), utc(3, 9)), utc(4));
    // a longer notice already holds it
    assert.equal(noticeEffectiveAt(untilThu, utc(0, 9), utc(7, 9)).getTime(), utc(7, 9).getTime());
    // paused until Thursday noon on a Monday/Thursday chat: the Thursday
    // half-day is not enough, the next Monday is
    const mixed = rules({ claim_days: [1, 4], paused: true, paused_until: utc(3, 12).getTime() / 1000 });
    assert.deepEqual(noticeEffectiveAt(mixed, utc(0, 9), utc(3, 9)), utc(8));
    // paused with no end date: no window ever
    assert.equal(noticeEffectiveAt(rules({ paused: true }), utc(0), utc(7)), null);
    // no notice (0 days) stays none
    const now = utc(1, 10);
    assert.equal(noticeEffectiveAt(rules({ claim_days: [1] }), now, now), now);
});

test('decreasePreview says when a decrease requested now applies and when members can claim', () => {
    const now = utc(1, 10); // Tuesday
    const weekly = decreasePreview(rules({ claim_days: [1, 4] }), now, 3);
    // Thursday is inside the 3-day notice: not extended
    assert.equal(weekly.extended, false);
    assert.equal(weekly.effective_at, utc(4, 10).getTime() / 1000);
    assert.equal(weekly.notice_ends_at, utc(4, 10).getTime() / 1000);
    assert.deepEqual(weekly.claim_windows, [{ start: utc(3).getTime() / 1000, end: utc(4).getTime() / 1000 }]);
    assert.equal(weekly.claims_open_throughout, false);

    const mondays = decreasePreview(rules({ claim_days: [1] }), now, 3);
    assert.equal(mondays.extended, true);
    assert.equal(mondays.effective_at, utc(8).getTime() / 1000);
    assert.deepEqual(mondays.claim_windows, [{ start: utc(7).getTime() / 1000, end: utc(8).getTime() / 1000 }]);

    const daily = decreasePreview(rules(), now, 3);
    assert.equal(daily.extended, false);
    assert.equal(daily.claims_open_throughout, true);

    const stuck = decreasePreview(rules({ paused: true }), now, 3);
    assert.equal(stuck.effective_at, null);
    assert.deepEqual(stuck.claim_windows, []);

    assert.deepEqual(serializeClaimWindows(rules(), now, now), { claim_windows: [], claims_open_throughout: false });
});

test('planPointPriceChange fits a new decrease to the claim rules', () => {
    withRate('0.01', () => {
        const now = utc(1, 10); // Tuesday
        const opts = { ...OPTS, now, noticeDays: 3 };
        const chat = { id: 5, point_price: '0.02' };
        // without claim settings: exactly the notice, as before
        assert.deepEqual(planPointPriceChange(chat, '0.015', opts).update.$set.point_price_pending.effective_at, utc(4, 10));
        // Monday-only claims: the next Monday must be in it
        const plan = planPointPriceChange(chat, '0.015', { ...opts, claimSettings: rules({ claim_days: [1] }) });
        assert.deepEqual(plan.update.$set.point_price_pending.effective_at, utc(8));
        // and the bot announces that date
        assert.deepEqual(plan.announcements[0].params.effective_at, utc(8));
        // every day open: unchanged
        assert.deepEqual(
            planPointPriceChange(chat, '0.015', { ...opts, claimSettings: rules() }).update.$set.point_price_pending.effective_at,
            utc(4, 10),
        );
        // paused with no end date: refused
        assert.throws(
            () => planPointPriceChange(chat, '0.015', { ...opts, claimSettings: rules({ paused: true }) }),
            (e) => e.status === 409 && e.message === CLAIMS_PAUSED_NO_END,
        );
        // ...but an increase still applies
        assert.equal(planPointPriceChange(chat, '0.05', { ...opts, claimSettings: rules({ paused: true }) }).after, '0.05');
        // notice 0: right away whatever the rules
        const zero = planPointPriceChange(chat, '0.015', { ...opts, noticeDays: 0, claimSettings: rules({ paused: true }) });
        assert.deepEqual(zero.update.$set.point_price_pending.effective_at, now);
    });
});

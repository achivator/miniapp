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
    assert.deepEqual(recentPointPriceChange(chat, NOW), { old: '0.005', new: '0.01', at: NOW - DAY, changes: 2 });
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
        { old: '0.02', new: '0.03', at: 2000, by: 7 },
        { old: '0.01', new: '0.02', at: 1000, by: 7 },
    ]);
    assert.deepEqual(serializePriceHistory(chat, 1), [{ old: '0.02', new: '0.03', at: 2000, by: 7 }]);
    assert.deepEqual(serializePriceHistory({}), []);
});

// --- notice period for decreases -------------------------------------------

const T0 = new Date(NOW * 1000);
const at = (days) => new Date(T0.getTime() + days * DAY * 1000);
const OPTS = { now: T0, noticeDays: 7, by: 42, symbol: 'PTS' };

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
        });

        // back to the default: once due, the live default pays (what the chat
        // gets once the bot unsets point_price), even if it moved since
        const toDefault = { id: 1, point_price: '0.02', point_price_pending: pendingOf('0.01', at(3), { to_default: true }) };
        assert.equal(pointPriceFor(toDefault, at(4)), '0.01');
        assert.equal(hasCustomPointPrice(toDefault, at(4)), false);
        assert.equal(hasCustomPointPrice(toDefault, T0), true);
        withRate('0.008', () => {
            assert.equal(pointPriceFor(toDefault, at(4)), '0.008');
            assert.equal(serializePendingPrice(upcomingPointPrice(toDefault, T0)).price, '0.008');
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
        assert.deepEqual(effectivePriceHistory(chat, T0).at(-1), { old: '0.02', new: '0.005', at: at(-1), by: 7 });
        assert.deepEqual(recentPointPriceChange(chat, NOW), { old: '0.02', new: '0.005', at: NOW - DAY, changes: 1 });
        assert.deepEqual(serializePriceHistory(chat, 10, T0)[0], { old: '0.02', new: '0.005', at: NOW - DAY, by: 7 });
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
            $push: { point_price_history: { $each: [{ old: '0.02', new: '0.03', at: T0, by: 42 }], $slice: -50 } },
        });
        assert.deepEqual(plan.announcement, {
            type: 'price_increased',
            params: { from: '0.02', to: '0.03', symbol: 'PTS', cancelled_pending: false },
        });
        assert.equal(plan.after, '0.03');
        // same price: nothing to do
        assert.equal(planPointPriceChange({ id: 5, point_price: '0.02' }, '0.02', OPTS), null);
        assert.equal(planPointPriceChange({ id: 5 }, null, OPTS), null);
        // custom price equal to the default -> default: stored changes, the
        // effective price does not, so no history and no announcement
        const same = planPointPriceChange({ id: 5, point_price: '0.01' }, null, OPTS);
        assert.deepEqual(same.update, { $unset: { point_price: '' } });
        assert.equal(same.announcement, null);
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
                },
            },
        });
        assert.deepEqual(plan.announcement, {
            type: 'price_decrease_scheduled',
            params: { from: '0.02', to: '0.015', symbol: 'PTS', effective_at: at(7) },
        });
        assert.equal(plan.after, '0.02');

        // "Use default" with a lower default is a decrease too
        const reset = planPointPriceChange({ id: 5, point_price: '0.02' }, null, OPTS);
        assert.equal(reset.update.$set.point_price_pending.to_default, true);
        assert.equal(reset.update.$set.point_price_pending.price, '0.01');
        assert.equal(reset.update.$unset, undefined);
        // ...but with a higher default it applies at once
        const up = planPointPriceChange({ id: 5, point_price: '0.005' }, null, OPTS);
        assert.deepEqual(up.update.$unset, { point_price: '' });
        assert.equal(up.announcement.type, 'price_increased');
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
        assert.equal(plan.announcement, null);
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
        assert.equal(plan.announcement.type, 'price_decrease_scheduled');
    });
});

test('planPointPriceChange: an equal price or an increase cancels the pending decrease', () => {
    withRate('0.01', () => {
        const chat = { id: 5, point_price: '0.02', point_price_pending: pendingOf('0.015', at(2), { from: '0.02' }) };
        const equal = planPointPriceChange(chat, '0.02', OPTS);
        assert.deepEqual(equal.update, { $unset: { point_price_pending: '' } });
        assert.deepEqual(equal.announcement, {
            type: 'price_decrease_cancelled',
            params: { from: '0.02', to: '0.015', symbol: 'PTS' },
        });

        const up = planPointPriceChange(chat, '0.05', OPTS);
        assert.deepEqual(up.update.$set, { point_price: '0.05' });
        assert.deepEqual(up.update.$unset, { point_price_pending: '' });
        assert.deepEqual(up.announcement, {
            type: 'price_increased',
            params: { from: '0.02', to: '0.05', symbol: 'PTS', cancelled_pending: true },
        });
    });
});

test('planPointPriceChange writes out a due decrease the bot has not applied yet', () => {
    withRate('0.01', () => {
        const chat = {
            id: 5,
            point_price: '0.02',
            point_price_pending: pendingOf('0.005', at(-1), { from: '0.02' }),
        };
        const dueEntry = { old: '0.02', new: '0.005', at: at(-1), by: 7 };

        // an increase from the due price: both changes are logged, in order
        const up = planPointPriceChange(chat, '0.008', OPTS);
        assert.equal(up.announcement.type, 'price_increased');
        assert.deepEqual(up.announcement.params, { from: '0.005', to: '0.008', symbol: 'PTS', cancelled_pending: false });
        assert.deepEqual(up.update.$push.point_price_history.$each, [dueEntry, { old: '0.005', new: '0.008', at: T0, by: 42 }]);
        assert.deepEqual(up.update.$unset, { point_price_pending: '' });

        // a new decrease: the due one lands in point_price, the new one waits
        const down = planPointPriceChange(chat, '0.004', OPTS);
        assert.equal(down.update.$set.point_price, '0.005');
        assert.equal(down.update.$set.point_price_pending.from, '0.005');
        assert.deepEqual(down.update.$push.point_price_history.$each, [dueEntry]);

        // the stored price again: an increase from the due price
        assert.equal(planPointPriceChange(chat, '0.02', OPTS).announcement.type, 'price_increased');

        // a due "back to default": point_price is unset
        const toDefault = { ...chat, point_price_pending: pendingOf('0.01', at(-1), { from: '0.02', to_default: true }) };
        const again = planPointPriceChange(toDefault, '0.001', OPTS);
        assert.deepEqual(again.update.$unset, { point_price: '' });
        assert.equal(again.update.$set.point_price_pending.from, '0.01');
    });
});

test('planPointPriceChange replaces corrupted state at once', () => {
    withRate('0.01', () => {
        const corrupt = planPointPriceChange({ id: 5, point_price: 'abc' }, '0.001', OPTS);
        assert.deepEqual(corrupt.update.$set, { point_price: '0.001' });
        assert.equal(corrupt.announcement, null);

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
        assert.deepEqual(plan.announcement, {
            type: 'price_decrease_cancelled',
            params: { from: '0.02', to: '0.015', symbol: 'PTS' },
        });

        assert.throws(() => planPointPriceCancel({ id: 5 }, { now: T0 }), (e) => e.status === 409);
        assert.throws(() => planPointPriceCancel(chat, { now: at(2) }), (e) => e.status === 409 && /already/.test(e.message));

        const malformed = planPointPriceCancel({ id: 5, point_price_pending: { price: 'x' } }, { now: T0 });
        assert.equal(malformed.announcement, null);
        assert.deepEqual(malformed.update, { $unset: { point_price_pending: '' } });
    });
});

test('announcementDoc is the outbox row the bot drains', () => {
    const doc = announcementDoc(-100123, { type: 'price_increased', params: { from: '1', to: '2', symbol: null, cancelled_pending: false } }, T0);
    assert.deepEqual(doc, {
        chat_id: -100123,
        type: 'price_increased',
        params: { from: '1', to: '2', symbol: null, cancelled_pending: false },
        created_at: T0,
        sent_at: null,
        claimed_at: null,
        attempts: 0,
    });
});

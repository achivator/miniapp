const { getCollection } = require('./mongo');
const { DATE_MS, dateMatch } = require('./lot-dates');
const { claimPauseEndMs, claimWindows, noticeEffectiveAt, upcomingPointPrice } = require('./point-price');

// Per-chat claim rules, set by the chat creator in the mini app and enforced
// by the backend: it simply refuses to sign a claim voucher that breaks them.
// Off-chain on purpose - no TON and no wallet needed to change them. (The
// on-chain pool pause/limit are the separate emergency brake for a leaked
// backend key.)
//
//   maturation_days  new points (reactions, /reward grants) become claimable
//                    only after this many days, so points farmed with friends
//                    cannot be cashed out before the admin notices;
//   claim_days       UTC weekdays (0 = Sunday) when claims are open; empty =
//                    every day;
//   paused           "on vacation": no claims at all, until paused_until
//                    (epoch seconds) or indefinitely when it is null.

const DAY = 86400;
const MAX_MATURATION_DAYS = 30;

function defaultMaturationDays() {
    const n = Number(process.env.MATURATION_DAYS ?? 3);
    return Number.isInteger(n) && n >= 0 && n <= MAX_MATURATION_DAYS ? n : 3;
}

// Normalizes a stored or submitted settings object; throws on invalid input.
function normalizeClaimSettings(raw = {}) {
    const maturation = raw.maturation_days ?? defaultMaturationDays();
    if (!Number.isInteger(maturation) || maturation < 0 || maturation > MAX_MATURATION_DAYS) {
        throw new Error(`maturation_days must be an integer 0…${MAX_MATURATION_DAYS}`);
    }
    const days = raw.claim_days ?? [];
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new Error('claim_days must be weekday numbers 0…6');
    }
    const pausedUntil = raw.paused_until ?? null;
    if (pausedUntil !== null && (!Number.isSafeInteger(pausedUntil) || pausedUntil <= 0)) {
        throw new Error('paused_until must be epoch seconds or null');
    }
    return {
        maturation_days: maturation,
        claim_days: [...new Set(days)].sort(),
        paused: Boolean(raw.paused),
        paused_until: raw.paused ? pausedUntil : null,
    };
}

function claimSettingsOf(chat) {
    try {
        return normalizeClaimSettings(chat?.claim_settings || {});
    } catch {
        return normalizeClaimSettings({});
    }
}

// Whether claims are open right now, and if not, why and until when.
function claimGate(settings, nowSec = Math.floor(Date.now() / 1000)) {
    if (settings.paused && (settings.paused_until === null || settings.paused_until > nowSec)) {
        return { open: false, reason: 'paused', until: settings.paused_until };
    }
    if (settings.claim_days.length > 0) {
        const today = new Date(nowSec * 1000).getUTCDay();
        if (!settings.claim_days.includes(today)) {
            const startOfToday = nowSec - (nowSec % DAY);
            for (let i = 1; i <= 7; i++) {
                if (settings.claim_days.includes((today + i) % 7)) {
                    return { open: false, reason: 'window', until: startOfToday + i * DAY };
                }
            }
        }
    }
    return { open: true, reason: null, until: null };
}

// While a price decrease is pending, members were told to claim at the
// current price before it (point-price.js), so the claim rules must not take
// that chance away. Refused (409, `code` for the UI):
//   pause      a new pause, or a longer one: claims cannot be paused at all
//              until the decrease takes effect;
//   no_window  rules that leave less open claim time before the decrease
//              and no full claim window (a UTC day of open claims) in it.
// Rules that do not narrow claims before the decrease (another maturation,
// more claim days, an earlier resume date) are always fine. `current` and
// `next` are normalized settings. Returns null when the save may go ahead.
const CLAIM_RULES_CONFLICT = {
    pause: 'claims cannot be paused while a price decrease is pending: members must be able to claim at the current price until it takes effect',
    no_window: 'these claim days leave members no full claim day before the scheduled price decrease',
};

function openMsBefore(settings, nowMs, effMs) {
    return claimWindows(settings, nowMs, effMs).reduce((sum, w) => sum + (w.end - w.start), 0);
}

function claimRulesConflict(current, next, chat, now = new Date()) {
    let pending = null;
    try {
        pending = upcomingPointPrice(chat, now);
    } catch {
        // a malformed pending pays nothing until the creator saves a price
        pending = null;
    }
    if (!pending) return null;
    const effectiveAt = pending.effective_at;
    const conflict = (code) => ({ code, error: CLAIM_RULES_CONFLICT[code], effective_at: effectiveAt });
    const nowMs = now.getTime();
    if (claimPauseEndMs(next) > Math.max(nowMs, claimPauseEndMs(current))) return conflict('pause');
    const effMs = effectiveAt.getTime();
    const covered = noticeEffectiveAt(next, now, effectiveAt);
    if (covered !== null && covered.getTime() <= effMs) return null;
    return openMsBefore(next, nowMs, effMs) < openMsBefore(current, nowMs, effMs) ? conflict('no_window') : null;
}

// Points still maturing for a member: reaction points and grants younger than
// the maturation period (dated either way, see lot-dates.js), plus when the
// oldest of them matures.
async function maturingPoints(chatId, userId, maturationDays, nowSec = Math.floor(Date.now() / 1000)) {
    if (!maturationDays) return { points: 0, next_at: null };
    const cutoffSec = nowSec - maturationDays * DAY;
    const [reactions, grants] = await Promise.all([
        (await getCollection('reaction_points'))
            .aggregate([
                { $match: { chat_id: chatId, receiver_id: userId, ...dateMatch({ gt: cutoffSec * 1000 }) } },
                { $group: { _id: null, points: { $sum: '$points' }, oldest: { $min: DATE_MS } } },
            ])
            .toArray(),
        (await getCollection('grants'))
            .aggregate([
                { $match: { chat_id: chatId, user_id: userId, ...dateMatch({ gt: cutoffSec * 1000 }) } },
                { $group: { _id: null, points: { $sum: '$points' }, oldest: { $min: DATE_MS } } },
            ])
            .toArray(),
    ]);
    const points = (reactions[0]?.points || 0) + (grants[0]?.points || 0);
    const oldestMs = Math.min(
        reactions[0] ? Number(reactions[0].oldest) : Infinity,
        grants[0] ? Number(grants[0].oldest) : Infinity,
    );
    return {
        points,
        next_at: Number.isFinite(oldestMs) ? Math.floor(oldestMs / 1000) + maturationDays * DAY : null,
    };
}

// Claimable = earned - already claimed - still maturing.
async function claimablePoints(chatId, userId, record, settings) {
    const maturing = await maturingPoints(chatId, userId, settings.maturation_days);
    const points = record?.points || 0;
    const claimed = record?.claimed_points || 0;
    return {
        points,
        maturing: maturing.points,
        next_mature_at: maturing.next_at,
        available: Math.max(0, points - claimed - maturing.points),
    };
}

module.exports = {
    MAX_MATURATION_DAYS,
    normalizeClaimSettings,
    claimSettingsOf,
    claimGate,
    CLAIM_RULES_CONFLICT,
    claimRulesConflict,
    maturingPoints,
    claimablePoints,
};

// Service subscription in Telegram Stars. Mirrors telegram-bot/subscription.mjs,
// which enforces it: accruing points is the paid part; claiming points
// already earned never depends on it. The chat creator pays a monthly Stars
// subscription; a chat gets TRIAL_DAYS free from its first /jetton, and
// GRACE_DAYS after the trial or the paid period ends before points stop.
//
// The price follows the chat's active members (who wrote at least one message
// in the last ACTIVE_WINDOW_DAYS days), from SUBSCRIPTION_TIERS. Telegram
// charges a renewal at the price the subscription started with.
//
// Off unless SUBSCRIPTIONS_ENABLED=true (the bot needs the same values).

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 30;
const SUBSCRIPTION_PERIOD_SECONDS = 30 * 24 * 60 * 60; // the only period Telegram accepts
const MAX_STARS = 10000; // Telegram's cap on a subscription price
const PAYLOAD_PREFIX = 'sub:';

// Placeholder prices until the real ones are decided (SUBSCRIPTION_TIERS).
const DEFAULT_TIERS = [
    { minActive: 0, stars: 100 },
    { minActive: 51, stars: 300 },
    { minActive: 301, stars: 750 },
    { minActive: 1001, stars: 1500 },
];

function days(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= 0 && value <= 365 ? value : fallback;
}

// JSON array of {minActive, stars}; an invalid table falls back to the
// default rather than selling at a wrong price.
function parseTiers(raw) {
    if (!raw) return DEFAULT_TIERS;
    try {
        const parsed = JSON.parse(raw);
        const tiers = parsed
            .map((tier) => ({ minActive: Number(tier.minActive), stars: Number(tier.stars) }))
            .sort((a, b) => a.minActive - b.minActive);
        const valid =
            tiers.length > 0 &&
            tiers[0].minActive === 0 &&
            tiers.every((tier) => Number.isInteger(tier.minActive) && tier.minActive >= 0) &&
            tiers.every((tier) => Number.isInteger(tier.stars) && tier.stars >= 1 && tier.stars <= MAX_STARS);
        return valid ? tiers : DEFAULT_TIERS;
    } catch {
        return DEFAULT_TIERS;
    }
}

function subscriptionConfig() {
    return {
        enabled: process.env.SUBSCRIPTIONS_ENABLED === 'true',
        trialDays: days('TRIAL_DAYS', 14),
        graceDays: days('GRACE_DAYS', 3),
        tiers: parseTiers(process.env.SUBSCRIPTION_TIERS),
    };
}

function tierFor(activeMembers, tiers = subscriptionConfig().tiers) {
    let picked = tiers[0];
    for (const tier of tiers) if (activeMembers >= tier.minActive) picked = tier;
    return picked;
}

const time = (value) => (value ? new Date(value).getTime() : NaN);

// Same states as the bot: off, not_started, trial, paid, grace, expired.
function serviceState(chat, now = new Date(), config = subscriptionConfig()) {
    if (!config.enabled) return { state: 'off', accrues: true, ends_at: null, grace_until: null };
    const trialEnd = time(chat?.trial_started_at) + config.trialDays * DAY_MS;
    const paidUntil = time(chat?.paid_until);
    const ends = Math.max(
        Number.isNaN(trialEnd) ? -Infinity : trialEnd,
        Number.isNaN(paidUntil) ? -Infinity : paidUntil,
    );
    if (ends === -Infinity) return { state: 'not_started', accrues: false, ends_at: null, grace_until: null };
    const graceUntil = ends + config.graceDays * DAY_MS;
    const at = now.getTime();
    const state = at < ends ? (paidUntil > at ? 'paid' : 'trial') : at < graceUntil ? 'grace' : 'expired';
    return { state, accrues: at < graceUntil, ends_at: new Date(ends), grace_until: new Date(graceUntil) };
}

function subscriptionPayload(chatId) {
    return `${PAYLOAD_PREFIX}${chatId}`;
}

module.exports = {
    ACTIVE_WINDOW_DAYS,
    SUBSCRIPTION_PERIOD_SECONDS,
    DEFAULT_TIERS,
    parseTiers,
    subscriptionConfig,
    tierFor,
    serviceState,
    subscriptionPayload,
};

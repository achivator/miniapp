const { getTonConfig } = require('./ton/config');
const { parseRate, pointsToJettons } = require('./ton/amounts');

// Price of a point: how many jettons one point pays out, per chat.
//
// The chat creator may set their own price (chats.point_price, a canonical
// decimal string); without one the platform default JETTONS_PER_POINT
// applies. It is off-chain like the claim rules: the pool contract only
// checks the backend's signature and daily limit, so the price is whatever
// the backend sizes the voucher with - which is why every points -> jettons
// conversion must go through pointPriceFor() and never read the env rate.
//
// Changing it re-prices points members already earned, so every change is
// kept in chats.point_price_history ({ old, new, at, by }, effective prices)
// and shown to members on their dashboard for a week.

// Jetton decimals assumed when the jetton is unknown at save time (TEP-64
// default, and the most any common jetton uses); re-checked at claim time.
const FALLBACK_DECIMALS = 9;
// A typo guard, not an economic rule: 1M jettons per point is far above any
// sane loyalty rate, and it keeps vouchers well inside the 120-bit coins field.
const MAX_POINT_PRICE = '1000000';
const MAX_INPUT_LENGTH = 32;
const HISTORY_LIMIT = 50;
const RECENT_CHANGE_DAYS = 7;

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

// "007.50" -> "7.5": one spelling per value, so stored prices compare as
// strings and "no change" is detected reliably.
function canonicalDecimal(str) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(str);
    if (!m) return null;
    const whole = m[1].replace(/^0+(?=\d)/, '');
    const frac = (m[2] || '').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
}

function fractionDigits(price) {
    const dot = price.indexOf('.');
    return dot === -1 ? 0 : price.length - dot - 1;
}

// Compares two canonical decimal strings exactly (no floats).
function compareDecimal(a, b) {
    const ra = parseRate(a);
    const rb = parseRate(b);
    const left = ra.num * rb.den;
    const right = rb.num * ra.den;
    return left === right ? 0 : left < right ? -1 : 1;
}

// Validates a submitted price and returns its canonical string; throws on
// invalid input. `decimals` is the chat jetton's, or null when unknown.
// Strings only: a JS number would already have gone through float rounding.
function normalizePointPrice(raw, decimals = null) {
    if (typeof raw !== 'string') throw new Error('price must be a decimal string, e.g. "0.01"');
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) {
        throw new Error('price must be a decimal string, e.g. "0.01"');
    }
    const price = canonicalDecimal(trimmed);
    if (price === null) throw new Error('price must be a decimal string, e.g. "0.01"');
    if (parseRate(price).num === 0n) throw new Error('price must be greater than 0');
    if (compareDecimal(price, MAX_POINT_PRICE) > 0) {
        throw new Error(`price must be at most ${MAX_POINT_PRICE} jettons per point`);
    }
    // Finer than the jetton's smallest unit would make pointsToJettons floor
    // every payout - to zero for a single point.
    const dec = Number.isInteger(decimals) ? decimals : FALLBACK_DECIMALS;
    if (fractionDigits(price) > dec) {
        throw new Error(`this jetton has ${dec} decimals: the price can have at most ${dec} digits after the point`);
    }
    return price;
}

// Platform default from JETTONS_PER_POINT. Not bounds-checked: it is the
// operator's setting, and an unparseable one throws exactly as before.
function platformPointPrice() {
    const raw = String(getTonConfig().jettonsPerPoint).trim();
    const price = canonicalDecimal(raw);
    if (price === null) throw new Error(`invalid JETTONS_PER_POINT: ${raw}`);
    return price;
}

// The chat's effective price. A stored value that fails validation means the
// document was edited by hand: refuse rather than silently pay a different
// rate (the creator can fix it by saving a new price).
function pointPriceFor(chat) {
    const stored = chat?.point_price;
    if (stored === undefined || stored === null) return platformPointPrice();
    try {
        return normalizePointPrice(stored);
    } catch {
        throw httpError(500, `the chat's stored point price is invalid (${String(stored)}); its creator must set it again`);
    }
}

function hasCustomPointPrice(chat) {
    return chat?.point_price !== undefined && chat?.point_price !== null;
}

// Whether `price` can be paid exactly in a jetton with `decimals`: one point
// must be worth a whole number of the jetton's smallest units.
function priceFitsDecimals(price, decimals) {
    return Number.isInteger(decimals) && fractionDigits(price) <= decimals;
}

// Points -> jetton units at the chat's current price. The one conversion
// routes use, so none of them can fall back to the platform rate by mistake.
function chatPointsToUnits(chat, points, decimals) {
    return pointsToJettons(points, pointPriceFor(chat), decimals);
}

function toEpochSec(at) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// The latest price change if it happened within the last week, for the
// member-facing "rate changed" notice; `changes` counts all changes in that
// window so several quick edits (down, then back up) are not hidden.
function recentPointPriceChange(chat, nowSec = Math.floor(Date.now() / 1000)) {
    const history = Array.isArray(chat?.point_price_history) ? chat.point_price_history : [];
    const since = nowSec - RECENT_CHANGE_DAYS * 86400;
    const recent = history.filter((h) => {
        const at = toEpochSec(h?.at);
        return at !== null && at > since && at <= nowSec;
    });
    if (recent.length === 0) return null;
    const last = recent.reduce((a, b) => (toEpochSec(b.at) >= toEpochSec(a.at) ? b : a));
    return { old: String(last.old), new: String(last.new), at: toEpochSec(last.at), changes: recent.length };
}

// History entries for API responses, newest first.
function serializePriceHistory(chat, limit = 10) {
    const history = Array.isArray(chat?.point_price_history) ? chat.point_price_history : [];
    return history
        .slice(-limit)
        .reverse()
        .map((h) => ({ old: String(h.old), new: String(h.new), at: toEpochSec(h.at), by: h.by ?? null }));
}

module.exports = {
    FALLBACK_DECIMALS,
    MAX_POINT_PRICE,
    HISTORY_LIMIT,
    RECENT_CHANGE_DAYS,
    canonicalDecimal,
    compareDecimal,
    normalizePointPrice,
    platformPointPrice,
    pointPriceFor,
    hasCustomPointPrice,
    priceFitsDecimals,
    chatPointsToUnits,
    recentPointPriceChange,
    serializePriceHistory,
};

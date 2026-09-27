const { validate, parse } = require('@tma.js/init-data-node');

function unauthorized(message) {
    const error = new Error(message);
    error.status = 401;
    return error;
}

function getInitDataRaw(request) {
    const header = request.headers.get('authorization');
    if (header && /^tma\s+/i.test(header)) {
        return header.replace(/^tma\s+/i, '').trim();
    }
    try {
        const { searchParams } = new URL(request.url);
        return searchParams.get('init_data');
    } catch {
        return null;
    }
}

// Validates the Telegram WebApp init data and returns its user.
// In development, DEV_TELEGRAM_USER_ID lets API routes be exercised without
// Telegram (never active when NODE_ENV === 'production').
function authenticate(request) {
    const raw = getInitDataRaw(request);
    if (!raw) {
        if (process.env.NODE_ENV !== 'production' && process.env.DEV_TELEGRAM_USER_ID) {
            return { user: { id: Number(process.env.DEV_TELEGRAM_USER_ID) }, dev: true };
        }
        throw unauthorized('missing Telegram init data');
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }
    try {
        validate(raw, process.env.TELEGRAM_BOT_TOKEN, { expiresIn: 86400 });
    } catch (e) {
        throw unauthorized(`invalid Telegram init data: ${e.message}`);
    }
    const data = parse(raw);
    if (!data.user || !data.user.id) throw unauthorized('no user in Telegram init data');
    return { user: data.user, dev: false };
}

module.exports = { authenticate, getInitDataRaw };

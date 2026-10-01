// A whole-number query parameter, or NaN when it is missing or empty:
// Number(null) and Number("") are 0, which turned a missing chatId or userId
// into a lookup of chat or user 0 (a 404, or worse) instead of the 400 the
// routes answer for a missing one.
function queryInt(searchParams, name) {
    const raw = searchParams.get(name);
    return raw === null || raw.trim() === '' ? NaN : Number(raw);
}

module.exports = { queryInt };

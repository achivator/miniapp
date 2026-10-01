// When a point was earned, as the bot's collections store it:
//   reaction_points.date  a Date
//   grants.date           epoch ms (a number)
// A doc of either collection may hold the other type (older data, hand
// edits), and Mongo compares a Date only with Dates and a number only with
// numbers, so every date condition on these collections must ask for both -
// otherwise such a doc silently falls out of every range (a lot "without a
// date", paid at the current price, or never maturing).

const NO_DATE_FILTER = Symbol('none');

// Mongo conditions on `date` for one type (asDate: Date, else number), over
// epoch ms bounds.
function dateRange(asDate, { gt = NO_DATE_FILTER, lt = NO_DATE_FILTER, lte = NO_DATE_FILTER, gte = NO_DATE_FILTER }) {
    const wrap = (ms) => (asDate ? new Date(ms) : ms);
    const cond = {};
    if (gt !== NO_DATE_FILTER) cond.$gt = wrap(gt);
    if (gte !== NO_DATE_FILTER) cond.$gte = wrap(gte);
    if (lt !== NO_DATE_FILTER) cond.$lt = wrap(lt);
    if (lte !== NO_DATE_FILTER) cond.$lte = wrap(lte);
    // an unbounded range still requires a date of that type, so a doc is
    // counted in exactly one of the ranges a loader splits a period into
    if (Object.keys(cond).length === 0) cond.$type = asDate ? 'date' : 'number';
    return cond;
}

// A filter fragment matching `date` in the range as either type; spread it
// into a $match / find filter (it adds a top-level $or).
function dateMatch(range) {
    return { $or: [{ date: dateRange(true, range) }, { date: dateRange(false, range) }] };
}

// An aggregation expression for `date` as epoch ms whatever its type (only
// for docs a dateMatch() already selected).
const DATE_MS = { $toLong: '$date' };

module.exports = { dateRange, dateMatch, DATE_MS };

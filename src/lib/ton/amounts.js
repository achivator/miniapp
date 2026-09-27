// Exact decimal-string math on BigInt (no float rounding on money paths).

function parseUnits(amountStr, decimals) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(String(amountStr).trim());
    if (!m) throw new Error(`invalid amount: ${amountStr}`);
    const dec = Number(decimals);
    const frac = (m[2] || '').slice(0, dec).padEnd(dec, '0');
    return BigInt(m[1]) * 10n ** BigInt(dec) + BigInt(frac || '0');
}

function formatUnits(value, decimals) {
    const v = BigInt(value);
    const dec = Number(decimals);
    const base = 10n ** BigInt(dec);
    const whole = v / base;
    const frac = (v % base).toString().padStart(dec, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
}

function parseRate(rateStr) {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(String(rateStr).trim());
    if (!m) throw new Error(`invalid rate: ${rateStr}`);
    const frac = m[2] || '';
    return { num: BigInt(m[1] + frac), den: 10n ** BigInt(frac.length) };
}

// points -> jetton units (floor), e.g. 150 points at 0.01 = 1.5 jettons.
function pointsToJettons(points, rateStr, decimals) {
    const { num, den } = parseRate(rateStr);
    return (BigInt(points) * num * 10n ** BigInt(decimals)) / den;
}

module.exports = { parseUnits, formatUnits, parseRate, pointsToJettons };

const { Address, beginCell, Cell, Dictionary } = require('@ton/core');
const { sha256_sync } = require('@ton/crypto');
const { getTonConfig } = require('./config');

class TonRpcError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'TonRpcError';
        this.code = code;
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toncenterRequest(method, params) {
    const cfg = getTonConfig();
    const url = `${cfg.toncenterBase}/api/v2/${method}`;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.toncenterApiKey) headers['X-API-Key'] = cfg.toncenterApiKey;

    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await sleep(1000 * attempt);
        let response;
        try {
            response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(params), cache: 'no-store' });
        } catch (e) {
            lastError = e;
            continue;
        }
        if (response.status === 429) {
            lastError = new TonRpcError('toncenter rate limit', 429);
            continue;
        }
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            lastError = new TonRpcError(`toncenter ${method} failed: HTTP ${response.status}`, response.status);
            continue;
        }
        if (body && body.ok === false) {
            lastError = new TonRpcError(`toncenter ${method}: ${body.error || body.code || 'unknown error'}`, body.code);
            continue;
        }
        return body ? body.result : null;
    }
    throw lastError || new TonRpcError(`toncenter ${method} failed`);
}

// toncenter parses 0x… num stack items as unsigned, so a two's-complement hex
// of a negative chatId would reach the getter as a huge positive number.
// Signed decimal is the only form that survives the round trip.
function addressToStack(address) {
    // testnet toncenter rejects a bare base64 string here: slice/cell stack
    // items must be objects with a `bytes` field.
    return ['slice', { bytes: beginCell().storeAddress(address).endCell().toBoc().toString('base64') }];
}

function stackItemBoc(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value.bytes === 'string') return value.bytes;
    throw new TonRpcError('expected a base64 cell stack value');
}

function stackItemToAddress(item) {
    if (!item) return null;
    const [type, value] = item;
    if (type === 'slice' || type === 'cell') {
        const cell = Cell.fromBase64(stackItemBoc(value));
        return cell.beginParse().loadAddress();
    }
    if (type === 'null' || type === 'nan' || value === null) return null;
    // A null Address? from a Tact getter reaches toncenter v2 as an empty
    // tuple: ["list", {"@type": "tvm.list", "elements": []}].
    if ((type === 'list' || type === 'tuple') && Array.isArray(value?.elements) && value.elements.length === 0) {
        return null;
    }
    throw new TonRpcError(`unexpected stack item type: ${type}`);
}

function stackItemToBigInt(item) {
    const [type, value] = item;
    if (type !== 'num') throw new TonRpcError(`expected num stack item, got ${type}`);
    // toncenter encodes negatives as "-0x1", which BigInt() rejects
    const text = String(value).trim();
    return text.startsWith('-') ? -BigInt(text.slice(1)) : BigInt(text);
}

async function runGetMethod(address, method, stack = []) {
    const result = await toncenterRequest('runGetMethod', {
        address: Address.parse(address.toString()).toString(),
        method,
        stack,
    });
    const exitCode = result.exit_code;
    if (exitCode !== 0 && exitCode !== 1) {
        throw new TonRpcError(`${method} exited with code ${exitCode}`, exitCode);
    }
    return result.stack || [];
}

async function getAddressInformation(address) {
    const result = await toncenterRequest('getAddressInformation', {
        address: Address.parse(address.toString()).toString(),
    });
    return { state: result.state, balance: BigInt(result.balance || 0) };
}

// Pool address per chat, from the master's poolAddress(chatId) getter.
async function fetchPoolAddress(masterAddress, chatId) {
    const stack = await runGetMethod(masterAddress, 'poolAddress', [['num', String(chatId)]]);
    return stackItemToAddress(stack[0]);
}

async function fetchJettonWalletAddress(jettonMaster, owner) {
    const stack = await runGetMethod(jettonMaster, 'get_wallet_address', [addressToStack(Address.parse(owner.toString()))]);
    return stackItemToAddress(stack[0]);
}

// ChatPool ledger balance of one jetton (what claims can draw on).
async function fetchPoolLedgerBalance(poolAddress, jettonMaster) {
    const stack = await runGetMethod(poolAddress, 'balanceOf', [addressToStack(Address.parse(jettonMaster.toString()))]);
    return stackItemToBigInt(stack[0]);
}

// ChatPool safety state for one jetton: pause flag, explicit daily limit
// (0 = default share) and what claims can still move today.
async function fetchPoolClaimControls(poolAddress, jettonMaster) {
    const master = addressToStack(Address.parse(jettonMaster.toString()));
    const [paused, limit, today] = await Promise.all([
        runGetMethod(poolAddress, 'claimsPaused', []),
        runGetMethod(poolAddress, 'claimLimit', [master]),
        runGetMethod(poolAddress, 'claimableToday', [master]),
    ]);
    return {
        paused: stackItemToBigInt(paused[0]) !== 0n,
        limit: stackItemToBigInt(limit[0]),
        claimableToday: stackItemToBigInt(today[0]),
    };
}

async function fetchIsMinted(registryAddress, templateId, tgUserId) {
    const stack = await runGetMethod(registryAddress, 'isMinted', [
        ['num', String(templateId)],
        ['num', String(tgUserId)],
    ]);
    return stackItemToBigInt(stack[0]) !== 0n;
}

async function getPoolStatus(masterAddress, chatId) {
    const poolAddress = await fetchPoolAddress(masterAddress, chatId);
    if (!poolAddress) return { poolAddress: null, active: false, balance: 0n };
    const info = await getAddressInformation(poolAddress);
    return { poolAddress, active: info.state === 'active', balance: info.balance };
}

// ---- Jetton metadata (TEP-64) ----

const metadataCache = new Map(); // master -> { value, expiresAt }
const METADATA_TTL_MS = 60 * 60 * 1000;

function fieldKey(field) {
    return BigInt('0x' + sha256_sync(field).toString('hex'));
}

// TEP-64 snake value holding a number: 0x00 prefix + decimal text ("6").
// Some non-standard masters store a raw uint8 instead; accept that too.
function parseSnakeNumber(cell) {
    let cs = cell.beginParse();
    if (cs.remainingBits === 0 && cs.remainingRefs === 1) cs = cs.loadRef().beginParse();
    if (cs.remainingBits >= 8 && cs.preloadUint(8) === 0) cs.loadUint(8);
    if (cs.remainingBits === 8 && cs.remainingRefs === 0 && cs.preloadUint(8) < 0x30) return Number(cs.loadUint(8));
    return parseDecimals(cs.loadStringTail().trim());
}

function parseOnchainContent(cell) {
    let cs = cell.beginParse();
    cs.loadUint(8); // 0x00 on-chain tag
    const dict = Dictionary.load(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell(), cs); // HashmapE: maybe-ref
    const read = (field) => {
        const value = dict.get(fieldKey(field));
        if (!value) return null;
        try {
            let vs = value.beginParse();
            // TEP-64 snake value: 0x00 prefix byte, then the text
            if (vs.remainingBits >= 8 && vs.preloadUint(8) === 0) vs.loadUint(8);
            return vs.loadStringTail();
        } catch {
            return null;
        }
    };
    let decimals = null;
    try {
        const decimalsCell = dict.get(fieldKey('decimals'));
        if (decimalsCell) decimals = parseSnakeNumber(decimalsCell);
    } catch {
        decimals = null;
    }
    return { decimals, name: read('name'), symbol: read('symbol'), uri: read('uri') };
}

// ---- Off-chain metadata (TEP-64 URI) ----
// The URI comes from a jetton master that any chat creator may pick, so the
// fetch must not become an SSRF primitive: https (or ipfs via a gateway)
// only, no IP-literal or internal hostnames, no redirects, a short timeout
// and a small body cap.
const METADATA_MAX_BYTES = 64 * 1024;
const METADATA_TIMEOUT_MS = 5000;

function isForbiddenHost(hostname) {
    const h = hostname.toLowerCase().replace(/\.$/, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (h.startsWith('[')) return true; // IPv6 literal
    if (/^\d+$/.test(h)) return true; // decimal-encoded IPv4
    if (/^[\d.]+$/.test(h) || /^0x/i.test(h)) return true; // IPv4 literal (any form)
    return false;
}

function resolveMetadataUrl(uri) {
    const raw = String(uri || '').trim();
    if (raw.startsWith('ipfs://')) {
        const gateway = (process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/').replace(/\/?$/, '/');
        return new URL(raw.slice('ipfs://'.length).replace(/^ipfs\//, ''), gateway);
    }
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new TonRpcError(`unsupported metadata url scheme: ${url.protocol}`);
    if (url.username || url.password || (url.port && url.port !== '443')) {
        throw new TonRpcError('metadata url must be a plain https url');
    }
    if (isForbiddenHost(url.hostname)) throw new TonRpcError(`metadata host not allowed: ${url.hostname}`);
    return url;
}

async function fetchOffchainMetadata(uri) {
    const url = resolveMetadataUrl(uri);
    const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        headers: { accept: 'application/json' },
        cache: 'no-store',
    });
    if (!response.ok) throw new TonRpcError(`metadata fetch failed: HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > METADATA_MAX_BYTES) throw new TonRpcError('metadata too large');
    const text = await response.text();
    if (text.length > METADATA_MAX_BYTES) throw new TonRpcError('metadata too large');
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object') throw new TonRpcError('metadata is not a JSON object');
    return json;
}

function parseDecimals(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 255) throw new TonRpcError(`invalid jetton decimals: ${value}`);
    return n;
}

// Jetton metadata. `decimals` is null when it cannot be determined (e.g. the
// metadata host is down); money paths must refuse to proceed then instead of
// guessing, because a wrong guess scales every amount by 10^difference
// (USDT has 6 decimals: assuming 9 would pay out 1000x).
async function fetchJettonMetadata(jettonMaster) {
    const key = Address.parse(jettonMaster.toString()).toString();
    const cached = metadataCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = { decimals: null, name: null, symbol: null, mintable: null, totalSupply: null };
    let resolved = false;
    try {
        const stack = await runGetMethod(jettonMaster, 'get_jetton_data', []);
        if (stack[0]) value.totalSupply = stackItemToBigInt(stack[0]);
        if (stack[1]) value.mintable = stackItemToBigInt(stack[1]);
        const contentItem = stack[3];
        if (contentItem && (contentItem[0] === 'cell' || contentItem[0] === 'slice')) {
            const content = Cell.fromBase64(stackItemBoc(contentItem[1]));
            const cs = content.beginParse();
            const tag = cs.remainingBits >= 8 ? cs.loadUint(8) : null;
            let offchain = null;
            let onchain = null;
            if (tag === 0) {
                onchain = parseOnchainContent(content);
                if (onchain.uri) offchain = await fetchOffchainMetadata(onchain.uri); // semi-chain
            } else if (tag === 1) {
                offchain = await fetchOffchainMetadata(cs.loadStringTail());
            }
            // on-chain fields win over the off-chain JSON (TEP-64)
            value.name = onchain?.name ?? offchain?.name ?? null;
            value.symbol = onchain?.symbol ?? offchain?.symbol ?? null;
            const decimals = onchain?.decimals ?? parseDecimals(offchain?.decimals);
            // TEP-64: absent decimals means 9
            value.decimals = decimals ?? 9;
            resolved = tag === 0 || tag === 1;
        }
    } catch {
        // leave decimals null: callers must not guess
    }
    metadataCache.set(key, { value, expiresAt: Date.now() + (resolved ? METADATA_TTL_MS : 60 * 1000) });
    return value;
}

module.exports = {
    TonRpcError,
    toncenterRequest,
    runGetMethod,
    getAddressInformation,
    fetchPoolAddress,
    fetchJettonWalletAddress,
    fetchJettonMetadata,
    fetchPoolLedgerBalance,
    fetchPoolClaimControls,
    fetchIsMinted,
    resolveMetadataUrl,
    getPoolStatus,
    stackItemToAddress,
    stackItemToBigInt,
};

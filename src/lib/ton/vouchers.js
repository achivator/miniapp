const { Address, beginCell } = require('@ton/core');
const { keyPairFromSeed, sign } = require('@ton/crypto');
const { OP, SECONDS } = require('./constants');

function toAddress(value) {
    return value instanceof Address ? value : Address.parse(value);
}

// DepositVoucher layout MUST match storeDepositVoucher in the compiled
// ChatPool bindings and the manual parse in contracts/chat_pool.tact:
// int64 chatId, address jettonMaster, address expectedJettonWallet,
// uint16 tier, coins feeTon, uint64 expiry.
function buildDepositVoucherCell({ chatId, jettonMaster, expectedJettonWallet, tier, feeTon, expiry }) {
    return beginCell()
        .storeInt(BigInt(chatId), 64)
        .storeAddress(toAddress(jettonMaster))
        .storeAddress(toAddress(expectedJettonWallet))
        .storeUint(BigInt(tier), 16)
        .storeCoins(BigInt(feeTon))
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

function buildClaimVoucherCell({ chatId, recipient, jettonMaster, amount, nonce, expiry }) {
    return beginCell()
        .storeInt(BigInt(chatId), 64)
        .storeAddress(toAddress(recipient))
        .storeAddress(toAddress(jettonMaster))
        .storeCoins(BigInt(amount))
        .storeUint(BigInt(nonce), 64)
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

// AdminInitVoucher: int64 chatId, address master, address admin, uint64 expiry.
function buildAdminVoucherCell({ chatId, master, admin, expiry }) {
    return beginCell()
        .storeInt(BigInt(chatId), 64)
        .storeAddress(toAddress(master))
        .storeAddress(toAddress(admin))
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

// MintVoucher (AchievementRegistry): uint32 templateId, address recipient,
// int64 tgUserId, uint64 nonce, uint64 expiry.
function buildMintVoucherCell({ templateId, recipient, tgUserId, nonce, expiry }) {
    return beginCell()
        .storeUint(BigInt(templateId), 32)
        .storeAddress(toAddress(recipient))
        .storeInt(BigInt(tgUserId), 64)
        .storeUint(BigInt(nonce), 64)
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

function backendKeyPair(secretHex) {
    const seed = Buffer.from(secretHex, 'hex');
    if (seed.length !== 32) throw new Error('BACKEND_SECRET must be a 32-byte hex seed');
    return keyPairFromSeed(seed);
}

// SignedVoucher envelope, byte-equal to storeSignedVoucher from the compiled
// bindings: uint32 tag, address target, ref(voucher).
function signedVoucherCell(voucherCell, { tag, target }) {
    if (!Number.isInteger(tag)) throw new Error('voucher tag is required');
    if (!target) throw new Error('voucher target contract is required');
    return beginCell().storeUint(tag, 32).storeAddress(toAddress(target)).storeRef(voucherCell).endCell();
}

// Signs `voucherCell` as a voucher of kind `tag` for the contract `target`
// (the pool for deposit/claim/admin vouchers, the registry for achievements).
function signVoucher(voucherCell, secretHex, { tag, target }) {
    return sign(signedVoucherCell(voucherCell, { tag, target }).hash(), backendKeyPair(secretHex).secretKey);
}

// The 513-bit payload (voucher ref + 512-bit signature) cannot ride inline in
// a transfer body, so it travels ref-wrapped as [1 bit][ref payload] — the
// verbatim TEP-74 form stock jetton wallets forward as-is.
function buildDepositForwardPayload(voucherCell, signature) {
    const inner = beginCell().storeRef(voucherCell).storeBuffer(signature).endCell();
    return beginCell().storeBit(1).storeRef(inner).endCell();
}

// Byte-for-byte equal to storeJettonTransfer({...}) from the compiled bindings.
function buildJettonTransferBody({ amount, destination, responseDestination, forwardTonAmount, forwardPayload, queryId = 0n }) {
    return beginCell()
        .storeUint(OP.JettonTransfer, 32)
        .storeUint(BigInt(queryId), 64)
        .storeCoins(BigInt(amount))
        .storeAddress(toAddress(destination))
        .storeAddress(toAddress(responseDestination))
        .storeBit(0) // customPayload: null
        .storeCoins(BigInt(forwardTonAmount))
        .storeBuilder(forwardPayload.asBuilder())
        .endCell();
}

// Byte-for-byte equal to storeClaim({...}) from the compiled bindings:
// opcode ++ ref(voucherCell) ++ 512-bit signature inline.
function buildClaimBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.Claim, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
}

function buildSetAdminBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.SetAdmin, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
}

function buildWithdrawRemainderBody({ jettonMaster, amount, to }) {
    return beginCell()
        .storeUint(OP.WithdrawRemainder, 32)
        .storeAddress(toAddress(jettonMaster))
        .storeCoins(BigInt(amount))
        .storeAddress(toAddress(to))
        .endCell();
}

function buildMintBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.MintAchievement, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
}

function buildSetClaimsPausedBody(paused) {
    return beginCell().storeUint(OP.SetClaimsPaused, 32).storeBit(Boolean(paused)).endCell();
}

// dailyLimit 0 restores the pool's default budget (10% of the balance/day).
function buildSetClaimLimitBody({ jettonMaster, dailyLimit }) {
    return beginCell()
        .storeUint(OP.SetClaimLimit, 32)
        .storeAddress(toAddress(jettonMaster))
        .storeCoins(BigInt(dailyLimit))
        .endCell();
}

function buildSetPoolBackendKeyBody(publicKeyHex) {
    const key = Buffer.from(String(publicKeyHex).replace(/^0x/, ''), 'hex');
    if (key.length !== 32) throw new Error('backend public key must be 32 bytes of hex');
    return beginCell().storeUint(OP.SetPoolBackendKey, 32).storeBuffer(key).endCell();
}

function buildCreatePoolBody(chatId) {
    return beginCell().storeUint(OP.CreatePool, 32).storeInt(BigInt(chatId), 64).endCell();
}

function defaultExpiry(ttlSeconds = SECONDS.depositVoucherTtl) {
    return BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
}

module.exports = {
    buildDepositVoucherCell,
    buildClaimVoucherCell,
    buildAdminVoucherCell,
    buildMintVoucherCell,
    buildMintBody,
    backendKeyPair,
    signedVoucherCell,
    signVoucher,
    buildDepositForwardPayload,
    buildJettonTransferBody,
    buildClaimBody,
    buildSetAdminBody,
    buildWithdrawRemainderBody,
    buildSetClaimsPausedBody,
    buildSetClaimLimitBody,
    buildSetPoolBackendKeyBody,
    buildCreatePoolBody,
    defaultExpiry,
    toAddress,
};

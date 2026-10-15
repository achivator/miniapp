const { Address, beginCell } = require('@ton/core');
const { keyPairFromSeed, sign } = require('@ton/crypto');
const { OP, SECONDS } = require('./constants');
const { contentUrlCell } = require('./achievement-tags');

function toAddress(value) {
    return value instanceof Address ? value : Address.parse(value);
}

// DepositVoucher in the layout of the pool's protocol `version` (its
// version() getter); MUST match storeDepositVoucher in the compiled ChatPool
// bindings and the manual parse in contracts/chat_pool.tact:
//   v3: int64 chatId, address jettonMaster, uint64 expiry
//       (the pool credits only its TEP-89-registered wallet, from its admin)
//   v2: int64 chatId, address jettonMaster, address expectedJettonWallet,
//       uint64 expiry
function buildDepositVoucherCell({ chatId, jettonMaster, expectedJettonWallet, expiry, version }) {
    const b = beginCell().storeInt(BigInt(chatId), 64).storeAddress(toAddress(jettonMaster));
    if (version === 2) {
        if (!expectedJettonWallet) throw new Error('a v2 deposit voucher names the pool jetton wallet');
        b.storeAddress(toAddress(expectedJettonWallet));
    } else if (version !== 3) {
        throw new Error(`no deposit voucher layout for contract version ${version}`);
    }
    return b.storeUint(BigInt(expiry), 64).endCell();
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

// AdminProposalVoucher (v3 admin recovery): int64 chatId, address newAdmin,
// uint32 seq (the pool's adminProposalSeq()), uint64 expiry.
function buildAdminProposalVoucherCell({ chatId, newAdmin, seq, expiry }) {
    return beginCell()
        .storeInt(BigInt(chatId), 64)
        .storeAddress(toAddress(newAdmin))
        .storeUint(BigInt(seq), 32)
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

// MintVoucher of a v2 (legacy) AchievementRegistry: uint32 templateId,
// address recipient, int64 tgUserId, uint64 nonce, uint64 expiry.
function buildMintVoucherCell({ templateId, recipient, tgUserId, nonce, expiry }) {
    return beginCell()
        .storeUint(BigInt(templateId), 32)
        .storeAddress(toAddress(recipient))
        .storeInt(BigInt(tgUserId), 64)
        .storeUint(BigInt(nonce), 64)
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

// MintVoucher of a v3 AchievementRegistry (soulbound items, no raw ids):
// uint256 templateKey, address recipient, uint256 userTag, uint64 expiry.
// The recipient must send the mint itself. See lib/ton/achievement-tags.js.
function buildMintVoucherV3Cell({ templateKey, recipient, userTag, expiry }) {
    return beginCell()
        .storeUint(BigInt(templateKey), 256)
        .storeAddress(toAddress(recipient))
        .storeUint(BigInt(userTag), 256)
        .storeUint(BigInt(expiry), 64)
        .endCell();
}

// RegisterVoucher of a v3 AchievementRegistry: uint256 chatTag, address
// registrant, uint256 contentHash, uint64 expiry, ref(contentUrl), the URL
// cell being its bytes (contentUrlCell, which enforces the URL policy).
function buildRegisterVoucherCell({ chatTag, registrant, contentHash, expiry, contentUrl }) {
    return beginCell()
        .storeUint(BigInt(chatTag), 256)
        .storeAddress(toAddress(registrant))
        .storeUint(BigInt(contentHash), 256)
        .storeUint(BigInt(expiry), 64)
        .storeRef(contentUrlCell(contentUrl))
        .endCell();
}

function backendKeyPair(secretHex) {
    const seed = Buffer.from(secretHex, 'hex');
    if (seed.length !== 32) throw new Error('BACKEND_SECRET must be a 32-byte hex seed');
    return keyPairFromSeed(seed);
}

// SignedVoucher envelope of the target contract's protocol `version`,
// byte-equal to storeSignedVoucher from the compiled bindings:
//   v3: uint32 tag, int32 globalId, address target, ref(voucher)
//   v2: uint32 tag, address target, ref(voucher)   (legacy, names no network)
// globalId is the network's config param 19 (GLOBAL_ID), which a v3 contract
// reads on-chain: a voucher signed for testnet is rejected on mainnet.
function signedVoucherCell(voucherCell, { tag, target, version, globalId }) {
    if (!Number.isInteger(tag)) throw new Error('voucher tag is required');
    if (!target) throw new Error('voucher target contract is required');
    const envelope = beginCell().storeUint(tag, 32);
    if (version === 3) {
        if (!Number.isInteger(globalId) || globalId < -(2 ** 31) || globalId >= 2 ** 31) {
            throw new Error('voucher network globalId is required (NEXT_PUBLIC_TON_NETWORK)');
        }
        envelope.storeInt(globalId, 32);
    } else if (version !== 2) {
        throw new Error(`cannot sign vouchers for contract version ${version}`);
    }
    return envelope.storeAddress(toAddress(target)).storeRef(voucherCell).endCell();
}

// Signs `voucherCell` as a voucher of kind `tag` for the contract `target`
// (the pool for deposit/claim/admin vouchers, the registry for achievements),
// in the envelope of the target's protocol `version` (its version() getter)
// for the network `globalId` (getTonConfig().globalId).
function signVoucher(voucherCell, secretHex, { tag, target, version, globalId }) {
    const envelope = signedVoucherCell(voucherCell, { tag, target, version, globalId });
    return sign(envelope.hash(), backendKeyPair(secretHex).secretKey);
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

// ---- v3 pools only ----

function buildRegisterJettonBody(jettonMaster) {
    return beginCell().storeUint(OP.RegisterJetton, 32).storeAddress(toAddress(jettonMaster)).endCell();
}

function buildSweepUntrackedBody({ jettonMaster, amount, to }) {
    return beginCell()
        .storeUint(OP.SweepUntracked, 32)
        .storeAddress(toAddress(jettonMaster))
        .storeCoins(BigInt(amount))
        .storeAddress(toAddress(to))
        .endCell();
}

function buildWithdrawTonBody({ to, amount }) {
    return beginCell().storeUint(OP.WithdrawTon, 32).storeAddress(toAddress(to)).storeCoins(BigInt(amount)).endCell();
}

function buildProposeAdminBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.ProposeAdmin, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
}

function buildCancelAdminProposalBody() {
    return beginCell().storeUint(OP.CancelAdminProposal, 32).endCell();
}

function buildExecuteAdminProposalBody() {
    return beginCell().storeUint(OP.ExecuteAdminProposal, 32).endCell();
}

function buildMintBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.MintAchievement, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
}

function buildRegisterBody({ voucherCell, signature }) {
    return beginCell().storeUint(OP.RegisterTemplate, 32).storeRef(voucherCell).storeBuffer(signature).endCell();
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
    buildAdminProposalVoucherCell,
    buildRegisterJettonBody,
    buildSweepUntrackedBody,
    buildWithdrawTonBody,
    buildProposeAdminBody,
    buildCancelAdminProposalBody,
    buildExecuteAdminProposalBody,
    buildMintVoucherCell,
    buildMintVoucherV3Cell,
    buildRegisterVoucherCell,
    buildMintBody,
    buildRegisterBody,
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

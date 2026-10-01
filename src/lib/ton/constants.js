// Message opcodes as compiled by Tact.
// Ground truth: ton-contracts/build/ChatPool/tact_ChatPool.ts store* helpers
// and the matching receive handlers in contracts/*.tact.
const OP = {
    JettonTransfer: 260734629, // 0xf8a7ea5, TEP-74
    JettonTransferNotification: 1935855772, // 0x7362d09c, TEP-74
    Claim: 1955221704,
    SetAdmin: 3591784092,
    WithdrawRemainder: 1475846085,
    SetClaimsPaused: 2070822456,
    SetClaimLimit: 21176938,
    SetPoolBackendKey: 3179849332,
    CreatePool: 1770470659,
    MintAchievement: 4155708920, // AchievementRegistry
};

// Protocol version the backend signs for: what ChatPool, DistributorMaster
// and AchievementRegistry return from their version() getter
// (ton-contracts/contracts/voucher.tact ProtocolVersion). Contracts without
// the getter speak version 1 (the DEP1 deposit voucher with a fee).
const CONTRACTS_VERSION = 2;

// Voucher kinds. The backend never signs a bare voucher cell: it signs
// SignedVoucher{tag, target, ^voucher} (ton-contracts/contracts/voucher.tact),
// where target is the contract that verifies it. A voucher can therefore not
// be replayed as another kind or against another pool/registry.
const VOUCHER_TAG = {
    Deposit: 0x44455032, // "DEP2", target = chat pool
    Claim: 0x434c4d31, // "CLM1", target = chat pool
    Admin: 0x41444d31, // "ADM1", target = chat pool
    Register: 0x52454731, // "REG1", target = achievement registry
    Mint: 0x4d4e5431, // "MNT1", target = achievement registry
};

// TON amounts attached to outbound messages (nanotons, decimal strings).
// No platform fee anywhere: this is gas and storage, and every contract sends
// back what it does not spend.
const GAS = {
    createPoolTon: '300000000', // 0.3 (contract minimum: 0.15): poolReserveTon stays on the pool, the rest comes back
    poolReserveTon: '100000000', // 0.1, PoolDeployValue: the pool's own storage reserve, not a fee
    depositTransferGas: '100000000', // 0.1, jetton transfer gas; the jetton wallet returns the rest
    depositForward: '150000000', // 0.15 to the pool for the notification (contract minimum: 0.02); the pool returns the rest
    claimTon: '150000000', // 0.15, matches scripts/claim.ts (contract minimum: 0.052); the rest comes back
    withdrawTon: '150000000', // contract minimum: 0.05
    setAdminTon: '50000000', // 0.05; the pool returns the rest
    adminControlTon: '50000000', // 0.05, pause / limit / key; the rest comes back
    mintTon: '150000000', // 0.15: 0.004 storage rent + 0.05 to the NFT + gas; the registry refunds the rest
};

const SECONDS = {
    depositVoucherTtl: 3600,
    claimVoucherTtl: 3600,
    adminVoucherTtl: 900,
    mintVoucherTtl: 900,
};

module.exports = { OP, VOUCHER_TAG, GAS, SECONDS, CONTRACTS_VERSION };

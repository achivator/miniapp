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
    // protocol v3 pools only (ton-contracts build/DistributorMaster/tact_ChatPool.ts)
    RegisterJetton: 2181291094, // 0x8203dc56: TEP-89 registration of the pool's jetton wallet
    SweepUntracked: 2154027184, // 0x8063d8b0: jettons outside the ledger
    WithdrawTon: 830373162, // 0x317e7d2a: the pool's TON above its reserve
    ProposeAdmin: 3538641322, // 0xd2eb61aa: admin recovery, 7-day timelock
    CancelAdminProposal: 4050456648, // 0xf16d1048
    ExecuteAdminProposal: 1944391457, // 0x73e50f21
    MintAchievement: 4155708920, // AchievementRegistry (0xf7b315f8)
    RegisterTemplate: 0xac4e0001, // AchievementRegistry v3
};

// Protocol version the backend signs for: what ChatPool, DistributorMaster
// and AchievementRegistry return from their version() getter
// (ton-contracts/contracts/voucher.tact ProtocolVersion). Contracts without
// the getter speak version 1 (the DEP1 deposit voucher with a fee); 2 dropped
// every TON fee; 3 binds every voucher to the network (globalId below).
const CONTRACTS_VERSION = 3;

// Versions the backend still signs for: contracts are immutable, so pools
// deployed by a v2 master keep verifying the v2 envelope (no network id) for
// good. Every signature picks its envelope by the target's version().
const SIGNABLE_VERSIONS = [2, 3];

// Network global ids (config param 19). A v3 contract reads its network's id
// on-chain and only accepts vouchers signed for it, so a testnet voucher is
// worthless on mainnet even where the addresses coincide.
const GLOBAL_ID = {
    mainnet: -239,
    testnet: -3,
};

// Voucher kinds. The backend never signs a bare voucher cell: it signs
// SignedVoucher{tag, globalId, target, ^voucher}
// (ton-contracts/contracts/voucher.tact), where target is the contract that
// verifies it and globalId the network it runs on. A voucher can therefore
// not be replayed as another kind, against another pool/registry, or on
// another network.
const VOUCHER_TAG = {
    Deposit: 0x44455032, // "DEP2", target = chat pool
    Claim: 0x434c4d31, // "CLM1", target = chat pool
    Admin: 0x41444d31, // "ADM1", target = chat pool
    AdminProposal: 0x41505231, // "APR1", target = chat pool (v3 admin recovery)
    Register: 0x52454731, // "REG1", target = achievement registry
    Mint: 0x4d4e5431, // "MNT1", target = achievement registry
};

// TON amounts attached to outbound messages (nanotons, decimal strings).
// No platform fee anywhere: this is gas and storage, and every contract sends
// back what it does not spend.
const GAS = {
    createPoolTon: '300000000', // 0.3 (contract minimum: 0.2, v2: 0.15): poolReserveTon stays on the pool, the rest comes back
    poolReserveTon: '150000000', // 0.15, PoolDeployValue (v3): the pool's own storage reserve, not a fee
    depositTransferGas: '100000000', // 0.1, jetton transfer gas; the jetton wallet returns the rest
    depositForward: '150000000', // 0.15 to the pool for the notification (contract minimum: 0.02); the pool returns the rest
    claimTon: '150000000', // 0.15, matches scripts/claim.ts (contract minimum: 0.082, v2: 0.052); the rest comes back
    withdrawTon: '150000000', // contract minimum: 0.08 (v2: 0.05); also SweepUntracked
    registerJettonTon: '100000000', // 0.1 (contract minimum: 0.05): TEP-89 round trip, the rest comes back
    proposeAdminTon: '50000000', // 0.05, admin recovery proposal / execution; the pool returns the rest
    setAdminTon: '50000000', // 0.05; the pool returns the rest
    adminControlTon: '50000000', // 0.05, pause / limit / key; the rest comes back
    mintTon: '150000000', // 0.15 (v3 registry minimum: 0.1): 0.04 stays on the SBT as its storage reserve, about 0.007 is gas; the SBT refunds the rest
};

const SECONDS = {
    depositVoucherTtl: 3600,
    claimVoucherTtl: 3600,
    adminVoucherTtl: 900,
    adminProposalVoucherTtl: 900,
    // v3 pools refuse claim vouchers expiring more than this far ahead
    maxClaimVoucherTtl: 86400,
    // Expired claim vouchers are settled against the chain only this long
    // after their expiry: a claim sent just before it may still be in flight.
    claimReconcileMargin: 600,
    // ProposeAdmin's timelock in v3 pools (AdminRecoveryDelay)
    adminRecoveryDelay: 604800,
    mintVoucherTtl: 900,
};

module.exports = { OP, VOUCHER_TAG, GAS, SECONDS, CONTRACTS_VERSION, SIGNABLE_VERSIONS, GLOBAL_ID };

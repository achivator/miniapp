"use client";

import Link from "next/link";
import { shortenAddress } from "@/lib/client-api";
import { formatDate, formatPoints, formatUnits } from "@/lib/format";
import { Chip } from "./ui";

// Shared bits of the chat creator's member-account screens.

export function memberLabel(member) {
  return member?.name || (member?.username ? `@${member.username}` : `User ${member?.user_id}`);
}

// Telegram statuses in which the person is no longer in the chat.
export function hasLeft(status) {
  return status === "left" || status === "kicked";
}

const STATES = {
  paid: { tone: "success", label: "Paid" },
  pending: { tone: "gold", label: "Pending" },
  unconfirmed: { tone: "neutral", label: "Unconfirmed" },
  expired: { tone: "neutral", label: "Released" },
};

export const STATE_HINT = {
  pending: "Voucher issued, the member has not sent it yet.",
  unconfirmed: "Voucher lapsed; the chain is checked when the member (or you) opens this account.",
  expired: "Voucher lapsed unused; the points went back to the member.",
};

export function StateChip({ state }) {
  const { tone, label } = STATES[state] || STATES.unconfirmed;
  return <Chip tone={tone}>{label}</Chip>;
}

// Jetton amount of a claim, in that claim's own jetton.
export function ClaimAmount({ claim }) {
  const symbol = claim.jetton?.symbol || "jetton";
  return (
    <>
      {formatUnits(claim.amount, claim.jetton?.decimals)} {symbol}
    </>
  );
}

// One row of a payout history (member screen or chat-wide feed).
export function PayoutRow({ claim, who, href }) {
  const body = (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        {who && <p className="truncate font-semibold">{who}</p>}
        <p className="text-[13px] text-hint tabular">
          {formatDate(claim.created_at, { time: true })} · {formatPoints(claim.points)} pts
          {claim.recipient ? ` → ${shortenAddress(claim.recipient, 4)}` : ""}
        </p>
        {!claim.current_jetton && <p className="text-[12px] text-hint">Previous chat jetton</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={`font-semibold tabular ${claim.state === "expired" ? "text-hint line-through" : ""}`}>
          <ClaimAmount claim={claim} />
        </span>
        <StateChip state={claim.state} />
      </div>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block active:opacity-70">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

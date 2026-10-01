"use client";

import Link from "next/link";
import { shortenAddress } from "@/lib/client-api";
import { useI18n } from "@/lib/use-locale";
import { Chip } from "./ui";

// Shared bits of the chat creator's member-account screens.

// `L` (from useI18n) translates the fallback for a member without a name.
export function memberLabel(member, L = (ru, en) => en) {
  return (
    member?.name ||
    (member?.username ? `@${member.username}` : L(`Пользователь ${member?.user_id}`, `User ${member?.user_id}`))
  );
}

// Telegram statuses in which the person is no longer in the chat.
export function hasLeft(status) {
  return status === "left" || status === "kicked";
}

const STATES = {
  paid: { tone: "success", label: ["Выплачено", "Paid"] },
  pending: { tone: "gold", label: ["Ожидает", "Pending"] },
  unconfirmed: { tone: "neutral", label: ["Не подтверждено", "Unconfirmed"] },
  expired: { tone: "neutral", label: ["Возвращено", "Released"] },
};

// A claim state's name, as its chip shows it.
export function stateLabel(state, L) {
  return L(...(STATES[state] || STATES.unconfirmed).label);
}

// What a claim state means, shown after its name and a colon ("Ожидает: чек
// выписан…"): lower case in Russian, where a colon does not start a
// sentence; English capitalizes the clause as usual.
const STATE_HINTS = {
  pending: ["чек выписан, участник его ещё не отправил.", "Voucher issued, the member has not sent it yet."],
  unconfirmed: [
    "срок чека истёк; сеть проверяется, когда участник (или вы) открывает этот счёт.",
    "Voucher lapsed; the chain is checked when the member (or you) opens this account.",
  ],
  expired: ["чек истёк неиспользованным; баллы вернулись участнику.", "Voucher lapsed unused; the points went back to the member."],
};

export function stateHint(state, L) {
  return STATE_HINTS[state] ? L(...STATE_HINTS[state]) : "";
}

export function StateChip({ state }) {
  const { L } = useI18n();
  const { tone } = STATES[state] || STATES.unconfirmed;
  return <Chip tone={tone}>{stateLabel(state, L)}</Chip>;
}

// Jetton amount of a claim, in that claim's own jetton.
export function ClaimAmount({ claim }) {
  const { L, units } = useI18n();
  const symbol = claim.jetton?.symbol || L("жетонов", "jetton");
  return (
    <>
      {units(claim.amount, claim.jetton?.decimals)} {symbol}
    </>
  );
}

// One row of a payout history (member screen or chat-wide feed).
export function PayoutRow({ claim, who, href }) {
  const t = useI18n();
  const body = (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        {who && <p className="truncate font-semibold">{who}</p>}
        <p className="text-[13px] text-hint tabular">
          {t.date(claim.created_at, { time: true })} · {t.pts(claim.points)}
          {claim.recipient ? ` → ${shortenAddress(claim.recipient, 4)}` : ""}
        </p>
        {!claim.current_jetton && <p className="text-[12px] text-hint">{t.L("Прежний жетон чата", "Previous chat jetton")}</p>}
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

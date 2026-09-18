// GET /api/houses/:houseId/balances
//   -> { balances, totalSpentCents, guestIncomeCents, unpaidGuestCents, settleUp }
//
// Everything derived from the ledger, in one call — the home screen needs all
// of it and a round trip per number would be silly.

import { requireRole } from "@/lib/guard";
import { handle, json } from "@/lib/http";
import { computeLedger } from "@/lib/ledger";
import { settleUp } from "@/lib/settle";

export const runtime = "nodejs";

type Params = { params: Promise<{ houseId: string }> };

export async function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const { houseId } = await params;
    await requireRole(req, houseId, "member");

    const ledger = await computeLedger(houseId);
    return json({ ...ledger, settleUp: settleUp(ledger.balances) });
  });
}

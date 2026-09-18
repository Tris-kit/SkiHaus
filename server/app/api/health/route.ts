// GET /api/health -> { ok, service, storage, mail }
//
// Booleans only — never report a configured value, only whether one exists.
// The app pings this on startup to decide whether to show an offline banner.

import { isDbConfigured } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail";
import { json } from "@/lib/http";
import type { Health } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const health: Health = {
    ok: true,
    service: "skihaus",
    storage: isDbConfigured(),
    mail: isMailConfigured(),
  };
  return json(health);
}

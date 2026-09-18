// Shared shape for every screen below the house picker.

import type { HouseEntry } from "../api";
import type { Session } from "../types";

export type HouseScreenProps = {
  entry: HouseEntry;
  session: Session;
  onBack: () => void;
};

/** Display name for a user id, falling back to something readable. */
export function nameFor(
  members: Array<{ userId: string; user: { name: string; email: string } }> | null,
  userId: string | null,
): string {
  if (!userId) return "The house";
  const m = members?.find((x) => x.userId === userId);
  if (!m) return "Someone";
  return m.user.name || m.user.email || "Someone";
}

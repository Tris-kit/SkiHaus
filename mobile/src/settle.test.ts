// `npx tsx src/settle.test.ts`. See money.test.ts for the house style.
//
// What this protects: settleUp() produces the list of "Venmo Dave $40"
// instructions people actually act on. Two properties matter — the transfers
// must exactly clear every balance, and the same input must always produce the
// same output so the list doesn't reshuffle between app launches.

import { settleUp } from "./settle";
import type { Balance } from "./types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
    failures++;
  }
}

/** Only netCents is read; the rest is padding to satisfy the type. */
function bal(userId: string, netCents: number): Balance {
  return { userId, paidCents: 0, owedCents: 0, sentCents: 0, receivedCents: 0, netCents };
}

console.log("settle.ts");

check("nobody owes anybody", settleUp([bal("a", 0), bal("b", 0)]), []);

check(
  "one debtor, one creditor",
  settleUp([bal("a", 5000), bal("b", -5000)]),
  [{ fromUserId: "b", toUserId: "a", amountCents: 5000 }],
);

check(
  "one debtor covers two creditors, biggest first",
  settleUp([bal("a", 3000), bal("b", 1000), bal("c", -4000)]),
  [
    { fromUserId: "c", toUserId: "a", amountCents: 3000 },
    { fromUserId: "c", toUserId: "b", amountCents: 1000 },
  ],
);

// The property that matters: after applying every transfer, everyone is at zero.
{
  const cases: Balance[][] = [
    [bal("a", 10000), bal("b", -3000), bal("c", -7000)],
    [bal("a", 1), bal("b", -1)],
    [bal("a", 3333), bal("b", 3333), bal("c", 3334), bal("d", -10000)],
    [bal("a", -500), bal("b", 200), bal("c", 300), bal("d", 0)],
  ];

  let worst = "";
  for (const balances of cases) {
    const net = new Map(balances.map((b) => [b.userId, b.netCents]));
    for (const t of settleUp(balances)) {
      net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) + t.amountCents);
      net.set(t.toUserId, (net.get(t.toUserId) ?? 0) - t.amountCents);
    }
    for (const [id, v] of net) if (v !== 0) worst = `${id} left holding ${v}`;
  }
  check("every transfer set clears every balance", worst, "");
}

// A settle-up list that reorders itself between renders looks broken.
{
  const balances = [bal("zed", 4000), bal("amy", 4000), bal("bob", -8000)];
  const once = JSON.stringify(settleUp(balances.slice()));
  const twice = JSON.stringify(settleUp(balances.slice().reverse()));
  check("output does not depend on input order", once, twice);
}

console.log(failures === 0 ? "\nsettle.ts: all checks passed" : `\nsettle.ts: ${failures} FAILED`);
if (failures > 0) process.exit(1);

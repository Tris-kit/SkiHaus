// Plain script, no test framework — `npx tsx src/money.test.ts`. Logs each
// check and exits 1 on the first failure. Split does the same; a ski-house app
// does not need Jest.
//
// What these protect: allocate() is the only place in the product where money
// can silently go missing, and quoteGuestStay() is the only place a fee can be
// silently wrong. Both are load-bearing for people trusting the ledger.

import {
  allocate,
  allocateByShares,
  allocateEqually,
  formatMoney,
  isWeekendNight,
  nightsBetween,
  nightsIn,
  quoteGuestStay,
  toCents,
} from "./money";

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

console.log("money.ts");

// --- toCents ---
check("19.99 survives float multiplication", toCents(19.99), 1999);
check("0.07 survives float multiplication", toCents(0.07), 7);
check("string input", toCents("1234.56"), 123456);
check("garbage is zero, not NaN", toCents("abc"), 0);

// --- allocate: the sum invariant ---
check("thirds of a dollar sum back to 100", allocate(100, [1, 1, 1]), [34, 33, 33]);
check("uneven weights", allocate(1000, [3, 1]), [750, 250]);
check("one person takes it all", allocate(999, [1]), [999]);
check("zero weights fall back to equal", allocate(100, [0, 0, 0]), [34, 33, 33]);
check("negative total (a refund) splits too", allocate(-100, [1, 1, 1]), [-34, -33, -33]);
check("empty roster", allocate(100, []), []);
check("zero total", allocate(0, [1, 2, 3]), [0, 0, 0]);

// The property that actually matters: for a spread of awkward totals and
// weights, the parts always sum to the whole.
{
  let worst = "";
  for (const total of [1, 7, 99, 100, 101, 12345, 999999]) {
    for (const weights of [[1, 1, 1], [1, 2, 3, 4], [5000, 3000, 2000], [1, 1, 1, 1, 1, 1, 1]]) {
      const parts = allocate(total, weights);
      const sum = parts.reduce((a, b) => a + b, 0);
      if (sum !== total) worst = `${total} over [${weights}] summed to ${sum}`;
    }
  }
  check("parts always sum to the total", worst, "");
}

// --- roster helpers ---
check(
  "allocateByShares keeps ids attached",
  allocateByShares(100, [
    { userId: "a", shareBps: 5000 },
    { userId: "b", shareBps: 5000 },
  ]),
  [
    { userId: "a", amountCents: 50 },
    { userId: "b", amountCents: 50 },
  ],
);
check(
  "allocateEqually",
  allocateEqually(10, ["a", "b", "c"]),
  [
    { userId: "a", amountCents: 4 },
    { userId: "b", amountCents: 3 },
    { userId: "c", amountCents: 3 },
  ],
);

// --- formatting ---
check("positive money", formatMoney(123456), "$1,234.56");
check("negative money uses a real minus sign", formatMoney(-420), "−$4.20");

// --- calendar ---
check("two nights", nightsBetween("2027-01-15", "2027-01-17"), 2);
check("same day is zero nights", nightsBetween("2027-01-15", "2027-01-15"), 0);
check("nights are listed from arrival", nightsIn("2027-01-15", "2027-01-17"), [
  "2027-01-15",
  "2027-01-16",
]);
// 2027-01-15 is a Friday.
check("Friday is a weekend night", isWeekendNight("2027-01-15"), true);
check("Saturday is a weekend night", isWeekendNight("2027-01-16"), true);
check("Sunday night is a weeknight — you drive home", isWeekendNight("2027-01-17"), false);

// --- guest pricing ---
{
  const rates = [
    { centsPerPersonPerNight: 5000, appliesTo: "weekend" as const },
    { centsPerPersonPerNight: 3000, appliesTo: "weekday" as const },
  ];
  // Fri + Sat at 50, Sun at 30, one person.
  check("mixed week prices per night", quoteGuestStay("2027-01-15", "2027-01-18", 1, rates), 13000);
  check("party size multiplies", quoteGuestStay("2027-01-15", "2027-01-18", 3, rates), 39000);
  check("no rates means unpriced, not free", quoteGuestStay("2027-01-15", "2027-01-18", 1, []), 0);

  const flat = [{ centsPerPersonPerNight: 4000, appliesTo: "any" as const }];
  check("the 'any' fallback applies to every night", quoteGuestStay("2027-01-15", "2027-01-18", 1, flat), 12000);
}

console.log(failures === 0 ? "\nmoney.ts: all checks passed" : `\nmoney.ts: ${failures} FAILED`);
if (failures > 0) process.exit(1);

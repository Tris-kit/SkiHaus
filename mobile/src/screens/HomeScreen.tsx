// The house dashboard: what you owe, what needs you, and where everything is.
//
// The ordering is the opinion. Money first, because that is the thing people
// avoid and then resent. Then anything waiting on you — an open vote, an
// unacknowledged lease. Then the week ahead. Navigation is last, because if
// the top of this screen did its job you never scroll to it.

import { Text, View } from "react-native";
import {
  fetchBalances,
  listAnnouncements,
  listDocuments,
  listPolls,
  type HouseEntry,
} from "../api";
import { useLoad } from "../hooks";
import { formatMoney } from "../money";
import { colors, spacing } from "../theme";
import { Banner, Card, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import type { Session } from "../types";
import type { Step } from "../../App";

export function HomeScreen({
  entry,
  session,
  onGo,
  onSwitchHouse,
}: {
  entry: HouseEntry;
  session: Session;
  onGo: (step: Step) => void;
  onSwitchHouse: () => void;
}) {
  const houseId = entry.house.id;
  const isGuest = entry.role === "guest";

  // Guests have no ledger, so don't ask for one — a 403 in the console on
  // every launch is how people learn to ignore the console.
  const ledger = useLoad(
    () => (isGuest ? Promise.resolve(null) : fetchBalances(houseId)),
    [houseId, isGuest],
  );
  const polls = useLoad(() => listPolls(houseId), [houseId]);
  const docs = useLoad(() => listDocuments(houseId), [houseId]);
  const feed = useLoad(() => listAnnouncements(houseId), [houseId]);

  const me = ledger.data?.balances.find((b) => b.userId === session.user.id);
  const openPolls = polls.data?.polls.filter((p) => p.status === "open") ?? [];
  const unacked = docs.data?.documents.filter((d) => !d.ackedByMe) ?? [];
  const unread = feed.data?.unread ?? 0;

  return (
    <Screen
      title={entry.house.name}
      subtitle={[entry.house.location, entry.house.season].filter(Boolean).join(" · ")}
      right={
        <Text
          onPress={onSwitchHouse}
          style={{ color: colors.primary, fontSize: 14, fontWeight: "600", paddingTop: 6 }}
        >
          Switch
        </Text>
      }
    >
      {/* --- money --- */}
      {!isGuest && (
        <>
          {ledger.loading ? (
            <Loading />
          ) : me ? (
            <Card style={{ paddingVertical: spacing(2.5) }}>
              <Text style={{ fontSize: 13, color: colors.textDim, fontWeight: "600" }}>
                {me.netCents >= 0 ? "The house owes you" : "You owe the house"}
              </Text>
              <Text
                style={{
                  fontSize: 38,
                  fontWeight: "800",
                  letterSpacing: -1,
                  color: me.netCents >= 0 ? colors.success : colors.text,
                  marginTop: 4,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatMoney(Math.abs(me.netCents))}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textFaint, marginTop: 6 }}>
                You&apos;ve paid {formatMoney(me.paidCents)} against{" "}
                {formatMoney(me.owedCents)} of costs.
              </Text>
            </Card>
          ) : null}
        </>
      )}

      {/* --- waiting on you --- */}
      {(openPolls.length > 0 || unacked.length > 0) && (
        <>
          <SectionHeader>Needs you</SectionHeader>
          <Card>
            {openPolls.map((p) => (
              <Row
                key={p.id}
                label={p.question}
                sub="Open vote"
                value={<Pill tone="warn">Vote</Pill>}
                onPress={() => onGo("votes")}
              />
            ))}
            {unacked.map((d, i) => (
              <Row
                key={d.id}
                label={d.title}
                sub="Not acknowledged"
                value={<Pill tone="warn">Read</Pill>}
                onPress={() => onGo("documents")}
                last={i === unacked.length - 1}
              />
            ))}
          </Card>
        </>
      )}

      {/* --- house health, managers only --- */}
      {entry.role === "admin" && ledger.data && ledger.data.unpaidGuestCents > 0 && (
        <Banner tone="warn">
          {formatMoney(ledger.data.unpaidGuestCents)} in approved guest fees hasn&apos;t been
          marked paid.
        </Banner>
      )}

      {/* --- navigation --- */}
      <SectionHeader>The house</SectionHeader>
      <Card>
        {!isGuest && (
          <Row
            label="Expenses"
            sub={
              ledger.data
                ? `${formatMoney(ledger.data.totalSpentCents)} this season`
                : "The ledger"
            }
            onPress={() => onGo("expenses")}
          />
        )}
        {!isGuest && (
          <Row
            label="Votes"
            sub={openPolls.length > 0 ? `${openPolls.length} open` : "House decisions"}
            onPress={() => onGo("votes")}
          />
        )}
        {!isGuest && (
          <Row label="Guests" sub="Stays and fees" onPress={() => onGo("guests")} />
        )}
        <Row label="Calendar" sub="Nights, mountains, dinner" onPress={() => onGo("calendar")} />
        <Row label="Documents" sub="Lease and house rules" onPress={() => onGo("documents")} />
        <Row
          label="People"
          sub={entry.role === "admin" ? "Roster, roles and invites" : "Who's in the house"}
          onPress={() => onGo("people")}
          last
        />
      </Card>

      {/* --- feed --- */}
      <SectionHeader>
        {unread > 0 ? `Recent · ${unread} new` : "Recent"}
      </SectionHeader>
      {feed.loading ? (
        <Loading />
      ) : (feed.data?.announcements.length ?? 0) === 0 ? (
        <View style={{ paddingVertical: spacing(2) }}>
          <Text style={{ fontSize: 14, color: colors.textFaint }}>Nothing yet.</Text>
        </View>
      ) : (
        <Card>
          {feed.data!.announcements.slice(0, 6).map((a, i, arr) => (
            <Row
              key={a.id}
              label={a.title}
              sub={a.body || undefined}
              value={a.readByMe ? undefined : <Pill tone="warn">New</Pill>}
              last={i === arr.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

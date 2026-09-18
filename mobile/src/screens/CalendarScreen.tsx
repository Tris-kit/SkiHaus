// Who's at the house, who's skiing where, and where dinner is.
//
// Organised by day rather than by feature, because that's how people ask the
// question: not "show me all ski days", but "what's happening Saturday?".
// Deliberately not a booking system — it makes plans visible, it doesn't
// arbitrate them (see the note in server/app/api/.../stays/route.ts).

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  claimStay,
  listDinners,
  listMembers,
  listMountains,
  listSkiDays,
  listStays,
  planDinner,
  rsvpDinner,
  setSkiDay,
} from "../api";
import { todayISO, useAction, useLoad } from "../hooks";
import { formatDayISO, parseDay } from "../money";
import { colors, radius, spacing } from "../theme";
import { Avatar, Banner, Button, Card, Field, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import type { HouseScreenProps } from "./common";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;

export function CalendarScreen({ entry, session, onBack }: HouseScreenProps) {
  const houseId = entry.house.id;
  const canWrite = entry.role !== "guest";

  const from = todayISO();
  const to = formatDayISO(parseDay(from) + WINDOW_DAYS * DAY_MS);

  const [claiming, setClaiming] = useState(false);

  const stays = useLoad(() => listStays(houseId), [houseId]);
  const skiDays = useLoad(() => listSkiDays(houseId, from, to), [houseId, from, to]);
  const dinners = useLoad(() => listDinners(houseId, from, to), [houseId, from, to]);
  const mountains = useLoad(() => listMountains(houseId), [houseId]);
  const members = useLoad(() => listMembers(houseId), [houseId]);
  const action = useAction();

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => formatDayISO(parseDay(from) + i * DAY_MS));

  function nameOf(userId: string): string {
    const m = members.data?.members.find((x) => x.userId === userId);
    return m?.user.name?.split(" ")[0] || "Someone";
  }

  return (
    <Screen title="Calendar" subtitle="Next two weeks" onBack={onBack}>
      {canWrite &&
        (claiming ? (
          <ClaimNights
            houseId={houseId}
            onDone={() => {
              setClaiming(false);
              stays.reload();
            }}
            onCancel={() => setClaiming(false)}
          />
        ) : (
          <Button title="Claim nights at the house" onPress={() => setClaiming(true)} style={{ marginBottom: spacing(2) }} />
        ))}

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      {stays.loading || skiDays.loading || dinners.loading ? (
        <Loading />
      ) : (
        days.map((day) => {
          const here = (stays.data?.stays ?? []).filter((s) => s.arriveOn <= day && day < s.departOn);
          const skiing = (skiDays.data?.skiDays ?? []).filter((s) => s.day === day);
          const dinner = dinners.data?.dinners.find((d) => d.day === day);
          const mine = skiing.find((s) => s.userId === session.user.id);

          // A day where nothing is planned and nobody is there is noise.
          if (here.length === 0 && skiing.length === 0 && !dinner) return null;

          return (
            <View key={day}>
              <SectionHeader>{prettyDay(day)}</SectionHeader>
              <Card>
                {here.length > 0 && (
                  <Row
                    label="At the house"
                    value={
                      <View style={{ flexDirection: "row", gap: -6 }}>
                        {here.slice(0, 5).map((s) => (
                          <Avatar key={s.id} name={nameOf(s.userId)} id={s.userId} size={26} />
                        ))}
                      </View>
                    }
                    sub={here.map((s) => nameOf(s.userId)).join(", ")}
                  />
                )}

                <Row
                  label="Skiing"
                  sub={
                    skiing.length === 0
                      ? "Nobody's said yet"
                      : skiing
                          .map((s) => {
                            const m = mountains.data?.mountains.find((x) => x.id === s.mountainId);
                            return `${nameOf(s.userId)} → ${m?.name ?? "TBD"}`;
                          })
                          .join(" · ")
                  }
                  value={mine ? <Pill tone="good">You&apos;re in</Pill> : undefined}
                />

                {canWrite && (mountains.data?.mountains.length ?? 0) > 0 && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: spacing(1.5) }}>
                    {mountains.data!.mountains.map((m) => {
                      const on = mine?.mountainId === m.id;
                      return (
                        <Pressable
                          key={m.id}
                          onPress={() =>
                            void action.run(
                              // Tapping the mountain you already picked clears
                              // the day — that's the rest-day path.
                              () => setSkiDay(houseId, day, on ? null : m.id),
                              skiDays.reload,
                            )
                          }
                          style={{
                            paddingHorizontal: 11,
                            paddingVertical: 6,
                            borderRadius: radius.pill,
                            backgroundColor: on ? colors.primary : colors.surfaceAlt,
                          }}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "600", color: on ? colors.onPrimary : colors.primaryDeep }}>
                            {m.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <Row
                  label="Dinner"
                  sub={
                    !dinner
                      ? "Nothing planned"
                      : dinner.kind === "in"
                        ? `Cooking in${dinner.cookUserId ? ` · ${nameOf(dinner.cookUserId)}` : ""}`
                        : `${dinner.note ?? "Out"}${dinner.timeLocal ? ` · ${dinner.timeLocal}` : ""}`
                  }
                  value={
                    dinner ? (
                      <Pill tone={dinner.rsvps.some((r) => r.userId === session.user.id && r.status === "in") ? "good" : "neutral"}>
                        {dinner.rsvps.filter((r) => r.status === "in").length} in
                      </Pill>
                    ) : undefined
                  }
                  onPress={
                    dinner
                      ? () => void action.run(() => rsvpDinner(houseId, dinner.id, "in"), dinners.reload)
                      : canWrite
                        ? () => void action.run(() => planDinner(houseId, { day, kind: "out" }), dinners.reload)
                        : undefined
                  }
                  last
                />
              </Card>
            </View>
          );
        })
      )}

      {(mountains.data?.mountains.length ?? 0) === 0 && canWrite && (
        <Banner tone="info">
          No mountains added yet — add the ones you actually ski and they&apos;ll show up as
          one-tap options on each day.
        </Banner>
      )}
    </Screen>
  );
}

function prettyDay(iso: string): string {
  const d = new Date(parseDay(iso));
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ClaimNights({
  houseId,
  onDone,
  onCancel,
}: {
  houseId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [arriveOn, setArriveOn] = useState(todayISO());
  const [departOn, setDepartOn] = useState("");
  const [bed, setBed] = useState("");
  const action = useAction();

  return (
    <Card style={{ paddingVertical: spacing(2) }}>
      <Field label="Arrive" value={arriveOn} onChangeText={setArriveOn} autoCapitalize="none" placeholder="2027-01-15" />
      <Field label="Depart" value={departOn} onChangeText={setDepartOn} autoCapitalize="none" placeholder="2027-01-18" />
      <Field
        label="Room (optional)"
        value={bed}
        onChangeText={setBed}
        placeholder="Bunk room"
        hint="Just a note — nobody's stopping anyone claiming the same bed."
      />
      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}
      <View style={{ flexDirection: "row", gap: spacing(1) }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title="Claim"
          onPress={() =>
            void action.run(
              () => claimStay(houseId, { arriveOn, departOn, bed: bed.trim() || null }),
              onDone,
            )
          }
          busy={action.busy}
          disabled={!departOn || departOn <= arriveOn}
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );
}

// The home screen: every ski lease you're part of, and a button to start one.
//
// This is the landing screen after sign-in, always — even with a single lease.
// It's the only place a new lease can be created, and it's the answer to
// "what am I part of", which is the question you have before "what do I owe".
//
// TERMINOLOGY: the UI says "ski lease" here because that's the thing you're a
// member of — a season-long agreement with other people. Inside one, it's "the
// house", because that's the place you drive to. The data model calls it
// `house` throughout.

import { useState } from "react";
import { Text, View } from "react-native";
import { createHouse, signOut } from "../api";
import { useAction } from "../hooks";
import { colors, spacing } from "../theme";
import { Avatar, Banner, Button, Card, Empty, Field, Row, RolePill, Screen, SectionHeader } from "../ui";
import type { Session } from "../types";

export function HousesScreen({
  session,
  onOpen,
  onChanged,
  onSignOut,
}: {
  session: Session;
  onOpen: (houseId: string) => void;
  onChanged: () => void;
  onSignOut: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const empty = session.houses.length === 0;

  return (
    <Screen
      title="SkiHaus"
      subtitle={session.user.name || session.user.email}
      right={
        <Avatar
          name={session.user.name || session.user.email}
          id={session.user.id}
          emoji={session.user.avatarEmoji}
        />
      }
    >
      {!empty && (
        <>
          <SectionHeader>
            {session.houses.length === 1 ? "Your lease" : `Your leases · ${session.houses.length}`}
          </SectionHeader>
          <Card>
            {session.houses.map((h, i) => (
              <Row
                key={h.house.id}
                label={h.house.name}
                sub={
                  [h.house.location, h.house.season].filter(Boolean).join(" · ") ||
                  "No location set"
                }
                value={<RolePill role={h.role} />}
                onPress={() => onOpen(h.house.id)}
                last={i === session.houses.length - 1}
              />
            ))}
          </Card>
        </>
      )}

      {empty && !creating && (
        <Empty
          icon="home"
          title="No ski leases yet"
          body="Start one if you're the person organising it. If someone else is, ask them for an invite link — you don't need an account they've set up for you."
        />
      )}

      {creating ? (
        <CreateLease
          onCreated={(id) => {
            setCreating(false);
            onChanged();
            onOpen(id);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button
          title="Create a ski lease"
          onPress={() => setCreating(true)}
          variant={empty ? "primary" : "secondary"}
        />
      )}

      <View style={{ marginTop: spacing(4) }}>
        <Button title="Sign out" variant="secondary" onPress={() => void signOut().then(onSignOut)} />
      </View>
    </Screen>
  );
}

function CreateLease({
  onCreated,
  onCancel,
}: {
  onCreated: (houseId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [season, setSeason] = useState(defaultSeason());
  const [location, setLocation] = useState("");
  const action = useAction();

  return (
    <>
      <SectionHeader>New ski lease</SectionHeader>
      <Card style={{ paddingVertical: spacing(2) }}>
        <Field
          label="What do you call it?"
          value={name}
          onChangeText={setName}
          placeholder="Cabin 12"
          autoCapitalize="words"
        />
        <Field
          label="Season"
          value={season}
          onChangeText={setSeason}
          placeholder="2026–27"
          hint="Just a label — it shows under the name."
        />
        <Field
          label="Mountain or town"
          value={location}
          onChangeText={setLocation}
          placeholder="Stowe, VT"
          autoCapitalize="words"
        />

        {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

        <View style={{ flexDirection: "row", gap: spacing(1) }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          <Button
            title="Create"
            busy={action.busy}
            disabled={name.trim().length < 2}
            onPress={() =>
              void action.run(async () => {
                const res = await createHouse({
                  name: name.trim(),
                  season: season.trim(),
                  location: location.trim(),
                });
                onCreated(res.house.id);
              })
            }
            style={{ flex: 2 }}
          />
        </View>

        <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: spacing(1.5), lineHeight: 18 }}>
          You&apos;ll be the manager: you record expenses, set guest fees and run votes. You can
          hand that over later.
        </Text>
      </Card>
    </>
  );
}

/** "2026–27" from today's date — a season spans the new year. */
function defaultSeason(): string {
  const now = new Date();
  // Before July we're in the back half of the season that started last year.
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${String(start + 1).slice(2)}`;
}

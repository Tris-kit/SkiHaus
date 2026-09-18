// The home screen: every ski lease you're part of.
//
// This is the landing screen after sign-in, always — even with a single
// lease. It answers "what am I part of", which is the question you have
// before "what do I owe".
//
// The screen itself is just the list. Creating a lease and signing out live
// in the header menu: you create a lease roughly once a year, and a button
// for it sitting under the list every single launch is noise. The exception
// is the empty state, where creating one is the only thing to do and so it
// gets to be the primary button.
//
// TERMINOLOGY: the UI says "ski lease" here because that's the thing you're a
// member of — a season-long agreement with other people. Inside one, it's
// "the house", because that's the place you drive to. The data model calls it
// `house` throughout.

import { useState } from "react";
import { Text, View } from "react-native";
import { createHouse, signOut } from "../api";
import { useAction } from "../hooks";
import { colors, spacing } from "../theme";
import {
  Avatar,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Picker,
  RolePill,
  Row,
  Screen,
  SectionHeader,
  type MenuItem,
} from "../ui";
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

  const menu: MenuItem[] = [
    { label: "Create a ski lease", icon: "plus-circle", onPress: () => setCreating(true) },
    {
      label: "Sign out",
      icon: "log-out",
      destructive: true,
      onPress: () => void signOut().then(onSignOut),
    },
  ];

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
      menu={menu}
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
        <>
          <Empty
            icon="home"
            title="No ski leases yet"
            body="Start one if you're the person organising it. If someone else is, ask them for an invite link — there's nothing they need to set up for you first."
          />
          <Button title="Create a ski lease" onPress={() => setCreating(true)} />
        </>
      )}

      {creating && (
        <CreateLease
          onCreated={(id) => {
            setCreating(false);
            onChanged();
            onOpen(id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
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
  const [season, setSeason] = useState(currentSeason());
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

        {/* A picker, not a text box. Left free, the same season arrives as
            "26/27", "2026-2027" and "winter 26", and then nothing groups or
            sorts. There are only ever a handful of sensible answers. */}
        <Picker
          label="Season"
          value={season}
          onChange={setSeason}
          options={seasonOptions().map((s) => ({
            value: s,
            label: s,
            sub: s === currentSeason() ? "This season" : undefined,
          }))}
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
                  season,
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

/** A ski season spans the new year, so it's named for both — "2026–27". */
function seasonFor(year: number): string {
  return `${year}–${String(year + 1).slice(2)}`;
}

/**
 * Anything from July onward belongs to the season starting this calendar
 * year; before July we're still in the back half of last year's.
 */
function startYear(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function currentSeason(): string {
  return seasonFor(startYear());
}

/** Last season through three ahead — enough to sign next year's lease early. */
function seasonOptions(): string[] {
  const start = startYear();
  return [-1, 0, 1, 2, 3].map((offset) => seasonFor(start + offset));
}

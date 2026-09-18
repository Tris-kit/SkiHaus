// Pick a house, or start one.
//
// Doubles as the empty state for a brand-new account: signing in with no
// memberships lands here rather than on a home screen with nothing on it.

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
  const [creating, setCreating] = useState(session.houses.length === 0);
  const [name, setName] = useState("");
  const [season, setSeason] = useState(defaultSeason());
  const [location, setLocation] = useState("");
  const action = useAction();

  function create() {
    void action.run(
      async () => {
        const res = await createHouse({ name: name.trim(), season, location: location.trim() });
        onOpen(res.house.id);
      },
      onChanged,
    );
  }

  return (
    <Screen
      title="Your houses"
      subtitle={session.user.email}
      right={
        <Avatar
          name={session.user.name || session.user.email}
          id={session.user.id}
          emoji={session.user.avatarEmoji}
        />
      }
    >
      {session.houses.length > 0 && (
        <Card>
          {session.houses.map((h, i) => (
            <Row
              key={h.house.id}
              label={h.house.name}
              sub={[h.house.location, h.house.season].filter(Boolean).join(" · ") || undefined}
              value={<RolePill role={h.role} />}
              onPress={() => onOpen(h.house.id)}
              last={i === session.houses.length - 1}
            />
          ))}
        </Card>
      )}

      {session.houses.length === 0 && !creating && (
        <Empty
          icon="home"
          title="No houses yet"
          body="Start a house if you're the manager, or ask whoever runs your lease to send you an invite link."
        />
      )}

      {creating ? (
        <>
          <SectionHeader>Start a house</SectionHeader>
          <Card style={{ paddingVertical: spacing(2) }}>
            <Field
              label="House name"
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
              hint="Just a label — it appears under the house name."
            />
            <Field
              label="Mountain or town"
              value={location}
              onChangeText={setLocation}
              placeholder="Stowe, VT"
              autoCapitalize="words"
            />
            {action.error ? <Banner tone="bad">{action.error}</Banner> : null}
            <Button
              title="Create house"
              onPress={create}
              busy={action.busy}
              disabled={name.trim().length < 2}
            />
            <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: spacing(1.5), lineHeight: 18 }}>
              You&apos;ll be the manager. You can invite members and guests, and hand the role over
              later.
            </Text>
          </Card>
        </>
      ) : (
        <Button title="Start a new house" variant="secondary" onPress={() => setCreating(true)} />
      )}

      <View style={{ marginTop: spacing(4) }}>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => void signOut().then(onSignOut)}
        />
      </View>
    </Screen>
  );
}

/** "2026–27" from today's date — a season spans the new year. */
function defaultSeason(): string {
  const now = new Date();
  // Before July, we're in the back half of the season that started last year.
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${String(start + 1).slice(2)}`;
}

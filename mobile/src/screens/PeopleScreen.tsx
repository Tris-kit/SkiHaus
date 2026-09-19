// The roster, roles, ownership shares, and invites.
//
// This is where the three-tier model becomes visible. A manager sets who is
// what; everyone else gets a read-only list of who's in the house.

import { useState } from "react";
import { Share, Text, View } from "react-native";
import { createInvite, listInvites, listMembers, updateMember } from "../api";
import { useAction, useLoad } from "../hooks";
import { colors, spacing } from "../theme";
import { Avatar, Banner, Button, Card, Field, Loading, RolePill, Row, Screen, SectionHeader } from "../ui";
import type { Role } from "../types";
import type { HouseScreenProps } from "./common";

export function PeopleScreen({
  entry,
  session,
  onBack,
  onChanged,
}: HouseScreenProps & { onChanged: () => void }) {
  const houseId = entry.house.id;
  const isAdmin = entry.role === "admin";
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const members = useLoad(() => listMembers(houseId), [houseId]);
  // Only a manager may read these; asking as a member would 403 on every open.
  const invites = useLoad(
    () => (isAdmin ? listInvites(houseId) : Promise.resolve({ invites: [] })),
    [houseId, isAdmin],
  );
  const action = useAction();

  // Live and unclaimed. A used-up or revoked invite is history, not a to-do.
  const pending = (invites.data?.invites ?? []).filter(
    (i) => i.revokedAt === null && i.expiresAt > Date.now() && i.usedCount < i.maxUses,
  );

  function invite() {
    void action.run(
      async () => {
        const res = await createInvite(houseId, {
          email: inviteEmail.trim() || null,
          role: inviteRole,
        });
        setInviteUrl(res.url);
        setInviteEmail("");
      },
      invites.reload,
    );
  }

  function cycleRole(userId: string, current: Role) {
    // guest → member → admin → guest. A three-value field doesn't need a
    // picker; tapping through it is faster and reads fine at this size.
    const next: Role = current === "guest" ? "member" : current === "member" ? "admin" : "guest";
    void action.run(() => updateMember(houseId, userId, { role: next }), () => {
      members.reload();
      onChanged();
    });
  }

  const totalBps = (members.data?.members ?? [])
    .filter((m) => m.role !== "guest")
    .reduce((a, m) => a + m.shareBps, 0);

  return (
    <Screen title="People" subtitle={entry.house.name} onBack={onBack}>
      {members.loading ? (
        <Loading />
      ) : members.error ? (
        <Banner tone="bad">{members.error}</Banner>
      ) : (
        <>
          <Card>
            {members.data!.members.map((m, i, arr) => (
              <Row
                key={m.userId}
                left={<Avatar name={m.user.name || m.user.email || "?"} id={m.userId} emoji={m.user.avatarEmoji} />}
                label={`${m.user.name || m.user.email || "Someone"}${m.userId === session.user.id ? " (you)" : ""}`}
                sub={
                  m.role === "guest"
                    ? undefined
                    : `${(m.shareBps / 100).toFixed(m.shareBps % 100 === 0 ? 0 : 1)}% share`
                }
                value={<RolePill role={m.role} />}
                onPress={isAdmin && m.userId !== session.user.id ? () => cycleRole(m.userId, m.role) : undefined}
                last={i === arr.length - 1}
              />
            ))}
          </Card>

          {isAdmin && (
            <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: -spacing(1), marginBottom: spacing(2), lineHeight: 18 }}>
              Tap someone to change their role. Shares total {(totalBps / 100).toFixed(0)}% — they
              don&apos;t have to add to 100, costs split in proportion either way.
            </Text>
          )}
        </>
      )}

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      {isAdmin && (
        <>
          <SectionHeader>Invite someone</SectionHeader>
          <Card style={{ paddingVertical: spacing(2) }}>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing(2) }}>
              {(["guest", "member", "admin"] as const).map((r) => (
                <Button
                  key={r}
                  title={r === "admin" ? "Manager" : r === "member" ? "Member" : "Guest"}
                  variant={inviteRole === r ? "primary" : "secondary"}
                  onPress={() => setInviteRole(r)}
                  style={{ flex: 1 }}
                />
              ))}
            </View>

            <Field
              label="Their email (optional)"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="dave@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              hint="With an email we send the invite. Without one you get a link to paste into the group text."
            />

            <Button
              title={inviteEmail.trim() ? "Send invite" : "Create a link"}
              onPress={invite}
              busy={action.busy}
            />

            <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: spacing(1.5), lineHeight: 18 }}>
              An invite sent to an email applies itself the moment that person
              confirms their address — whether or not they ever open the link.
            </Text>

            {inviteUrl && (
              <View style={{ marginTop: spacing(2) }}>
                <Text style={{ fontSize: 13, color: colors.textDim, lineHeight: 19 }}>
                  Link ready. It expires in 30 days.
                </Text>
                <Button
                  title="Share the link"
                  variant="secondary"
                  onPress={() => void Share.share({ message: inviteUrl })}
                  style={{ marginTop: spacing(1) }}
                />
              </View>
            )}
          </Card>

          {pending.length > 0 && (
            <>
              <SectionHeader>Waiting to join · {pending.length}</SectionHeader>
              <Card>
                {pending.map((inv, i) => (
                  <Row
                    key={`${inv.email ?? "link"}-${inv.createdAt}`}
                    label={inv.email ?? "Open link"}
                    sub={
                      inv.email
                        ? `Joins automatically once they confirm this address`
                        : `${inv.usedCount} of ${inv.maxUses} used · anyone with the link`
                    }
                    value={<RolePill role={inv.role} />}
                    last={i === pending.length - 1}
                  />
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {/* Sign out lives in the home screen's menu, one tap away. Repeating it
          at the bottom of a roster is the kind of stray destructive button
          people hit by accident. */}
    </Screen>
  );
}

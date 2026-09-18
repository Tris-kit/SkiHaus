// Guest stays and fees — the flow that makes "$50 a night, I think?" go away.
//
//   member requests  →  auto-quoted from the rate schedule  →  pending
//   manager approves →  fee confirmed, guest emailed a link →  approved
//
// The link is the important part: the guest never signs in and never
// downloads anything (CONTEXT.md §6).

import { useState } from "react";
import { Share, Text, View } from "react-native";
import { listGuestRates, listGuestStays, requestGuestStay, updateGuestStay } from "../api";
import { todayISO, useAction, useLoad } from "../hooks";
import { formatMoney, nightsBetween } from "../money";
import { colors, spacing } from "../theme";
import { Banner, Button, Card, Empty, Field, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import type { GuestStay } from "../types";
import { nameFor, type HouseScreenProps } from "./common";

export function GuestsScreen({ entry, session, onBack }: HouseScreenProps) {
  const houseId = entry.house.id;
  const isAdmin = entry.role === "admin";
  const [inviting, setInviting] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const stays = useLoad(() => listGuestStays(houseId), [houseId]);
  const rates = useLoad(() => listGuestRates(houseId), [houseId]);
  const action = useAction();

  const pending = stays.data?.stays.filter((s) => s.status === "pending") ?? [];
  const approved = stays.data?.stays.filter((s) => s.status === "approved") ?? [];

  function decide(stay: GuestStay, status: GuestStay["status"]) {
    void action.run(
      async () => {
        const res = await updateGuestStay(houseId, stay.id, { status });
        if (res.guestUrl) setLastUrl(res.guestUrl);
      },
      stays.reload,
    );
  }

  function togglePaid(stay: GuestStay) {
    void action.run(
      () => updateGuestStay(houseId, stay.id, { paid: stay.paidAt == null }),
      stays.reload,
    );
  }

  return (
    <Screen title="Guests" onBack={onBack}>
      {rates.data && rates.data.rates.length === 0 && isAdmin && (
        <Banner tone="warn">
          No guest rates set yet, so stays price at zero. Add a rate schedule before you start
          approving guests.
        </Banner>
      )}

      {lastUrl && (
        <Card style={{ paddingVertical: spacing(2) }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>Guest link ready</Text>
          <Text style={{ fontSize: 13, color: colors.textDim, marginTop: 4, lineHeight: 19 }}>
            We emailed it if you gave an address. Anyone with this link can see that stay — send
            it like a door code.
          </Text>
          <Button
            title="Share the link"
            variant="secondary"
            onPress={() => void Share.share({ message: lastUrl })}
            style={{ marginTop: spacing(1.5) }}
          />
        </Card>
      )}

      {inviting ? (
        <InviteGuest
          houseId={houseId}
          isAdmin={isAdmin}
          onDone={(url) => {
            setInviting(false);
            setLastUrl(url);
            stays.reload();
          }}
          onCancel={() => setInviting(false)}
        />
      ) : (
        <Button title="Invite a guest" onPress={() => setInviting(true)} style={{ marginBottom: spacing(2) }} />
      )}

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      {stays.loading ? (
        <Loading />
      ) : (stays.data?.stays.length ?? 0) === 0 ? (
        <Empty
          icon="user-plus"
          title="No guests yet"
          body="Invite someone and the house will know they're coming — and what they owe."
        />
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <SectionHeader>{isAdmin ? "Waiting on you" : "Pending approval"}</SectionHeader>
              <Card>
                {pending.map((s, i) => (
                  <View key={s.id} style={{ paddingVertical: spacing(1) }}>
                    <Row
                      label={`${s.guestName}${s.partySize > 1 ? ` +${s.partySize - 1}` : ""}`}
                      sub={`${s.arriveOn} → ${s.departOn} · ${s.nights} night${s.nights === 1 ? "" : "s"} · ${
                        s.feeCents > 0 ? formatMoney(s.feeCents) : "unpriced"
                      }`}
                      value={<Pill tone="warn">Pending</Pill>}
                      last
                    />
                    {isAdmin && (
                      <View style={{ flexDirection: "row", gap: spacing(1), paddingBottom: spacing(1) }}>
                        <Button
                          title="Decline"
                          variant="secondary"
                          onPress={() => decide(s, "declined")}
                          style={{ flex: 1 }}
                        />
                        <Button title="Approve" onPress={() => decide(s, "approved")} style={{ flex: 2 }} />
                      </View>
                    )}
                    {i < pending.length - 1 && (
                      <View style={{ height: 1, backgroundColor: colors.border }} />
                    )}
                  </View>
                ))}
              </Card>
            </>
          )}

          <SectionHeader>Confirmed</SectionHeader>
          {approved.length === 0 ? (
            <Text style={{ fontSize: 14, color: colors.textFaint, marginBottom: spacing(2) }}>
              Nobody confirmed yet.
            </Text>
          ) : (
            <Card>
              {approved.map((s, i) => (
                <Row
                  key={s.id}
                  label={`${s.guestName}${s.partySize > 1 ? ` +${s.partySize - 1}` : ""}`}
                  sub={`${s.arriveOn} → ${s.departOn} · host ${nameFor(null, s.hostUserId) === "Someone" && s.hostUserId === session.user.id ? "you" : ""}`}
                  value={
                    s.paidAt != null ? (
                      <Pill tone="good">Paid</Pill>
                    ) : (
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] }}>
                        {s.feeCents > 0 ? formatMoney(s.feeCents) : "—"}
                      </Text>
                    )
                  }
                  onPress={isAdmin ? () => togglePaid(s) : undefined}
                  last={i === approved.length - 1}
                />
              ))}
            </Card>
          )}
          {isAdmin && approved.length > 0 && (
            <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: -spacing(1), lineHeight: 18 }}>
              Tap a guest to toggle whether their fee has been paid.
            </Text>
          )}
        </>
      )}

      {rates.data && rates.data.rates.length > 0 && (
        <>
          <SectionHeader>Rates</SectionHeader>
          <Card>
            {rates.data.rates.map((r, i, arr) => (
              <Row
                key={r.id}
                label={r.name}
                sub={`${r.appliesTo === "any" ? "every night" : `${r.appliesTo} nights`}`}
                value={`${formatMoney(r.centsPerPersonPerNight)} pp/night`}
                last={i === arr.length - 1}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function InviteGuest({
  houseId,
  isAdmin,
  onDone,
  onCancel,
}: {
  houseId: string;
  isAdmin: boolean;
  onDone: (url: string) => void;
  onCancel: () => void;
}) {
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [arriveOn, setArriveOn] = useState(todayISO());
  const [departOn, setDepartOn] = useState("");
  const [partySize, setPartySize] = useState("1");
  const action = useAction();

  const nights = departOn ? nightsBetween(arriveOn, departOn) : 0;

  function save() {
    void action.run(async () => {
      const res = await requestGuestStay(houseId, {
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || null,
        partySize: Math.max(1, parseInt(partySize, 10) || 1),
        arriveOn,
        departOn,
      });
      onDone(res.guestUrl);
    });
  }

  return (
    <Card style={{ paddingVertical: spacing(2) }}>
      <Field label="Guest name" value={guestName} onChangeText={setGuestName} placeholder="Sam Ellis" autoCapitalize="words" />
      <Field
        label="Their email (optional)"
        value={guestEmail}
        onChangeText={setGuestEmail}
        placeholder="sam@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        hint="We'll send them their link. Leave blank and you can share it yourself."
      />
      <Field label="Arrive" value={arriveOn} onChangeText={setArriveOn} placeholder="2027-01-15" autoCapitalize="none" />
      <Field
        label="Depart"
        value={departOn}
        onChangeText={setDepartOn}
        placeholder="2027-01-18"
        autoCapitalize="none"
        hint={nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : undefined}
      />
      <Field label="How many people" value={partySize} onChangeText={setPartySize} keyboardType="number-pad" />

      {!isAdmin && (
        <Text style={{ fontSize: 12, color: colors.textFaint, marginBottom: spacing(2), lineHeight: 18 }}>
          This goes to the manager to price and approve.
        </Text>
      )}

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      <View style={{ flexDirection: "row", gap: spacing(1) }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title={isAdmin ? "Add guest" : "Request"}
          onPress={save}
          busy={action.busy}
          disabled={guestName.trim().length < 2 || nights < 1}
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );
}

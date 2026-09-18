// House decisions that actually close.
//
// The product claim here is narrow: a vote has a question, a deadline, a
// quorum and a recorded outcome. That is the difference between a decision and
// a group text.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { castBallot, closePoll, createPoll, fetchPoll, listPolls } from "../api";
import { useAction, useLoad } from "../hooks";
import { colors, radius, spacing } from "../theme";
import { Banner, Button, Card, Empty, Field, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import type { Poll, PollResult } from "../types";
import type { HouseScreenProps } from "./common";

export function VotesScreen({ entry, onBack }: HouseScreenProps) {
  const houseId = entry.house.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const polls = useLoad(() => listPolls(houseId), [houseId]);

  if (openId) {
    return (
      <PollDetail
        houseId={houseId}
        pollId={openId}
        isAdmin={entry.role === "admin"}
        onBack={() => {
          setOpenId(null);
          polls.reload();
        }}
      />
    );
  }

  const open = polls.data?.polls.filter((p) => p.status === "open") ?? [];
  const closed = polls.data?.polls.filter((p) => p.status === "closed") ?? [];

  return (
    <Screen title="Votes" onBack={onBack}>
      {entry.role === "admin" &&
        (composing ? (
          <NewPoll
            houseId={houseId}
            onDone={() => {
              setComposing(false);
              polls.reload();
            }}
            onCancel={() => setComposing(false)}
          />
        ) : (
          <Button title="Start a vote" onPress={() => setComposing(true)} style={{ marginBottom: spacing(2) }} />
        ))}

      {polls.loading ? (
        <Loading />
      ) : polls.error ? (
        <Banner tone="bad">{polls.error}</Banner>
      ) : open.length === 0 && closed.length === 0 ? (
        <Empty
          icon="check-square"
          title="No votes yet"
          body={
            entry.role === "admin"
              ? "Re-upping the lease, a new plow guy, whether dogs are allowed — put it to the house."
              : "Nothing to decide right now."
          }
        />
      ) : (
        <>
          {open.length > 0 && (
            <>
              <SectionHeader>Open</SectionHeader>
              <Card>
                {open.map((p, i) => (
                  <Row
                    key={p.id}
                    label={p.question}
                    sub={describe(p)}
                    value={<Pill tone="warn">Open</Pill>}
                    onPress={() => setOpenId(p.id)}
                    last={i === open.length - 1}
                  />
                ))}
              </Card>
            </>
          )}

          {closed.length > 0 && (
            <>
              <SectionHeader>Decided</SectionHeader>
              <Card>
                {closed.map((p, i) => (
                  <Row
                    key={p.id}
                    label={p.question}
                    sub={p.outcome ?? undefined}
                    onPress={() => setOpenId(p.id)}
                    last={i === closed.length - 1}
                  />
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function describe(p: Poll): string {
  const parts: string[] = [];
  if (p.quorumBps > 0) parts.push(`${p.quorumBps / 100}% quorum`);
  parts.push(p.passBps === 5000 ? "simple majority" : `${p.passBps / 100}% to pass`);
  if (p.anonymous) parts.push("anonymous");
  return parts.join(" · ");
}

function PollDetail({
  houseId,
  pollId,
  isAdmin,
  onBack,
}: {
  houseId: string;
  pollId: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const loaded = useLoad(() => fetchPoll(houseId, pollId), [houseId, pollId]);
  const [result, setResult] = useState<PollResult | null>(null);
  const action = useAction();

  const r = result ?? loaded.data;

  if (loaded.loading && !r) return <Screen title="Vote" onBack={onBack}><Loading /></Screen>;
  if (!r) return <Screen title="Vote" onBack={onBack}><Banner tone="bad">{loaded.error ?? "Not found."}</Banner></Screen>;

  const { poll } = r;
  const live = poll.status === "open";

  function vote(optionId: string) {
    const next = poll.kind === "multi"
      ? toggle(r!.myChoice ?? [], optionId)
      : [optionId];
    void action.run(async () => setResult(await castBallot(houseId, poll.id, next)));
  }

  return (
    <Screen title={poll.question} subtitle={describe(poll)} onBack={onBack}>
      {poll.detail ? (
        <Text style={{ fontSize: 15, color: colors.textDim, lineHeight: 22, marginBottom: spacing(2) }}>
          {poll.detail}
        </Text>
      ) : null}

      {!r.quorumMet && live && (
        <Banner tone="warn">
          {r.ballotCount} of {r.eligibleCount} have voted — not enough to decide yet.
        </Banner>
      )}

      {poll.status === "closed" && r.poll.outcome ? (
        <Banner tone="info">{r.poll.outcome}</Banner>
      ) : null}

      <Card>
        {poll.options.map((o, i) => {
          const count = r.counts.find((c) => c.optionId === o.id);
          const votes = count?.votes ?? 0;
          const share = r.ballotCount > 0 ? votes / r.ballotCount : 0;
          const chosen = r.myChoice?.includes(o.id) ?? false;

          return (
            <Pressable
              key={o.id}
              onPress={live ? () => vote(o.id) : undefined}
              disabled={!live || action.busy}
              style={{ paddingVertical: spacing(1.5) }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing(1) }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: poll.kind === "multi" ? 6 : 10,
                    borderWidth: 2,
                    borderColor: chosen ? colors.primary : colors.border,
                    backgroundColor: chosen ? colors.primary : colors.transparent,
                  }}
                />
                <Text style={{ flex: 1, fontSize: 15, fontWeight: chosen ? "700" : "500", color: colors.text }}>
                  {o.label}
                </Text>
                <Text style={{ fontSize: 14, color: colors.textDim, fontVariant: ["tabular-nums"] }}>
                  {votes}
                </Text>
              </View>
              {/* A bar rather than a percentage: eight people voting is not a
                  statistic, it's a picture. */}
              <View style={{ height: 6, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, marginTop: 8, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(share * 100)}%`, height: 6, backgroundColor: colors.primary }} />
              </View>
            </Pressable>
          );
        })}
      </Card>

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      {live && (
        <Text style={{ fontSize: 12, color: colors.textFaint, marginBottom: spacing(2), lineHeight: 18 }}>
          {r.myChoice
            ? "Your vote is recorded. Tap another option to change it while this is open."
            : "Tap an option to vote."}
        </Text>
      )}

      {isAdmin && live && (
        <Button
          title="Close this vote"
          variant="secondary"
          busy={action.busy}
          onPress={() =>
            void action.run(async () => setResult(await closePoll(houseId, poll.id)))
          }
        />
      )}
    </Screen>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function NewPoll({
  houseId,
  onDone,
  onCancel,
}: {
  houseId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [detail, setDetail] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [yesno, setYesno] = useState(true);
  const action = useAction();

  const options = optionsText.split("\n").map((s) => s.trim()).filter(Boolean);

  function save() {
    void action.run(
      () =>
        createPoll(houseId, {
          question: question.trim(),
          detail: detail.trim() || null,
          kind: yesno ? "yesno" : "single",
          options: yesno ? undefined : options,
          // Default to "most of the house has to weigh in". A vote nobody
          // showed up for shouldn't be able to decide anything.
          quorumBps: 6000,
          passBps: 5000,
        }),
      onDone,
    );
  }

  return (
    <Card style={{ paddingVertical: spacing(2) }}>
      <Field label="Question" value={question} onChangeText={setQuestion} placeholder="Re-up the lease for next season?" />
      <Field label="Detail (optional)" value={detail} onChangeText={setDetail} multiline placeholder="Rent goes up 8%…" />

      <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing(2) }}>
        {[
          { on: yesno, label: "Yes / No", set: () => setYesno(true) },
          { on: !yesno, label: "Multiple choice", set: () => setYesno(false) },
        ].map((o) => (
          <Pressable
            key={o.label}
            onPress={o.set}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: o.on ? colors.primary : colors.surfaceAlt,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: o.on ? colors.onPrimary : colors.primaryDeep }}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {!yesno && (
        <Field
          label="Options"
          value={optionsText}
          onChangeText={setOptionsText}
          multiline
          placeholder={"One per line\nStowe\nSugarbush"}
          hint="At least two."
        />
      )}

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      <View style={{ flexDirection: "row", gap: spacing(1) }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title="Open the vote"
          onPress={save}
          busy={action.busy}
          disabled={question.trim().length < 4 || (!yesno && options.length < 2)}
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );
}

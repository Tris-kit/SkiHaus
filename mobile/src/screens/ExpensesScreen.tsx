// The ledger. Two views behind one screen: the list of what was spent, and
// the balances that fall out of it.
//
// Only a manager sees the "Add" form — recording spending is an admin action
// (CONTEXT.md §4). Everyone else gets a complete, unedited read of the same
// numbers, which is the whole point of having the app.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  createExpense,
  fetchBalances,
  listCategories,
  listExpenses,
  listMembers,
} from "../api";
import { todayISO, useAction, useLoad } from "../hooks";
import { formatMoney, toCents } from "../money";
import { colors, radius, spacing } from "../theme";
import { Avatar, Banner, Button, Card, Empty, Field, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import { nameFor, type HouseScreenProps } from "./common";

type Tab = "spending" | "balances";

export function ExpensesScreen({ entry, session, onBack }: HouseScreenProps) {
  const houseId = entry.house.id;
  const [tab, setTab] = useState<Tab>("spending");
  const [adding, setAdding] = useState(false);

  const expenses = useLoad(() => listExpenses(houseId), [houseId]);
  const balances = useLoad(() => fetchBalances(houseId), [houseId]);
  const members = useLoad(() => listMembers(houseId), [houseId]);
  const categories = useLoad(() => listCategories(houseId), [houseId]);

  function reloadAll() {
    expenses.reload();
    balances.reload();
  }

  return (
    <Screen
      title="Money"
      subtitle={
        balances.data ? `${formatMoney(balances.data.totalSpentCents)} spent this season` : undefined
      }
      onBack={onBack}
    >
      <Tabs tab={tab} onChange={setTab} />

      {tab === "spending" ? (
        <>
          {entry.role === "admin" &&
            (adding ? (
              <AddExpense
                houseId={houseId}
                categories={categories.data?.categories ?? []}
                members={members.data?.members ?? []}
                onDone={() => {
                  setAdding(false);
                  reloadAll();
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button title="Record an expense" onPress={() => setAdding(true)} style={{ marginBottom: spacing(2) }} />
            ))}

          {expenses.loading ? (
            <Loading />
          ) : expenses.error ? (
            <Banner tone="bad">{expenses.error}</Banner>
          ) : (expenses.data?.expenses.length ?? 0) === 0 ? (
            <Empty
              icon="file-text"
              title="Nothing recorded yet"
              body={
                entry.role === "admin"
                  ? "Add the rent, the plow contract, the firewood — anything the house pays for."
                  : "Your manager hasn't recorded any spending yet."
              }
            />
          ) : (
            <Card>
              {expenses.data!.expenses.map((e, i, arr) => {
                const cat = categories.data?.categories.find((c) => c.id === e.categoryId);
                const mine = e.shares.find((sh) => sh.userId === session.user.id);
                return (
                  <Row
                    key={e.id}
                    label={e.description}
                    sub={`${e.incurredOn}${cat ? ` · ${cat.name}` : ""} · paid by ${nameFor(
                      members.data?.members ?? null,
                      e.paidBy,
                    )}`}
                    value={
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] }}>
                          {formatMoney(e.amountCents)}
                        </Text>
                        {mine ? (
                          <Text style={{ fontSize: 12, color: colors.textFaint, fontVariant: ["tabular-nums"] }}>
                            you {formatMoney(mine.amountCents)}
                          </Text>
                        ) : null}
                      </View>
                    }
                    last={i === arr.length - 1}
                  />
                );
              })}
            </Card>
          )}
        </>
      ) : (
        <Balances
          data={balances}
          members={members.data?.members ?? null}
          meId={session.user.id}
        />
      )}
    </Screen>
  );
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 4, marginBottom: spacing(2) }}>
      {(["spending", "balances"] as const).map((t) => (
        <Pressable
          key={t}
          onPress={() => onChange(t)}
          style={{
            flex: 1,
            paddingVertical: 9,
            borderRadius: radius.sm,
            backgroundColor: tab === t ? colors.surface : colors.transparent,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: tab === t ? colors.primaryDeep : colors.textDim }}>
            {t === "spending" ? "Spending" : "Balances"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Balances({
  data,
  members,
  meId,
}: {
  data: ReturnType<typeof useLoad<Awaited<ReturnType<typeof fetchBalances>>>>;
  members: Awaited<ReturnType<typeof listMembers>>["members"] | null;
  meId: string;
}) {
  if (data.loading) return <Loading />;
  if (data.error) return <Banner tone="bad">{data.error}</Banner>;
  if (!data.data) return null;

  const { balances, settleUp, guestIncomeCents } = data.data;

  return (
    <>
      <SectionHeader>Where everyone stands</SectionHeader>
      <Card>
        {balances.map((b, i) => {
          const m = members?.find((x) => x.userId === b.userId);
          return (
            <Row
              key={b.userId}
              left={
                <Avatar
                  name={m?.user.name || "?"}
                  id={b.userId}
                  emoji={m?.user.avatarEmoji}
                  size={32}
                />
              }
              label={`${m?.user.name || "Someone"}${b.userId === meId ? " (you)" : ""}`}
              sub={`paid ${formatMoney(b.paidCents)} · owes ${formatMoney(b.owedCents)}`}
              value={
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                    color: b.netCents > 0 ? colors.success : b.netCents < 0 ? colors.danger : colors.textDim,
                  }}
                >
                  {b.netCents === 0 ? "—" : formatMoney(b.netCents)}
                </Text>
              }
              last={i === balances.length - 1}
            />
          );
        })}
      </Card>

      {settleUp.length > 0 && (
        <>
          <SectionHeader>Settle up</SectionHeader>
          <Card>
            {settleUp.map((t, i) => (
              <Row
                key={`${t.fromUserId}-${t.toUserId}`}
                label={`${members?.find((m) => m.userId === t.fromUserId)?.user.name ?? "Someone"} → ${
                  members?.find((m) => m.userId === t.toUserId)?.user.name ?? "someone"
                }`}
                value={formatMoney(t.amountCents)}
                last={i === settleUp.length - 1}
              />
            ))}
          </Card>
          <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: -spacing(1), marginBottom: spacing(2), lineHeight: 18 }}>
            Ski House doesn&apos;t move money. Venmo each other, then record it so the ledger
            keeps up.
          </Text>
        </>
      )}

      {guestIncomeCents > 0 && (
        <Card>
          <Row
            label="Guest fees collected"
            sub="Offsets the season total"
            value={<Pill tone="good">{formatMoney(guestIncomeCents)}</Pill>}
            last
          />
        </Card>
      )}
    </>
  );
}

function AddExpense({
  houseId,
  categories,
  members,
  onDone,
  onCancel,
}: {
  houseId: string;
  categories: Awaited<ReturnType<typeof listCategories>>["categories"];
  members: Awaited<ReturnType<typeof listMembers>>["members"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const action = useAction();

  const amountCents = toCents(amount);

  function save() {
    void action.run(
      () =>
        createExpense(houseId, {
          description: description.trim(),
          amountCents,
          incurredOn,
          categoryId,
          paidBy,
          splitMode: "shares",
        }),
      onDone,
    );
  }

  return (
    <Card style={{ paddingVertical: spacing(2) }}>
      <Field label="What was it?" value={description} onChangeText={setDescription} placeholder="Plow contract" />
      <Field
        label="Amount"
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        hint={amountCents > 0 ? `Splits by ownership share → ${formatMoney(amountCents)}` : undefined}
      />
      <Field label="Date" value={incurredOn} onChangeText={setIncurredOn} placeholder="2027-01-15" autoCapitalize="none" />

      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textDim, marginBottom: 6 }}>Category</Text>
      <Chips
        options={categories.map((c) => ({ id: c.id, label: c.name }))}
        selected={categoryId}
        onSelect={setCategoryId}
      />

      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textDim, marginBottom: 6, marginTop: spacing(2) }}>
        Who paid
      </Text>
      <Chips
        options={[
          { id: "__house__", label: "House account" },
          ...members.filter((m) => m.role !== "guest").map((m) => ({ id: m.userId, label: m.user.name || m.user.email })),
        ]}
        selected={paidBy ?? "__house__"}
        onSelect={(id) => setPaidBy(id === "__house__" ? null : id)}
      />

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      <View style={{ flexDirection: "row", gap: spacing(1), marginTop: spacing(2) }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title="Save"
          onPress={save}
          busy={action.busy}
          disabled={description.trim().length < 2 || amountCents <= 0}
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );
}

/** Horizontal single-select. A picker wheel for six categories is overkill. */
function Chips({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ id: string; label: string }>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = o.id === selected;
        return (
          <Pressable
            key={o.id}
            onPress={() => onSelect(o.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: radius.pill,
              backgroundColor: on ? colors.primary : colors.surfaceAlt,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: on ? colors.onPrimary : colors.primaryDeep }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

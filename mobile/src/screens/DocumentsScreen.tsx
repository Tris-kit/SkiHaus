// The lease agreement, house rules, insurance.
//
// The feature that matters is the acknowledgement: a manager can see who has
// actually read the lease. Acks are per-version, so republishing resets them.

import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { ackDocument, createDocument, listDocuments } from "../api";
import { useAction, useLoad } from "../hooks";
import { colors, spacing } from "../theme";
import { Banner, Button, Card, Empty, Field, Loading, Pill, Row, Screen, SectionHeader } from "../ui";
import type { HouseDocument } from "../types";
import type { HouseScreenProps } from "./common";

export function DocumentsScreen({ entry, onBack }: HouseScreenProps) {
  const houseId = entry.house.id;
  const [open, setOpen] = useState<HouseDocument | null>(null);
  const [adding, setAdding] = useState(false);

  const docs = useLoad(() => listDocuments(houseId), [houseId]);
  const action = useAction();

  if (open) {
    return (
      <Screen title={open.title} subtitle={`Version ${open.version}`} onBack={() => setOpen(null)}>
        {open.bodyMd ? (
          // Rendered as plain pre-wrapped text, not parsed markdown — a
          // markdown renderer means shipping a sanitiser too, and house rules
          // are a bulleted list, not a document format.
          <Card style={{ paddingVertical: spacing(2) }}>
            <Text style={{ fontSize: 15, lineHeight: 23, color: colors.text }}>{open.bodyMd}</Text>
          </Card>
        ) : null}

        {open.url ? (
          <Button
            title="Open the file"
            variant="secondary"
            onPress={() => void Linking.openURL(open.url!)}
            style={{ marginBottom: spacing(2) }}
          />
        ) : null}

        {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

        {open.ackedByMe ? (
          <Banner tone="info">You acknowledged this version.</Banner>
        ) : (
          <Button
            title="I've read this"
            busy={action.busy}
            onPress={() =>
              void action.run(
                async () => {
                  await ackDocument(houseId, open.id);
                  setOpen({ ...open, ackedByMe: true });
                },
                docs.reload,
              )
            }
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Documents" onBack={onBack}>
      {entry.role === "admin" &&
        (adding ? (
          <AddDocument
            houseId={houseId}
            onDone={() => {
              setAdding(false);
              docs.reload();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button title="Add a document" onPress={() => setAdding(true)} style={{ marginBottom: spacing(2) }} />
        ))}

      {docs.loading ? (
        <Loading />
      ) : docs.error ? (
        <Banner tone="bad">{docs.error}</Banner>
      ) : (docs.data?.documents.length ?? 0) === 0 ? (
        <Empty
          icon="file-text"
          title="Nothing here yet"
          body={
            entry.role === "admin"
              ? "Put the lease agreement and the house rules here so nobody has to ask for them."
              : "Your manager hasn't shared anything yet."
          }
        />
      ) : (
        <>
          <SectionHeader>Shared with you</SectionHeader>
          <Card>
            {docs.data!.documents.map((d, i, arr) => (
              <Row
                key={d.id}
                label={d.title}
                sub={`${LABEL[d.kind]} · v${d.version}`}
                value={d.ackedByMe ? <Pill tone="good">Read</Pill> : <Pill tone="warn">New</Pill>}
                onPress={() => setOpen(d)}
                last={i === arr.length - 1}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const LABEL: Record<HouseDocument["kind"], string> = {
  lease: "Lease agreement",
  rules: "House rules",
  insurance: "Insurance",
  other: "Document",
};

function AddDocument({
  houseId,
  onDone,
  onCancel,
}: {
  houseId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [url, setUrl] = useState("");
  const [guestVisible, setGuestVisible] = useState(false);
  const action = useAction();

  return (
    <Card style={{ paddingVertical: spacing(2) }}>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="House rules" autoCapitalize="sentences" />
      <Field
        label="Text"
        value={bodyMd}
        onChangeText={setBodyMd}
        multiline
        placeholder={"Quiet after 11.\nStrip your bed before you leave.\n…"}
      />
      <Field
        label="Or a link"
        value={url}
        onChangeText={setUrl}
        placeholder="https://drive.google.com/…"
        autoCapitalize="none"
        hint="There's no file upload yet — link to the PDF wherever it already lives."
      />

      <Button
        title={guestVisible ? "✓ Guests can see this" : "Guests can see this"}
        variant="secondary"
        onPress={() => setGuestVisible((v) => !v)}
        style={{ marginBottom: spacing(2) }}
      />
      <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: -spacing(1.5), marginBottom: spacing(2), lineHeight: 18 }}>
        House rules: yes. The lease with the rent on it: probably not.
      </Text>

      {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

      <View style={{ flexDirection: "row", gap: spacing(1) }}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          title="Publish"
          busy={action.busy}
          disabled={title.trim().length < 2 || (!bodyMd.trim() && !url.trim())}
          onPress={() =>
            void action.run(
              () =>
                createDocument(houseId, {
                  title: title.trim(),
                  kind: /rule/i.test(title) ? "rules" : /lease/i.test(title) ? "lease" : "other",
                  bodyMd: bodyMd.trim() || null,
                  url: url.trim() || null,
                  visibleTo: guestVisible ? ["admin", "member", "guest"] : ["admin", "member"],
                }),
              onDone,
            )
          }
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );
}

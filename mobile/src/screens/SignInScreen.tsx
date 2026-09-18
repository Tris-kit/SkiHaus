// Sign in, sign up, or get a link emailed.
//
// Password is the default path because it works with no email infrastructure
// at all — you can stand the whole app up with nothing but a database. The
// magic link stays available for anyone who'd rather not have a password, and
// it's the route back in when one is forgotten.

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { register, requestSignInLink, signIn, verifyToken } from "../api";
import { useAction } from "../hooks";
import { isWeb } from "../storage";
import { colors, radius, spacing } from "../theme";
import { Banner, Button, Card, Field, Screen } from "../ui";
import type { Session } from "../types";

type Mode = "signin" | "signup" | "link";

export function SignInScreen({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();

  function go() {
    void action.run(async () => {
      if (mode === "signin") return onSignedIn(await signIn(email.trim(), password));
      if (mode === "signup") return onSignedIn(await register(email.trim(), password, name.trim()));
      await requestSignInLink(email.trim());
      setSent(true);
    });
  }

  function switchTo(next: Mode) {
    setMode(next);
    setSent(false);
    action.clear();
  }

  const emailLooksOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit =
    mode === "link" ? emailLooksOk : emailLooksOk && password.length >= 8;

  return (
    <Screen>
      <View style={{ paddingTop: spacing(5), paddingBottom: spacing(3) }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: colors.primary,
          }}
        >
          Ski House
        </Text>
        <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text, marginTop: spacing(1) }}>
          Run the lease,{"\n"}not the group text.
        </Text>
        <Text style={{ fontSize: 15, color: colors.textDim, marginTop: spacing(1.5), lineHeight: 22 }}>
          Expenses, votes, guest fees and who&apos;s skiing what — in one place everyone can
          actually see.
        </Text>
      </View>

      <Card style={{ paddingVertical: spacing(2.5) }}>
        {sent ? (
          <CheckYourEmail
            email={email}
            onSignedIn={onSignedIn}
            onRestart={() => switchTo("signin")}
          />
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={switchTo}
              options={[
                { value: "signin", label: "Sign in" },
                { value: "signup", label: "Create account" },
              ]}
            />

            {mode === "signup" && (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                placeholder="Tristan"
                autoCapitalize="words"
              />
            )}

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {mode !== "link" && (
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                secureTextEntry
                autoCapitalize="none"
                hint={mode === "signup" ? "Eight characters minimum. That's the only rule." : undefined}
              />
            )}

            {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

            <Button
              title={mode === "signup" ? "Create account" : "Sign in"}
              onPress={go}
              busy={action.busy}
              disabled={!canSubmit}
            />

            <Pressable onPress={() => switchTo("link")} style={{ marginTop: spacing(2) }}>
              <Text style={{ fontSize: 13, color: colors.primary, textAlign: "center" }}>
                {mode === "link" ? "Use a password instead" : "Email me a sign-in link instead"}
              </Text>
            </Pressable>

            {mode === "link" && (
              <Text style={{ fontSize: 12, color: colors.textFaint, marginTop: spacing(1), lineHeight: 18, textAlign: "center" }}>
                No password needed — we&apos;ll send a link that signs you in.
              </Text>
            )}
          </>
        )}
      </Card>

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: "center", lineHeight: 18 }}>
        Guests don&apos;t need an account at all — they get their own link.
      </Text>
    </Screen>
  );
}

function CheckYourEmail({
  email,
  onSignedIn,
  onRestart,
}: {
  email: string;
  onSignedIn: (s: Session) => void;
  onRestart: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const action = useAction();

  return (
    <>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Check your email</Text>
      <Text style={{ fontSize: 14, color: colors.textDim, marginTop: 6, lineHeight: 20 }}>
        We sent a link to {email}. It works once and expires in 20 minutes.
      </Text>

      {/* Native only. On web the emailed link navigates to /join/<token>,
          which sets the cookie server-side — nothing to paste. The native app
          has no such navigation until universal links are configured. */}
      {!isWeb && (
        <View style={{ marginTop: spacing(3) }}>
          <Field
            label="Or paste the link here"
            value={pasted}
            onChangeText={setPasted}
            placeholder="https://…/join/…"
            autoCapitalize="none"
          />
          {action.error ? <Banner tone="bad">{action.error}</Banner> : null}
          <Button
            title="Sign in"
            busy={action.busy}
            disabled={!pasted.trim()}
            onPress={() =>
              void action.run(async () => onSignedIn(await verifyToken(extractToken(pasted.trim()))))
            }
          />
        </View>
      )}

      <Button
        title="Back"
        variant="secondary"
        onPress={onRestart}
        style={{ marginTop: spacing(1.5) }}
      />
    </>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        backgroundColor: colors.surfaceAlt,
        borderRadius: radius.md,
        padding: 4,
        marginBottom: spacing(2.5),
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              paddingVertical: 9,
              borderRadius: radius.sm,
              backgroundColor: on ? colors.surface : colors.transparent,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: on ? colors.primaryDeep : colors.textDim }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Accept either a pasted URL or a bare token — people paste both. */
function extractToken(input: string): string {
  const m = /\/join\/([^/?#\s]+)/.exec(input);
  return m ? m[1] : input;
}

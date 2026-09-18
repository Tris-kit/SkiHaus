// The whole sign-up and sign-in flow: type your email, click the link.
//
// There is no password field, no "create account" tab, and no social buttons.
// Sign-up and sign-in are the same action — the server upserts the user when
// the link is consumed — so there is nothing here for someone to get wrong.

import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { requestSignInLink, verifyToken } from "../api";
import { useAction } from "../hooks";
import { isWeb } from "../storage";
import { colors, spacing } from "../theme";
import { Banner, Button, Card, Field, Screen } from "../ui";
import type { Session } from "../types";

export function SignInScreen({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const action = useAction();

  function send() {
    void action.run(
      () => requestSignInLink(email.trim()),
      () => setSent(true),
    );
  }

  /**
   * Native only. On web, clicking the emailed link navigates to /join/:token,
   * which sets the cookie server-side and lands you in the app — nothing to
   * paste. In the native app there is no such navigation, so the token has to
   * come back in by hand until universal links are configured (see
   * RELEASING.md).
   */
  function verify() {
    void action.run(
      async () => {
        const token = extractToken(code.trim());
        return onSignedIn(await verifyToken(token));
      },
    );
  }

  return (
    <Screen>
      <View style={{ paddingTop: spacing(6), paddingBottom: spacing(3) }}>
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
        {!sent ? (
          <>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              hint="We'll email you a link. No password to remember."
            />
            {action.error ? <Banner tone="bad">{action.error}</Banner> : null}
            <Button
              title="Email me a link"
              onPress={send}
              busy={action.busy}
              disabled={!email.includes("@")}
            />
          </>
        ) : (
          <>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
              Check your email
            </Text>
            <Text style={{ fontSize: 14, color: colors.textDim, marginTop: 6, lineHeight: 20 }}>
              We sent a link to {email}. It works once and expires in 20 minutes.
            </Text>

            {!isWeb && (
              <View style={{ marginTop: spacing(3) }}>
                <Field
                  label="Or paste the link here"
                  value={code}
                  onChangeText={setCode}
                  placeholder="https://…/join/…"
                  autoCapitalize="none"
                  hint="Opening the link in Safari signs in the web app. Paste it here to sign in to this app instead."
                />
                {action.error ? <Banner tone="bad">{action.error}</Banner> : null}
                <Button title="Sign in" onPress={verify} busy={action.busy} disabled={!code.trim()} />
              </View>
            )}

            <Button
              title="Use a different email"
              variant="secondary"
              onPress={() => {
                setSent(false);
                action.clear();
              }}
              style={{ marginTop: spacing(1.5) }}
            />
          </>
        )}
      </Card>

      <Text
        style={{ fontSize: 12, color: colors.textFaint, textAlign: "center", lineHeight: 18 }}
        onPress={() => void Linking.openURL("https://github.com/Tris-kit/SkiHaus")}
      >
        By signing in you agree to the terms and privacy policy.
      </Text>
    </Screen>
  );
}

/** Accept either a pasted URL or a bare token — people paste both. */
function extractToken(input: string): string {
  const m = /\/join\/([^/?#\s]+)/.exec(input);
  return m ? m[1] : input;
}

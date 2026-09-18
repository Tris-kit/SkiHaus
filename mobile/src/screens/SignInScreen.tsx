// Email-first sign-in.
//
//   email ─▶ check ─┬─ account exists      ─▶ password        ─▶ in
//                   ├─ no account          ─▶ name + password ─▶ confirm email
//                   └─ registered, unconfirmed ─▶ confirm email
//
// One field on the first screen. Nobody has to decide up front whether they
// are signing in or signing up — the server already knows, so asking is just
// making the person do the lookup for us.
//
// There is no magic-link sign-in. The only links we email are "confirm your
// address" and "reset your password", both of which do something a password
// can't.
//
// Mirrors server/components/SignInForm.tsx, which runs the same flow inline on
// the invite page. Keep the two in step.

import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { checkEmail, register, requestPasswordReset, signIn, verifyToken } from "../api";
import { useAction } from "../hooks";
import { isWeb } from "../storage";
import { colors, spacing } from "../theme";
import { Banner, Button, Card, Field, Screen } from "../ui";
import type { Session } from "../types";

type Step = "email" | "password" | "create" | "verify" | "reset-sent";

export function SignInScreen({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const action = useAction();

  const addr = email.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);

  function submit() {
    void action.run(async () => {
      if (step === "email") {
        const r = await checkEmail(addr);
        if (r.needsVerification) return setStep("verify");
        // An account with no password predates password auth. "create" is
        // the right destination — the server lets them set a first one
        // because there's no current password to check against.
        return setStep(r.exists && r.hasPassword ? "password" : "create");
      }
      if (step === "password") return onSignedIn(await signIn(addr, password));
      if (step === "create") {
        await register(addr, password, name.trim());
        return setStep("verify");
      }
    });
  }

  function restart() {
    setStep("email");
    setPassword("");
    action.clear();
  }

  const canSubmit =
    step === "email"
      ? emailOk
      : step === "password"
        ? password.length > 0
        : name.trim().length > 0 && password.length >= 8;

  return (
    <Screen>
      <View style={{ alignItems: "center", paddingTop: spacing(5), paddingBottom: spacing(3) }}>
        <Image
          source={require("../../assets/icon.png")}
          // Square source; the radius is iOS's squircle approximation so it
          // reads as an app icon rather than a photo.
          style={{ width: 84, height: 84, borderRadius: 19 }}
          accessibilityLabel="SkiHaus"
        />
        <Text
          style={{
            fontSize: 28,
            fontWeight: "800",
            color: colors.text,
            marginTop: spacing(2),
            letterSpacing: -0.5,
          }}
        >
          SkiHaus
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: colors.textDim,
            marginTop: spacing(0.5),
            textAlign: "center",
            lineHeight: 22,
          }}
        >
          Run the lease, not the group text.
        </Text>
      </View>

      <Card style={{ paddingVertical: spacing(2.5) }}>
        {step === "verify" || step === "reset-sent" ? (
          <CheckYourEmail
            kind={step}
            email={addr}
            onSignedIn={onSignedIn}
            onBack={restart}
          />
        ) : (
          <>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              // Locked once we've looked it up — changing it here would leave
              // the screen showing a password box for a different account.
              editable={step === "email"}
            />

            {step === "create" && (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                placeholder="Tristan"
                autoCapitalize="words"
                hint="What your housemates will see."
              />
            )}

            {step !== "email" && (
              <Field
                label={step === "create" ? "Choose a password" : "Password"}
                value={password}
                onChangeText={setPassword}
                placeholder={step === "create" ? "At least 8 characters" : ""}
                secureTextEntry
                autoCapitalize="none"
                hint={step === "create" ? "Eight characters minimum. That's the only rule." : undefined}
              />
            )}

            {action.error ? <Banner tone="bad">{action.error}</Banner> : null}

            <Button
              title={
                step === "email" ? "Continue" : step === "create" ? "Create account" : "Sign in"
              }
              onPress={submit}
              busy={action.busy}
              disabled={!canSubmit}
            />

            {step !== "email" && (
              <View style={{ marginTop: spacing(2), gap: spacing(1) }}>
                {step === "password" && (
                  <Link
                    onPress={() =>
                      void action.run(async () => {
                        await requestPasswordReset(addr);
                        setStep("reset-sent");
                      })
                    }
                  >
                    Forgot your password?
                  </Link>
                )}
                <Link onPress={restart}>Use a different email</Link>
              </View>
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
  kind,
  email,
  onSignedIn,
  onBack,
}: {
  kind: "verify" | "reset-sent";
  email: string;
  onSignedIn: (s: Session) => void;
  onBack: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const action = useAction();
  const verifying = kind === "verify";

  return (
    <>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
        {verifying ? "Confirm your email" : "Check your email"}
      </Text>
      <Text style={{ fontSize: 14, color: colors.textDim, marginTop: 6, lineHeight: 20 }}>
        {verifying
          ? `We sent a link to ${email}. Tap it and you're in — your account isn't active until you do.`
          : `If there's an account for ${email}, a reset link is on its way. It works once and expires in 20 minutes.`}
      </Text>

      {/* Native only, and not for resets — a reset link opens a web page that
          collects the new password, so there's nothing to paste here. On web
          the link navigates to /join/<token> and the cookie is set
          server-side; the native app has no such navigation until universal
          links are configured. */}
      {!isWeb && verifying && (
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
            title="Continue"
            busy={action.busy}
            disabled={!pasted.trim()}
            onPress={() =>
              void action.run(async () =>
                onSignedIn(await verifyToken(extractToken(pasted.trim()))),
              )
            }
          />
        </View>
      )}

      <Button title="Back" variant="secondary" onPress={onBack} style={{ marginTop: spacing(1.5) }} />
    </>
  );
}

function Link({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text style={{ fontSize: 13, color: colors.primary, textAlign: "center" }}>{children}</Text>
    </Pressable>
  );
}

/** Accept either a pasted URL or a bare token — people paste both. */
function extractToken(input: string): string {
  const m = /\/join\/([^/?#\s]+)/.exec(input);
  return m ? m[1] : input;
}

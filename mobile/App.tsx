// SkiHaus — one screen at a time.
//
// NAVIGATION: no navigation library, same as Split. `App.tsx` is a single
// useState<Step> machine. Adding a screen means adding a Step, a render
// branch, and (if it's not a top-level tab) a back target.
//
//   signin ─▶ houses ─▶ home ─┬─▶ expenses
//                             ├─▶ votes
//                             ├─▶ guests
//                             ├─▶ calendar
//                             ├─▶ documents
//                             └─▶ people
//
// Session and the selected house live here and are passed down as props.
// Screens own their own data fetching — there is no global store, because
// nine screens sharing one cache is a bigger problem than nine fetches.

import { useCallback, useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { View } from "react-native";

import { fetchSession, type HouseEntry } from "./src/api";
import { setLastHouseId } from "./src/storage";
import { colors } from "./src/theme";
import { Loading, Screen } from "./src/ui";
import type { Session } from "./src/types";

import { SignInScreen } from "./src/screens/SignInScreen";
import { HousesScreen } from "./src/screens/HousesScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ExpensesScreen } from "./src/screens/ExpensesScreen";
import { VotesScreen } from "./src/screens/VotesScreen";
import { GuestsScreen } from "./src/screens/GuestsScreen";
import { CalendarScreen } from "./src/screens/CalendarScreen";
import { DocumentsScreen } from "./src/screens/DocumentsScreen";
import { PeopleScreen } from "./src/screens/PeopleScreen";

export type Step =
  | "loading"
  | "signin"
  | "houses"
  | "home"
  | "expenses"
  | "votes"
  | "guests"
  | "calendar"
  | "documents"
  | "people";

export default function App() {
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);

  const entry: HouseEntry | null =
    session?.houses.find((h) => h.house.id === houseId) ?? null;

  /** Load the session and pick a house. Also the post-sign-in path. */
  const boot = useCallback(async (next?: Session) => {
    const s = next ?? (await fetchSession().catch(() => null));
    setSession(s);

    if (!s) {
      setStep("signin");
      return;
    }

    // Always land on the lease list, even with exactly one lease. It is the
    // home screen: it answers "what am I part of" before "what do I owe", and
    // it's the only place a new lease can be started. Auto-opening the last
    // lease saved one tap and cost the app its front door.
    setHouseId(null);
    setStep("houses");
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const openHouse = useCallback((id: string) => {
    setHouseId(id);
    void setLastHouseId(id);
    setStep("home");
  }, []);

  const signedOut = useCallback(() => {
    setSession(null);
    setHouseId(null);
    void setLastHouseId(null);
    setStep("signin");
  }, []);

  const home = useCallback(() => setStep("home"), []);

  function render() {
    if (step === "loading") {
      return (
        <Screen>
          <Loading label="Opening the house…" />
        </Screen>
      );
    }

    if (step === "signin" || !session) {
      return <SignInScreen onSignedIn={(s) => void boot(s)} />;
    }

    if (step === "houses" || !entry) {
      return (
        <HousesScreen
          session={session}
          onOpen={openHouse}
          onChanged={() => void boot()}
          onSignOut={signedOut}
        />
      );
    }

    const shared = { entry, session, onBack: home };

    switch (step) {
      case "expenses":
        return <ExpensesScreen {...shared} />;
      case "votes":
        return <VotesScreen {...shared} />;
      case "guests":
        return <GuestsScreen {...shared} />;
      case "calendar":
        return <CalendarScreen {...shared} />;
      case "documents":
        return <DocumentsScreen {...shared} />;
      case "people":
        return <PeopleScreen {...shared} onChanged={() => void boot()} />;
      default:
        return (
          <HomeScreen
            entry={entry}
            session={session}
            onGo={setStep}
            onLeases={() => {
              setHouseId(null);
              setStep("houses");
            }}
          />
        );
    }
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.webBackdrop }} edges={["top"]}>
        <View style={{ flex: 1 }}>{render()}</View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

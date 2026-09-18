// The one data-fetching primitive. No React Query, no global store — screens
// call the API directly and hold their own result.
//
// This is a deliberate ceiling: if a screen needs more than `useLoad` plus
// `useState`, that is a signal the screen is doing too much, not that the app
// needs a state library.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type Loaded<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // A screen can unmount mid-request (fast back tap); setting state after that
  // is a memory leak warning and, worse, can clobber the next screen's data.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    setLoading(true);
    setError(null);
    run()
      .then((d) => {
        if (alive.current) setData(d);
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
  }, [run, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

/** Wraps a mutation so a screen gets `busy` and `error` without boilerplate. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<unknown>, after?: () => void) => Promise<void>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clear: () => setError(null) };
}

/** Today as `YYYY-MM-DD` in the device's timezone — the default for date fields. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Central style tokens so the whole app looks like one system.
// Ski House — cool light theme: snow-white canvas, alpine-blue accents,
// deep-navy ink.
//
// NEVER HARD-CODE A COLOUR. If a value isn't here, add it here.
//
// MIRRORED FILE — the hex values must match server/app/globals.css, which
// styles the three pages the Expo bundle doesn't render (invite, guest,
// privacy). Those pages are often someone's first sight of the product; they
// have to look like the same app.

export const colors = {
  bg: "#F5F9FF",          // snow — cool off-white canvas
  surface: "#FFFFFF",     // cards
  surfaceAlt: "#E8F1FE",  // pale blue — selected / tinted rows
  border: "#DCE7F5",      // cool hairline
  text: "#0B1B2B",        // deep navy near-black
  textDim: "#5B7185",     // slate — secondary copy (4.7:1 on bg, passes AA)
  textFaint: "#9DB0C2",   // captions only — deliberately below AA, never for
                          // anything you actually need to read
  primary: "#1D6FE0",     // alpine blue — primary actions (4.8:1 on white)
  primaryDim: "#A8C8F5",  // disabled / tints
  primaryDeep: "#0B3C7D", // navy — headers, pressed states, emphasis
  onPrimary: "#FFFFFF",   // text/icons on primary or any coloured fill
  success: "#0E9F6E",
  warning: "#B45309",
  warningTint: "#FEF6E7",
  warningText: "#8A4B0A",
  danger: "#D4342C",
  dangerTint: "#FDECEB",
  scrim: "rgba(11, 27, 43, 0.5)",  // modal backdrop
  transparent: "transparent",
  webBackdrop: "#E3EBF5", // neutral canvas behind the phone-width column on web
};

/**
 * The same colour at a given opacity, so alpha shades derive from a token
 * instead of a hard-coded rgba(). Change `primary` above and every tint
 * follows. Accepts #rgb or #rrggbb.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Avatar backgrounds. Cool-leaning by design — a warm palette here fights the
 * blue identity, and a roster of twelve people is a lot of colour on screen.
 * Dark initials sit on top, so all of these stay light.
 */
export const personColors = [
  "#A8C8F5", // sky
  "#9FD8E8", // glacier
  "#B7C7EA", // periwinkle
  "#A9E0C8", // mint
  "#C9C2F0", // lavender
  "#9BD3D3", // teal
  "#C3D9F2", // ice
  "#D5C9E8", // lilac
];

/** Deterministic colour for a person, so their avatar never changes. */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return personColors[hash % personColors.length];
}

/** Role accents. Guests are grey on purpose — a badge, not a warning. */
export const roleColors: Record<string, string> = {
  admin: colors.primaryDeep,
  member: colors.primary,
  guest: colors.textDim,
};

/** 8-pt grid. spacing(2) = 16. */
export const spacing = (n: number) => n * 8;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

/**
 * One type scale for the whole app. Sizes are literals at the call site in
 * Split; naming them here instead keeps headings consistent across twelve
 * screens written at different times.
 */
export const type = {
  caption: { fontSize: 12, fontWeight: "500" },
  small: { fontSize: 13, fontWeight: "400" },
  body: { fontSize: 15, fontWeight: "400" },
  bodyStrong: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "700" },
  screen: { fontSize: 26, fontWeight: "800" },
  /** Money and any column of digits that has to line up. */
  numeric: { fontVariant: ["tabular-nums"] as const },
} as const;

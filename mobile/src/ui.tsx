// The shared component kit. Every screen builds from these so the app looks
// like one thing.
//
// Two rules:
//   1. No screen imports `colors` to invent a new visual. If you need a new
//      variant, add it here.
//   2. Everything is phone-width, even on web — `Screen` centres a 460px
//      column on a neutral backdrop rather than stretching a list of expenses
//      across a 27" monitor.

import { Feather } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { colorForId, colors, radius, roleColors, spacing } from "./theme";
import type { Role } from "./types";

/** The single line-icon primitive. Used everywhere in place of emoji chrome. */
export function Icon({
  name,
  size = 18,
  color = colors.textDim,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}

export function Screen({
  title,
  subtitle,
  onBack,
  right,
  menu,
  children,
  scroll = true,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Renders a hamburger at the top right that opens a sheet. */
  menu?: MenuItem[];
  children: ReactNode;
  scroll?: boolean;
}) {
  const header = title ? (
    <View style={s.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} style={s.backBtn} accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.primary} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.screenTitle}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
      {menu && menu.length > 0 ? <HeaderMenu items={menu} /> : null}
    </View>
  ) : null;

  const inner = (
    <>
      {header}
      {children}
    </>
  );

  return (
    <View style={s.backdrop}>
      <View style={s.column}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={s.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {inner}
          </ScrollView>
        ) : (
          <View style={s.scrollBody}>{inner}</View>
        )}
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

/**
 * A bottom sheet. Used for the header menu and for pickers.
 *
 * Bottom-anchored rather than centred because it's reachable one-handed —
 * these open from a header the thumb can't comfortably reach, so the content
 * shouldn't land there too. Tapping the scrim closes; on web that's the only
 * dismissal, since there's no back gesture.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close">
        {/* Swallows taps so pressing the sheet itself doesn't dismiss it. */}
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grabber} />
          {title ? <Text style={s.sheetTitle}>{title}</Text> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type MenuItem = {
  label: string;
  icon: IconName;
  onPress: () => void;
  /** Renders in red and sits below a divider. */
  destructive?: boolean;
};

function HeaderMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const normal = items.filter((i) => !i.destructive);
  const danger = items.filter((i) => i.destructive);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Menu"
        style={({ pressed }) => [s.menuButton, pressed && { opacity: 0.5 }]}
      >
        <Icon name="menu" size={22} color={colors.primaryDeep} />
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)}>
        {[...normal, ...danger].map((item, i) => (
          <Pressable
            key={item.label}
            onPress={() => {
              // Close first: leaving the sheet up while the screen changes
              // underneath it looks like the tap didn't register.
              setOpen(false);
              item.onPress();
            }}
            style={({ pressed }) => [
              s.menuRow,
              i === normal.length && danger.length > 0 && s.menuDivider,
              pressed && { backgroundColor: colors.surfaceAlt },
            ]}
          >
            <Icon
              name={item.icon}
              size={19}
              color={item.destructive ? colors.danger : colors.primaryDeep}
            />
            <Text
              style={[
                s.menuLabel,
                item.destructive && { color: colors.danger, fontWeight: "500" },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

/**
 * A single-select field that opens a sheet.
 *
 * Used where the answer comes from a short known list — a season, say. A free
 * text box there invites "26/27", "2026-2027" and "winter 26" for the same
 * thing, and then nothing sorts or groups.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
  hint,
  placeholder = "Choose…",
}: {
  label: string;
  value: string | null;
  options: Array<{ value: string; label: string; sub?: string }>;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ marginBottom: spacing(2) }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => [s.input, s.pickerField, pressed && { opacity: 0.7 }]}
      >
        <Text style={{ fontSize: 16, color: selected ? colors.text : colors.textFaint }}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color={colors.textDim} />
      </Pressable>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}

      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 340 }}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  s.menuRow,
                  i > 0 && s.optionDivider,
                  pressed && { backgroundColor: colors.surfaceAlt },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.menuLabel, on && { fontWeight: "700", color: colors.primary }]}>
                    {o.label}
                  </Text>
                  {o.sub ? <Text style={s.rowSub}>{o.sub}</Text> : null}
                </View>
                {on ? <Icon name="check" size={19} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

export function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

export function Row({
  label,
  value,
  sub,
  left,
  onPress,
  last,
}: {
  label: ReactNode;
  value?: ReactNode;
  sub?: string;
  left?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const content = (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      {left ? <View style={{ marginRight: spacing(1.5) }}>{left}</View> : null}
      <View style={{ flex: 1 }}>
        {typeof label === "string" ? <Text style={s.rowLabel}>{label}</Text> : label}
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      {typeof value === "string" ? <Text style={s.rowValue}>{value}</Text> : value}
      {onPress ? <Icon name="chevron-right" size={18} color={colors.textFaint} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>
      {content}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  const bg =
    variant === "primary"
      ? off
        ? colors.primaryDim
        : colors.primary
      : variant === "danger"
        ? colors.dangerTint
        : colors.surfaceAlt;
  const fg =
    variant === "primary"
      ? colors.onPrimary
      : variant === "danger"
        ? colors.danger
        : colors.primaryDeep;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [s.button, { backgroundColor: bg }, pressed && !off && { opacity: 0.85 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  multiline,
  secureTextEntry,
  editable = true,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "decimal-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words";
  multiline?: boolean;
  secureTextEntry?: boolean;
  /** Read-only fields are tinted so "locked" reads as deliberate, not broken. */
  editable?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ marginBottom: spacing(2) }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCapitalize === "none" ? false : undefined}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        editable={editable}
        // Lets iOS and the browser offer to save and fill the credential.
        // Without it, password managers ignore the field and people reuse
        // something they can remember instead.
        textContentType={secureTextEntry ? "password" : undefined}
        autoComplete={secureTextEntry ? "current-password" : undefined}
        style={[
          s.input,
          multiline && { minHeight: 96, textAlignVertical: "top" },
          !editable && { backgroundColor: colors.surfaceAlt, color: colors.textDim },
        ]}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const bg = {
    neutral: colors.surfaceAlt,
    good: "#E4F6EE",
    warn: colors.warningTint,
    bad: colors.dangerTint,
  }[tone];
  const fg = {
    neutral: colors.primaryDeep,
    good: colors.success,
    warn: colors.warningText,
    bad: colors.danger,
  }[tone];

  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function RolePill({ role }: { role: Role }) {
  const label = role === "admin" ? "Manager" : role === "member" ? "Member" : "Guest";
  return (
    <View style={[s.pill, { backgroundColor: colors.surfaceAlt }]}>
      <Text style={[s.pillText, { color: roleColors[role] }]}>{label}</Text>
    </View>
  );
}

export function Avatar({
  name,
  id,
  emoji,
  size = 36,
}: {
  name: string;
  id: string;
  emoji?: string | null;
  size?: number;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <View
      style={[
        s.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colorForId(id) },
      ]}
    >
      <Text style={{ fontSize: size * 0.4, fontWeight: "700", color: colors.text }}>
        {emoji ?? initials}
      </Text>
    </View>
  );
}

export function Banner({
  children,
  tone = "warn",
}: {
  children: ReactNode;
  tone?: "warn" | "bad" | "info";
}) {
  const bg = { warn: colors.warningTint, bad: colors.dangerTint, info: colors.surfaceAlt }[tone];
  const fg = { warn: colors.warningText, bad: colors.danger, info: colors.primaryDeep }[tone];
  return (
    <View style={[s.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 13, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

/** Empty states carry the instruction. A blank list teaches nobody anything. */
export function Empty({ icon, title, body }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; body: string }) {
  return (
    <View style={s.empty}>
      <Icon name={icon} size={28} color={colors.primaryDim} />
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.empty}>
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={s.emptyBody}>{label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.webBackdrop, alignItems: "center" },
  // One phone-width column, centred. On a phone this is just the screen; on
  // web it stops the UI from stretching into something nobody designed.
  column: { flex: 1, width: "100%", maxWidth: 460, backgroundColor: colors.bg },
  scrollBody: { padding: spacing(2), paddingBottom: spacing(6) },

  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing(2.5), gap: spacing(1) },
  backBtn: { marginLeft: -6, marginTop: 2 },
  screenTitle: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: colors.textDim, marginTop: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(0.5),
    marginBottom: spacing(2),
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing(1),
    marginBottom: spacing(1),
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textDim,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing(1.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing(1),
  },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: "500" },
  rowSub: { fontSize: 13, color: colors.textDim, marginTop: 2 },
  rowValue: { fontSize: 15, color: colors.text, fontWeight: "600", fontVariant: ["tabular-nums"] },

  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing(2.5),
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "600" },

  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textDim, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing(1.5),
    paddingVertical: 12,
    // 16pt minimum: anything smaller makes iOS Safari zoom the page on focus.
    fontSize: 16,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.textFaint, marginTop: 6 },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  pillText: { fontSize: 12, fontWeight: "600" },

  avatar: { alignItems: "center", justifyContent: "center" },

  banner: { borderRadius: radius.md, padding: spacing(1.5), marginBottom: spacing(2) },

  menuButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },

  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: spacing(1),
    paddingBottom: spacing(4), // clears the home indicator
    paddingHorizontal: spacing(1),
    // Matches Screen's column so the sheet doesn't span a wide browser.
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing(1.5),
  },
  sheetTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.textDim,
    paddingHorizontal: spacing(1.5),
    marginBottom: spacing(0.5),
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    paddingVertical: 15,
    paddingHorizontal: spacing(1.5),
    borderRadius: radius.md,
  },
  menuLabel: { fontSize: 16, color: colors.text, fontWeight: "500" },
  menuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing(0.5),
    paddingTop: 15,
  },
  optionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pickerField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  empty: { alignItems: "center", paddingVertical: spacing(5), gap: spacing(1) },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyBody: {
    fontSize: 14,
    color: colors.textDim,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
});

export const styles = s;
export type IconName = React.ComponentProps<typeof Feather>["name"];

/** Formats a `TextStyle` for money columns. */
export const numeric: TextStyle = { fontVariant: ["tabular-nums"] };

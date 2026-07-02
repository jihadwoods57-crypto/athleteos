// OnStandard — shared role chrome: a bottom tab bar + a settings row, used by the Trainer
// and Parent shells so every role has the same bottom-tab + Profile structure the athlete
// and coach already have. (Coach still hand-rolls its own equivalent; this is the reusable
// version for the roles that were missing tabs entirely.)
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Txt, Pressable } from '@/ui/primitives';
import { Icon, type IconName } from '@/icons';
import { haptics } from '@/ui/haptics';

export interface RoleTab<K extends string> {
  key: K;
  label: string;
  icon: IconName;
}

/** Absolute bottom tab bar (matches the coach/athlete look). Generic over the tab key. */
export function RoleTabBar<K extends string>({ tabs, active, onChange }: { tabs: RoleTab<K>[]; active: K; onChange: (k: K) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 10), paddingTop: 10, backgroundColor: c.card, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border }}>
      {tabs.map((t) => {
        const on = active === t.key;
        const color = on ? c.accent : c.textTertiary;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => { haptics.tap(); onChange(t.key); }}
            style={{ flex: 1, alignItems: 'center', gap: 4 }}
          >
            <Icon name={t.icon} size={22} color={color} />
            <Txt w={on ? 'b' : 'sb'} size={10.5} color={color} maxFontSizeMultiplier={MAX_FONT_SCALE}>{t.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tappable settings row (icon · label · sub · chevron) — the coach profile pattern. */
export function SettingRow({ icon, label, sub, onPress }: { icon: IconName; label: string; sub: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { haptics.tap(); onPress(); }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: c.card, borderRadius: 16, padding: 16 }, shadow.card]}
    >
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={c.slate600} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt w="b" size={15}>{label}</Txt>
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      <Icon name="chevronRight" size={18} color={c.slate300} />
    </Pressable>
  );
}

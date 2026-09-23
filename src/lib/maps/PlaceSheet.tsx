/* The sheet under the map: what the place is called (required), where it is, how big the bubble
   is, and Cancel / Save. Save stays disabled until there is both a name and a spot on the map, and
   says which one is missing, so a coach is never left guessing why the button is grey. */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RadiusSlider } from './RadiusSlider';
import { metersLabel } from './radius';
import { font, type PickerTheme } from './theme';

type Props = {
  theme: PickerTheme;
  name: string;
  onName: (v: string) => void;
  /** One line under the title: the address, "Finding the address…", or how to place the bubble. */
  where: string;
  radius: number;
  onRadius: (m: number) => void;
  onRadiusRelease: (m: number) => void;
  hasSpot: boolean;
  onCancel: () => void;
  onSave: () => void;
  bottomInset: number;
};

export function PlaceSheet(p: Props) {
  const t = p.theme;
  const named = p.name.trim().length > 0;
  const canSave = named && p.hasSpot;
  const why = !p.hasSpot ? 'Place the bubble on the map to save.' : !named ? 'Name the place to save.' : '';

  return (
    <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.line, paddingBottom: Math.max(p.bottomInset, 16) }]}>
      <View style={styles.inner}>
        <Text style={[styles.label, { color: t.text3, fontFamily: font.semibold }]} maxFontSizeMultiplier={1.6}>NAME</Text>
        <TextInput
          value={p.name}
          onChangeText={p.onName}
          placeholder="Weight room, Field 2, Team hotel"
          placeholderTextColor={t.text3}
          maxLength={60}
          returnKeyType="done"
          autoCapitalize="words"
          maxFontSizeMultiplier={1.6}
          accessibilityLabel="Place name, required"
          style={[styles.input, { color: t.text, backgroundColor: t.well, borderColor: t.line, fontFamily: font.semibold }]}
        />
        <Text style={[styles.where, { color: t.text2, fontFamily: font.medium }]} numberOfLines={2} maxFontSizeMultiplier={1.8}>
          {p.where}
        </Text>

        <View style={styles.sizeRow}>
          <Text style={[styles.label, styles.sizeLabel, { color: t.text3, fontFamily: font.semibold }]} maxFontSizeMultiplier={1.6}>
            BUBBLE SIZE
          </Text>
          <Text
            style={[styles.size, { color: t.blueInk, fontFamily: font.bold }]}
            maxFontSizeMultiplier={1.6}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {metersLabel(p.radius)}
          </Text>
        </View>
        <RadiusSlider value={p.radius} onChange={p.onRadius} onRelease={p.onRadiusRelease} theme={t} />
        <Text style={[styles.help, { color: t.text3, fontFamily: font.regular }]} maxFontSizeMultiplier={1.8}>
          Athletes inside the bubble are checked in. Drag its edge or this slider.
        </Text>

        <View style={styles.buttons}>
          <Pressable
            onPress={p.onCancel}
            accessibilityRole="button"
            style={({ pressed }) => [styles.btn, { backgroundColor: t.well, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.btnText, { color: t.text, fontFamily: font.semibold }]} maxFontSizeMultiplier={1.6}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={canSave ? p.onSave : undefined}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            accessibilityHint={why || undefined}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: canSave ? (pressed ? t.blueDeep : t.blue) : t.disabledBg },
            ]}
          >
            <Text style={[styles.btnText, { color: canSave ? t.onBlue : t.disabledText, fontFamily: font.bold }]} maxFontSizeMultiplier={1.6}>
              Save
            </Text>
          </Pressable>
        </View>
        {why ? (
          <Text style={[styles.why, { color: t.text3, fontFamily: font.medium }]} maxFontSizeMultiplier={1.8}>{why}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, paddingTop: 18,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  // iPad: one readable column, not a sheet stretched across 1000 pt.
  inner: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { fontSize: 12, letterSpacing: 0.8, marginBottom: 6 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 17, borderWidth: StyleSheet.hairlineWidth },
  where: { fontSize: 14, marginTop: 8, minHeight: 20 },
  sizeRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16 },
  sizeLabel: { marginBottom: 0 },
  size: { fontSize: 20, fontVariant: ['tabular-nums'] },
  help: { fontSize: 13, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  btnText: { fontSize: 17 },
  why: { fontSize: 13, textAlign: 'center', marginTop: 10 },
});

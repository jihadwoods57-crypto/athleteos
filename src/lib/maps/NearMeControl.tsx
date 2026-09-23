/* The Near me button over the map's bottom-right corner, and the short note it leaves when it
   cannot help. Tapping it is the ONLY way the picker asks for location (see nearMe.ts). */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { tap } from '../../ui/haptics';
import type { LatLng } from './geometry';
import { LocateIcon } from './icons';
import { locationModule } from './mapsNative';
import { locateMe, type NearMe } from './nearMe';
import { font, type PickerTheme } from './theme';

const NOTE: Record<Exclude<NearMe, { ok: true }>['reason'], string> = {
  denied: 'Location is off. Search or tap the map instead.',
  blocked: 'Location is off for OnStandard. Turn it on in Settings to use Near me.',
  nofix: 'Couldn’t find you just now. Try again, or search.',
  unavailable: 'Near me needs an app update. Search instead.',
};
const NOTE_MS = 4000;

export function NearMeControl({ theme: t, onFound }: { theme: PickerTheme; onFound: (pos: LatLng) => void }) {
  const [locating, setLocating] = React.useState(false);
  const [note, setNote] = React.useState('');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }, []);

  const press = async () => {
    if (locating) return;
    tap();
    setLocating(true);
    const r = await locateMe(locationModule());
    if (!alive.current) return;
    setLocating(false);
    if (r.ok) { onFound(r.pos); return; }
    setNote(NOTE[r.reason]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), NOTE_MS);
  };

  return (
    <>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel="Near me"
        accessibilityHint="Centres the map on where you are. Asks for your location the first time."
        accessibilityState={{ busy: locating }}
        style={({ pressed }) => [styles.button, { backgroundColor: t.surface, borderColor: t.line, opacity: pressed ? 0.8 : 1 }]}
      >
        {locating ? <ActivityIndicator color={t.blue} /> : <LocateIcon color={t.blueInk} size={20} />}
      </Pressable>
      {note ? (
        <View pointerEvents="none" style={[styles.note, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Text style={[styles.noteText, { color: t.text, fontFamily: font.medium }]} maxFontSizeMultiplier={1.6} accessibilityLiveRegion="polite">
            {note}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute', right: 16, bottom: 16, width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  note: {
    position: 'absolute', left: 16, right: 76, bottom: 16, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noteText: { fontSize: 14 },
});

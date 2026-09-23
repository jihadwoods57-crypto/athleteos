/* The search field over the top of the map. The OS geocoder (expo-location geocodeAsync) turns
   what the coach typed into points; each is reverse-geocoded once so the list reads as addresses,
   not numbers. One result jumps straight there; several are listed; none says "No match". */
import React from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatAddress } from './address';
import { CloseIcon, SearchIcon } from './icons';
import { locationModule } from './mapsNative';
import { font, type PickerTheme } from './theme';
import type { LatLng } from './geometry';

/** `label` is '' when the address is not known (lookup skipped or failed). */
export type SearchHit = LatLng & { label: string; query: string };
type Status = 'idle' | 'searching' | 'results' | 'nomatch' | 'error';

const MAX_HITS = 5;
/** More forward hits than this and none are reverse-looked-up. */
const REVERSE_MAX = 3;

export function SearchBar({ theme: t, onPick }: { theme: PickerTheme; onPick: (hit: SearchHit) => void }) {
  const Location = locationModule();
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState<Status>('idle');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const seq = React.useRef(0);

  const pick = (hit: SearchHit) => {
    Keyboard.dismiss();
    setStatus('idle');
    setHits([]);
    onPick(hit);
  };

  const search = async () => {
    const q = query.trim();
    if (!q || !Location) return;
    const mine = ++seq.current;
    setStatus('searching');
    try {
      const found = (await Location.geocodeAsync(q)).slice(0, MAX_HITS);
      const labelled: SearchHit[] = [];
      // One at a time: the iOS geocoder refuses overlapping requests (and rate-limits a burst), so
      // a long list is not looked up at all; those rows read "Result N" and are looked up once
      // picked. A blank label always means "not known", never the query repeated back.
      const lookUp = found.length <= REVERSE_MAX;
      for (const f of found) {
        let label = '';
        if (lookUp) {
          try { label = formatAddress((await Location.reverseGeocodeAsync(f))[0]); } catch { /* not known */ }
        }
        labelled.push({ lat: f.latitude, lng: f.longitude, label, query: q });
      }
      if (mine !== seq.current) return;
      if (labelled.length === 1) pick(labelled[0]);
      else if (labelled.length === 0) setStatus('nomatch');
      else { setHits(labelled); setStatus('results'); }
    } catch {
      // Both platforms throw on "nothing found" as well as on a network failure, and the two are
      // not reliably distinguishable, so both read as a plain no-match with a hint.
      if (mine === seq.current) setStatus('error');
    }
  };

  const clear = () => { seq.current++; setQuery(''); setHits([]); setStatus('idle'); };

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>
      <View style={styles.row}>
        <View style={styles.glyph}><SearchIcon color={t.text3} /></View>
        <TextInput
          value={query}
          onChangeText={(v) => { setQuery(v); if (status !== 'searching') setStatus('idle'); }}
          onSubmitEditing={search}
          editable={!!Location}
          placeholder={Location ? 'Search for a place or address' : 'Search needs an app update'}
          placeholderTextColor={t.text3}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="never"
          maxFontSizeMultiplier={1.6}
          accessibilityLabel="Search for a place or address"
          style={[styles.input, { color: t.text, fontFamily: font.medium }]}
        />
        {status === 'searching' ? <ActivityIndicator color={t.blue} style={styles.side} /> : null}
        {status !== 'searching' && query ? (
          <Pressable onPress={clear} hitSlop={8} style={styles.side} accessibilityRole="button" accessibilityLabel="Clear search">
            <View style={[styles.clearDot, { backgroundColor: t.well }]}><CloseIcon color={t.text2} size={10} /></View>
          </Pressable>
        ) : null}
      </View>
      {status === 'nomatch' || status === 'error' ? (
        <Text style={[styles.note, { color: t.text2, borderTopColor: t.line, fontFamily: font.medium }]} maxFontSizeMultiplier={1.8} accessibilityLiveRegion="polite">
          {status === 'nomatch' ? 'No match' : 'No match. Check the spelling or your connection, then try again.'}
        </Text>
      ) : null}
      {status === 'results' ? hits.map((h, i) => (
        <Pressable
          key={`${i}:${h.lat},${h.lng}`}
          onPress={() => pick(h)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.hit, { borderTopColor: t.line, backgroundColor: pressed ? t.well : 'transparent' }]}
        >
          <Text style={[styles.hitText, { color: t.text, fontFamily: font.semibold }]} numberOfLines={2} maxFontSizeMultiplier={1.8}>{h.label || `Result ${i + 1}`}</Text>
        </Pressable>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingLeft: 14, paddingRight: 6 },
  glyph: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  side: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  clearDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 15, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  hit: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  hitText: { fontSize: 15 },
});

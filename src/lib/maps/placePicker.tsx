/* The coach's map: a full-screen native picker for where athletes are supposed to be. A blue
   bubble on a real map (Apple Maps on iOS, Google Maps on Android), a pin at its centre, an edge
   handle and a slider for its size, a search field, and a sheet with the name and Save / Cancel.
   Opened by the proto through the MAP_PICK bridge message (ProtoApp renders this while one is
   pending). It never calls the server: the page that asked saves the place it gets back.
   No coordinate is ever logged. */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, PanResponder, Platform, StyleSheet, Text, View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { select, success, tap } from '../../ui/haptics';
import { formatAddress, suggestName } from './address';
import {
  EDGE, edgePoint, handlePoint, metersPerPoint, radiusFromDrag, toScreen, zoomToFit,
  type LatLng, type Point, type Region, type Size,
} from './geometry';
import { PinIcon, ResizeIcon } from './icons';
import { locationModule, mapSupport } from './mapsNative';
import { NativeMap, type Camera } from './NativeMap';
import { PlaceSheet } from './PlaceSheet';
import type { PickInitial, Place } from './pickRequest';
import { DEFAULT_RADIUS } from './radius';
import { SearchBar, type SearchHit } from './SearchBar';
import { font, usePickerTheme, type PickerTheme } from './theme';

/** `granted`: location permission is on, so the map may draw the coach's own blue dot. */
type Start = { camera: Camera; denied: boolean; granted: boolean };

/** Nowhere in particular: the continental US, wide enough that search is the obvious next step. */
const FALLBACK: Camera = { lat: 39.5, lng: -98.35, zoom: 3.2 };
/** A few blocks across: enough to recognise where you are and tap the right building. */
const NEAR_ME_ZOOM = zoomToFit(400, 0);
const ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'] as const;
const FIX_TIMEOUT_MS = 4000;

export function PlacePicker({ initial, onDone }: { initial: PickInitial | null; onDone: (p: Place | null) => void }) {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={[...ORIENTATIONS]}
      onRequestClose={() => onDone(null)}
      statusBarTranslucent
    >
      <SafeAreaProvider>
        <PickerBody initial={initial} onDone={onDone} />
      </SafeAreaProvider>
    </Modal>
  );
}

/** Where the camera opens: the place being edited, else the phone's position, else FALLBACK. */
async function findStart(initial: PickInitial | null): Promise<Start> {
  const L = locationModule();
  if (initial) {
    // Editing: open on the place, and never prompt; only show the blue dot if already allowed.
    let granted = false;
    try { granted = !!L && (await L.getForegroundPermissionsAsync()).granted; } catch { /* no dot */ }
    return { camera: { lat: initial.lat, lng: initial.lng, zoom: zoomToFit(initial.radius_m, initial.lat) }, denied: false, granted };
  }
  if (!L) return { camera: FALLBACK, denied: false, granted: false };
  try {
    let perm = await L.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await L.requestForegroundPermissionsAsync();
    if (!perm.granted) return { camera: FALLBACK, denied: true, granted: false };
    const fix = (await L.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1000 }))
      ?? (await Promise.race([
        L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), FIX_TIMEOUT_MS)),
      ]));
    if (!fix) return { camera: FALLBACK, denied: false, granted: true };
    // The camera starts where the coach is, but the bubble does NOT: a coach setting up tomorrow's
    // 6 AM lift from the couch must not be one tap from saving his living room.
    return { camera: { lat: fix.coords.latitude, lng: fix.coords.longitude, zoom: NEAR_ME_ZOOM }, denied: false, granted: true };
  } catch {
    return { camera: FALLBACK, denied: false, granted: false };
  }
}

function PickerBody({ initial, onDone }: { initial: PickInitial | null; onDone: (p: Place | null) => void }) {
  const t = usePickerTheme();
  const insets = useSafeAreaInsets();
  const support = mapSupport();

  const [start, setStart] = React.useState<Start | null>(null);
  const [center, setCenter] = React.useState<LatLng | null>(initial ? { lat: initial.lat, lng: initial.lng } : null);
  const [radius, setRadius] = React.useState(initial?.radius_m ?? DEFAULT_RADIUS);
  const [name, setName] = React.useState(initial?.name ?? '');
  const [address, setAddress] = React.useState('');
  const [addressBusy, setAddressBusy] = React.useState(false);
  const [region, setRegion] = React.useState<Region | null>(null);
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 });
  const [moving, setMoving] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  const mapRef = React.useRef<{ setCameraPosition: (c: { coordinates: { latitude: number; longitude: number }; zoom: number }) => void } | null>(null);
  const geoSeq = React.useRef(0);
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = React.useRef(false);

  React.useEffect(() => {
    let alive = true;
    void findStart(initial).then((s) => { if (alive) setStart(s); });
    return () => { alive = false; if (settleTimer.current) clearTimeout(settleTimer.current); };
    // The start is decided once, when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Move the bubble. A search already knows the address; a tap asks the geocoder for it. */
  const place = React.useCallback((p: LatLng, knownAddress?: string) => {
    setCenter(p);
    const mine = ++geoSeq.current;
    if (knownAddress !== undefined) { setAddress(knownAddress); setAddressBusy(false); return; }
    const L = locationModule();
    if (!L) { setAddress(''); return; }
    setAddressBusy(true);
    L.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng })
      .then((r) => { if (mine === geoSeq.current) setAddress(formatAddress(r[0])); })
      .catch(() => { if (mine === geoSeq.current) setAddress(''); })
      .finally(() => { if (mine === geoSeq.current) setAddressBusy(false); });
  }, []);

  // The edited place's address is looked up once, on open.
  React.useEffect(() => { if (initial) place({ lat: initial.lat, lng: initial.lng }); }, [initial, place]);

  const flyTo = (p: LatLng, r: number) =>
    mapRef.current?.setCameraPosition({ coordinates: { latitude: p.lat, longitude: p.lng }, zoom: zoomToFit(r, p.lat) });

  const onSearchPick = (hit: SearchHit) => {
    tap();
    place({ lat: hit.lat, lng: hit.lng }, hit.label);
    if (!name.trim()) setName(suggestName(hit.label));
    flyTo(hit, radius);
  };

  const onMapClick = (e: { coordinates: { latitude?: number; longitude?: number } }) => {
    const { latitude, longitude } = e.coordinates ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
    tap();
    place({ lat: latitude, lng: longitude });
  };

  const onCameraMove = (e: { coordinates: { latitude?: number; longitude?: number }; latitudeDelta: number; longitudeDelta: number }) => {
    const { latitude, longitude } = e.coordinates ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
    setRegion({ lat: latitude, lng: longitude, latDelta: e.latitudeDelta, lngDelta: e.longitudeDelta });
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMoving(false);
  };

  // expo-maps reports the camera only when a gesture ENDS, so the overlay handle would float in
  // the wrong place while the map slides under it. Hide it for the gesture, show it on the report
  // (or shortly after the finger lifts, for a tap that never moved the camera).
  const mapTouchStart = () => { if (settleTimer.current) clearTimeout(settleTimer.current); setMoving(true); };
  const mapTouchEnd = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setMoving(false), 700);
  };

  // The edge handle. The pan responder is made once; it reads the live state through a ref.
  const live = React.useRef({ center, radius, region, size });
  live.current = { center, radius, region, size };
  const drag = React.useRef<{ c: Point; h: Point; mpp: number } | null>(null);
  const handlePan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      const { center: c, radius: r, region: rg, size: sz } = live.current;
      if (!c || !rg) return;
      const mpp = metersPerPoint(rg, sz);
      const cs = toScreen(c, rg, sz);
      drag.current = { c: cs, h: { x: cs.x + r / mpp, y: cs.y }, mpp };
      setDragging(true);
    },
    onPanResponderMove: (_e, g) => {
      const d = drag.current;
      if (!d || !(d.mpp > 0)) return;
      const m = radiusFromDrag(d.c, { x: d.h.x + g.dx, y: d.h.y + g.dy }, d.mpp);
      if (m !== live.current.radius) { select(); setRadius(m); }
    },
    onPanResponderRelease: () => { drag.current = null; setDragging(false); },
    onPanResponderTerminate: () => { drag.current = null; setDragging(false); },
  }), []);

  // While dragging, the handle is pinned inside the screen rather than removed, which would end
  // the gesture under the coach's finger.
  let handle: Point | null = null;
  if (center && support.ok && !moving) {
    if (dragging) {
      const p = edgePoint(center, radius, region, size);
      handle = p && { x: Math.min(Math.max(p.x, EDGE), size.width - EDGE), y: Math.min(Math.max(p.y, EDGE), size.height - EDGE) };
    } else {
      handle = handlePoint(center, radius, region, size);
    }
  }

  const onRadiusRelease = (m: number) => {
    // The slider made the bubble bigger than the screen: back the camera out so all of it shows.
    if (center && region && !handlePoint(center, m, region, size)) flyTo(center, m);
  };

  const finish = (p: Place | null) => {
    if (finished.current) return;
    finished.current = true;
    if (p) success();
    onDone(p);
  };
  const save = () => {
    if (!center || !name.trim()) return;
    finish({ name: name.trim(), address, lat: center.lat, lng: center.lng, radius_m: radius });
  };

  const where = !center
    ? (!support.ok ? 'Search for the place to set the bubble.'
      : start?.denied ? 'Location is off. Search or tap the map to place the bubble.'
      : 'Tap the map or search to place the bubble.')
    : addressBusy ? 'Finding the address…' : address || 'Pinned on the map';

  return (
    <View style={[styles.fill, { backgroundColor: t.bg }]}>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={styles.fill}
          onLayout={(e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          {!start ? (
            <Centered t={t}>
              <ActivityIndicator color={t.blue} />
              <Text style={[styles.stateText, { color: t.text2, fontFamily: font.medium }]} maxFontSizeMultiplier={1.8}>Finding where you are…</Text>
            </Centered>
          ) : support.ok ? (
            <View style={styles.fill} onTouchStart={mapTouchStart} onTouchEnd={mapTouchEnd} onTouchCancel={mapTouchEnd}>
              <NativeMap
                support={support}
                mapRef={mapRef}
                camera={start.camera}
                center={center}
                radius={radius}
                name={name}
                showMe={start.granted}
                t={t}
                onMapClick={onMapClick}
                onCameraMove={onCameraMove}
              />
            </View>
          ) : (
            <Centered t={t}>
              <PinIcon color={t.text3} />
              <Text style={[styles.stateTitle, { color: t.text, fontFamily: font.bold }]} maxFontSizeMultiplier={1.8}>Map unavailable</Text>
              <Text style={[styles.stateText, { color: t.text2, fontFamily: font.medium }]} maxFontSizeMultiplier={1.8}>
                {support.reason} Search for the place above and pick it from the results; you can still set the bubble size below.
              </Text>
            </Centered>
          )}

          {handle ? (
            <View
              {...handlePan.panHandlers}
              style={[styles.handleHit, { left: handle.x - 22, top: handle.y - 22 }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={[styles.handle, { borderColor: t.bubbleEdge }]}>
                <ResizeIcon color={t.bubbleEdge} size={13} />
              </View>
            </View>
          ) : null}

          <View style={[styles.searchWrap, { top: insets.top + 8, left: insets.left + 16, right: insets.right + 16 }]}>
            <View style={styles.searchInner}><SearchBar theme={t} onPick={onSearchPick} /></View>
          </View>
        </View>

        <PlaceSheet
          theme={t}
          name={name}
          onName={setName}
          where={where}
          radius={radius}
          onRadius={setRadius}
          onRadiusRelease={onRadiusRelease}
          hasSpot={!!center}
          onCancel={() => finish(null)}
          onSave={save}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function Centered({ t, children }: { t: PickerTheme; children: React.ReactNode }) {
  return <View style={[styles.fill, styles.centered, { backgroundColor: t.well }]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  stateTitle: { fontSize: 19, textAlign: 'center' },
  stateText: { fontSize: 15, textAlign: 'center', lineHeight: 21, maxWidth: 420 },
  // iPad: the field stays one readable column, centred over the map.
  searchWrap: { position: 'absolute', alignItems: 'center' },
  searchInner: { width: '100%', maxWidth: 560 },
  handleHit: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  handle: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});

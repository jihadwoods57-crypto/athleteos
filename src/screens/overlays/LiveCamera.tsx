// OnStandard — live in-app camera for the Log-a-Meal screen. Shows the camera feed INSIDE the
// capture card (expo-camera CameraView) with the shutter capturing straight from it, then hands
// the downscaled base64 to the SAME store.capture pipeline (consent gate + AI analysis included).
// Degrades gracefully: no native camera (web) or permission off -> the system camera / library,
// so logging never blocks on the live view.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { isCameraAvailable, photoUriToBase64 } from '@/lib/capture';
import { Txt, Pressable } from '@/ui/primitives';
import { useColors } from '@/ui/theme';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

const SQUARE = { width: '100%' as const, aspectRatio: 1, borderRadius: 24, overflow: 'hidden' as const };

/** Corner brackets that frame the plate (keeps the viewfinder look of the old placeholder). */
function Brackets({ color }: { color: string }) {
  return (
    <>
      {[
        { top: 14, left: 14 },
        { top: 14, right: 14 },
        { bottom: 14, left: 14 },
        { bottom: 14, right: 14 },
      ].map((pos, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{ position: 'absolute', width: 26, height: 26, borderColor: color, opacity: 0.9, borderTopWidth: i < 2 ? 3 : 0, borderBottomWidth: i >= 2 ? 3 : 0, borderLeftWidth: i % 2 === 0 ? 3 : 0, borderRightWidth: i % 2 === 1 ? 3 : 0, ...pos }}
        />
      ))}
    </>
  );
}

/** Tappable placeholder for when there's no live feed (web / permission off) — behaves like the
 *  old capture card: tap opens the system camera. */
function FallbackCard({
  c,
  title,
  sub,
  cta,
  onPress,
}: {
  c: ReturnType<typeof useColors>;
  title: string;
  sub: string;
  cta?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cta ?? title}
      onPress={() => { haptics.tap(); onPress(); }}
      style={[SQUARE, { backgroundColor: c.track, alignItems: 'center', justifyContent: 'center', padding: 24 }]}
    >
      <Icon name="camera" size={40} color={c.textTertiary} />
      <Txt w="eb" size={15} color={c.slate700} style={{ marginTop: 12, textAlign: 'center' }}>{title}</Txt>
      <Txt w="sb" size={13} color={c.textTertiary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 19 }}>{sub}</Txt>
      {cta ? (
        <View style={{ marginTop: 14, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: c.success }}>
          <Txt w="b" size={14} color={c.onGreen}>{cta}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Live meal camera. `onCapture` receives the downscaled base64 of a shot taken from the feed;
 * `onFallback` opens the system camera (permission off / capture error); `onPickLibrary` opens
 * the photo library.
 */
export function LiveCamera({
  onCapture,
  onFallback,
  onPickLibrary,
}: {
  onCapture: (base64: string) => void;
  onFallback: () => void;
  onPickLibrary: () => void;
}) {
  const c = useColors();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // No native camera (web): the old tap-to-capture placeholder (context inference on the model).
  if (!isCameraAvailable) {
    return <FallbackCard c={c} title="Tap to add a meal photo" sub="Snap a photo or pick one from your library" onPress={onFallback} />;
  }

  // Permission response still loading.
  if (!permission) {
    return (
      <View style={[SQUARE, { backgroundColor: c.track, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  // Not granted: ask once, or (permanently denied) fall back to the system camera.
  if (!permission.granted) {
    return permission.canAskAgain ? (
      <FallbackCard c={c} title="Turn on the live camera" sub="See your plate right here and snap it in one tap." cta="Enable camera" onPress={() => { requestPermission(); }} />
    ) : (
      <FallbackCard c={c} title="Camera access is off" sub="Turn it on in Settings, or take a photo the system way." cta="Take a photo" onPress={onFallback} />
    );
  }

  const take = async () => {
    if (busy || !ready) return;
    setBusy(true);
    haptics.tap();
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.6, base64: false, skipProcessing: false });
      const b64 = shot?.uri ? await photoUriToBase64(shot.uri, shot.width, shot.height) : shot?.base64 ?? undefined;
      if (b64) onCapture(b64);
      else onFallback(); // capture returned nothing -> don't strand the user
    } catch {
      onFallback(); // any camera error -> system camera, so logging never blocks
    } finally {
      setBusy(false);
    }
  };

  // Granted: the live preview with an overlaid shutter + gallery button.
  return (
    <View style={[SQUARE, { backgroundColor: '#000' }]}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" onCameraReady={() => setReady(true)} />
      <Brackets color={c.white} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pick a photo from your library"
        onPress={() => { haptics.tap(); onPickLibrary(); }}
        style={{ position: 'absolute', left: 18, bottom: 18, width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="gallery" size={20} color={c.white} />
      </Pressable>
      {/* The redesign's GREEN shutter (proto camera.js): green glow ring around a green disc. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Capture meal photo"
        disabled={busy || !ready}
        onPress={take}
        style={{ position: 'absolute', alignSelf: 'center', bottom: 16, width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: 'rgba(52,211,153,0.45)', padding: 5, opacity: ready ? 1 : 0.5 }}
      >
        <View style={{ flex: 1, borderRadius: 31, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator color={c.onGreen} /> : <Icon name="camera" size={24} color={c.onGreen} />}
        </View>
      </Pressable>
    </View>
  );
}

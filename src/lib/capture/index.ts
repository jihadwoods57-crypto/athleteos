// OnStandard — meal photo capture (expo-image-picker + expo-image-manipulator).
//
// Captures a real meal photo (camera, or library fallback), downscales it, and returns it as
// base64 JPEG for the analyze-meal AI. Permissions + the picker UI are handled by the OS via
// expo-image-picker; the config-plugin usage strings live in app.json.
//
// NOTE (device-gated): the native camera only works in a real dev/standalone build, not on web.
// `isCameraAvailable` is false on web (no native camera), so the flow degrades to
// context-inference there. This module is wired but can only be runtime-verified on a device.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/** Native camera capability. Web has no camera pipeline; everywhere else the picker
 *  handles camera + permission at call time. */
export const isCameraAvailable = Platform.OS !== 'web';

/** Longest edge (px) we downscale a captured photo to before upload. Big enough for the
 *  vision model to read a plate clearly, small enough to keep the base64 well under the
 *  server's ~8MB cap and cut upload time on a phone. */
export const MAX_EDGE = 1568;

/**
 * Launch the camera (or fall back to the photo library when camera permission is not
 * granted), returning a downscaled base64 JPEG (no `data:` prefix) for analyze-meal, or
 * undefined when the user cancels / denies / on an unsupported platform. Never throws —
 * capture must never block logging.
 */
export async function capturePhotoBase64(): Promise<string | undefined> {
  if (!isCameraAvailable) return undefined;
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const launch = perm.granted
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync; // no camera permission -> let them pick one
    const result = await launch({
      mediaTypes: ['images'],
      quality: 0.6, // decent capture; we resize + recompress below
      base64: true, // keep the raw base64 as a fallback if resizing fails
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled) return undefined;
    const asset = result.assets?.[0];
    if (!asset) return undefined;
    // Prefer a downscaled copy; fall back to the raw base64 so a manipulator hiccup never
    // costs the photo (capture must never block logging).
    const shrunk = asset.uri ? await downscaleToBase64(asset.uri, asset.width, asset.height) : undefined;
    return shrunk ?? asset.base64 ?? undefined;
  } catch {
    // Permission race, no camera hardware, simulator, etc. — degrade gracefully.
    return undefined;
  }
}

/** Pure: the resize target that caps the image's LONG edge at `max`, preserving aspect ratio
 *  (ImageManipulator keeps the other dimension when only one is given). Never upscales.
 *  Exported for tests. */
export function longEdgeResize(
  width: number | undefined,
  height: number | undefined,
  max: number,
): { width: number } | { height: number } {
  if (!width || !height) return { width: max };
  return width >= height ? { width: Math.min(max, width) } : { height: Math.min(max, height) };
}

/** Resize a captured image so its long edge is at most MAX_EDGE, then JPEG-compress to base64
 *  (no `data:` prefix). Returns undefined on any failure so the caller falls back to raw base64. */
async function downscaleToBase64(uri: string, width?: number, height?: number): Promise<string | undefined> {
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: longEdgeResize(width, height, MAX_EDGE) }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return out.base64 ?? undefined;
  } catch {
    return undefined;
  }
}

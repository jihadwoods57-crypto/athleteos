// AthleteOS — meal photo capture (expo-image-picker).
//
// Captures a real meal photo (camera, or library fallback) and returns it as base64
// JPEG for the analyze-meal AI. Permissions + the picker UI are handled by the OS via
// expo-image-picker; the config-plugin usage strings live in app.json.
//
// NOTE (device-gated): the native camera only works in a real dev/standalone build,
// not on web. `isCameraAvailable` is false on web (no native camera), so the flow
// degrades to context-inference there. This module is wired but can only be
// runtime-verified on a physical device.
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/** Native camera capability. Web has no camera pipeline; everywhere else the picker
 *  handles camera + permission at call time. */
export const isCameraAvailable = Platform.OS !== 'web';

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
      quality: 0.5, // keep the JPEG small; the server caps base64 at ~8MB
      base64: true,
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled) return undefined;
    return result.assets?.[0]?.base64 ?? undefined;
  } catch {
    // Permission race, no camera hardware, simulator, etc. — degrade gracefully.
    return undefined;
  }
}

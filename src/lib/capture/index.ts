// AthleteOS — meal photo capture seam (inert until expo-camera is added).
//
// The activation flow already works without a photo (the analyze-meal function infers a
// typical meal). To capture a REAL photo, activate this seam:
//   1) `npx expo install expo-camera expo-image-manipulator`
//   2) implement capturePhotoBase64() with the camera + downscale to ~1024px JPEG base64
//   3) set isCameraAvailable = true (or detect Camera.isAvailableAsync())
//   4) in the store `capture()`, pass the returned base64 to analyzeMeal({ photoBase64 }).
// Web has no native camera; this returns undefined there so the model infers from context.

/** True once a real camera pipeline is wired. Keep false until expo-camera is added. */
export const isCameraAvailable = false;

/** Capture + downscale a meal photo to base64 JPEG (no data: prefix), or undefined when
 *  unavailable (web / no permission / not yet wired). Inert by default. */
export async function capturePhotoBase64(): Promise<string | undefined> {
  return undefined;
}

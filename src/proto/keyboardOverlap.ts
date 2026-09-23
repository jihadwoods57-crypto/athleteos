// The keyboard's overlap with the WebView, from a React Native keyboard event (composer upgrade,
// 2026-09-23). Kept out of ProtoApp.tsx so it can be tested without the WebView's native modules.
import type { KeyboardEvent } from 'react-native';

/** How much of the WebView the keyboard will cover once it lands, from a keyboard event. The
 *  WebView fills the window, so it is the part of the window below the keyboard's top edge. A
 *  hiding keyboard ends below the window (0); an undocked or floating iPad keyboard does not reach
 *  the bottom edge and covers nothing the page should resize for (0). */
export function keyboardOverlap(e: Pick<KeyboardEvent, 'endCoordinates'>, windowHeight: number): number {
  const end = e?.endCoordinates;
  if (!end || !(windowHeight > 0)) return 0;
  const top = Number(end.screenY);
  const h = Number(end.height);
  if (!Number.isFinite(top) || !Number.isFinite(h) || h <= 0) return 0;
  // Floating: its bottom edge sits well above the window's.
  if (top + h < windowHeight - 1) return 0;
  return Math.max(0, Math.round(windowHeight - top));
}

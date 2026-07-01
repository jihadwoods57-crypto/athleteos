// OnStandard — barcode food-scan seam (inert until a scanner + lookup are wired).
//
// P2 (better meal logging) ships food search + manual quick-add against the curated
// local DB (src/core/foodDb). Barcode scanning needs a real camera AND a product
// database, neither of which exists in this offline build, so it stays a SEAM:
// the shape is defined and gated; the implementation is the founder's device step.
//
// To activate this seam:
//   1) `npx expo install expo-camera` (BarCodeScanner / CameraView with barcode types)
//   2) implement scanBarcode() to open the scanner and resolve the scanned code
//   3) implement lookupBarcode() against a product DB (Open Food Facts API, or a
//      licensed nutrition DB) and map the result to an AddableFood
//   4) set isFoodScanAvailable = true (or detect camera availability at runtime)
//   5) in MealDetail, add a "Scan barcode" affordance that calls scanBarcode ->
//      lookupBarcode -> addFood (the same engine the manual quick-add already uses).
// Network lookups are an EXTERNAL call — keep them off until the founder approves a
// data source and its licensing. See docs/FOUNDER-DECISIONS.md.
//
// No-ops by default so the app (and web, which has no native camera) run unchanged.

import type { AddableFood } from '@/core';

/** True once a real scanner + product lookup are wired. Keep false until then. */
export const isFoodScanAvailable = false;

/** A scanned product resolved to the shape the meal engine (`addFood`) consumes. */
export interface ScannedFood extends AddableFood {
  /** The raw barcode the product was matched from (UPC/EAN), for display + audit. */
  barcode: string;
}

/**
 * Open the camera barcode scanner and resolve the scanned code, or undefined when
 * unavailable (web / no permission / not yet wired). Inert by default.
 */
export async function scanBarcode(): Promise<string | undefined> {
  return undefined;
}

/**
 * Resolve a scanned barcode to a food with real per-serving macros, or undefined
 * when not found / not yet wired. Inert by default — a real implementation calls a
 * product database; keep that network call gated until the founder approves a source.
 */
export async function lookupBarcode(_code: string): Promise<ScannedFood | undefined> {
  return undefined;
}

// Extracts the bundled proto (assets/proto.zip) to the device's document directory on
// launch and returns the file:// URI of index.html for the WebView to load.
//
// Why a zip we unpack (not a native-bundled folder): the proto is JS-shipped content, so a
// new proto shipped over `eas update` re-extracts here — proto tweaks in the wiring phases
// go out over-the-air in seconds instead of a full rebuild. The version gate (PROTO_VERSION,
// a content hash) makes re-extraction happen exactly when the proto changes and never otherwise.
import { Asset } from 'expo-asset';
import { unzipSync } from 'fflate';
import * as FileSystem from 'expo-file-system/legacy';
import { PROTO_VERSION } from './protoVersion';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PROTO_ZIP = require('../../assets/proto.zip');

const PROTO_DIR = `${FileSystem.documentDirectory}proto/`;
const INDEX_URI = `${PROTO_DIR}index.html`;
const VERSION_FILE = `${PROTO_DIR}.protoversion`;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Reverse lookup (charCode -> 0..63, or -1) so decode/encode are O(1) per char, not O(64)
// String.indexOf — keeps the launch-time extract off the "frozen white screen" path on old phones.
const B64_REV = new Int16Array(256).fill(-1);
for (let i = 0; i < B64.length; i++) B64_REV[B64.charCodeAt(i)] = i;

/** base64 string -> bytes (dependency-free; does not rely on atob being present in Hermes).
 *  Keeps '=' so length stays a multiple of 4 and padding is detectable; invalid chars map to 0
 *  and the `o < len` guards drop the padding bytes — round-trips every length exactly. */
function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const len = Math.max(0, (clean.length / 4) * 3 - pad);
  const out = new Uint8Array(len);
  let o = 0;
  const at = (i: number) => {
    const v = B64_REV[clean.charCodeAt(i)];
    return v < 0 ? 0 : v;
  };
  for (let i = 0; i < clean.length; i += 4) {
    const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    if (o < len) out[o++] = (n >> 16) & 0xff;
    if (o < len) out[o++] = (n >> 8) & 0xff;
    if (o < len) out[o++] = n & 0xff;
  }
  return out;
}

/** bytes -> base64 string (for writing each extracted file via writeAsStringAsync base64). */
function bytesToB64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    let s = B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    s += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    s += i + 2 < bytes.length ? B64[c & 63] : '=';
    parts.push(s);
  }
  return parts.join('');
}

async function alreadyExtracted(): Promise<boolean> {
  try {
    const idx = await FileSystem.getInfoAsync(INDEX_URI);
    if (!idx.exists) return false;
    const ver = await FileSystem.readAsStringAsync(VERSION_FILE);
    return ver.trim() === PROTO_VERSION;
  } catch {
    return false;
  }
}

const seenDirs = new Set<string>();
async function ensureDir(fileUri: string): Promise<void> {
  const dir = fileUri.slice(0, fileUri.lastIndexOf('/'));
  if (dir === PROTO_DIR.slice(0, -1) || seenDirs.has(dir)) return;
  seenDirs.add(dir);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

// Share one extraction across concurrent callers (two mounts / a fast remount), and clear on
// failure so a retry can re-run rather than latching a rejected promise forever.
let inflight: Promise<string> | null = null;

/** Idempotent: extracts the proto once per version, returns the index.html file:// URI. */
export function ensureProtoExtracted(): Promise<string> {
  if (!inflight) {
    inflight = runExtract().catch((e) => {
      inflight = null;
      throw e;
    });
  }
  return inflight;
}

async function runExtract(): Promise<string> {
  if (await alreadyExtracted()) return INDEX_URI;

  // Clear any stale extraction, then recreate the root.
  try {
    await FileSystem.deleteAsync(PROTO_DIR, { idempotent: true });
  } catch {
    /* first run — nothing to delete */
  }
  seenDirs.clear();
  await FileSystem.makeDirectoryAsync(PROTO_DIR, { intermediates: true });

  const asset = Asset.fromModule(PROTO_ZIP);
  await asset.downloadAsync();
  const zipUri = asset.localUri ?? asset.uri;

  const zipB64 = await FileSystem.readAsStringAsync(zipUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const files = unzipSync(b64ToBytes(zipB64));

  for (const [rel, bytes] of Object.entries(files)) {
    if (rel.endsWith('/')) continue; // directory entry (keep legitimately-empty files)
    const target = `${PROTO_DIR}${rel}`;
    await ensureDir(target);
    await FileSystem.writeAsStringAsync(target, bytesToB64(bytes as Uint8Array), {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  await FileSystem.writeAsStringAsync(VERSION_FILE, PROTO_VERSION);
  return INDEX_URI;
}

export const PROTO_INDEX_URI = INDEX_URI;
export const PROTO_ROOT_DIR = PROTO_DIR;

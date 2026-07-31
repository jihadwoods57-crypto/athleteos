/* Chat photo attachments — pure-module tests (node --test).

   attachedPhoto() is a SECURITY boundary, not a convenience: whatever it returns is handed to a
   storage lookup and then rendered as an <img src>. It reads `meta`, a jsonb column clients are
   allowed to write on their own rows (0157), so the value is genuinely untrusted. These cases pin
   the rejections — a regression here would not fail loudly, it would just start trusting input.

   isPhotoOnly() has to straddle a schema change: rows written before migration 0173 carry the
   'Sent a photo' stand-in because text was NOT NULL with a length floor of 1, and rows written
   after it carry ''. Both must render as a bare photo, forever — old rows do not get rewritten. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachedPhoto, isPhotoOnly, PHOTO_ONLY_TEXT } from './chat-attach.js';

const KEY = '11111111-2222-3333-4444-555555555555/chat/1730000000000.jpg';
const withMeta = (meta, text = 'hi') => ({ role: 'athlete', text, meta });

test('reads the storage key off meta', () => {
  assert.equal(attachedPhoto(withMeta({ photo: KEY })), KEY);
});

test('tolerates meta arriving as a JSON string', () => {
  // Some clients/drivers hand back jsonb as text; a photo must not vanish because of transport.
  assert.equal(attachedPhoto(withMeta(JSON.stringify({ photo: KEY }))), KEY);
});

test('returns null for every shape that carries no photo', () => {
  assert.equal(attachedPhoto(null), null);
  assert.equal(attachedPhoto({}), null);
  assert.equal(attachedPhoto(withMeta(null)), null);
  assert.equal(attachedPhoto(withMeta({})), null);
  assert.equal(attachedPhoto(withMeta({ photo: '' })), null);
  assert.equal(attachedPhoto(withMeta({ photo: 42 })), null);
  assert.equal(attachedPhoto(withMeta('not json at all')), null);
});

test('REJECTS traversal, schemes and absurd lengths', () => {
  // These are the cases that make this function a boundary rather than an accessor.
  assert.equal(attachedPhoto(withMeta({ photo: '../../secrets/key.jpg' })), null);
  assert.equal(attachedPhoto(withMeta({ photo: 'uid/chat/../../other/x.jpg' })), null);
  assert.equal(attachedPhoto(withMeta({ photo: 'https://evil.example/x.jpg' })), null);
  assert.equal(attachedPhoto(withMeta({ photo: 'javascript://alert(1)' })), null);
  assert.equal(attachedPhoto(withMeta({ photo: `${'a'.repeat(201)}.jpg` })), null);
});

test('photo-only covers BOTH the post-0173 empty text and the legacy stand-in', () => {
  assert.equal(isPhotoOnly(withMeta({ photo: KEY }, '')), true);
  assert.equal(isPhotoOnly(withMeta({ photo: KEY }, '   ')), true);
  assert.equal(isPhotoOnly(withMeta({ photo: KEY }, PHOTO_ONLY_TEXT)), true);
});

test('a photo WITH a real caption is not photo-only', () => {
  // The caption must still render; suppressing it would silently eat the athlete's words.
  assert.equal(isPhotoOnly(withMeta({ photo: KEY }, 'is this enough protein?')), false);
});

test('text with no attachment is never photo-only', () => {
  // Notably including the stand-in string itself: without a photo it is just a message, and
  // hiding it would leave a blank bubble.
  assert.equal(isPhotoOnly(withMeta(null, PHOTO_ONLY_TEXT)), false);
  assert.equal(isPhotoOnly(withMeta(null, '')), false);
  assert.equal(isPhotoOnly({ text: 'hello' }), false);
});

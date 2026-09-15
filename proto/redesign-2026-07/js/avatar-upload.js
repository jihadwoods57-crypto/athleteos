/* The profile-photo control, shared by every person who has a face in this app (2026-09-15).
 *
 * WHY. The upload lived inside the athlete's Profile screen only. A coach, trainer or dietitian
 * had a monogram on their own card and no way to change it, although every place their face
 * appears to athletes (thread avatars, facepiles, the members sheet) already hydrates by uid
 * from the same `avatars/<uid>/avatar.jpg` object. The founder asked for the coach to have a
 * picture too and for it to reach every connected account. The path was already there; only
 * the control was missing. It is one control now.
 *
 * WHAT IT DOES. Renders the avatar (real photo by uid through avatar.js, initials beneath as
 * the fallback), a camera badge, and a hidden file input; on pick it centre-crops to 256px,
 * JPEG 0.82, and hands the data URL to act.setAvatar, which uploads to the bucket the whole app
 * reads from and busts every cache. Errors are said in the person's terms. "Remove photo" appears
 * only once a photo exists. Role-agnostic: state.js setAvatar/removeAvatar read RT.userId.
 */
import { RT } from './state.js';
import { icon } from './icons.js';
import { esc } from './components.js';

/**
 * @param {object} o
 * @param {string} o.uid        whose face (data-avatar-uid); the signed-in user for an upload control
 * @param {string} o.initials   the monogram beneath the photo
 * @param {number} [o.size]     circle size in px (62 on an id card, 88 on the profile hero)
 * @param {boolean} [o.editable] render the camera badge + file input (only for the signed-in user)
 * @param {string} [o.id]       element id prefix (default 'avatar'): `${id}-wrap/-btn/-file/-err`
 */
export function avatarControlHtml({ uid, initials, size = 62, editable = true, id = 'avatar' } = {}) {
  const av = `<div class="big-av av-${size}" data-avatar-uid="${esc(uid || '')}" data-avatar-ver="${esc(RT.avatarVer || '')}"><span data-avatar-fallback>${esc(initials || '?')}</span></div>`;
  if (!editable) return av;
  return `<div class="av-wrap" id="${id}-wrap">
      ${av}
      <div id="${id}-btn" class="av-btn" title="Upload photo" aria-label="Upload photo" role="button" tabindex="0"><span class="req-badge b av-badge">${icon('camera', 13)}</span></div>
      <input type="file" id="${id}-file" accept="image/*" class="av-file" />
    </div>`;
}

/**
 * Wire the control rendered by avatarControlHtml. `errHost` is where the status line and the
 * Remove button are placed (a selector inside root); they follow the name, not the photo.
 * Re-entrant per mount: everything is injected fresh, nothing survives a repaint.
 */
export function wireAvatarUpload(root, { id = 'avatar', errHost = '.id-card .id-txt', hasLocalPhoto = false } = {}) {
  const btn = root.querySelector(`#${id}-btn`);
  const file = root.querySelector(`#${id}-file`);
  if (!btn || !file) return;
  const host = root.querySelector(errHost);
  const err = document.createElement('div');
  err.id = `${id}-err`;
  err.className = 'id-err';
  if (host) host.insertAdjacentElement('beforeend', err);

  let busy = false;
  const setBusy = (on) => {
    busy = on;
    btn.classList.toggle('busy', on);
    btn.title = on ? 'Uploading photo…' : 'Upload photo';
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (!busy) file.click(); });

  // "Remove photo" appears only once a photo exists (locally or on the server).
  import('./avatar.js').then(({ avatarReady }) => {
    const renderRemove = () => {
      if (!err.isConnected || root.querySelector(`#${id}-remove`)) return;
      const rm = document.createElement('button');
      rm.id = `${id}-remove`;
      rm.className = 'id-act';
      rm.type = 'button';
      rm.textContent = 'Remove photo';
      err.insertAdjacentElement('beforebegin', rm);
      rm.addEventListener('click', async () => {
        if (busy) return;
        setBusy(true); rm.disabled = true;
        const ok = await window.__act.removeAvatar();
        setBusy(false);
        if (ok) window.__render();
        else { rm.disabled = false; err.textContent = "Couldn't remove it. Check your connection and try again."; }
      });
    };
    if (hasLocalPhoto) return renderRemove();
    avatarReady(RT.userId, RT.avatarVer || '').then((url) => { if (url) renderRemove(); });
  });

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    // Let the SAME photo be picked again after a failed upload: a file input never fires
    // `change` for a value it already holds.
    file.value = '';
    if (!f) return;
    err.textContent = 'Uploading your photo…';
    setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => { setBusy(false); err.textContent = "Couldn't read that photo. Try a JPG or PNG."; };
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => { setBusy(false); err.textContent = "Couldn't read that photo. Try a JPG or PNG from your library."; };
      img.onload = async () => {
        // 256px: 2x for the largest circle that renders it, ~15KB as JPEG. Centre-crop.
        const c = document.createElement('canvas');
        const s = Math.min(img.width, img.height);
        c.width = 256; c.height = 256;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
        const ok = await window.__act.setAvatar(c.toDataURL('image/jpeg', 0.82));
        setBusy(false);
        if (ok) { window.__render(); return; }
        const why = String(RT.avatarError || '');
        err.textContent = /403|policy|unauthori[sz]ed|row-level/i.test(why)
          ? "The server wouldn't accept the photo. That's on us, not your connection; it's been reported."
          : /413|too large|size/i.test(why)
            ? 'That photo is too large even after resizing. Try a different one.'
            : /415|mime|type/i.test(why)
              ? 'That file type is not supported. Try a JPG or PNG.'
              : /network|fetch|timeout|threw/i.test(why)
                ? "The photo didn't upload. Check your connection and try again."
                : "The photo didn't upload. Try again in a moment; if it keeps failing, it's on our side.";
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });
}

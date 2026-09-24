/* Thumbnails for Home's meal cards (cold launch, 2026-09-23). A signed photo URL lives an hour,
   so an athlete who reopens the app the next morning has a new URL, an empty disk cache for it,
   and a card that sat empty until the download finished. A ~10 KB JPEG of each card's photo, kept
   with the launch cache, paints under the real one from the first frame; the real one covers it
   the moment it arrives. Lazy (photo-store imports it after a paint), so it costs boot nothing.

   Made from an anonymous-CORS load (Supabase storage answers `*`). If a host ever refuses, the
   canvas is tainted, toDataURL throws, and that card simply has no stand-in, which is today. */
const SHORT = 200;   // short side in px: the card is 158 x ~100 CSS px, and this is only a stand-in

/** For each [path, url], call done(path, dataUrl) once its thumbnail exists. Idle-time work. */
export function makeThumbs(list, done) {
  const run = () => list.forEach(([path, url]) => {
    if (!url) return;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const k = Math.min(1, SHORT / Math.min(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        done(path, c.toDataURL('image/jpeg', 0.6));
      } catch { /* tainted canvas or no 2d context: no stand-in for this one */ }
    };
    im.src = url;
  });
  // WKWebView has no requestIdleCallback; a short timeout keeps this off the paint that asked.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 }); else setTimeout(run, 250);
}

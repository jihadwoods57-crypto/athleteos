/* The share card — the only OnStandard surface that leaves the app.
 *
 * Every share is a billboard, and this was a flat rectangle with a system-font number on it: no
 * ring, no sweep, no grain, none of the type the app is built out of. Someone posting their month
 * was posting something that didn't look like the product. This draws the app's actual signature
 * instead — dark canvas, the green→teal→blue arc, the score in the display face — from the same
 * token values the screens use.
 *
 * ONE renderer for both the monthly report and a single day, because a month and a day are the same
 * shape of thing: a score, a label, and a few supporting numbers. Two drawing functions would drift.
 *
 * Nothing here invents a number. It renders exactly the payload it is handed; a missing value draws
 * as an em dash rather than a zero, because "—" is honest about not knowing and "0" is not.
 */

/* Straight from tokens.css. Duplicated as literals ON PURPOSE: canvas cannot read CSS custom
   properties, and resolving them off a live element would make the exported image depend on which
   theme the athlete happened to be in — a shared card is always the dark brand. */
const IMG = { w: 1080, h: 1350 };
const IMG_BG = '#070B14';
const IMG_WASH = '#0F1B33';
const RING = ['#34D399', '#22D3EE', '#3B82F6'];   // --ring-a / --ring-b / --ring-c
const TEXT = '#EEF3FB';
const TEXT_2 = '#9AA9C2';
const TEXT_3 = '#7C8BA6';

/** Tiled monochrome noise, the canvas equivalent of the app's grain overlay. */
function grainPattern(ctx) {
  const t = document.createElement('canvas');
  t.width = 120; t.height = 120;
  const tc = t.getContext('2d');
  if (!tc) return null;
  const img = tc.createImageData(t.width, t.height);
  for (let i = 0; i < img.data.length; i += 4) {
    // A single grey value per pixel with a low, constant alpha: coloured noise would tint the
    // canvas, and varying alpha clumps into visible blotches at this tile size.
    const v = 120 + Math.floor(Math.random() * 135);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 15;
  }
  tc.putImageData(img, 0, 0);
  return ctx.createPattern(t, 'repeat');
}

/** The signature ring: dim full track, blurred under-glow, then the gradient arc from 12 o'clock. */
function drawRing(ctx, cx, cy, r, stroke, pct) {
  const g = ctx.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
  g.addColorStop(0, RING[0]); g.addColorStop(0.55, RING[1]); g.addColorStop(1, RING[2]);

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(148,176,224,0.12)';
  ctx.lineWidth = stroke;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  if (pct <= 0) return;
  const from = -Math.PI / 2;
  const to = from + Math.PI * 2 * Math.min(1, pct);

  ctx.save();
  ctx.shadowColor = 'rgba(34,211,238,0.55)';
  ctx.shadowBlur = 46;
  ctx.strokeStyle = g;
  ctx.lineWidth = stroke;
  ctx.beginPath(); ctx.arc(cx, cy, r, from, to); ctx.stroke();
  ctx.restore();

  // Re-stroke without the shadow so the band itself stays crisp rather than reading as pure glow.
  ctx.strokeStyle = g;
  ctx.lineWidth = stroke;
  ctx.beginPath(); ctx.arc(cx, cy, r, from, to); ctx.stroke();

  // Specular rim — the same lit outer edge scoreRing() draws in the app since the ring-material
  // pass, so the card someone posts shows the ring the app actually renders. Alphas are the app's
  // 0.5-opacity white gradient premultiplied into the stops.
  const specW = Math.max(2, stroke * 0.16);
  const rs = r + stroke / 2 - specW / 2 - 2;
  const sg = ctx.createLinearGradient(cx - rs, cy - rs, cx + rs, cy + rs);
  sg.addColorStop(0, 'rgba(255,255,255,0.33)');
  sg.addColorStop(0.45, 'rgba(255,255,255,0.09)');
  sg.addColorStop(1, 'rgba(255,255,255,0.20)');
  ctx.strokeStyle = sg;
  ctx.lineWidth = specW;
  ctx.beginPath(); ctx.arc(cx, cy, rs, from, to); ctx.stroke();
}

/* The display face has to be LOADED before canvas can draw with it, or the browser silently
   substitutes the fallback and the exported image is the one place nobody would notice. */
async function readyFonts() {
  try {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all([
      document.fonts.load('900 300px Archivo'),
      document.fonts.load('800 40px "Plus Jakarta Sans"'),
    ]);
  } catch { /* older WebView — the fallback stack still draws something sane */ }
}

/**
 * Draw a share card and return a PNG data URL (or null if canvas is unavailable).
 * @param {object} p
 * @param {number|null} p.score   the headline number; null draws an em dash
 * @param {string} p.eyebrow      small caps line above the number ("JULY 2026", "THURSDAY")
 * @param {string} p.caption      what the number IS ("Average daily score")
 * @param {Array<[string,string]>} p.stats  up to three [label, value] pairs
 */
export async function drawScoreCard({ score = null, eyebrow = '', caption = '', stats = [] } = {}) {
  try {
    await readyFonts();
    const canvas = document.createElement('canvas');
    canvas.width = IMG.w; canvas.height = IMG.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = IMG_BG;
    ctx.fillRect(0, 0, IMG.w, IMG.h);
    // Top wash, the same "light above the hero" the app canvas has.
    const wash = ctx.createRadialGradient(IMG.w / 2, -180, 60, IMG.w / 2, 520, 900);
    wash.addColorStop(0, IMG_WASH);
    wash.addColorStop(1, 'rgba(7,11,20,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, IMG.w, IMG.h);

    // Ring geometry and the stats block have to be derived together, not hand-placed: with three
    // stats the fixed offsets this started with ran the last one straight through the wordmark.
    const cx = IMG.w / 2, cy = 500, r = 280, stroke = 32;
    const ringBottom = cy + r + stroke / 2 + 22;       // + room for the glow
    drawRing(ctx, cx, cy, r, stroke, score != null ? score / 100 : 0);

    ctx.textAlign = 'center';

    if (eyebrow) {
      ctx.fillStyle = TEXT_3;
      ctx.font = '800 34px "Plus Jakarta Sans", -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(eyebrow.toUpperCase(), cx, 158);
    }

    // The score, in the app's display face. 3 digits get the same shrink the UI applies, for the
    // same reason: Archivo Expanded is wide and 100 would crowd the ring it sits inside.
    if (score != null) {
      const txt = String(score);
      ctx.fillStyle = TEXT;
      ctx.font = `900 ${txt.length >= 3 ? 220 : 290}px Archivo, "Plus Jakarta Sans", sans-serif`;
      ctx.fillText(txt, cx, cy + (txt.length >= 3 ? 78 : 100));
    } else {
      // An em dash at score size renders as a solid white bar — it reads as REDACTED, not as
      // "unknown". Small and dim says the same thing without looking like a censored number.
      ctx.fillStyle = TEXT_3;
      ctx.font = '900 110px Archivo, "Plus Jakarta Sans", sans-serif';
      ctx.fillText('—', cx, cy + 40);
    }

    if (caption) {
      ctx.fillStyle = TEXT_2;
      ctx.font = '700 36px "Plus Jakarta Sans", -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(caption, cx, cy + 200);
    }

    /* Bottom-anchored: the block grows UPWARD from a reserved footer line, so one stat or three all
       clear the wordmark. Clamped so it can never climb into the ring either. */
    const rows = stats.slice(0, 3);
    const STEP = 112;
    const FOOTER_TOP = IMG.h - 150;
    let y = Math.max(ringBottom + 26, FOOTER_TOP - rows.length * STEP);
    for (const [k, v] of rows) {
      ctx.fillStyle = TEXT_3;
      ctx.font = '700 30px "Plus Jakarta Sans", -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(k, cx, y);
      ctx.fillStyle = TEXT;
      ctx.font = '800 42px "Plus Jakarta Sans", -apple-system, Helvetica, Arial, sans-serif';
      ctx.fillText(v, cx, y + 54);
      y += STEP;
    }

    /* Footer lockup: flat dial + the two-tone wordmark (brand law, docs/brand/LOGO.md).
       Canvas can't gradient-clip text per-glyph cheaply, so "On" is ink and "Standard"
       carries the sweep gradient across its own width. */
    const wordFont = '800 44px "Plus Jakarta Sans", -apple-system, Helvetica, Arial, sans-serif';
    ctx.font = wordFont;
    const onW = ctx.measureText('On').width;
    const stdW = ctx.measureText('Standard').width;
    const MARK_S = 56, GAP = 18;
    const totalW = MARK_S + GAP + onW + stdW;
    const baseY = IMG.h - 84;
    const left = cx - totalW / 2;

    // dial (geometry is law: track, sweep arc, marker — 100-unit box scaled)
    const s = MARK_S / 100, mx = left, my = baseY - 14 - MARK_S / 2 - 8;
    ctx.save();
    ctx.translate(mx, my); ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke(new Path2D('M33 81.4 A34 34 0 1 1 67 81.4'));
    const dialGrad = ctx.createLinearGradient(26, 82, 58, 18);
    dialGrad.addColorStop(0, RING[0]); dialGrad.addColorStop(0.5, RING[1]); dialGrad.addColorStop(1, RING[2]);
    ctx.strokeStyle = dialGrad;
    ctx.stroke(new Path2D('M33 81.4 A34 34 0 0 1 50 18'));
    ctx.fillStyle = '#0F172A'; ctx.beginPath(); ctx.arc(50, 18, 10.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(50, 18, 6, 0, 7); ctx.fill();
    ctx.restore();

    ctx.font = wordFont;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    ctx.fillStyle = TEXT;
    ctx.fillText('On', left + MARK_S + GAP, baseY);
    const stdX = left + MARK_S + GAP + onW;
    const stdGrad = ctx.createLinearGradient(stdX, 0, stdX + stdW, 0);
    stdGrad.addColorStop(0, RING[0]); stdGrad.addColorStop(0.5, RING[1]); stdGrad.addColorStop(1, RING[2]);
    ctx.fillStyle = stdGrad;
    ctx.fillText('Standard', stdX, baseY);
    ctx.textAlign = prevAlign;

    // Grain last, over everything, exactly like the app's overlay.
    const grain = grainPattern(ctx);
    if (grain) { ctx.fillStyle = grain; ctx.fillRect(0, 0, IMG.w, IMG.h); }

    return canvas.toDataURL('image/png');
  } catch { return null; }
}

/** Draw, then hand to the native share sheet. Falls back to a text share, then to nothing. */
export async function shareScoreCard(payload, caption) {
  // No number, nothing to share. The renderer can draw a scoreless card (a dim dash, for a month
  // with no data), but pushing that into a share sheet would put an empty ring on someone's feed.
  if (!payload || payload.score == null) return false;
  const dataUrl = await drawScoreCard(payload);
  const N = window.OnStandardNative;
  if (dataUrl && N && N.shareImage) { N.shareImage(dataUrl, caption); return true; }
  if (N && N.share) { N.share({ title: caption }); return true; }
  return false;
}

/* ---------------- the day's payload ----------------
 * The renderer above was written for a month AND a day, but only the monthly report ever called it,
 * so the DAILY score — the number this product is built around, and the only one an athlete feels
 * anything about the moment it lands — still could not leave the app.
 *
 * Pure on purpose: what the card CLAIMS is testable without rendering a pixel.
 *
 * This shows one athlete their own number, shared by their own deliberate tap. It does not touch the
 * promise in settings.js that "there is no team feed and no leaderboard — nobody on your team is
 * shown your number": nothing here makes one teammate visible to another. */

/** The four bands the app uses everywhere else. */
function tierLabel(score) {
  if (score == null) return '';
  if (score >= 90) return 'OnStandard';
  if (score >= 75) return 'Locked In';
  if (score >= 60) return 'Building';
  return 'Off Standard';
}

/**
 * Build the {payload, caption} for a single day.
 * @param {object} day  { score, streak, met, total, dateISO, eyebrow }
 */
export function dayShareCard(day) {
  const d = day || {};
  // null, not 0 — the renderer draws an em dash for "unknown", and a 0 would be a claim about the
  // athlete. Note Number(null) is 0, not NaN, so a null score has to be rejected BEFORE coercion or
  // "we don't know" silently becomes "you scored zero" on something they might post.
  const n = d.score == null || d.score === '' ? NaN : Number(d.score);
  const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  const sRaw = Number(d.streak);
  const streak = Number.isFinite(sRaw) && sRaw > 0 ? Math.floor(sRaw) : 0;
  const met = Number.isFinite(Number(d.met)) ? Math.max(0, Math.floor(Number(d.met))) : null;
  const total = Number.isFinite(Number(d.total)) ? Math.max(0, Math.floor(Number(d.total))) : null;

  const stats = [];
  // Only claim a denominator when there is one. "0 of 0" is noise on something someone posts.
  if (total) stats.push(['Completed', `${Math.min(met ?? 0, total)} of ${total}`]);
  if (streak >= 2) stats.push(['Streak', `${streak} days`]);
  if (score != null) stats.push(['Standard', tierLabel(score)]);

  return {
    payload: {
      score,
      eyebrow: typeof d.eyebrow === 'string' && d.eyebrow ? d.eyebrow : 'Today',
      caption: 'Daily score',
      stats,
    },
    // The text that rides along. States what held, never what was missed: a card someone chooses to
    // post is a moment of pride, and nobody shares a scolding.
    caption: streak >= 2
      ? `Day ${streak} of my streak — ${score != null ? score : '—'} on OnStandard.`
      : `${score != null ? score : '—'} on OnStandard today.`,
  };
}

/** Share today's number. Never throws at a tap. */
export async function shareDay(day) {
  const { payload, caption } = dayShareCard(day);
  return shareScoreCard(payload, caption);
}

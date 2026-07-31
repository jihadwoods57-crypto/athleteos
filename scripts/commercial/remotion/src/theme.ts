import { continueRender, delayRender, staticFile } from 'remotion';

/* OnStandard brand v4 — dark-navy canvas, Athlete Blue chrome, dial sweep (site.css / LOGO.md). */
export const C = {
  bg: '#070B14',
  bg2: '#0A1020',
  ink: '#EDF3FC',
  ink2: '#8FA3BF',
  blue: '#3B82F6',
  blueBright: '#60A5FA',
  blueDeep: '#2563EB',
  ringA: '#34D399',
  ringB: '#22D3EE',
  ringC: '#60A5FA',
};

export const F = {
  exp: 'ArchivoExp',   // Archivo Expanded 900 — the score face; kinetic lines + numbers
  body: 'ArchivoVar',  // Archivo variable — labels, small text
  brand: 'Jakarta',    // Plus Jakarta Sans 800 — the wordmark (brand law)
};

let loaded: Promise<void> | null = null;
export const ensureFonts = () => {
  if (!loaded) {
    const handle = delayRender('fonts');
    loaded = Promise.all([
      new FontFace(F.exp, `url(${staticFile('archivo-exp900.woff2')})`, { weight: '900' }).load(),
      new FontFace(F.body, `url(${staticFile('archivo-var.woff2')})`, { weight: '100 900' }).load(),
      new FontFace(F.brand, `url(${staticFile('jakarta800.woff2')})`, { weight: '800' }).load(),
    ]).then((faces) => {
      faces.forEach((f) => document.fonts.add(f));
      continueRender(handle);
    });
  }
  return loaded;
};

/** The dial's signature sweep as a CSS gradient. */
export const sweep = (deg = 90) => `linear-gradient(${deg}deg, ${C.ringA}, ${C.ringB}, ${C.ringC})`;

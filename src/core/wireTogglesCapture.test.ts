/**
 * REGRESSION: wireToggles (proto settings.js) attaches a per-chip click handler that calls
 * e.stopPropagation() — so a capture listener bound on the GROUP element never fires. Every
 * onboarding chip capture must therefore bind per chip, AFTER wireToggles, relying on
 * same-element listeners running in attach order (toggle first, then sync reads fresh .on).
 *
 * This test locks both facts:
 *   1. the group-level listener does NOT fire (documents why the per-chip pattern is required);
 *   2. the per-chip sync DOES fire and reads the post-toggle .on state.
 *
 * Runs under the default node environment (the repo's jest-environment-jsdom is v29, which is
 * incompatible with jest 30's runtime) — so we build the DOM with the jsdom package directly
 * and install the browser globals BEFORE lazily requiring settings.js (its import chain pulls
 * in proto state.js, which touches window/localStorage at module load).
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).MouseEvent = dom.window.MouseEvent;

// Lazy CJS require so the globals above exist before the proto module graph evaluates.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { wireToggles } = require('../../proto/redesign-2026-07/js/screens/settings.js');

function buildGroup(): { group: HTMLElement; chips: HTMLElement[] } {
  const root = dom.window.document.createElement('div');
  root.innerHTML = `
    <div class="chip-row" id="g" data-toggle-group>
      <span class="chp on">A</span><span class="chp">B</span><span class="chp">C</span>
    </div>`;
  dom.window.document.body.appendChild(root);
  wireToggles(root); // must run FIRST, exactly like every onboarding mount
  const group = root.querySelector('#g') as HTMLElement;
  return { group, chips: [...group.querySelectorAll('.chp')] as HTMLElement[] };
}

const click = (el: HTMLElement) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

afterEach(() => { dom.window.document.body.innerHTML = ''; });

describe('wireToggles + chip capture binding', () => {
  it('stopPropagation()s chip clicks: a group-level capture listener never fires', () => {
    const { group, chips } = buildGroup();
    let groupSyncFired = 0;
    group.addEventListener('click', () => { groupSyncFired++; });
    click(chips[1]);
    // the toggle itself worked…
    expect(chips[1].classList.contains('on')).toBe(true);
    expect(chips[0].classList.contains('on')).toBe(false);
    // …but the group listener was starved by stopPropagation — the broken pattern.
    expect(groupSyncFired).toBe(0);
  });

  it('per-chip sync bound after wireToggles fires and reads the fresh .on state', () => {
    const { group, chips } = buildGroup();
    const captured: string[] = [];
    const sync = () => {
      const on = group.querySelector('.on');
      if (on) captured.push((on.textContent || '').trim());
    };
    chips.forEach((chp) => chp.addEventListener('click', sync));
    click(chips[1]);
    click(chips[2]);
    // sync fired per click AND saw the post-toggle selection each time (attach order).
    expect(captured).toEqual(['B', 'C']);
    expect(chips[2].classList.contains('on')).toBe(true);
    expect(group.querySelectorAll('.on')).toHaveLength(1);
  });
});

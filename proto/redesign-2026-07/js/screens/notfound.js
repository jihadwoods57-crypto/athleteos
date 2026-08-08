import { RT, routeForRole } from '../state.js';
import { emptyState } from '../components.js';

/* The honest fallback for a route that does not exist.
   router.js used to resolve an unknown hash with `screens[route] || screens.home`, so a stale
   deep link, a renamed screen, or a typo in a push notification's data.route painted a
   pixel-perfect Home while the address bar kept the bogus hash — no error, no console warning.
   That is the worst failure mode available: it looks completely fine, so nobody reports it.
   This screen makes the failure visible to the user and loud in the console, and hands them one
   real door back to their OWN home rather than assuming the athlete shell. */
export default {
  hideTabs: true,
  // Exempt from the role-mirror guard in router.js. Without this a signed-in coach who hits a
  // dead link gets bounced to coach-home and the failure goes silent again for exactly the role
  // most likely to be following a stale link out of an email or a push.
  anyRole: true,
  render({ sub } = {}) {
    const home = routeForRole(RT.authRole || 'athlete');
    const hash = (location.hash || '').replace(/^#/, '') || '(empty)';
    return `
    <div class="nf-wrap">
      ${emptyState({
    icon: 'search',
    title: "That screen doesn't exist",
    body: `Nothing lives at "${hash}". The link is probably out of date. Your home screen is one tap away and nothing you logged was lost.`,
    action: { label: 'Go to my home', go: home },
  })}
    </div>`;
  },
  mount() {
    // Loud where developers look, quiet where the athlete does. A route that fails silently is
    // a route nobody ever fixes.
    console.warn('[router] no screen registered for hash', location.hash);
  },
};

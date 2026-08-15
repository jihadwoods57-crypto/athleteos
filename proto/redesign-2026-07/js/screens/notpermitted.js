import { RT, routeForRole } from '../state.js';
import { permissionState } from '../components.js';

/* The honest answer to "this screen is not yours".

   The router used to handle a role-denied route by rewriting location.hash to the user's own
   home. Role integrity was preserved, but the user was not told anything: they tapped a link
   and landed somewhere else, which is indistinguishable from a broken tap. The same class of
   silent bounce already shipped a real lockout once, when avatarHead() pointed every operator
   at a nav:'coach' profile and trainers were teleported home instead of reaching account
   settings or sign-out at all (see components.js). A bounce hides that kind of bug; a state
   reports it.

   DESIGN.md lists permissionState as one of four states every data-bearing surface owes the
   user, "not for coach screens only". It was live on exactly one screen before this.

   Rendered in the DENIED user's own chrome, never the chrome of the screen they were refused:
   no declared `nav` means navFor() resolves to the signed-in role's shell, so their own tab bar
   is still under them and the exit is never a dead end. */
export default {
  // Exempt from the role-mirror guard, for the same reason notfound.js is: without it a
  // signed-in coach hitting a denied route would be bounced by the very guard this screen
  // exists to replace, and the silence would come straight back.
  anyRole: true,
  render() {
    const role = RT.authRole || 'athlete';
    const home = routeForRole(role);
    // Say which door was closed. "Not your access" alone leaves the user guessing whether they
    // tapped the wrong thing or the app broke.
    const isOperator = role === 'coach' || role === 'trainer';
    return permissionState({
      title: 'This screen is not on your account',
      body: isOperator
        ? 'That link belongs to a different kind of account. Nothing is wrong with yours, and nothing you were working on was lost.'
        : 'That link belongs to a coach or trainer account. Nothing is wrong with yours, and nothing you logged was lost.',
      action: { label: 'Go to my home', go: home },
    });
  },
  mount() {
    // Loud where developers look, quiet where the user does. A link that points at the wrong
    // role is a bug in whatever rendered the link, and it should be findable.
    console.warn('[router] role-denied route', location.hash, 'for role', RT.authRole);
  },
};

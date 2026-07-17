/* Minimal stub — gap-fill: router.js/index.js wire a 'coach-roster' tab root (Task 6) but no
   task brief creates its real body yet. Honest empty state, no fake copy; replaced by its own task. */
import { S } from '../state.js';
import { avatarHead } from '../components.js';

export const coachRoster = {
  nav: 'coach', tab: 'roster',
  render() {
    return `${avatarHead('Roster', '', S.coachIdentity.initials)}
    <section class="card" style="padding:16px"></section>`;
  },
};

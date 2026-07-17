/* Minimal stub — Insights (Task 9) is not built yet. Honest empty state, no fake copy. */
import { S } from '../state.js';
import { avatarHead } from '../components.js';

export const coachInsights = {
  nav: 'coach', tab: 'insights',
  render() {
    return `${avatarHead('Insights', '', S.coachIdentity.initials)}
    <section class="card" style="padding:16px"></section>`;
  },
};

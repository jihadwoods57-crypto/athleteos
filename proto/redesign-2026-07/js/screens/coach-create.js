/* Minimal stub — the create menu (Task 8) is not built yet. Honest empty state, no fake copy. */
import { backHead } from '../components.js';

export const coachCreate = {
  nav: 'coach', tab: 'create',
  render() {
    return `${backHead('Create', '', 'coach-home')}
    <section class="card" style="padding:16px"></section>`;
  },
};

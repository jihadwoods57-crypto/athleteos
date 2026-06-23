// AthleteOS — Account-overlay settings rows. Pure copy + data, no RN imports.
// Turns the formerly-static "Team & roster / Billing / Help" rows (which showed
// a "›" chevron but had no destination) into intentional, deterministic
// disclosures. The team-row detail derives from the real roster / client book
// per role, so the numbers can never be invented or drift from the dashboards.
import type { Role } from './types';
import { APP_VERSION, flowForRole, ROSTER, TRAINER_CLIENTS } from './constants';

export interface AccountRow {
  key: 'team' | 'plan' | 'help';
  label: string;
  /** Compact summary shown to the right of the label on the collapsed row. */
  hint: string;
  /** Intentional detail revealed when the row is expanded. */
  detail: string;
}

/** The three disclosure rows under the Account overlay's settings card,
 *  tailored to the signed-in role. `null` role is treated as the athlete. */
export function accountRows(role: Role | null): AccountRow[] {
  return [
    teamRow(role),
    {
      key: 'plan',
      label: 'Billing & plan',
      hint: 'Free preview',
      detail: 'AthleteOS is in free preview. There is no billing on this account yet.',
    },
    {
      key: 'help',
      label: 'Help & support',
      hint: APP_VERSION,
      detail: `AthleteOS ${APP_VERSION} runs fully offline on this device. No data leaves the app.`,
    },
  ];
}

function teamRow(role: Role | null): AccountRow {
  const flow = flowForRole(role);
  if (flow === 'coach') {
    const n = ROSTER.length;
    return {
      key: 'team',
      label: 'Team & roster',
      hint: `${n} athletes`,
      detail: `You manage ${n} athletes on the Eastside HS roster. Add or remove players from the Coach dashboard.`,
    };
  }
  if (flow === 'trainer') {
    const n = TRAINER_CLIENTS.length;
    const orgs = new Set(TRAINER_CLIENTS.map((c) => c.org)).size;
    const noun = role === 'nutritionist' ? 'nutrition clients' : 'clients';
    return {
      key: 'team',
      label: role === 'nutritionist' ? 'Clients & nutrition' : 'Clients & book',
      hint: `${n} ${noun}`,
      detail: `You coach ${n} ${noun} across ${orgs} organizations. Manage your book from the dashboard.`,
    };
  }
  if (flow === 'parent') {
    return {
      key: 'team',
      label: 'Team & roster',
      hint: 'Linked',
      detail: 'You are linked to your athlete on the Eastside HS roster. Roster changes are managed by their coach.',
    };
  }
  // athlete (role null or 'athlete')
  return {
    key: 'team',
    label: 'Team & roster',
    hint: 'Eastside HS',
    detail: 'You are on the Eastside HS roster. Your coach manages who is on the team.',
  };
}

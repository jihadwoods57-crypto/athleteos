// AthleteOS — Account-overlay settings rows. Pure copy + data, no RN imports.
// Turns the formerly-static "Team & roster / Billing / Help" rows (which showed
// a "›" chevron but had no destination) into intentional, deterministic
// disclosures. The team-row detail derives from the real roster / client book
// per role, so the numbers can never be invented or drift from the dashboards.
import type { Role } from './types';
import { APP_VERSION, PRIVACY_POLICY_URL, SUPPORT_EMAIL, TERMS_URL, flowForRole, ROSTER, TRAINER_CLIENTS } from './constants';
import { billingRowCopy, previewEntitlement, type Entitlement } from './subscription';

export interface AccountRow {
  key: 'team' | 'plan' | 'help' | 'legal';
  label: string;
  /** Compact summary shown to the right of the label on the collapsed row. */
  hint: string;
  /** Intentional detail revealed when the row is expanded. */
  detail: string;
}

/** The settings disclosure rows under the Account overlay, tailored to the signed-in
 *  role. `null` role is treated as the athlete. The billing row reads the real
 *  entitlement (defaults to the free-preview copy when none is passed). */
export function accountRows(role: Role | null, entitlement: Entitlement = previewEntitlement()): AccountRow[] {
  const billing = billingRowCopy(entitlement, flowForRole(role));
  return [
    teamRow(role),
    {
      key: 'plan',
      label: 'Billing & plan',
      hint: billing.hint,
      detail: billing.detail,
    },
    {
      key: 'help',
      label: 'Help & support',
      hint: APP_VERSION,
      detail: `Questions or a problem? Email ${SUPPORT_EMAIL} and we will help. When your account is connected to a coach or guardian, your data syncs securely to the people you have linked; until then it stays on this device.`,
    },
    {
      key: 'legal',
      label: 'Privacy & terms',
      hint: 'Required reading',
      detail: `How we handle your data (and a minor's data) is described in our Privacy Policy at ${PRIVACY_POLICY_URL} and Terms at ${TERMS_URL}. You can request account deletion or a copy of your data any time from this screen.`,
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

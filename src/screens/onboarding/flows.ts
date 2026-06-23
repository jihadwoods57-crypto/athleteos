// AthleteOS — onboarding flow definitions for the non-athlete roles.
// Each role's flow is data (an array of step descriptors) so one renderer drives
// all of them. Answers are stored in `obMeta` keyed by `field` (personalization,
// not scored). The athlete flow is bespoke (see Onboarding.tsx) because it feeds
// the Starting Point Score + activation; the other six are short and end in an invite.
import type { Role } from '@/core';
import { SPORTS } from '@/core';

export interface Opt {
  key: string;
  label: string;
}

export type GenStep =
  | { kind: 'select'; field: string; title: string; sub?: string; options: Opt[]; columns?: number }
  | { kind: 'multiselect'; field: string; title: string; sub?: string; options: Opt[] }
  | { kind: 'text'; field: string; title: string; sub?: string; placeholder: string }
  | { kind: 'invite'; title: string; sub: string; cta: string; codeLabel: string };

const sportOpts: Opt[] = SPORTS.map((s) => ({ key: s, label: s }));

const COUNT_BANDS: Opt[] = [
  { key: '1-10', label: '1 to 10' },
  { key: '11-25', label: '11 to 25' },
  { key: '26-50', label: '26 to 50' },
  { key: '51+', label: '51 or more' },
];

const PARENT_GOALS: Opt[] = [
  { key: 'performance', label: 'Performance' },
  { key: 'scholarship', label: 'Earn a scholarship' },
  { key: 'body_comp', label: 'Body composition' },
  { key: 'health', label: 'Health & habits' },
];

export const ROLE_FLOWS: Partial<Record<Role, GenStep[]>> = {
  personal_trainer: [
    {
      kind: 'select',
      field: 'clientType',
      title: 'What type of clients do you coach?',
      sub: "We'll tune your dashboard to how you work.",
      options: [
        { key: 'athletes', label: 'Athletes' },
        { key: 'weight_loss', label: 'Weight loss' },
        { key: 'muscle_gain', label: 'Muscle gain' },
        { key: 'general', label: 'General fitness' },
        { key: 'hybrid', label: 'Hybrid' },
      ],
    },
    { kind: 'select', field: 'clientCount', title: 'How many active clients?', options: COUNT_BANDS },
    {
      kind: 'select',
      field: 'challenge',
      title: "What's your biggest challenge?",
      sub: 'This shapes what your dashboard surfaces first.',
      options: [
        { key: 'adherence', label: "Clients don't follow the plan" },
        { key: 'retention', label: 'Client retention' },
        { key: 'results', label: 'Poor results' },
        { key: 'accountability', label: 'Lack of accountability' },
        { key: 'scaling', label: 'Scaling coaching' },
      ],
    },
    { kind: 'invite', title: 'Invite your first client', sub: 'Activation starts the moment they join. Share your code or send an invite.', cta: 'Send invite', codeLabel: 'YOUR INVITE CODE' },
  ],
  sports_perf_coach: [
    { kind: 'select', field: 'sport', title: 'What sport do you train?', options: sportOpts, columns: 2 },
    {
      kind: 'multiselect',
      field: 'posGroups',
      title: 'Position groups you coach',
      sub: 'Pick all that apply.',
      options: [
        { key: 'skill', label: 'Skill' },
        { key: 'big', label: 'Big skill' },
        { key: 'line', label: 'Linemen' },
        { key: 'specialists', label: 'Specialists' },
      ],
    },
    { kind: 'select', field: 'athleteCount', title: 'How many athletes?', options: COUNT_BANDS },
    {
      kind: 'select',
      field: 'challenge',
      title: 'Biggest development challenge?',
      options: [
        { key: 'nutrition', label: 'Nutrition compliance' },
        { key: 'recovery', label: 'Recovery & readiness' },
        { key: 'consistency', label: 'Day-to-day consistency' },
        { key: 'buyin', label: 'Athlete buy-in' },
      ],
    },
    { kind: 'invite', title: 'Invite your first athlete', sub: 'Get one athlete in and the roster fills from there.', cta: 'Send invite', codeLabel: 'YOUR TEAM CODE' },
  ],
  nutritionist: [
    {
      kind: 'select',
      field: 'specialty',
      title: "What's your specialty?",
      options: [
        { key: 'sports', label: 'Sports nutrition' },
        { key: 'weight', label: 'Weight management' },
        { key: 'clinical', label: 'Clinical' },
        { key: 'performance', label: 'Performance' },
        { key: 'general', label: 'General' },
      ],
    },
    { kind: 'select', field: 'clientCount', title: 'How many clients?', options: COUNT_BANDS },
    {
      kind: 'select',
      field: 'clientType',
      title: 'Primary client type?',
      options: [
        { key: 'athletes', label: 'Athletes' },
        { key: 'gen_pop', label: 'General population' },
        { key: 'teams', label: 'Teams' },
        { key: 'youth', label: 'Youth' },
      ],
    },
    {
      kind: 'select',
      field: 'challenge',
      title: 'Biggest nutrition challenge?',
      options: [
        { key: 'compliance', label: 'Compliance' },
        { key: 'consistency', label: 'Meal consistency' },
        { key: 'protein', label: 'Protein intake' },
        { key: 'weight', label: 'Weight management' },
        { key: 'accountability', label: 'Client accountability' },
      ],
    },
    { kind: 'invite', title: 'Invite your first client', sub: 'Their first logged meal is where your coaching begins.', cta: 'Send invite', codeLabel: 'YOUR INVITE CODE' },
  ],
  hs_coach: [
    { kind: 'text', field: 'school', title: "What's your school?", placeholder: 'e.g. Eastside High School' },
    { kind: 'select', field: 'sport', title: 'Which sport?', options: sportOpts, columns: 2 },
    { kind: 'select', field: 'athleteCount', title: 'How many athletes?', options: COUNT_BANDS },
    {
      kind: 'multiselect',
      field: 'posGroups',
      title: 'Position groups',
      sub: 'Pick all that apply.',
      options: [
        { key: 'offense', label: 'Offense' },
        { key: 'defense', label: 'Defense' },
        { key: 'special', label: 'Special teams' },
      ],
    },
    { kind: 'invite', title: 'Invite your roster', sub: 'Drop your team code in the group chat and they join in seconds.', cta: 'Share team code', codeLabel: 'YOUR TEAM CODE' },
  ],
  college_coach: [
    { kind: 'text', field: 'school', title: "What's your program?", placeholder: 'e.g. State University' },
    { kind: 'select', field: 'sport', title: 'Which sport?', options: sportOpts, columns: 2 },
    {
      kind: 'multiselect',
      field: 'posGroups',
      title: 'Position group',
      sub: 'Pick all you oversee.',
      options: [
        { key: 'offense', label: 'Offense' },
        { key: 'defense', label: 'Defense' },
        { key: 'special', label: 'Special teams' },
      ],
    },
    { kind: 'select', field: 'rosterSize', title: 'Roster size?', options: COUNT_BANDS },
    { kind: 'invite', title: 'Invite your athletes', sub: 'Get the room on the same number. Share your program code.', cta: 'Share program code', codeLabel: 'YOUR PROGRAM CODE' },
  ],
  parent: [
    { kind: 'text', field: 'athleteName', title: "Your athlete's name?", placeholder: 'e.g. Jordan' },
    { kind: 'select', field: 'sport', title: 'What sport do they play?', options: sportOpts, columns: 2 },
    { kind: 'select', field: 'goal', title: "Their main goal?", options: PARENT_GOALS },
    { kind: 'invite', title: 'Invite your athlete', sub: "Link to their account and you'll see every day, honestly.", cta: 'Send invite', codeLabel: 'YOUR LINK CODE' },
  ],
};

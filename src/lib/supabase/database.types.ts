// OnStandard — Supabase schema types (hand-authored, mirrors supabase/migrations).
// Kept in sync with 0001_schema.sql / 0002_rls.sql. When the schema stabilizes,
// replace this file with `supabase gen types typescript` output — the shape is
// drop-in compatible with createClient<Database>.

export type UserRole = 'athlete' | 'parent' | 'coach' | 'trainer';
export type OrgType = 'school' | 'club' | 'independent';
export type CompMode = 'position' | 'team' | 'off';
export type LinkStatus = 'active' | 'invited' | 'removed' | 'pending';
export type StaffRole = 'head_coach' | 'assistant';

// A meal row mirrors src/core meal macros; `meals` jsonb on `days` is the
// boolean per-slot map the prototype uses, kept separate from the richer
// per-meal rows in the `meals` table.
export type DayRow = {
  id: string;
  athlete_id: string;
  date: string; // YYYY-MM-DD
  meals: Record<string, boolean>;
  hydration_l: number;
  tasks: Array<{ id: number; done: boolean; label?: string }>;
  quick_added: boolean[];
  current_weight: number | null;
  checkin: Record<string, unknown>;
  score: number | null;
  grade: string | null;
  computed_at: string | null;
  updated_at: string;
}

export type TrustPassRow = {
  id: string;
  athlete_id: string;
  granted_by: string;
  granted_date: string; // YYYY-MM-DD
  length_days: number;
  ended_at: string | null;
  created_at: string;
}

export type MealRow = {
  id: string;
  athlete_id: string;
  day_date: string;
  type: string | null;
  photo_path: string | null;
  name: string | null;
  protein: number | null;
  kcal: number | null;
  carbs: number | null;
  fat: number | null;
  quality: number | null;
  detected: string[];
  note: string | null;
  /** Grounder confidence in the macro estimate ('high'|'medium'|'low'); null on legacy/deterministic. */
  macro_confidence: string | null;
  /** How the athlete note related to the photo ('match'|'photo_heavier'|'photo_lighter'|'no_photo'). */
  description_signal: string | null;
  /** Athlete flagged this meal as a reusable "usual". */
  favorited: boolean;
  logged_at: string;
}

/** The unified access grant (Phase A keystone, migration 0011). One row generalizes
 *  today's team_members/team_staff/practice_clients/guardianships. Mirrors
 *  src/core/membership.ts Membership. Reads are RLS-scoped to own/admin; writes are
 *  service_role/RPC only. INERT until the backend is live + the can_view cutover. */
export type OrgMembershipRow = {
  id: string;
  organization_id: string;
  member_id: string;
  role: 'athlete' | 'client' | 'guardian' | 'admin' | 'head_coach' | 'assistant_coach' | 'trainer' | 'nutritionist';
  scope_kind: 'organization' | 'program' | 'group' | 'individual';
  scope_id: string | null;
  permissions: Record<string, boolean>;
  status: 'invited' | 'active' | 'suspended' | 'left' | 'transferred' | 'graduated' | 'removed';
  invited_by: string | null;
  joined_at: string | null;
  ended_at: string | null;
  created_at: string;
}

/** A coach/org subscription (B2B per-seat). Written by the Stripe webhook
 *  (service_role) at go-live; the owner reads their own row. Added in migration 0010;
 *  lifecycle columns (plan_id / paused / cancel_at_period_end / payment_failed_at)
 *  added in 0042. */
export type SubscriptionRow = {
  owner_id: string;
  tier: 'preview' | 'team';
  status: 'preview' | 'active' | 'past_due' | 'canceled' | 'paused';
  /** Which catalog plan was bought (pro_solo / professional / org_*). Null pre-0042. */
  plan_id: string | null;
  seats: number | null;
  seats_used: number | null;
  current_period_end: string | null;
  /** True when the owner canceled but access runs to period end ("canceling on <date>"). */
  cancel_at_period_end: boolean | null;
  /** When the last invoice failed (dunning); null when billing is healthy. */
  payment_failed_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  updated_at: string;
}

/** A coach-seen receipt (0043): a real human opened this athlete's day. The viewer writes
 *  their own row (RLS: only for athletes they can_view); the athlete reads receipts about
 *  themselves — "Coach Mark saw your day" is never fabricated. */
export type CoachViewRow = {
  athlete_id: string;
  viewer_id: string;
  date: string;
  viewer_name: string | null;
  seen_at: string;
}

/** One per-meal comment (0046): the athlete/coach/AI conversation living on the plate it
 *  is about. Written as yourself only (RLS); read by the athlete + linked overseers. */
export type MealCommentRow = {
  id: string;
  meal_id: string;
  athlete_id: string;
  author_id: string;
  role: 'athlete' | 'coach' | 'ai';
  text: string;
  created_at: string;
}

/** The signed-in user's referral code row (0042). Client creates its own, reads its own. */
export type ReferralCodeRow = {
  owner_id: string;
  code: string;
  created_at: string;
}

/** One referral redemption (0042): who brought whom. Written only by the webhook. */
export type ReferralRedemptionRow = {
  referred_owner_id: string;
  referrer_owner_id: string;
  code: string;
  status: 'pending' | 'rewarded';
  created_at: string;
  rewarded_at: string | null;
}

export type CheckinRow = {
  id: string;
  athlete_id: string;
  week: string;
  weight: number | null;
  energy: number | null;
  recovery: number | null;
  sleep: number | null;
  confidence: number | null;
  soreness: number | null;
  motivation: number | null;
  notes: string | null;
  ai_summary: string | null;
  submitted_at: string;
}

export type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  /** Overseer-editable org/team/practice name (OverseerProfile). Null until set;
   *  added in migration 0009. */
  org_name: string | null;
  primary_role: UserRole;
  created_at: string;
  updated_at: string;
}

export type AthleteProfileRow = {
  athlete_id: string;
  level: string | null;
  sport: string | null;
  position: string | null;
  base_height: number | null;
  base_weight: number | null;
  base_age: number | null;
  base_goal: string | null;
  /** Coach-set plan. `profile` is the coach's chosen scoring profile (constitution 11a
   *  — the coach owns targets + profile), persisted inside the same jsonb so it
   *  round-trips into the goals editor. */
  targets: { protein?: number; calories?: number; weight?: number; profile?: string };
  season_goal: { start?: number; target?: number; deadline?: string };
  team_code: string | null;
  updated_at: string;
}

// School / club / gym directory entity. `city`/`state` (added in 0022) disambiguate
// same-named schools in the picker and are null for location-less clubs/gyms.
export type OrgRow = {
  id: string;
  name: string;
  type: OrgType;
  city: string | null;
  state: string | null;
  created_by: string | null;
  created_at: string;
}

export type TeamRow = {
  id: string;
  org_id: string | null;
  name: string;
  sport: string | null;
  join_code: string;
  /** Opt-in athlete discovery at the team's school (added in 0022). Default false. */
  discoverable: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PracticeRow = {
  id: string;
  owner_id: string;
  name: string;
  join_code: string;
  plan: string | null;
  /** Trainer's unique @handle (client-first discovery key) + opt-in discovery (0025). */
  handle: string | null;
  discoverable: boolean;
  created_at: string;
}

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

export type TeamMemberRow = {
  team_id: string;
  athlete_id: string;
  position: string | null;
  status: LinkStatus;
  joined_at: string;
}

export type PracticeClientRow = {
  practice_id: string;
  client_id: string;
  org_label: string | null;
  status: LinkStatus;
  last_active_at: string | null;
}

// One guardian-consent request per (athlete, guardian email). `status` is server-owned:
// only the service-role verification endpoint may set it to 'verified' (migration 0008). The
// athlete can read their own rows (gcr_read RLS) but never write 'verified'.
export type GuardianConsentRequestRow = {
  id: string;
  athlete_id: string;
  guardian_email: string;
  status: 'pending' | 'verified' | 'revoked';
  token: string;
  requested_at: string;
  verified_at: string | null;
}

// Helper: a table definition matching the `supabase gen types` shape (incl. the
// empty `Relationships` tuple the client's type inference requires).
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  // Matches `supabase gen types` output; the client's type inference keys off this.
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      athlete_profiles: Table<AthleteProfileRow>;
      orgs: Table<OrgRow>;
      teams: Table<TeamRow>;
      practices: Table<PracticeRow>;
      notifications: Table<NotificationRow>;
      days: Table<DayRow>;
      meals: Table<MealRow>;
      checkins: Table<CheckinRow>;
      team_members: Table<TeamMemberRow>;
      practice_clients: Table<PracticeClientRow>;
      subscriptions: Table<SubscriptionRow>;
      referral_codes: Table<ReferralCodeRow>;
      referral_redemptions: Table<ReferralRedemptionRow>;
      coach_views: Table<CoachViewRow>;
      meal_comments: Table<MealCommentRow>;
      org_memberships: Table<OrgMembershipRow>;
      guardian_consent_requests: Table<GuardianConsentRequestRow>;
      trust_passes: Table<TrustPassRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_team: {
        Args: {
          team_name: string;
          team_sport?: string | null;
          team_org?: string | null;
          team_discoverable?: boolean | null;
        };
        Returns: string;
      };
      delete_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      request_guardian_consent: {
        Args: { guardian_email: string };
        Returns: undefined;
      };
      // Go-live (security G1): revoke a viewer KIND's server access (sets the athlete's matching
      // link rows status <> 'active', which can_view excludes). RPC authored at go-live; see
      // docs/specs/2026-06-29-g1-revoke-viewer.md. The client seam below is wired + inert until then.
      revoke_viewer: {
        Args: { viewer_kind: string };
        Returns: undefined;
      };
      join_team: {
        Args: { code: string; athlete_position?: string | null };
        Returns: string;
      };
      discover_teams: {
        Args: { org: string };
        Returns: { id: string; name: string; sport: string | null; coach_name: string | null }[];
      };
      // School-directory search via SECURITY DEFINER RPCs (migration 0031). Return SAFE display
      // columns only (never created_by), so orgs_read can stay locked (audit: 0013<->0022).
      search_orgs: {
        Args: { q: string; lim?: number | null };
        Returns: { id: string; name: string; type: OrgType; city: string | null; state: string | null }[];
      };
      find_org: {
        Args: { p_name: string; p_state?: string | null };
        Returns: { id: string; name: string; type: OrgType; city: string | null; state: string | null }[];
      };
      resolve_team_code: {
        Args: { code: string };
        Returns: { id: string; name: string; sport: string | null; coach_name: string | null; school: string | null }[];
      };
      request_join_team: {
        Args: { team: string; athlete_position?: string | null };
        Returns: string;
      };
      pending_team_requests: {
        Args: { team: string };
        Returns: { athlete_id: string; athlete_name: string | null; position: string | null; requested_at: string }[];
      };
      team_roster: {
        Args: { team: string };
        Returns: { athlete_id: string; athlete_name: string | null; position: string | null; joined_at: string }[];
      };
      practice_roster: {
        Args: { practice: string };
        Returns: { client_id: string; client_name: string | null; joined_at: string }[];
      };
      join_practice: {
        Args: { code: string };
        Returns: string;
      };
      create_practice: {
        Args: { practice_name: string; practice_handle?: string | null; is_discoverable?: boolean | null };
        Returns: string;
      };
      find_practice_by_handle: {
        Args: { h: string };
        Returns: { id: string; name: string; trainer_name: string | null }[];
      };
      resolve_practice_code: {
        Args: { code: string };
        Returns: { id: string; name: string; trainer_name: string | null }[];
      };
      request_join_practice: {
        Args: { practice: string };
        Returns: string;
      };
      pending_practice_requests: {
        Args: { practice: string };
        Returns: { client_id: string; client_name: string | null; requested_at: string | null }[];
      };
      register_device_token: { Args: { tok: string; plat?: string | null }; Returns: undefined };
      set_my_team_code: { Args: { new_code: string }; Returns: string };
      regenerate_my_team_code: { Args: Record<string, never>; Returns: string };
      set_my_practice_code: { Args: { new_code: string }; Returns: string };
      regenerate_my_practice_code: { Args: Record<string, never>; Returns: string };
      coach_set_goals: {
        Args: {
          athlete: string;
          new_targets: AthleteProfileRow['targets'] | null;
          new_season_goal: AthleteProfileRow['season_goal'] | null;
        };
        Returns: undefined;
      };
      grant_trust_pass: {
        Args: { p_athlete: string; p_length?: number | null; p_min_on_standard?: number | null };
        Returns: string;
      };
      end_trust_pass: {
        Args: { p_athlete: string };
        Returns: undefined;
      };
    };
    Enums: {
      user_role: UserRole;
      org_type: OrgType;
      comp_mode: CompMode;
      link_status: LinkStatus;
      staff_role: StaffRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
}

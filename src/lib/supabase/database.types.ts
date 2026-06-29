// AthleteOS — Supabase schema types (hand-authored, mirrors supabase/migrations).
// Kept in sync with 0001_schema.sql / 0002_rls.sql. When the schema stabilizes,
// replace this file with `supabase gen types typescript` output — the shape is
// drop-in compatible with createClient<Database>.

export type UserRole = 'athlete' | 'parent' | 'coach' | 'trainer';
export type OrgType = 'school' | 'club' | 'independent';
export type CompMode = 'position' | 'team' | 'off';
export type LinkStatus = 'active' | 'invited' | 'removed';
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
 *  (service_role) at go-live; the owner reads their own row. Added in migration 0010. */
export type SubscriptionRow = {
  owner_id: string;
  tier: 'preview' | 'team';
  status: 'preview' | 'active' | 'past_due' | 'canceled';
  seats: number | null;
  seats_used: number | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  updated_at: string;
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
  targets: { protein?: number; calories?: number; weight?: number };
  season_goal: { start?: number; target?: number; deadline?: string };
  team_code: string | null;
  updated_at: string;
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
      days: Table<DayRow>;
      meals: Table<MealRow>;
      checkins: Table<CheckinRow>;
      team_members: Table<TeamMemberRow>;
      practice_clients: Table<PracticeClientRow>;
      subscriptions: Table<SubscriptionRow>;
      org_memberships: Table<OrgMembershipRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_team: {
        Args: { team_name: string; team_sport?: string | null };
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
      join_team: {
        Args: { code: string; athlete_position?: string | null };
        Returns: string;
      };
      join_practice: {
        Args: { code: string };
        Returns: string;
      };
      coach_set_goals: {
        Args: {
          athlete: string;
          new_targets: AthleteProfileRow['targets'] | null;
          new_season_goal: AthleteProfileRow['season_goal'] | null;
        };
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

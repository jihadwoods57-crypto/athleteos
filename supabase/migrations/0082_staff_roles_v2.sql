-- OnStandard — staff-role vocabulary v2 (part 1 of 2): add the three roles the onboarding
-- handoff calls for but the enum was missing — Strength & Conditioning, Athletic Trainer, and
-- Team Admin. Mirrors the 0077 split-file rule.
--
-- SPLIT-FILE RULE: ALTER TYPE ... ADD VALUE commits fine inside this migration's transaction,
-- but the new values cannot be REFERENCED until that transaction commits — so every function
-- whose allow-list must accept them (create_staff_invite, set_staff_role) lives in 0083, which
-- supabase db push runs as its own later transaction.
--
-- PERMISSIONS: these three are ordinary NON-readonly write staff (is_write_staff already covers
-- them — role <> 'readonly'), so no policy change is needed for them to assign/announce/message
-- within their scope. Finer per-role differences (e.g. Team Admin managing staff, category-level
-- visibility) arrive with the per-category permission model, not here.
--
-- GUARDRAIL: authored for founder review — apply with `supabase db push` then `npm run test:rls`
-- against a throwaway/local DB before go-live (same gate as 0080/0081).

alter type staff_role add value if not exists 's_and_c';
alter type staff_role add value if not exists 'athletic_trainer';
alter type staff_role add value if not exists 'team_admin';

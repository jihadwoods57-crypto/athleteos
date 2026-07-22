// Shared premium-unlock check for the paid report features (deep-analysis, monthly-report).
// Any ACTIVE paid subscription unlocks — reconciled from deep-analysis's old team-only check so an
// individual athlete's CONSUMER subscription (RevenueCat IAP) actually unlocks premium reports.
const FREE_TIERS = new Set(['', 'preview', 'free', 'none', 'trial_expired']);

export function isPremiumUnlocked(sub: { status?: string | null; tier?: string | null } | null): boolean {
  if (!sub) return false;
  const statusOk = sub.status === 'active' || sub.status === 'past_due';
  const tier = (sub.tier ?? '').toString().toLowerCase();
  return statusOk && tier !== '' && !FREE_TIERS.has(tier);
}

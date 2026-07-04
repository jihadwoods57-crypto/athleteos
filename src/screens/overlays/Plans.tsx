// OnStandard — Plans / checkout overlay (the compliant subscription flow).
// Built to the consumer-protection contract (docs/specs/2026-06-29-subscription-compliance.md):
// BEFORE any purchase it shows price, billing frequency, AUTO-RENEWAL, trial length, and how
// to cancel; the CTA carries the auto-renewal terms in its label; cancellation is one tap (the
// hosted billing portal / OS settings), no phone call. Role-aware: an athlete sees the
// Individual plans, a trainer the Professional plans, a coach/gym the Organization tiers.
//
// LIVE Stripe rail (revenue build 2026-07-04): business plans check out through
// billing-checkout (hosted Stripe page in the browser; no card data in the app) with
// ANNUAL as the highlighted default (2 months free, half the churn surface). Dunning
// (past_due) shows an update-your-card banner; the cancel path offers PAUSE first.
// Consumer IAP plans stay "available at launch" until the store build. When the billing
// backend isn't deployed yet, every CTA falls back to the honest preview copy.
import React from 'react';
import { ScrollView, View } from 'react-native';
import {
  isPro, needsBillingAttention, planTerms, plansForFlow, purchaseCtaLabelFor,
  cadencePriceParts, annualSavingsLine,
  type BillingCadence, type PricedPlan,
} from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { isBillingConfigured, openBillingPortal, startCheckout, type BillingFailure } from '@/lib/billing/portal';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

/** Whether the live Stripe checkout path is even possible in this build. */
const canCheckout = isBackendLive && isBillingConfigured;

export function Plans() {
  const c = useColors();
  const s = useStore();
  const plans = plansForFlow(s.flow);
  const onPaidPlan = isPro(s.entitlement);
  const [cadence, setCadence] = React.useState<BillingCadence>('annual');

  return (
    <Overlay title={onPaidPlan ? 'Your Plan' : 'Plans'} onClose={s.closePlans}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {needsBillingAttention(s.entitlement) ? <DunningBanner /> : null}
        {onPaidPlan ? <ManageCurrent /> : null}

        {!canCheckout ? (
          <Row style={{ gap: 7, marginBottom: 14 }}>
            <SampleTag />
            <Txt w="sb" size={12} color={c.textTertiary} style={{ flex: 1 }}>
              OnStandard is in free preview. These are launch prices — billing isn’t switched on yet.
            </Txt>
          </Row>
        ) : null}

        <CadenceToggle cadence={cadence} onChange={setCadence} />

        <Reveal index={0}>
        <View style={{ gap: 14 }}>
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} cadence={cadence} />
          ))}
        </View>
        </Reveal>

        <Txt w="m" size={11} color={c.textTertiary} style={{ marginTop: 18, lineHeight: 16 }}>
          Prices in USD. Subscriptions auto-renew until canceled; cancel anytime with no phone call.
          Active organization participants are billed by the organization — athletes never pay while
          attached to an active team.
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

/** Annual-first billing period selector. Annual is the default: it carries the honest
 *  saving line, but monthly is one tap away — a toggle, never a trick. */
function CadenceToggle({ cadence, onChange }: { cadence: BillingCadence; onChange: (c: BillingCadence) => void }) {
  const c = useColors();
  const opts: { key: BillingCadence; label: string; sub?: string }[] = [
    { key: 'annual', label: 'Annual', sub: '2 months free' },
    { key: 'monthly', label: 'Monthly' },
  ];
  return (
    <Row style={{ gap: 8, marginBottom: 14 }}>
      {opts.map((o) => {
        const on = cadence === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityLabel={`Bill ${o.label.toLowerCase()}`}
            accessibilityState={{ selected: on }}
            onPress={() => { haptics.tap(); onChange(o.key); }}
            style={({ pressed }) => [{
              flex: 1, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? c.accent : c.bg2,
              opacity: pressed ? 0.85 : 1,
            }]}
          >
            <Txt w="b" size={14} color={on ? c.white : c.slate700}>{o.label}</Txt>
            {o.sub ? <Txt w="sb" size={10.5} color={on ? c.white : c.textTertiary}>{o.sub}</Txt> : null}
          </Pressable>
        );
      })}
    </Row>
  );
}

/** Dunning: the card failed but access is riding the grace window. One honest line, one tap
 *  to the portal to fix the card. Shown before anything else on the screen. */
function DunningBanner() {
  const c = useColors();
  const s = useStore();
  const failedAt = s.entitlement.paymentFailedAt;
  const dateLine = failedAt ? ` on ${String(failedAt).slice(0, 10)}` : '';
  const onFix = async () => {
    haptics.tap();
    await openBillingPortal();
  };
  return (
    <Card variant="low" style={{ borderRadius: 16, marginBottom: 14, borderWidth: 1, borderColor: c.alertBorder }}>
      <Row style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="shield" size={16} color={c.alert} />
        <Txt w="sb" size={13} color={c.slate700} style={{ flex: 1, lineHeight: 18 }}>
          Your last payment didn’t go through{dateLine}. Your team still has access, but update
          your card soon to keep it.
        </Txt>
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update your card"
        onPress={onFix}
        style={({ pressed }) => [{ height: 44, borderRadius: 12, backgroundColor: c.alert, alignItems: 'center', justifyContent: 'center', marginTop: 12, opacity: pressed ? 0.85 : 1 }]}
      >
        <Txt w="b" size={14} color={c.white}>Update card</Txt>
      </Pressable>
    </Card>
  );
}

/** The current-plan management block for an owner already on a paid plan. Cancel is one tap
 *  away in the portal, but PAUSE is offered first — a break keeps the roster and the data. */
function ManageCurrent() {
  const c = useColors();
  const onManage = async () => {
    haptics.tap();
    await openBillingPortal();
  };
  return (
    <Card variant="hero" style={{ borderRadius: 20, marginBottom: 16 }}>
      <Txt w="eb" size={15} ls={-0.3}>You’re on a paid plan</Txt>
      <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
        Manage billing, change seats, or cancel anytime — no phone call, no runaround.
      </Txt>
      <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
        Need a break instead? You can pause your plan from billing — your roster, history, and
        settings all stay exactly as they are until you resume.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage, pause, or cancel your plan"
        onPress={onManage}
        style={({ pressed }) => [{ height: 50, borderRadius: 14, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', marginTop: 14, flexDirection: 'row', gap: 8, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name="settings" size={17} color={c.slate700} />
        <Txt w="b" size={14} color={c.slate700}>
          {canCheckout ? 'Manage / pause / cancel' : 'Manage plan (available at launch)'}
        </Txt>
      </Pressable>
    </Card>
  );
}

/** Post-tap footnote states for the checkout CTA. */
type CtaState = 'idle' | 'opening' | 'browser' | BillingFailure;

function PlanCard({ plan, cadence }: { plan: PricedPlan; cadence: BillingCadence }) {
  const c = useColors();
  const t = planTerms(plan);
  const price = cadencePriceParts(plan, cadence);
  const savings = cadence === 'annual' ? annualSavingsLine(plan) : '';
  const [state, setState] = React.useState<CtaState>('idle');

  // The live path: business (Stripe) plans open hosted Checkout in the browser; the
  // webhook flips the entitlement when payment lands. IAP consumer plans wait for the
  // store build. Anything unavailable falls to honest copy, never a dead button.
  const onStart = async () => {
    haptics.tap();
    if (canCheckout && plan.rail === 'stripe' && !plan.custom) {
      setState('opening');
      const res = await startCheckout(plan.id, cadence);
      setState(res.ok ? 'browser' : res.reason);
      return;
    }
    setState('not_available_yet');
  };

  const footnote = (() => {
    switch (state) {
      case 'idle':
      case 'opening':
        return null;
      case 'browser':
        return 'Finishing in your browser. Your plan unlocks here as soon as payment completes.';
      case 'sign_in_required':
        return 'Sign in to your account first, then start your plan.';
      case 'error':
        return 'Checkout didn’t open. Check your connection and try again.';
      case 'not_configured':
      case 'not_available_yet':
      default:
        return plan.custom
          ? 'Enterprise sales open at launch — we’ll add a contact form here.'
          : plan.rail === 'iap'
            ? 'This plan goes live with the App Store launch. Your terms above are exactly what you’ll see at checkout.'
            : 'Billing isn’t switched on yet — this plan goes live with the public launch. Your terms above are exactly what you’ll see at checkout.';
    }
  })();

  return (
    <Card variant="low" style={{ borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Txt w="eb" size={17} ls={-0.3}>{plan.name}</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>{plan.blurb}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {plan.custom ? (
            <Txt w="eb" size={18}>Custom</Txt>
          ) : (
            <>
              <Txt w="eb" num size={22} ls={-0.5}>{price.amount}</Txt>
              <Txt w="sb" size={12} color={c.textTertiary}>{price.per}</Txt>
              {savings ? <Txt w="sb" size={11} color={c.accent} style={{ marginTop: 2 }}>{savings}</Txt> : null}
            </>
          )}
        </View>
      </Row>

      {/* The compliant disclosure — shown BEFORE any purchase action. */}
      <View style={{ marginTop: 14, gap: 7, padding: 13, borderRadius: 13, backgroundColor: c.bg2 }}>
        <TermLine icon="bolt" text={cadence === 'annual' && !plan.custom ? 'Billed yearly, auto-renews until canceled.' : t.renewal} />
        {t.trial ? <TermLine icon="check" text={t.trial} /> : null}
        {cadence === 'monthly' && t.annual ? <TermLine icon="trophy" text={t.annual} /> : null}
        <TermLine icon="shield" text={t.cancellation} />
        {plan.seatLimit ? <TermLine icon="squad" text={`Up to ${plan.seatLimit} ${plan.audience === 'organization' ? 'active participants' : plan.audience === 'individual' ? 'athletes in your household' : 'active clients'}${plan.extraSeatMonthly ? `; $${plan.extraSeatMonthly}/mo each beyond` : ''}.`} /> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={purchaseCtaLabelFor(plan, cadence)}
        onPress={onStart}
        disabled={state === 'opening'}
        style={({ pressed }) => [{ height: 52, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: pressed || state === 'opening' ? 0.85 : 1 }, shadow.cta]}
      >
        <Txt w="b" size={15} color={c.white}>
          {state === 'opening' ? 'Opening secure checkout…' : purchaseCtaLabelFor(plan, cadence)}
        </Txt>
      </Pressable>
      {footnote ? (
        <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 10, textAlign: 'center', lineHeight: 17 }}>
          {footnote}
        </Txt>
      ) : null}
    </Card>
  );
}

function TermLine({ icon, text }: { icon: 'bolt' | 'check' | 'shield' | 'trophy' | 'squad'; text: string }) {
  const c = useColors();
  return (
    <Row style={{ gap: 8, alignItems: 'flex-start' }}>
      <Icon name={icon} size={14} color={c.textSecondary} />
      <Txt w="sb" size={12} color={c.slate700} style={{ flex: 1, lineHeight: 17 }}>{text}</Txt>
    </Row>
  );
}

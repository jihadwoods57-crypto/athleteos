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
import { isBillingConfigured, isCheckoutLive, openBillingPortal, startCheckout, type BillingFailure } from '@/lib/billing/portal';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon, IconName } from '@/icons';
import { Overlay } from './Overlay';

/** Whether the live Stripe checkout path is even possible in this build. `isCheckoutLive` is an
 *  explicit off-by-default kill-switch so App Store review can never reach an external purchase
 *  flow (Guideline 3.1.1) — see EXPO_PUBLIC_BILLING_CHECKOUT_LIVE in lib/billing/portal.ts. */
const canCheckout = isBackendLive && isBillingConfigured && isCheckoutLive;

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
          <Row style={{ gap: 9, marginBottom: 16, alignItems: 'flex-start', padding: 13, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
            <SampleTag />
            <Txt w="sb" size={12} color={c.textSecondary} style={{ flex: 1, lineHeight: 17 }}>
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

        <Row style={{ gap: 8, alignItems: 'flex-start', marginTop: 20 }}>
          <Icon name="shield" size={14} color={c.textTertiary} />
          <Txt w="m" size={11} color={c.textTertiary} style={{ flex: 1, lineHeight: 16 }}>
            Prices in USD. Subscriptions auto-renew until canceled; cancel anytime with no phone call.
            Active organization participants are billed by the organization — athletes never pay while
            attached to an active team.
          </Txt>
        </Row>
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
    <Row style={{ gap: 6, marginBottom: 16, backgroundColor: c.surface2, borderRadius: 15, padding: 5, borderWidth: 1, borderColor: c.hairline }}>
      {opts.map((o) => {
        const on = cadence === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityLabel={`Bill ${o.label.toLowerCase()}`}
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={() => { haptics.tap(); onChange(o.key); }}
            style={({ pressed }) => [{
              flex: 1, minHeight: 44, paddingVertical: 8, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? c.accent : 'transparent',
              opacity: pressed ? 0.85 : 1,
            }, on ? shadow.cta : null]}
          >
            <Txt w="b" size={14} color={on ? c.white : c.slate700}>{o.label}</Txt>
            {o.sub ? <Txt w="sb" size={10.5} color={on ? c.white : c.accent} style={{ marginTop: 1 }}>{o.sub}</Txt> : null}
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
    <View style={{ borderRadius: 18, marginBottom: 14, padding: 16, backgroundColor: c.alertSurface, borderWidth: 1, borderColor: c.alertBorder }}>
      <Row style={{ gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="shield" size={18} color={c.alert} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={11} color={c.alertDeep} ls={0.5}>PAYMENT NEEDS ATTENTION</Txt>
          <Txt w="sb" size={13} color={c.slate700} style={{ marginTop: 4, lineHeight: 18 }}>
            Your last payment didn’t go through{dateLine}. Your team still has access, but update
            your card soon to keep it.
          </Txt>
        </View>
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update your card"
        onPress={onFix}
        style={({ pressed }) => [{ minHeight: 46, paddingVertical: 8, borderRadius: 13, backgroundColor: c.alert, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: pressed ? 0.85 : 1 }]}
      >
        <Txt w="b" size={14} color={c.white}>Update card</Txt>
      </Pressable>
    </View>
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
    <Card variant="hero" style={{ borderRadius: 22, marginBottom: 16, padding: 20 }}>
      <Row style={{ gap: 11, alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.successSurface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={22} color={c.successDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={11} color={c.successDeep} ls={0.6}>ACTIVE PLAN</Txt>
          <Txt w="eb" size={16} ls={-0.3} style={{ marginTop: 3 }}>You’re on a paid plan</Txt>
        </View>
      </Row>
      <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 12, lineHeight: 19 }}>
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
        style={({ pressed }) => [{ minHeight: 50, paddingVertical: 8, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', marginTop: 16, flexDirection: 'row', gap: 8, opacity: pressed ? 0.8 : 1 }]}
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
    <Card variant="low" style={{ borderRadius: 22, padding: 20 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt w="eb" size={17} ls={-0.3}>{plan.name}</Txt>
          <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 4, lineHeight: 18 }}>{plan.blurb}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {plan.custom ? (
            <Txt w="eb" size={19} ls={-0.4}>Custom</Txt>
          ) : (
            <>
              <Row style={{ alignItems: 'baseline', gap: 3 }}>
                <Txt w="eb" num size={26} ls={-0.6}>{price.amount}</Txt>
                <Txt w="sb" size={12} color={c.textTertiary}>{price.per}</Txt>
              </Row>
              {savings ? (
                <View style={{ marginTop: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
                  <Txt w="eb" size={10.5} color={c.accent} ls={0.2}>{savings}</Txt>
                </View>
              ) : null}
            </>
          )}
        </View>
      </Row>

      {/* The compliant disclosure — shown BEFORE any purchase action. */}
      <View style={{ marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
        <Txt w="eb" size={10.5} color={c.textTertiary} ls={0.7} style={{ marginBottom: 10 }}>YOUR TERMS</Txt>
        <View style={{ gap: 9 }}>
          <TermLine icon="bolt" text={cadence === 'annual' && !plan.custom ? 'Billed yearly, auto-renews until canceled.' : t.renewal} />
          {t.trial ? <TermLine icon="check" text={t.trial} /> : null}
          {cadence === 'monthly' && t.annual ? <TermLine icon="trophy" text={t.annual} /> : null}
          <TermLine icon="shield" text={t.cancellation} />
          {plan.seatLimit ? <TermLine icon="squad" text={`Up to ${plan.seatLimit} ${plan.audience === 'organization' ? 'active participants' : plan.audience === 'individual' ? 'athletes in your household' : 'active clients'}${plan.extraSeatMonthly ? `; $${plan.extraSeatMonthly}/mo each beyond` : ''}.`} /> : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={purchaseCtaLabelFor(plan, cadence)}
        onPress={onStart}
        disabled={state === 'opening'}
        style={({ pressed }) => [{ minHeight: 54, paddingVertical: 8, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16, opacity: pressed || state === 'opening' ? 0.85 : 1 }, shadow.cta]}
      >
        <Txt w="b" size={15} color={c.white} style={{ textAlign: 'center', paddingHorizontal: 14, lineHeight: 20 }}>
          {state === 'opening' ? 'Opening secure checkout…' : purchaseCtaLabelFor(plan, cadence)}
        </Txt>
      </Pressable>
      {footnote ? (
        <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 12, textAlign: 'center', lineHeight: 17 }}>
          {footnote}
        </Txt>
      ) : null}
    </Card>
  );
}

function TermLine({ icon, text }: { icon: IconName; text: string }) {
  const c = useColors();
  return (
    <Row style={{ gap: 10, alignItems: 'flex-start' }}>
      <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center', marginTop: 0 }}>
        <Icon name={icon} size={13} color={c.accent} />
      </View>
      <Txt w="sb" size={12} color={c.slate700} style={{ flex: 1, lineHeight: 18, paddingTop: 3 }}>{text}</Txt>
    </Row>
  );
}

// OnStandard — Plans / checkout overlay (the compliant subscription flow).
// Built to the consumer-protection contract (docs/specs/2026-06-29-subscription-compliance.md):
// BEFORE any purchase it shows price, billing frequency, AUTO-RENEWAL, trial length, and how
// to cancel; the CTA carries the auto-renewal terms in its label; cancellation is one tap (the
// hosted billing portal / OS settings), no phone call. Role-aware: an athlete sees the
// Individual plans, a trainer the Professional plans, a coach/gym the Organization tiers.
//
// INERT until billing is switched on: with no Stripe portal / IAP wired the CTA shows
// "Available at launch" — the terms still display, so the screen is honest and compliant
// either way. Reads the pure pricing catalog (src/core/pricing.ts) — prices are data.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { isPro, planTerms, plansForFlow, purchaseCtaLabel, type PricedPlan } from '@/core';
import { useStore } from '@/store';
import { isBackendLive } from '@/lib/supabase';
import { isBillingConfigured, openBillingPortal } from '@/lib/billing/portal';
import { colors, shadow } from '@/ui/tokens';
import { Card, Reveal, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

export function Plans() {
  const s = useStore();
  const plans = plansForFlow(s.flow);
  const onPaidPlan = isPro(s.entitlement);

  return (
    <Overlay title={onPaidPlan ? 'Your Plan' : 'Plans'} onClose={s.closePlans}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {onPaidPlan ? <ManageCurrent /> : null}

        {!isBillingConfigured ? (
          <Row style={{ gap: 7, marginBottom: 14 }}>
            <SampleTag />
            <Txt w="sb" size={12} color={colors.textTertiary} style={{ flex: 1 }}>
              OnStandard is in free preview. These are launch prices — billing isn’t switched on yet.
            </Txt>
          </Row>
        ) : null}

        <Reveal index={0}>
        <View style={{ gap: 14 }}>
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </View>
        </Reveal>

        <Txt w="m" size={11} color={colors.textTertiary} style={{ marginTop: 18, lineHeight: 16 }}>
          Prices in USD. Subscriptions auto-renew until canceled; cancel anytime with no phone call.
          Active organization participants are billed by the organization — athletes never pay while
          attached to an active team.
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

/** The current-plan management block for an athlete/org already on a paid plan. */
function ManageCurrent() {
  const onManage = async () => {
    haptics.tap();
    await openBillingPortal();
  };
  return (
    <Card variant="hero" style={{ borderRadius: 20, marginBottom: 16 }}>
      <Txt w="eb" size={15} ls={-0.3}>You’re on a paid plan</Txt>
      <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
        Manage billing, change seats, or cancel anytime — no phone call, no runaround.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage or cancel your plan"
        onPress={onManage}
        style={({ pressed }) => [{ height: 50, borderRadius: 14, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center', marginTop: 14, flexDirection: 'row', gap: 8, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name="settings" size={17} color={colors.slate700} />
        <Txt w="b" size={14} color={colors.slate700}>
          {isBillingConfigured ? 'Manage / cancel plan' : 'Manage plan (available at launch)'}
        </Txt>
      </Pressable>
    </Card>
  );
}

function PlanCard({ plan }: { plan: PricedPlan }) {
  const t = planTerms(plan);
  const [tapped, setTapped] = React.useState(false);
  // The seam: a live Stripe portal (business plans) opens it; otherwise honest "available
  // at launch". Consumer IAP is wired at go-live; both keep the terms visible up front.
  const onStart = async () => {
    haptics.tap();
    if (isBackendLive && isBillingConfigured && plan.rail === 'stripe') {
      await openBillingPortal();
      return;
    }
    setTapped(true);
  };

  return (
    <Card variant="low" style={{ borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Txt w="eb" size={17} ls={-0.3}>{plan.name}</Txt>
          <Txt w="m" size={13} color={colors.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>{plan.blurb}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {plan.custom ? (
            <Txt w="eb" size={18}>Custom</Txt>
          ) : (
            <>
              <Txt w="eb" num size={22} ls={-0.5}>{t.price.split(' / ')[0]}</Txt>
              <Txt w="sb" size={12} color={colors.textTertiary}>/ month</Txt>
            </>
          )}
        </View>
      </Row>

      {/* The compliant disclosure — shown BEFORE any purchase action. */}
      <View style={{ marginTop: 14, gap: 7, padding: 13, borderRadius: 13, backgroundColor: colors.bg2 }}>
        <TermLine icon="bolt" text={t.renewal} />
        {t.trial ? <TermLine icon="check" text={t.trial} /> : null}
        {t.annual ? <TermLine icon="trophy" text={t.annual} /> : null}
        <TermLine icon="shield" text={t.cancellation} />
        {plan.seatLimit ? <TermLine icon="squad" text={`Up to ${plan.seatLimit} active ${plan.audience === 'organization' ? 'participants' : 'clients'}${plan.extraSeatMonthly ? `; $${plan.extraSeatMonthly}/mo each beyond` : ''}.`} /> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={purchaseCtaLabel(plan)}
        onPress={onStart}
        style={({ pressed }) => [{ height: 52, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: pressed ? 0.85 : 1 }, shadow.cta]}
      >
        <Txt w="b" size={15} color="#fff">{purchaseCtaLabel(plan)}</Txt>
      </Pressable>
      {tapped ? (
        <Txt w="sb" size={12} color={colors.textTertiary} style={{ marginTop: 10, textAlign: 'center', lineHeight: 17 }}>
          {plan.custom
            ? 'Enterprise sales open at launch — we’ll add a contact form here.'
            : 'Billing isn’t switched on yet — this plan goes live with the public launch. Your terms above are exactly what you’ll see at checkout.'}
        </Txt>
      ) : null}
    </Card>
  );
}

function TermLine({ icon, text }: { icon: 'bolt' | 'check' | 'shield' | 'trophy' | 'squad'; text: string }) {
  return (
    <Row style={{ gap: 8, alignItems: 'flex-start' }}>
      <Icon name={icon} size={14} color={colors.textSecondary} />
      <Txt w="sb" size={12} color={colors.slate700} style={{ flex: 1, lineHeight: 17 }}>{text}</Txt>
    </Row>
  );
}

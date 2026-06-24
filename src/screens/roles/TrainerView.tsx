// AthleteOS — Trainer mobile view: multi-org client book, KPIs, book-compliance
// trend, needs-follow-up nudges, AI practice summary.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { ORG_COLORS, TRAINER_CLIENTS, gradeFor, initials, needsAttention, rankByRisk, trainerBookKpis, trainerLens } from '@/core';
import { useStore } from '@/store';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, SampleTag, Txt, Pressable } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Account } from '@/screens/overlays/Account';
import { Messages } from '@/screens/overlays/Messages';
import { PersonDetail } from '@/screens/overlays/PersonDetail';

export function TrainerView() {
  const s = useStore();
  const kpis = trainerBookKpis(TRAINER_CLIENTS);
  // Needs-Follow-Up derives from the same book the FOLLOW-UPS KPI counts, so the
  // badge count always equals the rows shown and only REAL clients can appear
  // (the old list hand-named a client who was not in the book at all).
  const followUps = needsAttention(TRAINER_CLIENTS);
  // Header identity: the seeded demo keeps the showcase gym + "MA"; a real trainer
  // gets a neutral practice label (no business name is collected) and their own
  // initials, so neither leaks another trainer's brand.
  const isReal = s.athleteName.trim().length > 0;
  // A nutritionist rides this same dashboard but through a nutrition lens (header,
  // compliance card, and empty state), consistent with the Account "nutrition
  // clients" copy; a personal trainer keeps the generic book framing.
  const lens = trainerLens(s.role, isReal);
  const orgTitle = lens.orgTitle;
  const monogram = initials(s.athleteName, 'MA');
  const clientByName: Record<string, (typeof TRAINER_CLIENTS)[number]> = Object.fromEntries(
    TRAINER_CLIENTS.map((c) => [c.name, c]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Account & settings" hitSlop={6} onPress={s.openAccount} style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}>
                <Icon name="menu" size={20} color={colors.slate600} />
              </Pressable>
              <View>
                <Txt w="sb" size={13} color={colors.textSecondary}>
                  {orgTitle}
                </Txt>
                <Txt w="eb" size={21} ls={-0.3}>
                  {lens.headerTitle}
                </Txt>
                <Row style={{ gap: 7, marginTop: 5 }}>
                  <SampleTag />
                  <Txt w="sb" size={12} color={colors.textTertiary}>
                    Demo book, not your real clients
                  </Txt>
                </Row>
              </View>
            </Row>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: colors.trainer, alignItems: 'center', justifyContent: 'center' }}>
              <Txt w="b" size={15} color="#fff">
                {monogram}
              </Txt>
            </View>
          </Row>

          <Row style={{ gap: 10, marginTop: 20 }}>
            <Kpi value={String(kpis.clients)} label="CLIENTS" />
            <Kpi value={`${kpis.avgCompliance}%`} label="AVG COMPLY" />
            <Kpi value="92%" label="RETENTION" color={colors.success} sample />
          </Row>

          {/* book compliance trend */}
          <Card elevated style={{ marginTop: 14, borderRadius: 20 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Row style={{ gap: 8 }}>
                  <Txt w="eb" size={15} ls={-0.3}>
                    {lens.complianceTitle}
                  </Txt>
                  <SampleTag />
                </Row>
                <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 3 }}>
                  All clients · 8-week average
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt w="eb" size={22}>
                  {kpis.avgCompliance}%
                </Txt>
                <Txt w="b" size={12} color={colors.success}>
                  ↑ +6%
                </Txt>
              </View>
            </Row>
            <Svg viewBox="0 0 322 96" width="100%" height={92} preserveAspectRatio="none" style={{ marginTop: 6 }}>
              <Defs>
                <LinearGradient id="tbc" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#2563EB" stopOpacity="0.16" />
                  <Stop offset="1" stopColor="#2563EB" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40 L310,96 L12,96 Z" fill="url(#tbc)" />
              <Path d="M12,70 L62,66 L111,68 L161,58 L211,52 L260,46 L310,40" fill="none" stroke="#2563EB" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={310} cy={40} r={5.5} fill="#2563EB" stroke="#fff" strokeWidth={2.5} />
            </Svg>
          </Card>

          {/* needs follow-up */}
          {followUps.length > 0 ? (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.alertSurface, borderWidth: 1, borderColor: colors.alertBorder }}>
              <Row style={{ gap: 8, marginBottom: 13 }}>
                <Txt w="eb" size={12} color={colors.alertDeep} ls={0.7}>
                  NEEDS FOLLOW-UP
                </Txt>
                <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                  <Txt w="eb" size={11} color={colors.alertDeep}>
                    {followUps.length}
                  </Txt>
                </View>
              </Row>
              {followUps.map((a, i) => {
                const c = clientByName[a.name];
                const org = (c && ORG_COLORS[c.org]) ?? ORG_COLORS.Independent;
                return (
                  <FollowUp
                    key={a.name}
                    initials={c?.initials ?? a.name.slice(0, 2).toUpperCase()}
                    iconBg={org.bg}
                    iconColor={org.c}
                    name={a.name}
                    meta={a.reason}
                    score={a.score}
                    color={a.tone === 'alert' ? colors.alert : colors.warning}
                    nudged={s.nudged.includes(a.name)}
                    onNudge={() => { haptics.success(); s.sendNudge(a.name, { score: a.score, comp: a.comp }); }}
                    onView={() => s.openPerson({ name: a.name, initials: c?.initials ?? a.name.slice(0, 2).toUpperCase(), pos: c?.sport ?? '', org: c?.org, score: a.score, comp: a.comp, last: c?.last })}
                    last={i === followUps.length - 1}
                  />
                );
              })}
            </View>
          ) : (
            <View style={{ marginTop: 14, borderRadius: 20, padding: 18, backgroundColor: colors.successSurface }}>
              <Txt w="eb" size={12} color={colors.successDeep} ls={0.7} style={{ marginBottom: 6 }}>
                NEEDS FOLLOW-UP
              </Txt>
              <Txt w="sb" size={14} color={colors.slate700} style={{ lineHeight: 20 }}>
                {lens.allClearLine}
              </Txt>
            </View>
          )}

          {/* all clients */}
          <Row style={{ justifyContent: 'space-between', marginTop: 22, marginBottom: 12, marginHorizontal: 4 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              All Clients
            </Txt>
            <Txt w="b" size={13} color={colors.textTertiary}>
              {kpis.clients} active
            </Txt>
          </Row>
          <View style={{ gap: 8 }}>
            {rankByRisk(TRAINER_CLIENTS).map((c) => {
              const g = gradeFor(c.score);
              const org = ORG_COLORS[c.org] ?? ORG_COLORS.Independent;
              return (
                <Pressable
                  key={c.name}
                  onPress={() => s.openPerson({ name: c.name, initials: c.initials, pos: c.sport, score: c.score, org: c.org, comp: c.comp, last: c.last })}
                  style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14 }, shadow.card]}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
                    <Txt w="b" size={13} color={colors.slate600}>
                      {c.initials}
                    </Txt>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt w="b" size={14}>
                      {c.name}
                    </Txt>
                    <Row style={{ gap: 7, marginTop: 4 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7, backgroundColor: org.bg }}>
                        <Txt w="b" size={11} color={org.c}>
                          {c.org}
                        </Txt>
                      </View>
                      <Txt w="sb" size={12} color={colors.textTertiary}>
                        {c.comp}% · {c.last}
                      </Txt>
                    </Row>
                  </View>
                  <Txt w="eb" size={18} style={{ width: 30, textAlign: 'right' }}>
                    {c.score}
                  </Txt>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: g.bg }}>
                    <Txt w="eb" size={12} color={g.c}>
                      {g.g}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Card elevated style={{ marginTop: 16, borderRadius: 20 }}>
            <Row style={{ gap: 9, marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={17} color={colors.accent} />
              </View>
              <Txt w="eb" size={12} color={colors.accent} ls={0.4}>
                AI PRACTICE SUMMARY
              </Txt>
              <SampleTag />
            </Row>
            <Txt w="m" size={14} color={colors.slate700} style={{ lineHeight: 22 }}>
              Your book is healthy: {kpis.avgCompliance}% average compliance, up 6% this month.{' '}
              {followUps.length === 0
                ? 'No clients are at risk right now, so keep the momentum with the steady ones.'
                : `${followUps.length === 1 ? '1 client is a retention risk' : `${followUps.length} clients are retention risks`}: ${followUps.map((a) => a.name).join(', ')}. A nudge today usually recovers 70% of at-risk clients before they churn.`}
            </Txt>
          </Card>
        </ScrollView>
      </SafeAreaView>

      {s.personDetail && <PersonDetail />}
      {s.msgOpen && <Messages />}
      {s.accountOpen && <Account />}
    </View>
  );
}

function Kpi({ value, label, color, sample }: { value: string; label: string; color?: string; sample?: boolean }) {
  return (
    <Card style={{ flex: 1, borderRadius: 18, padding: 16 }}>
      <Txt w="eb" size={28} color={color}>
        {value}
      </Txt>
      <Txt w="b" size={11} color={colors.textTertiary} style={{ marginTop: 3 }}>
        {label}
      </Txt>
      {sample ? <SampleTag style={{ marginTop: 7 }} /> : null}
    </Card>
  );
}

function FollowUp({ initials, iconBg, iconColor, name, meta, score, color, nudged, onNudge, onView, last }: { initials: string; iconBg?: string; iconColor?: string; name: string; meta: string; score: number; color: string; nudged: boolean; onNudge: () => void; onView: () => void; last?: boolean }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: last ? 0 : 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 11, flex: 1 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconBg ?? colors.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={12} color={iconColor ?? colors.slate600}>
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="b" size={14}>
              {name}
            </Txt>
            <Txt w="sb" size={12} color={colors.alertDeep}>
              {meta}
            </Txt>
          </View>
        </Row>
        <Txt w="eb" size={18} color={color}>
          {score}
        </Txt>
      </Row>
      <Row style={{ gap: 8, marginTop: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nudged ? `Nudge sent to ${name}` : `Send a nudge to ${name}`}
          accessibilityState={{ disabled: nudged }}
          disabled={nudged}
          onPress={onNudge}
          style={({ pressed }) => ({ flex: 1, height: 34, borderRadius: 9, backgroundColor: nudged ? colors.successSurface : colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, opacity: pressed ? 0.85 : 1 })}
        >
          {nudged ? <Icon name="check" size={14} color={colors.successDeep} /> : null}
          <Txt w="b" size={12} color={nudged ? colors.successDeep : '#fff'}>
            {nudged ? 'Nudged' : 'Send nudge'}
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${name}`}
          onPress={() => { haptics.tap(); onView(); }}
          style={({ pressed }) => ({ flex: 1, height: 34, borderRadius: 9, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Txt w="b" size={12} color={colors.slate700}>
            View
          </Txt>
        </Pressable>
      </Row>
    </View>
  );
}

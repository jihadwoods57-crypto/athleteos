// OnStandard — the Assistant Nutritionist surface (revenue/retention build 2026-07-04).
//
// The coach/trainer dashboard is a BRIEFING, not an inspection: the assistant already
// reviewed every athlete and opens with what matters. This file is the shared surface both
// role views render:
//   * AssistantBriefCard — the editorial brief (deterministic text always; the AI narration,
//     cached once per day, only swaps the PHRASING), with a quiet "last checked" line.
//   * TriageQueue        — "handle these today": at-risk entries with evidence + a one-tap
//     ready message, and the PRAISE lane (blue temperature) for earned recognition.
//   * AssistantKpiStrip  — the demoted metrics, one quiet strip under the brief.
//   * AssistantUpgradeCard — the honest locked state when the paywall flag is on and the
//     account lacks the 'assistant' entitlement: the real review line shows (real value,
//     really computed), the assistant's work is what upgrading unlocks.
//
// Honesty: narration runs only over a LIVE roster (never the seeded demo), and every fact in
// it ships from core/assistantBrief — the model can rephrase, never add.
import React from 'react';
import { View } from 'react-native';
import {
  hasFeature, todayStamp,
  type AssistantBrief, type BriefAction,
} from '@/core';
import { useStore } from '@/store';
import { isAssistConfigured, narrateDailyBrief } from '@/lib/ai/assist';
import { isAssistantGateEnabled } from '@/lib/features';
import { useColors } from '@/ui/theme';
import { Card, Pressable, Row, SampleTag, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';

/** Whether this account's assistant layer is unlocked. The paywall engages only once the
 *  founder flips the gate flag at go-live; until then the beta stays all-on. */
export function useAssistantUnlocked(): boolean {
  const entitlement = useStore((s) => s.entitlement);
  if (!isAssistantGateEnabled) return true;
  return hasFeature(entitlement, 'assistant');
}

/** "6:12 AM" style label for the brief's authorship line. */
function timeLabel(d = new Date()): string {
  const h = d.getHours();
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Relative "last checked" read from the previous dashboard open. Honest: it reports when
 *  the coach last looked, never a fabricated "what changed" count. */
export function lastLookedLine(prevIso: string | null): string | null {
  if (!prevIso) return null;
  const ms = Date.now() - new Date(prevIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return null; // just re-opened; say nothing
  if (mins < 60) return `You last checked ${mins} minutes ago.`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `You last checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago.`;
  const days = Math.round(hours / 24);
  return `You last checked ${days} days ago.`;
}

/**
 * The brief, editorial-first: a quiet authorship eyebrow, then prose that breathes. On a
 * live roster with AI configured, the narration (cached once per day in the store) replaces
 * the deterministic phrasing when it lands; the facts are identical by construction.
 */
export function AssistantBriefCard({ brief, live }: { brief: AssistantBrief; live: boolean }) {
  const c = useColors();
  const s = useStore();

  // Stamp "the coach looked" once per mount (two-slot dance: prev <- last <- now).
  React.useEffect(() => {
    s.stampDashboardOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per dashboard mount
  }, []);

  // Narrate once per day, live rosters only, and only when there's something to say.
  const today = todayStamp();
  const cached = s.briefNarration;
  React.useEffect(() => {
    if (!live || !isAssistConfigured || brief.kpis.total === 0) return;
    if (cached?.date === today) return;
    let cancelled = false;
    void narrateDailyBrief(brief.narrationData, brief.directive).then((text) => {
      if (!cancelled && text) s.setBriefNarration(today, text);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by day, not by every brief recompute
  }, [live, today]);

  const text = live && cached?.date === today ? cached.text : brief.text;
  const since = lastLookedLine(s.prevDashboardOpenedAt);

  return (
    <View style={{ marginTop: 20 }}>
      <Row style={{ gap: 9, alignItems: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={14} color={c.accent} />
        </View>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.8}>ASSISTANT NUTRITIONIST · {timeLabel()}</Txt>
        {!live ? <SampleTag /> : null}
      </Row>
      <Txt w="sb" size={16} color={c.text} style={{ marginTop: 12, lineHeight: 25, letterSpacing: -0.2 }}>
        {text}
      </Txt>
      {since ? (
        <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 8 }}>{since}</Txt>
      ) : null}
    </View>
  );
}

/** The demoted metric strip: four quiet stat tiles of evidence under the brief. Framed
 *  hairline tiles on the dark canvas — evidence, not a headline. */
export function AssistantKpiStrip({ brief, noun }: { brief: AssistantBrief; noun: string }) {
  const c = useColors();
  const k = brief.kpis;
  if (k.total === 0) return null;
  const singular = noun.replace(/s$/, '');
  const stats: { value: string; label: string; tone?: string }[] = [
    { value: String(k.avgScore), label: 'TEAM AVG' },
    { value: `${k.compliance}%`, label: 'ON PLAN' },
    { value: String(k.alerts), label: k.alerts === 1 ? 'ALERT' : 'ALERTS', tone: k.alerts > 0 ? c.alert : undefined },
    { value: String(k.total), label: (k.total === 1 ? singular : noun).toUpperCase() },
  ];
  return (
    <Row
      accessibilityRole="text"
      accessibilityLabel={`Team ${k.avgScore}, ${k.compliance} percent on plan, ${k.alerts} ${k.alerts === 1 ? 'alert' : 'alerts'}, ${k.total} ${k.total === 1 ? singular : noun}`}
      style={{ gap: 8, marginTop: 16 }}
    >
      {stats.map((st) => (
        <View
          key={st.label}
          style={{ flex: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 14, paddingVertical: 12, alignItems: 'center' }}
        >
          <Txt w="eb" num size={19} color={st.tone ?? c.text}>{st.value}</Txt>
          <Txt w="b" size={9.5} color={c.textTertiary} ls={0.4} style={{ marginTop: 3 }}>{st.label}</Txt>
        </View>
      ))}
    </Row>
  );
}

/** One triage entry: evidence + the one-tap action. Urgent entries sit on the alert
 *  temperature, praise on the positive one — the state of the room reads in color first. */
function TriageRow({ action, sent, onAct, onOpen }: {
  action: BriefAction;
  sent: boolean;
  onAct: () => void;
  onOpen: () => void;
}) {
  const c = useColors();
  const praise = action.tone === 'praise';
  const surface = praise ? c.successSurface : c.alertSurface;
  const border = praise ? c.successBorderSoft : c.alertBorder;
  const accent = praise ? c.successDeep : action.tone === 'alert' ? c.alert : c.warning;
  return (
    <View style={{ borderRadius: 16, padding: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, marginTop: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${action.name}`} onPress={onOpen} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Row style={{ gap: 7, alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
              <Txt w="b" size={14.5}>{action.name}</Txt>
            </Row>
            <Txt w="sb" size={12.5} color={c.slate700} style={{ marginTop: 4, lineHeight: 18 }}>
              {action.reason}
            </Txt>
          </View>
          {/* Score chip in the row's temperature — the number reads as the same status the dot carries. */}
          <View style={{ minWidth: 40, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: border, alignItems: 'center' }}>
            <Txt w="eb" num size={16} color={accent}>{action.score}</Txt>
          </View>
        </Row>
      </Pressable>
      {sent ? (
        <Row style={{ gap: 6, marginTop: 12, alignItems: 'center' }}>
          <Icon name="check" size={13} color={c.successDeep} />
          <Txt w="b" size={12.5} color={c.successDeep}>{praise ? 'Recognized' : 'Message sent'}</Txt>
        </Row>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={praise ? `Recognize ${action.name}` : `Send ${action.name} the suggested message`}
          onPress={onAct}
          style={({ pressed }) => ({ marginTop: 12, height: 42, borderRadius: 12, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Txt w="b" size={13} color={c.white}>{praise ? 'Recognize' : 'Send the message'}</Txt>
        </Pressable>
      )}
    </View>
  );
}

/**
 * "Handle these today" — the triage queue the coach can clear, praise lane included.
 * Each action carries the assistant's ready message; one tap sends it (sendNudge: local
 * trail + real push when live). Clearing to zero is the daily win.
 */
export function TriageQueue({ brief, rosterMeta, viewAllCount, onViewAll }: {
  brief: AssistantBrief;
  rosterMeta: Record<string, { initials: string; pos: string; comp: number; athleteId?: string }>;
  /** Total at-risk beyond the queue (shows "view all N"), 0 to hide. */
  viewAllCount?: number;
  onViewAll?: () => void;
}) {
  const c = useColors();
  const s = useStore();
  const entries = [...brief.actions, ...brief.praise];
  if (entries.length === 0) {
    return (
      <View style={{ marginTop: 14, borderRadius: 16, padding: 16, backgroundColor: c.successSurface, borderWidth: 1, borderColor: c.successBorderSoft }}>
        <Row style={{ gap: 9, alignItems: 'center' }}>
          <Icon name="check" size={16} color={c.successDeep} />
          <Txt w="sb" size={13.5} color={c.slate700} style={{ flex: 1, lineHeight: 19 }}>
            Nothing to handle. Everyone is above the line right now.
          </Txt>
        </Row>
      </View>
    );
  }
  const openPerson = (a: BriefAction) => {
    const m = rosterMeta[a.name] ?? { initials: a.name.slice(0, 2).toUpperCase(), pos: '', comp: a.comp };
    s.openPerson({ name: a.name, initials: m.initials, pos: m.pos, score: a.score, comp: m.comp, athleteId: m.athleteId ?? a.athleteId });
  };
  return (
    <View style={{ marginTop: 12 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.7}>
          {brief.actions.length > 0
            ? `${brief.actions.length + brief.praise.length} ${brief.actions.length + brief.praise.length === 1 ? 'THING' : 'THINGS'} TO HANDLE TODAY`
            : 'WORTH A WORD'}
        </Txt>
        {viewAllCount && viewAllCount > brief.actions.length && onViewAll ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`View all ${viewAllCount} who need attention`} hitSlop={6} onPress={() => { haptics.tap(); onViewAll(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Txt w="b" size={12} color={c.accent}>View all {viewAllCount}</Txt>
          </Pressable>
        ) : null}
      </Row>
      {entries.map((a) => (
        <TriageRow
          key={`${a.kind}:${a.name}`}
          action={a}
          sent={s.nudged.includes(a.name)}
          onOpen={() => { haptics.tap(); openPerson(a); }}
          onAct={() => {
            haptics.success();
            s.sendNudge(
              a.name,
              { score: a.score, comp: a.comp },
              a.suggestion,
              rosterMeta[a.name]?.athleteId ?? a.athleteId,
              a.kind === 'recognize' ? 'A word from your coach' : undefined,
            );
          }}
        />
      ))}
    </View>
  );
}

/**
 * The honest locked state (paywall flag on, no 'assistant' entitlement): the review line is
 * REAL — the assistant genuinely ran — and what upgrading unlocks is its work product. No
 * blur tricks, no fake numbers; aspiration built from truth.
 */
export function AssistantUpgradeCard({ brief, noun }: { brief: AssistantBrief; noun: string }) {
  const c = useColors();
  const s = useStore();
  const k = brief.kpis;
  return (
    <Card variant="hero" style={{ marginTop: 14, borderRadius: 20 }}>
      <Row style={{ gap: 9, alignItems: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={14} color={c.accent} />
        </View>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.8}>ASSISTANT NUTRITIONIST</Txt>
      </Row>
      <Txt w="sb" size={15.5} style={{ marginTop: 12, lineHeight: 23 }}>
        {k.total === 0
          ? `Your assistant is ready. Add ${noun}s and it reviews every log, every day.`
          : `Reviewed all ${k.total} ${noun}${k.total === 1 ? '' : 's'} today. ${k.alerts > 0 ? `${k.alerts} need${k.alerts === 1 ? 's' : ''} your attention, and the evidence and ready-to-send messages are waiting.` : 'The full read, flags, and ready-to-send messages are waiting.'}`}
      </Txt>
      <Txt w="m" size={13} color={c.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
        Unlock the daily brief, who-needs-you flags with evidence, one-tap suggested messages,
        Ask-AI about your roster, the weekly digest, and report exports.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Unlock the Assistant Nutritionist"
        onPress={() => { haptics.tap(); s.openPlans(); }}
        style={({ pressed }) => ({ height: 50, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: pressed ? 0.85 : 1 })}
      >
        <Txt w="b" size={14.5} color={c.white}>Unlock the Assistant Nutritionist</Txt>
      </Pressable>
    </Card>
  );
}

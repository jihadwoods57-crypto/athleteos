// AthleteOS — Nutrition Memory overlay. The differentiator surface: longitudinal insights
// the AthleteOS remembers from logged history ("breakfast protein 18g → 37g", "dinner keeps
// slipping", "your go-to meal"). Every line is COMPUTED from real data by core/nutritionMemory;
// this only paints what the engine returns. Until there's enough real history it shows the
// tagged sample seed (honest: a Sample chip), and the label flips from "Coach memory" to
// "Remembered by AI" automatically the day a model does the phrasing.
import React from 'react';
import { ScrollView, View } from 'react-native';
import type { MemoryInsight, MemoryTone } from '@/core';
import { useStore, useNutritionMemory } from '@/store';
import { aiMemoryTag, isAiConfigured, rephraseMemoryInsights } from '@/lib/ai';
import { colors, shadow } from '@/ui/tokens';
import { Card, Row, SampleTag, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

const TONE: Record<MemoryTone, { bg: string; fg: string; bar: string }> = {
  win: { bg: colors.successSurface, fg: colors.successDeep, bar: colors.successDeep },
  watch: { bg: '#FEF3C7', fg: colors.warningDeep, bar: colors.warningDeep },
  neutral: { bg: colors.accentSurface, fg: colors.accent, bar: colors.accent },
};

export function NutritionMemory() {
  const s = useStore();
  const { insights, sampled, readiness } = useNutritionMemory();
  // "Remembered by AI": the deterministic insights render instantly (ground truth). When a model
  // is configured, ask it to reword them in a warmer voice and swap the warmed text in when it
  // arrives. The core voice guard keeps every number exactly the engine's, so this only ever
  // changes wording. Inert without a backend (the effect early-returns), and any failure simply
  // leaves the deterministic text on screen — the surface never blanks or blocks on AI.
  const display = useRephrasedMemory(insights);

  return (
    <Overlay title="Nutrition Memory" onClose={s.closeNutritionMemory} right={sampled ? <SampleTag /> : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* what this is */}
        <Card elevated style={{ borderRadius: 22, marginTop: 4 }}>
          <Row style={{ gap: 9 }}>
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={16} color={colors.accent} />
            </View>
            <Txt w="eb" size={12} color={colors.accent} ls={0.6}>{aiMemoryTag.toUpperCase()}</Txt>
          </Row>
          <Txt w="sb" size={16} color={colors.slate700} style={{ marginTop: 12, lineHeight: 23 }}>
            This is what AthleteOS remembers about how you eat — not just today's meal, but how
            your habits are moving over time.
          </Txt>
          {sampled ? (
            <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 10, lineHeight: 17 }}>
              This is a sample so you can see how it works. Your real memory builds as you log —
              every meal makes it sharper.
            </Txt>
          ) : null}
        </Card>

        {/* the remembered insights */}
        <View style={{ marginTop: 14, gap: 12 }}>
          {display.map((it) => <InsightCard key={it.id} insight={it} />)}
        </View>

        {/* honest provenance + readiness */}
        <Txt w="m" size={12} color={colors.textTertiary} style={{ marginTop: 18, paddingHorizontal: 4, lineHeight: 17 }}>
          {sampled
            ? 'Sample shown. Once you have logged a few days, this fills in with your own trends, streaks, and go-to meals.'
            : `Built from your logged history${readiness.daysLogged ? ` — ${readiness.daysLogged} day${readiness.daysLogged === 1 ? '' : 's'} so far` : ''}. The more you log, the more it remembers.`}
        </Txt>
      </ScrollView>
    </Overlay>
  );
}

/**
 * Returns the insights to render: the deterministic ones immediately, replaced by the AI-warmed
 * wording once it resolves (when a model is configured). The deterministic list is always the
 * fallback. Guards against races (a stale rephrase from a previous input never lands) and is a
 * literal no-op when AI is unconfigured, so today it just returns the engine's insights.
 */
function useRephrasedMemory(insights: MemoryInsight[]): MemoryInsight[] {
  const [warmed, setWarmed] = React.useState<MemoryInsight[] | null>(null);

  React.useEffect(() => {
    setWarmed(null); // new deterministic input -> drop any prior warmed text, show ground truth
    if (!isAiConfigured || insights.length === 0) return;
    let active = true;
    void rephraseMemoryInsights(insights).then((next) => {
      // Only apply if this is still the current input and the model actually changed wording.
      if (active && next !== insights) setWarmed(next);
    });
    return () => {
      active = false;
    };
  }, [insights]);

  return warmed ?? insights;
}

function InsightCard({ insight }: { insight: MemoryInsight }) {
  const tone = TONE[insight.tone];
  return (
    <Card style={{ borderRadius: 18, flexDirection: 'row', gap: 0, padding: 0, overflow: 'hidden' }}>
      <View style={{ width: 4, backgroundColor: tone.bar }} />
      <View style={{ flex: 1, padding: 16 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <Txt w="eb" size={15} ls={-0.2} style={{ flex: 1 }}>{insight.headline}</Txt>
          {insight.metric ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: tone.bg }}>
              <Txt w="eb" size={13} color={tone.fg}>{insight.metric}</Txt>
            </View>
          ) : null}
        </Row>
        <Txt w="sb" size={13} color={colors.textSecondary} style={{ marginTop: 7, lineHeight: 19 }}>
          {insight.detail}
        </Txt>
      </View>
    </Card>
  );
}

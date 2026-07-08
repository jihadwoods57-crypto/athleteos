// OnStandard — Athlete Performance: the development track the app was missing.
// Log a result (PR) for a lift / sprint / jump / body weight / custom metric and
// see your personal records + trends. Deliberately SEPARATE from the daily
// Accountability Score — this answers "am I getting better?", not "did I stay on
// plan today?". Data is local + persisted (core/performance.ts); it would sync
// through the P0 backend seam once the founder flips it live.
//
// Dark-premium redesign: the same Card/Row/Txt hierarchy, section eyebrows, tile
// iconography, and tactile press feedback the other athlete tabs establish. Values
// here are PRs (lb / s / in / reps), NOT a 0–100 score, so the status color story is
// the improvement TREND (green up · red down · muted flat) rather than a tier chip.
// This is a visual port only — every store hook / action / core helper is preserved.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import {
  PERF_METRICS,
  CUSTOM_METRIC_KEY,
  performanceSummaries,
  resolveMetric,
  formatPerfValue,
  improvementLabel,
  perfSparkGeometry,
  todayStamp,
  type PerfMetricDef,
  type PerfDir,
  type PerfMetricSummary,
} from '@/core';
import { useStore } from '@/store';
import { MAX_FONT_SCALE, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Reveal, Row, Txt, Pressable, Input, Btn } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon, IconName } from '@/icons';

const CATEGORY_ICON: Record<string, IconName> = {
  lift: 'bolt',
  speed: 'flame',
  jump: 'trophy',
  body: 'user',
  custom: 'sparkle',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function Performance() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const perfEntries = useStore((s) => s.perfEntries);
  const logPr = useStore((s) => s.logPr);
  const deletePr = useStore((s) => s.deletePr);
  const goHome = useStore((s) => s.goHome);

  const summaries = performanceSummaries(perfEntries);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
    >
      {/* header */}
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" hitSlop={8} onPress={goHome} style={{ marginLeft: -6, padding: 6 }}>
          <Icon name="chevronLeft" size={24} color={c.text} />
        </Pressable>
        <Txt w="eb" size={28} ls={-0.8} accessibilityRole="header">
          Performance
        </Txt>
      </Row>
      <Txt w="sb" size={14} color={c.textSecondary} style={{ marginTop: 2, marginLeft: 30 }}>
        Your performance track · separate from your daily OnStandard Score
      </Txt>

      <Reveal index={0}>
        <LogForm onSave={logPr} />
      </Reveal>

      {summaries.length === 0 ? (
        <Reveal index={1}>
          <EmptyState />
        </Reveal>
      ) : (
        <View style={{ marginTop: 26 }}>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} upper style={{ marginBottom: 2 }}>
            Your records
          </Txt>
          {summaries.map((s, i) => (
            <Reveal key={s.id} index={i + 1}>
              <SummaryCard summary={s} onDelete={deletePr} />
            </Reveal>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function EmptyState() {
  const c = useColors();
  return (
    <Card variant="low" style={{ marginTop: 22, borderRadius: 24, alignItems: 'center', paddingVertical: 40 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="trophy" size={28} color={c.accent} />
      </View>
      <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 16 }}>
        No results logged yet
      </Txt>
      <Txt w="m" size={14} color={c.textSecondary} style={{ marginTop: 6, textAlign: 'center', lineHeight: 20, paddingHorizontal: 24 }}>
        Log your first lift, sprint, or jump above. We'll track your PRs and show
        whether you're trending up.
      </Txt>
    </Card>
  );
}

function LogForm({ onSave }: { onSave: (spec: { metricKey: string; value: number; date?: string; customLabel?: string; customUnit?: string; customDir?: PerfDir }) => void }) {
  const c = useColors();
  const [metricKey, setMetricKey] = React.useState<string>('bench');
  const [value, setValue] = React.useState('');
  const [date, setDate] = React.useState(todayStamp());
  const [customLabel, setCustomLabel] = React.useState('');
  const [customUnit, setCustomUnit] = React.useState('');
  const [customDir, setCustomDir] = React.useState<PerfDir>('higher');

  const isCustom = metricKey === CUSTOM_METRIC_KEY;
  const def: PerfMetricDef | null = isCustom ? null : PERF_METRICS.find((m) => m.key === metricKey) ?? null;
  const num = Number(value);
  const dateOk = ISO_DATE.test(date.trim());
  const canSave =
    value.trim().length > 0 && Number.isFinite(num) && num > 0 && dateOk && (!isCustom || customLabel.trim().length > 0);

  const save = () => {
    if (!canSave) return;
    haptics.success();
    onSave(
      isCustom
        ? { metricKey: CUSTOM_METRIC_KEY, value: num, date: date.trim(), customLabel: customLabel.trim(), customUnit: customUnit.trim(), customDir }
        : { metricKey, value: num, date: date.trim() },
    );
    // Reset the value/custom fields but keep the metric + date for fast repeat logging.
    setValue('');
    setCustomLabel('');
    setCustomUnit('');
  };

  // The log form is the primary action on this screen, so it takes the elevated `hero`
  // weight (matching Nutrition's this-week goal) while the records below sit `low`.
  return (
    <Card variant="hero" style={{ marginTop: 18, borderRadius: 24, padding: 22 }}>
      <Row style={{ gap: 11, alignItems: 'center' }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={19} color={c.accent} />
        </View>
        <View>
          <Txt w="eb" size={12} color={c.textTertiary} ls={0.7} upper>
            Log a result
          </Txt>
          <Txt w="eb" size={17} ls={-0.3} style={{ marginTop: 2 }}>
            Add a new PR
          </Txt>
        </View>
      </Row>

      {/* metric picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {PERF_METRICS.map((m) => (
          <MetricChip key={m.key} label={m.label} active={metricKey === m.key} onPress={() => setMetricKey(m.key)} />
        ))}
        <MetricChip label="Custom" active={isCustom} onPress={() => setMetricKey(CUSTOM_METRIC_KEY)} />
      </ScrollView>

      {/* custom metric fields */}
      {isCustom ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Input placeholder="Metric name (e.g. Pull-ups)" value={customLabel} onChangeText={setCustomLabel} accessibilityLabel="Custom metric name" />
          <Row style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input placeholder="Unit (e.g. reps)" value={customUnit} onChangeText={setCustomUnit} accessibilityLabel="Custom metric unit" />
            </View>
            <DirToggle dir={customDir} onChange={setCustomDir} />
          </Row>
        </View>
      ) : null}

      {/* value + date */}
      <Row style={{ gap: 10, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} upper style={{ marginBottom: 6 }}>
            Value{def?.unit ? ` (${def.unit})` : ''}
          </Txt>
          <Input
            placeholder={isCustom ? 'Value' : def?.dir === 'lower' ? 'e.g. 4.72' : 'e.g. 225'}
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            accessibilityLabel="Result value"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} upper style={{ marginBottom: 6 }}>
            Date
          </Txt>
          <Input placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} autoCapitalize="none" accessibilityLabel="Result date" />
        </View>
      </Row>

      <View style={{ marginTop: 16 }}>
        <Btn label="Save result" onPress={save} disabled={!canSave} haptic="none" />
      </View>
    </Card>
  );
}

function MetricChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => [
        {
          paddingHorizontal: 15,
          paddingVertical: 10,
          borderRadius: 13,
          backgroundColor: active ? c.accent : c.surface2,
          borderWidth: 1,
          borderColor: active ? c.accent : c.hairline,
          opacity: pressed ? 0.85 : 1,
        },
        active ? shadow.cta : null,
      ]}
    >
      <Txt w="b" size={13} color={active ? c.white : c.slate700} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Txt>
    </Pressable>
  );
}

function DirToggle({ dir, onChange }: { dir: PerfDir; onChange: (d: PerfDir) => void }) {
  const c = useColors();
  const flip = () => {
    haptics.select();
    onChange(dir === 'higher' ? 'lower' : 'higher');
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir === 'higher' ? 'Higher is better' : 'Lower is better'}
      onPress={flip}
      style={({ pressed }) => ({
        height: 54,
        paddingHorizontal: 14,
        borderRadius: 16,
        backgroundColor: c.surface2,
        borderWidth: 1,
        borderColor: c.hairline,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name={dir === 'higher' ? 'trophy' : 'flame'} size={15} color={c.accent} />
      <Txt w="b" size={12} color={c.slate700}>
        {dir === 'higher' ? 'Higher' : 'Lower'} = better
      </Txt>
    </Pressable>
  );
}

function SummaryCard({ summary, onDelete }: { summary: PerfMetricSummary; onDelete: (id: string) => void }) {
  const c = useColors();
  const { def } = summary;
  // PRs are not a 0–100 score, so status color = the improvement TREND, tokenized:
  // green when getting better, red when regressing, muted when flat / single result.
  const trendColor = summary.trend === 'up' ? c.successDeep : summary.trend === 'down' ? c.alertDeep : c.textTertiary;
  const trendSurface = summary.trend === 'up' ? c.successSurface : summary.trend === 'down' ? c.alertSurface : c.surface2;
  const trendGlyph = summary.trend === 'up' ? '↑' : summary.trend === 'down' ? '↓' : '→';
  const values = summary.entries.map((e) => e.value);
  const spark = perfSparkGeometry(values, def.dir);
  const sparkFillId = `perfspark-${summary.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <Card variant="low" style={{ marginTop: 12, borderRadius: 22, padding: 20 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Row style={{ gap: 12, alignItems: 'center', flex: 1, minWidth: 0 }}>
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={CATEGORY_ICON[def.category] ?? 'trophy'} size={20} color={c.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="b" size={15} numberOfLines={1}>
              {def.label}
            </Txt>
            <Txt w="m" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>
              {summary.count} {summary.count === 1 ? 'result' : 'results'}
            </Txt>
          </View>
        </Row>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt w="eb" num size={22} ls={-0.5}>
            {formatPerfValue(def, summary.best)}
          </Txt>
          <View style={{ marginTop: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder }}>
            <Txt w="eb" size={10} color={c.accent} ls={0.6}>
              PR
            </Txt>
          </View>
        </View>
      </Row>

      {/* sparkline — a self-fitting trend line with a soft gradient fill for depth */}
      {values.length >= 2 ? (
        <View style={{ marginTop: 16 }}>
          <Svg width="100%" height={64} viewBox="0 0 300 64">
            <Defs>
              <LinearGradient id={sparkFillId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.accent} stopOpacity="0.16" />
                <Stop offset="1" stopColor={c.accent} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Path d={`${spark.linePath} L${spark.last.x},64 L${spark.points[0].x},64 Z`} fill={`url(#${sparkFillId})`} stroke="none" />
            <Path d={spark.linePath} stroke={c.accent} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={spark.last.x} cy={spark.last.y} r={4} fill={c.accent} stroke={c.card} strokeWidth={2} />
          </Svg>
        </View>
      ) : null}

      <Row style={{ justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt w="eb" size={11} color={c.textTertiary} ls={0.5} upper>
            Latest
          </Txt>
          <Txt w="b" num size={14} color={c.slate700} numberOfLines={1} style={{ marginTop: 3 }}>
            {formatPerfValue(def, summary.latest)} · {summary.latestDate}
          </Txt>
        </View>
        <Row style={{ gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, backgroundColor: trendSurface }}>
          <Txt w="eb" size={13} color={trendColor}>
            {trendGlyph}
          </Txt>
          <Txt w="b" size={12} color={trendColor}>
            {improvementLabel(summary)}
          </Txt>
        </Row>
      </Row>

      {/* per-entry delete */}
      <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 10 }}>
        {[...summary.entries].reverse().map((e) => (
          <Row key={e.id} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
            <Txt w="m" size={13} color={c.textSecondary}>
              {e.date}
            </Txt>
            <Row style={{ gap: 12, alignItems: 'center' }}>
              <Txt w="b" num size={13} color={c.slate700}>
                {formatPerfValue(resolveMetric(e), e.value)}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${def.label} result from ${e.date}`}
                hitSlop={8}
                onPress={() => {
                  haptics.select();
                  onDelete(e.id);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 2 })}
              >
                <Icon name="close" size={15} color={c.textTertiary} />
              </Pressable>
            </Row>
          </Row>
        ))}
      </View>
    </Card>
  );
}

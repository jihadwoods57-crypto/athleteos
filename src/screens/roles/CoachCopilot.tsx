// OnStandard — Coach Copilot panel (doc-05 §6). Natural-language front door to the deterministic
// engines. The buttons run a deterministic tool over the scoped roster (source of truth); when a
// backend is configured, the model's coach-voiced narration is layered on. Works offline (shows the
// deterministic answer), lights up narration when live. Honest label: "Copilot" until AI is wired.
import React from 'react';
import { View } from 'react-native';
import { narrateCopilotResult, isAssistConfigured } from '@/lib/ai/assist';
import { runCopilotTool, tierFor } from '@/core';
import type { AtRiskInput, CopilotQuery, CopilotResult, NutritionSummary } from '@/core';
import { tierChip } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Pressable, Row, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';
import { haptics } from '@/ui/haptics';

const QUESTIONS: { label: string; query: CopilotQuery }[] = [
  { label: 'Who needs attention?', query: { tool: 'who_needs_attention' } },
  { label: 'Low on protein', query: { tool: 'who_missed', metric: 'protein' } },
  { label: 'Team summary', query: { tool: 'summarize_nutrition' } },
  { label: "Who's improving?", query: { tool: 'positive_trends' } },
];

type Athlete = { name: string; score?: number; reason?: string };

function athletes(data: unknown): Athlete[] {
  if (Array.isArray(data)) return data as Athlete[];
  if (data && typeof data === 'object' && 'athletes' in data) return (data as { athletes: Athlete[] }).athletes ?? [];
  return [];
}

export function CoachCopilot({ roster }: { roster: AtRiskInput[] }) {
  const c = useColors();
  const [result, setResult] = React.useState<CopilotResult | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  // Monotonic ask counter: a slower narration for an OLDER question must never
  // overwrite the answer to the one the coach asked last.
  const askSeq = React.useRef(0);

  const ask = React.useCallback(
    (q: { label: string; query: CopilotQuery }) => {
      haptics.tap();
      setActive(q.label);
      const seq = ++askSeq.current;
      // The deterministic answer renders INSTANTLY (it's computed locally in
      // microseconds); the model's narration patches in when it lands. The coach
      // never waits 20s on "Thinking…" for data that was already on the device.
      const deterministic = runCopilotTool(q.query, { roster });
      setResult(deterministic);
      if (!isAssistConfigured) return;
      void narrateCopilotResult(deterministic).then((narrated) => {
        if (seq === askSeq.current) setResult(narrated);
      });
    },
    [roster],
  );

  return (
    <Card variant="low" style={{ borderRadius: 20 }}>
      <Row style={{ gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={17} color={c.accent} />
        </View>
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.8}>{isAssistConfigured ? 'AI COPILOT' : 'COPILOT'}</Txt>
      </Row>
      <Txt w="m" size={12} color={c.textSecondary} style={{ marginBottom: 14, lineHeight: 18 }}>
        Ask about your roster. Answers are computed from your own numbers.
      </Txt>

      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        {QUESTIONS.map((q) => {
          const on = active === q.label;
          return (
            <Pressable
              key={q.label}
              accessibilityRole="button"
              accessibilityLabel={q.label}
              accessibilityState={{ selected: on }}
              onPress={() => ask(q)}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => ({
                paddingHorizontal: 13,
                paddingVertical: 11,
                borderRadius: 11,
                backgroundColor: on ? c.accent : c.surface2,
                borderWidth: 1,
                borderColor: on ? c.accent : c.hairline,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Txt w="b" size={13} color={on ? c.white : c.slate700}>{q.label}</Txt>
            </Pressable>
          );
        })}
      </Row>

      {result ? <CopilotAnswer result={result} /> : null}
    </Card>
  );
}

function CopilotAnswer({ result }: { result: CopilotResult }) {
  const c = useColors();
  const { tool, data, narration } = result;

  return (
    <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: 14 }}>
      {narration ? (
        <Txt w="m" size={14} color={c.slate700} style={{ lineHeight: 21, marginBottom: 12 }}>{narration}</Txt>
      ) : null}

      {tool === 'summarize_nutrition' ? (
        (() => {
          const s = data as NutritionSummary;
          return (
            <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 21 }}>
              {s.count} {s.count === 1 ? 'athlete' : 'athletes'} · avg {s.avgScore} · {s.avgCompliance}% compliant.{' '}
              {s.onStandard} on standard, {s.needIntervention} {s.needIntervention === 1 ? 'needs' : 'need'} intervention.
            </Txt>
          );
        })()
      ) : (
        (() => {
          const list = athletes(data);
          if (list.length === 0) return <Txt w="sb" size={14} color={c.textSecondary}>No one right now — all clear.</Txt>;
          return (
            <View style={{ gap: 8 }}>
              {list.slice(0, 6).map((a) => {
                // A 0-100 score here takes tier coloring, so the room's state reads in color:
                // green OnStandard → cyan Locked In → amber Building → red Off Standard.
                const chip = typeof a.score === 'number' ? tierChip[tierFor(a.score).short] : null;
                return (
                  <Row
                    key={a.name}
                    style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 13 }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt w="b" size={14} numberOfLines={1}>{a.name}</Txt>
                      {a.reason ? <Txt w="m" size={12} color={c.textTertiary} style={{ marginTop: 2, lineHeight: 16 }}>{a.reason}</Txt> : null}
                    </View>
                    {chip ? (
                      <View style={{ minWidth: 42, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
                        <Txt w="eb" num size={16} color={chip.fg}>{a.score}</Txt>
                      </View>
                    ) : null}
                  </Row>
                );
              })}
            </View>
          );
        })()
      )}
    </View>
  );
}

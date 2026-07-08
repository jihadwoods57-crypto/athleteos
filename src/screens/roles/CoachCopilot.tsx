// OnStandard — Coach Copilot panel (doc-05 §6). Natural-language front door to the deterministic
// engines. The buttons run a deterministic tool over the scoped roster (source of truth); when a
// backend is configured, the model's coach-voiced narration is layered on. Works offline (shows the
// deterministic answer), lights up narration when live. Honest label: "Copilot" until AI is wired.
import React from 'react';
import { View } from 'react-native';
import { narrateCopilotResult, isAssistConfigured } from '@/lib/ai/assist';
import { runCopilotTool } from '@/core';
import type { AtRiskInput, CopilotQuery, CopilotResult, NutritionSummary } from '@/core';
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

      {/* proto .eyebrow "Ask" over the question chips */}
      <Txt w="eb" size={11} color={c.textTertiary} ls={1.2} upper style={{ marginBottom: 10 }}>Ask</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 9 }}>
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
              // Proto .chp pills (flows.css): blue-tinted surface + blue border + blue text
              // when selected, quiet hairline pill otherwise — never a filled button.
              style={({ pressed }) => ({
                paddingHorizontal: 17,
                paddingVertical: 11,
                borderRadius: 999,
                backgroundColor: on ? c.accentSurface : c.surface2,
                borderWidth: 1.5,
                borderColor: on ? c.accent : c.hairline,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Txt w="b" size={13.5} color={on ? c.accentLight : c.slate700}>{q.label}</Txt>
            </Pressable>
          );
        })}
      </Row>

      {result ? <CopilotAnswer result={result} /> : null}
    </Card>
  );
}

/** Proto R/Y/G read for a 0-100 score: green on standard, amber borderline, red critical
 *  (coach.js colors `.rs` at 80/60; the copilot flag dots carry the same story). */
function scoreTone(c: ReturnType<typeof useColors>, score: number): string {
  return score >= 80 ? c.success : score >= 60 ? c.warning : c.alert;
}

function CopilotAnswer({ result }: { result: CopilotResult }) {
  const c = useColors();
  const { tool, data, narration } = result;

  return (
    <View style={{ marginTop: 16 }}>
      {/* proto .ai-note — blue-washed card, gradient sparkle avatar, COPILOT eyebrow, prose */}
      {narration ? (
        <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, marginBottom: 4 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={18} color={c.white} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt w="eb" size={11} color={c.accentLight} ls={1.1} upper>Copilot</Txt>
            <Txt w="sb" size={14} color={c.text} style={{ lineHeight: 21, marginTop: 4 }}>{narration}</Txt>
          </View>
        </View>
      ) : null}

      {/* proto .eyebrow "The numbers behind it" over the deterministic answer */}
      <Txt w="eb" size={11} color={c.textTertiary} ls={1.2} upper style={{ marginTop: narration ? 18 : 0, marginBottom: 10 }}>
        The numbers behind it
      </Txt>

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
            // Proto roster-row list (flows.css): one hairline-divided section, a 12px R/Y/G
            // flag dot, name + note, and the bare score colored by the same flag story.
            <View style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, borderRadius: 16 }}>
              {list.slice(0, 6).map((a, i) => {
                const tone = typeof a.score === 'number' ? scoreTone(c, a.score) : null;
                return (
                  <Row
                    key={a.name}
                    style={{ alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.hairline }}
                  >
                    {tone ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tone }} /> : null}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt w="eb" size={14.5} numberOfLines={1}>{a.name}</Txt>
                      {a.reason ? <Txt w="sb" size={12} color={c.textTertiary} numberOfLines={1} style={{ marginTop: 2 }}>{a.reason}</Txt> : null}
                    </View>
                    {tone ? <Txt w="eb" num size={18} color={tone}>{a.score}</Txt> : null}
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

// OnStandard — Memory confirmation (doc-05 §5.2). Athlete-facing. Safety facts the system inferred
// (an allergy/dislike proposed from a meal correction) are NEVER trusted until the athlete confirms
// them here — the LLM never writes a safety fact. Confirm -> 'active'; "Not mine" -> 'rejected'.
// Renders nothing when there is nothing to confirm, so it's safe to mount anywhere.
import React from 'react';
import { View } from 'react-native';
import { fetchMemoryFacts, setFactStatus } from '@/lib/ai/memory';
import type { MemoryFact } from '@/core';
import { shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Card, Pressable, Row, Txt } from '@/ui/primitives';
import { Icon } from '@/icons';
import { haptics } from '@/ui/haptics';

const KIND_LABEL: Partial<Record<MemoryFact['kind'], string>> = {
  allergy: 'allergy',
  dislike: "food you don't like",
  favorite_food: 'favorite food',
  favorite_restaurant: 'favorite spot',
};

function describe(f: MemoryFact): string {
  const label = KIND_LABEL[f.kind] ?? f.kind.replace(/_/g, ' ');
  return `We think ${String(f.value)} is ${f.kind === 'allergy' ? 'an' : 'a'} ${label}. Is that right?`;
}

export function MemoryConfirm() {
  const c = useColors();
  const [facts, setFacts] = React.useState<MemoryFact[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetchMemoryFacts('pending_confirmation').then((f) => {
      if (alive) setFacts(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  const decide = React.useCallback(async (id: string, status: 'active' | 'rejected') => {
    haptics.tap();
    setBusy(id);
    const ok = await setFactStatus(id, status);
    if (ok) setFacts((prev) => prev.filter((f) => f.id !== id));
    setBusy(null);
  }, []);

  if (facts.length === 0) return null;

  return (
    <Card variant="low" style={{ borderRadius: 20, marginTop: 18 }}>
      {/* eyebrow — the AI-surface idiom: accent icon tile + tracked accent overline */}
      <Row style={{ gap: 9, marginBottom: 12, alignItems: 'center' }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentSurface, borderWidth: 1, borderColor: c.accentBorder, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={17} color={c.accent} />
        </View>
        <Txt w="eb" size={12} color={c.accent} ls={0.6}>QUICK CHECK</Txt>
      </Row>
      <Txt w="m" size={12} color={c.textSecondary} style={{ marginBottom: 14, lineHeight: 18 }}>
        Confirm these so your coaching stays accurate. Nothing is used until you say so.
      </Txt>

      {/* Each pending fact is its own framed row so multiple checks read as distinct items,
          not one run-on block — the confirm/reject actions carry the card's own accent CTA. */}
      <View style={{ gap: 10 }}>
        {facts.map((f) => (
          <View key={f.id} style={{ borderRadius: 14, padding: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
            <Txt w="sb" size={14} color={c.slate700} style={{ lineHeight: 20, marginBottom: 12 }}>{describe(f)}</Txt>
            <Row style={{ gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Yes, that's right" disabled={busy === f.id} onPress={() => decide(f.id, 'active')}
                style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: c.accent, opacity: busy === f.id ? 0.6 : 1 }, shadow.cta]}>
                <Icon name="check" size={14} color={c.white} />
                <Txt w="b" size={13} color={c.white}>Yes, that's right</Txt>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Not mine" disabled={busy === f.id} onPress={() => decide(f.id, 'rejected')}
                style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, opacity: busy === f.id ? 0.6 : 1 }}>
                <Txt w="b" size={13} color={c.slate700}>Not mine</Txt>
              </Pressable>
            </Row>
          </View>
        ))}
      </View>
    </Card>
  );
}

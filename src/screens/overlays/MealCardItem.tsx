// OnStandard — shared meal-history card. One presentational row rendered identically
// by the client history overlay (MealHistory) and the coach/trainer history section
// (PersonDetail), so the two surfaces never drift. A stored photo loads as a thumbnail
// via a short-lived signed URL; with no photo (or the backend off) it falls back to the
// app's per-slot color block — honest, never a broken image.
import React from 'react';
import { Image, View } from 'react-native';
import { tierFor, type MealCard } from '@/core';
import { db, isBackendLive } from '@/lib/supabase';
import { tierChip } from '@/ui/tokens';
import { Pressable, Row, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { useColors } from '@/ui/theme';

function MealThumb({ card }: { card: MealCard }) {
  const c = useColors();
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isBackendLive || !card.photoPath) return;
    let cancelled = false;
    db.signedMealPhotoUrl(card.photoPath)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [card.photoPath]);

  // Hairline frame so the thumb reads as an edge on the dark canvas — a real photo and
  // the color-token fallback both sit in the same 48px rounded tile.
  if (url) {
    return <Image source={{ uri: url }} style={{ width: 48, height: 48, borderRadius: 13, borderWidth: 1, borderColor: c.hairline }} resizeMode="cover" />;
  }
  return (
    <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: card.thumb, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="utensils" size={19} color="rgba(255,255,255,0.9)" />
    </View>
  );
}

/** The shared row. `onPress` (optional) makes it a drill-down into the meal review +
 *  comment thread — passed only for stored meals (serverId), so a local-only card stays a
 *  plain row and nothing ever opens onto a meal the server doesn't have. */
export function MealCardItem({ card, onPress }: { card: MealCard; onPress?: () => void }) {
  const c = useColors();
  // Tier coloring on the 0–100 quality score (Off / Building / Locked In / OnStandard) so the
  // meal chip speaks the SAME status band as the Home ring and the roster — never a fixed
  // green/blue binary that reads two meals at 89 and 91 as different colors than their tier.
  const tier = tierFor(card.quality);
  const chip = tierChip[tier.short];
  const body = (
    <Row style={{ gap: 13 }}>
      <MealThumb card={card} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="b" size={14} numberOfLines={1}>
          {card.name}
        </Txt>
        <Txt w="m" num size={12} color={c.textTertiary} style={{ marginTop: 3 }}>
          {card.label} · {card.protein}g protein · {card.kcal} cal
        </Txt>
      </View>
      <View style={{ minWidth: 38, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: chip.bg, borderWidth: 1, borderColor: chip.border, alignItems: 'center' }}>
        <Txt w="eb" num size={13} color={chip.fg} maxFontSizeMultiplier={1.3}>
          {card.quality}
        </Txt>
      </View>
      {onPress ? (
        <Icon name="chevronRight" size={16} color={c.textTertiary} />
      ) : null}
    </Row>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.label}: ${card.name}. Review and comment.`}
      onPress={() => { haptics.tap(); onPress(); }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

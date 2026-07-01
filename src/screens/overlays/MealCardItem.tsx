// OnStandard — shared meal-history card. One presentational row rendered identically
// by the client history overlay (MealHistory) and the coach/trainer history section
// (PersonDetail), so the two surfaces never drift. A stored photo loads as a thumbnail
// via a short-lived signed URL; with no photo (or the backend off) it falls back to the
// app's per-slot color block — honest, never a broken image.
import React from 'react';
import { Image, View } from 'react-native';
import type { MealCard } from '@/core';
import { db, isBackendLive } from '@/lib/supabase';
import { colors } from '@/ui/tokens';
import { Row, Txt } from '@/ui/primitives';

function MealThumb({ card }: { card: MealCard }) {
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

  if (url) {
    return <Image source={{ uri: url }} style={{ width: 48, height: 48, borderRadius: 13 }} resizeMode="cover" />;
  }
  return <View style={{ width: 48, height: 48, borderRadius: 13, backgroundColor: card.thumb }} />;
}

export function MealCardItem({ card }: { card: MealCard }) {
  const strong = card.quality >= 90;
  return (
    <Row style={{ gap: 13 }}>
      <MealThumb card={card} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt w="b" size={14}>
          {card.name}
        </Txt>
        <Txt w="m" num size={12} color={colors.textTertiary} style={{ marginTop: 2 }}>
          {card.label} · {card.protein}g protein · {card.kcal} cal
        </Txt>
      </View>
      <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: strong ? colors.successSurface : colors.accentSurface }}>
        <Txt w="eb" num size={12} color={strong ? colors.successDeep : colors.accent}>
          {card.quality}
        </Txt>
      </View>
    </Row>
  );
}

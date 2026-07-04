// OnStandard — MealReview: one stored meal, opened for review + conversation (WS4,
// Assistant Nutritionist build 2026-07-04).
//
// The SAME overlay both sides of the link use — a coach/trainer opens it from an athlete's
// recent meals (PersonDetail), the athlete opens it from their own Meal History — so the
// two ends of the conversation are looking at the identical surface: the photo, the macros,
// the AI's read, and the per-meal comment thread (0046 meal_comments, the app's first real
// delivered messaging). Role is derived, never declared: you are the athlete on your own
// meal, a coach on a linked athlete's. A coach comment lands as an in-app notification +
// push via the existing send-push seam ("Coach commented on your lunch").
//
// Honesty: everything shown is stored data (no fabricated coaching); the thread renders
// only rows the server returned; a failed post keeps the draft and says so.
import React from 'react';
import { Image, ScrollView, View } from 'react-native';
import type { MealCommentRow } from '@/lib/supabase';
import { db, isBackendLive } from '@/lib/supabase';
import { useStore } from '@/store';
import { aiCoachName } from '@/lib/ai';
import { useColors } from '@/ui/theme';
import { Card, Input, Pressable, Row, Txt } from '@/ui/primitives';
import { haptics } from '@/ui/haptics';
import { Icon } from '@/icons';
import { Overlay } from './Overlay';

export function MealReview() {
  const c = useColors();
  const s = useStore();
  const review = s.mealReview;
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [comments, setComments] = React.useState<MealCommentRow[] | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sendState, setSendState] = React.useState<'idle' | 'sending' | 'failed'>('idle');

  const mealId = review?.mealId;
  const viewerId = s.userId;
  // Role is derived from the link, mirroring the RLS rule: your own meal -> athlete voice,
  // a linked athlete's meal -> coach voice.
  const viewerRole: 'athlete' | 'coach' = review && viewerId === review.athleteId ? 'athlete' : 'coach';

  // The photo, via the same signed-URL seam MealCardItem uses.
  React.useEffect(() => {
    if (!isBackendLive || !review?.card.photoPath) return;
    let cancelled = false;
    db.signedMealPhotoUrl(review.card.photoPath)
      .then((u) => { if (!cancelled) setPhotoUrl(u); })
      .catch(() => { /* fall back to the slot color block */ });
    return () => { cancelled = true; };
  }, [review?.card.photoPath]);

  // The thread. RLS scopes it; an error renders the honest "couldn't load" line.
  const [threadError, setThreadError] = React.useState(false);
  const loadThread = React.useCallback(() => {
    if (!isBackendLive || !mealId) return;
    db.fetchMealComments(mealId)
      .then((rows) => { setComments(rows); setThreadError(false); })
      .catch(() => setThreadError(true));
  }, [mealId]);
  React.useEffect(() => { loadThread(); }, [loadThread]);

  if (!review) return null;
  const { card, athleteName } = review;

  const send = async () => {
    const text = draft.trim();
    if (!text || !viewerId || !mealId || sendState === 'sending') return;
    haptics.tap();
    setSendState('sending');
    try {
      await db.postMealComment(mealId, review.athleteId, viewerId, viewerRole, text);
      setDraft('');
      setSendState('idle');
      loadThread();
      // Close the loop: a coach's comment reaches the athlete as a notification + push
      // (send-push authorizes via can_view, the same fence the comment itself passed).
      if (viewerRole === 'coach') {
        void db.nudgePush(
          review.athleteId,
          `Coach commented on your ${card.label.toLowerCase()}`,
          text.slice(0, 280),
        ).catch(() => undefined);
      }
    } catch {
      setSendState('failed'); // keep the draft; never silently drop feedback
    }
  };

  const bubbleName = (row: MealCommentRow): string => {
    if (row.role === 'ai') return aiCoachName;
    if (row.author_id === viewerId) return 'You';
    return row.role === 'coach' ? 'Coach' : athleteName.split(' ')[0] || 'Athlete';
  };

  return (
    <Overlay title={`${card.label} · ${athleteName.split(' ')[0] || athleteName}`} onClose={s.closeMealReview}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* The plate: real photo when one was logged, the slot color block otherwise. */}
        <View style={{ borderRadius: 20, overflow: 'hidden', marginTop: 4 }}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={{ width: '100%', height: 220 }} resizeMode="cover" accessibilityLabel={`${card.label} photo`} />
          ) : (
            <View style={{ width: '100%', height: 120, backgroundColor: card.thumb, alignItems: 'center', justifyContent: 'center' }}>
              <Txt w="eb" size={15} color={c.white}>{card.photoPath ? 'Loading photo…' : 'No photo logged'}</Txt>
            </View>
          )}
        </View>

        <Txt w="eb" size={19} ls={-0.4} style={{ marginTop: 14 }}>{card.name}</Txt>
        <Row style={{ gap: 8, marginTop: 10 }}>
          <ReviewStat label="Protein" value={`${card.protein}g`} />
          <ReviewStat label="Calories" value={String(card.kcal)} />
          <ReviewStat label="Quality" value={`${card.quality}`} />
        </Row>

        {/* The AI's stored read — shown to both roles, never regenerated here. */}
        {card.note ? (
          <Card variant="low" style={{ marginTop: 12, borderRadius: 16 }}>
            <Row style={{ gap: 7, alignItems: 'center', marginBottom: 6 }}>
              <Icon name="sparkle" size={13} color={c.accent} />
              <Txt w="eb" size={10.5} color={c.accent} ls={0.6}>AI READ</Txt>
            </Row>
            <Txt w="m" size={13.5} color={c.slate700} style={{ lineHeight: 20 }}>{card.note}</Txt>
          </Card>
        ) : null}

        {/* The conversation — the loop that makes logging worth it. */}
        <Txt w="eb" size={11} color={c.textTertiary} ls={0.7} style={{ marginTop: 18 }}>CONVERSATION</Txt>
        {!isBackendLive ? (
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 8, lineHeight: 19 }}>
            Comments go live with your team connection.
          </Txt>
        ) : threadError ? (
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 8 }}>
            Couldn’t load the conversation. Pull back in a moment.
          </Txt>
        ) : comments === null ? (
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 8 }}>Loading…</Txt>
        ) : comments.length === 0 ? (
          <Txt w="m" size={13} color={c.textTertiary} style={{ marginTop: 8, lineHeight: 19 }}>
            {viewerRole === 'coach'
              ? 'No comments yet. What you write here lands on this exact meal, and they get a notification.'
              : 'No comments on this meal yet.'}
          </Txt>
        ) : (
          <View style={{ marginTop: 10, gap: 8 }}>
            {comments.map((m) => {
              const mine = m.author_id === viewerId;
              const bubbleBg = mine ? c.accent : m.role === 'ai' ? c.accentSurface : c.card;
              const textColor = mine ? c.white : c.text;
              return (
                <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
                  <Txt w="b" size={10.5} color={c.textTertiary} style={{ marginBottom: 3, marginLeft: 4 }}>
                    {bubbleName(m)}
                  </Txt>
                  <View style={{ backgroundColor: bubbleBg, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 10 }}>
                    <Txt w="m" size={13.5} color={textColor} style={{ lineHeight: 19 }}>{m.text}</Txt>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {isBackendLive ? (
          <>
            <Row style={{ gap: 10, marginTop: 14 }}>
              <Input
                value={draft}
                onChangeText={setDraft}
                placeholder={viewerRole === 'coach' ? `Comment on this ${card.label.toLowerCase()}…` : 'Reply to your coach…'}
                accessibilityLabel="Write a comment on this meal"
                style={{ flex: 1 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send comment"
                onPress={send}
                disabled={sendState === 'sending' || !draft.trim()}
                style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 16, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed || sendState === 'sending' || !draft.trim() ? 0.6 : 1 })}
              >
                <Icon name="send" size={19} color={c.white} />
              </Pressable>
            </Row>
            {sendState === 'failed' ? (
              <Txt w="sb" size={12} color={c.alertDeep} style={{ marginTop: 8 }}>
                Didn’t send. Your draft is safe; try again.
              </Txt>
            ) : viewerRole === 'coach' ? (
              <Txt w="m" size={11.5} color={c.textTertiary} style={{ marginTop: 8 }}>
                They’ll get a notification the moment you send.
              </Txt>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Overlay>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, borderRadius: 13, backgroundColor: c.bg2, paddingVertical: 11, alignItems: 'center' }}>
      <Txt w="eb" num size={16}>{value}</Txt>
      <Txt w="sb" size={10} color={c.textTertiary} style={{ marginTop: 2 }}>{label}</Txt>
    </View>
  );
}

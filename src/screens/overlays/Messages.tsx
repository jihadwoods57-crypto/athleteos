// OnStandard — Messages thread overlay (coach↔athlete / role↔athlete).
// Aligned to the proto's messages design (js/screens/settings.js + css/screens.css):
// a back-head on the canvas (round hairline back button, 20/800 title, 12/600 sub),
// a thread of 88%-wide bubbles (other party: 32px amber avatar + 11/800 who-line +
// surface-2 bubble with a 5px top-left corner; me: flat accent bubble, white text,
// 5px top-right corner), the honest delivery line as the proto's centered `.msg-status`
// pill, and the proto composer (48px pill input on surface-1 + 48px round accent send).
// Visual port only — every store hook / action (who you're messaging, the message list,
// draft, send, the minor-messaging gate, close) and every honesty gate are preserved.
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useStore } from '@/store';
import { messageDeliveryNote, messagingAllowed, messagingGateNote } from '@/core';
import { isBackendLive } from '@/lib/supabase';
import { font, shadow } from '@/ui/tokens';
import { useColors } from '@/ui/theme';
import { Row, Txt, Pressable } from '@/ui/primitives';
import { Icon } from '@/icons';
import { SafeAreaView } from 'react-native-safe-area-context';

// The seeded-demo contact when Messages is opened without a specific person in
// context (the showcase). A real thread always names the person actually tapped.
const THEM_BY_ROLE: Record<string, string> = { coach: 'Jihad Carter', parent: 'Coach Davis', trainer: 'Maya Lopez' };

export function Messages() {
  const c = useColors();
  const s = useStore();
  // Messages is opened from PersonDetail's "Message", which leaves the tapped
  // person in context. Name THAT person so the thread header agrees with the
  // overlay it was opened from (tapping Marcus must not show a "Jihad" thread);
  // fall back to the role's showcase contact only when no person is in context.
  const them = s.personDetail?.name?.trim() || THEM_BY_ROLE[s.role ?? ''] || 'Coach Davis';
  const initials = them.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  // msgThread is ONE global array seeded with showcase bubbles. Rendering it under a
  // REAL person's name fabricates speech from a real (possibly minor) athlete — and
  // shows the same conversation for everyone the overseer opens. A real counterpart
  // (live athleteId) or a real signed-up user gets an honest empty thread instead.
  const realCounterpart = Boolean(s.personDetail?.athleteId) || s.athleteName.trim() !== '';
  // The beta minor-messaging rule, applied on the athlete side where age is known
  // (the real enforcement is RLS, migration 0006 — this keeps the UI from offering a
  // channel the backend would reject). Overseer roles pass through.
  const allowed = s.role === 'athlete'
    ? messagingAllowed({ athleteAge: s.baseAge, counterpartAuthorized: (s.supportTeam ?? []).includes('coach') })
    : true;

  const deliveryNote = allowed ? messageDeliveryNote(isBackendLive) : messagingGateNote(false);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, zIndex: 110 }}>
      {/* Header — the proto's back-head, sitting directly on the canvas: a round
          surface-1 back button inside a hairline, then title + honest sub. */}
      <SafeAreaView edges={['top']}>
        <Row style={{ gap: 14, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={6} onPress={s.closeMsg} style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronLeft" size={20} color={c.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={20} ls={-0.4} numberOfLines={1} accessibilityRole="header">
              {them}
            </Txt>
            {/* No "Active now" presence claim: the app has no real-time presence
                signal and delivery is gated to the backend, so an always-green
                "Active now" was a fabrication. The honest delivery state lives in
                the thread's status pill (messageDeliveryNote). */}
            <Txt w="sb" size={12} color={c.textSecondary} style={{ marginTop: 1 }}>
              Direct message
            </Txt>
          </View>
        </Row>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12 }} showsVerticalScrollIndicator={false}>
        {realCounterpart ? (
          // Honest empty thread: a real counterpart has no seeded showcase bubbles to show.
          <View style={{ alignItems: 'center', marginTop: 44, paddingHorizontal: 24 }}>
            <View style={{ width: 60, height: 60, borderRadius: 999, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Icon name="send" size={24} color={c.textTertiary} />
            </View>
            <Txt w="eb" size={16} ls={-0.3} style={{ textAlign: 'center' }}>
              No messages with {them} yet
            </Txt>
            <Txt w="m" size={13} color={c.textTertiary} style={{ textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              Say hello below to start the conversation.
            </Txt>
          </View>
        ) : (
          s.msgThread.map((m, i) => {
            const me = m.who === 'me';
            // Proto bubbles: mine ride the accent with white text and a 5px top-right
            // corner; the other party gets a 32px amber avatar, an 11/800 who-line, and
            // an elevated surface-2 bubble inside a hairline with a 5px top-left corner —
            // both legible on the dark canvas.
            return me ? (
              <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
                <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, borderTopRightRadius: 5, backgroundColor: c.accent }}>
                  <Txt w="sb" size={14} color={c.white} style={{ lineHeight: 20 }}>
                    {m.text}
                  </Txt>
                </View>
              </View>
            ) : (
              <Row key={i} style={{ alignSelf: 'flex-start', maxWidth: '88%', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: c.warning, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt w="eb" size={12} color={c.bg2}>
                    {initials}
                  </Txt>
                </View>
                <View style={{ flexShrink: 1 }}>
                  <Txt w="eb" size={11} color={c.textTertiary} style={{ marginBottom: 3 }}>
                    {them}
                  </Txt>
                  <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, borderTopLeftRadius: 5, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline }}>
                    <Txt w="sb" size={14} color={c.text} style={{ lineHeight: 20 }}>
                      {m.text}
                    </Txt>
                  </View>
                </View>
              </Row>
            );
          })
        )}

        {/* The honest delivery/gate line — the proto's centered `.msg-status` pill. */}
        <View style={{ alignSelf: 'center', marginTop: 2, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.divider2 }}>
          <Txt w="b" size={11.5} color={c.textTertiary} style={{ textAlign: 'center' }}>
            {deliveryNote}
          </Txt>
        </View>
      </ScrollView>

      {/* Composer — the proto composer on the canvas (no raised bar): a 48px pill input
          on surface-1 inside a hairline, and a 48px round accent send with the blue glow. */}
      <SafeAreaView edges={['bottom']}>
        {allowed ? (
          <Row style={{ gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
            <TextInput
              value={s.msgDraft}
              onChangeText={s.setMsgDraft}
              onSubmitEditing={s.sendMsg}
              placeholder={`Message ${them}…`}
              placeholderTextColor={c.textTertiary}
              style={{ flex: 1, height: 48, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 18, fontFamily: font.sb, fontSize: 14, color: c.text }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={s.sendMsg} style={[{ width: 48, height: 48, borderRadius: 999, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
              <Icon name="send" size={19} color={c.white} />
            </Pressable>
          </Row>
        ) : (
          <View style={{ paddingVertical: 14 }} />
        )}
      </SafeAreaView>
    </View>
  );
}

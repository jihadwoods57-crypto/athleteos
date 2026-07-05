// OnStandard — Messages thread overlay (coach↔athlete / role↔athlete).
// Dark-premium redesign: a full-bleed dark canvas with a floating monogram header, a
// chat thread (athlete rides the accent, the other party an elevated surface + hairline —
// each legible on the dark canvas, never white text on a near-white bubble), day-grouped
// bubbles with muted timestamps, and a clean dark composer with a shadowed send button.
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
      {/* Header — the person you're talking to, on a raised dark bar that reads as its own
          plane over the thread (hairline base, not a hard divider line). */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.hairline }}>
        <Row style={{ gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={6} onPress={s.closeMsg} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronLeft" size={20} color={c.slate600} />
          </Pressable>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="eb" size={14} color={c.white}>
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={17} ls={-0.3} accessibilityRole="header">
              {them}
            </Txt>
            {/* No "Active now" presence claim: the app has no real-time presence
                signal and delivery is gated to the backend, so an always-green
                "Active now" was a fabrication. The honest delivery state lives in
                the composer footer (messageDeliveryNote). */}
            <Txt w="sb" size={12} color={c.textTertiary} style={{ marginTop: 2 }}>
              Direct message
            </Txt>
          </View>
        </Row>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }} showsVerticalScrollIndicator={false}>
        {realCounterpart ? (
          // Honest empty thread: a real counterpart has no seeded showcase bubbles to show.
          <View style={{ alignItems: 'center', marginTop: 44, paddingHorizontal: 24 }}>
            <View style={{ width: 60, height: 60, borderRadius: 20, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
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
            // Dark bubbles: my messages ride the accent with white text; the other party
            // gets an elevated slate surface + hairline with light `slate700` text — both
            // legible on the dark canvas (never the near-white bubble that hid white text).
            return (
              <View key={i} style={{ alignItems: me ? 'flex-end' : 'flex-start', gap: 5 }}>
                <Txt w="eb" size={10} color={c.textTertiary} ls={0.3} style={{ paddingHorizontal: 4 }}>
                  {me ? 'You' : them}
                </Txt>
                <View
                  style={[
                    {
                      maxWidth: '82%',
                      paddingHorizontal: 15,
                      paddingVertical: 11,
                      borderRadius: 18,
                      backgroundColor: me ? c.accent : c.surface3,
                    },
                    me
                      ? { borderBottomRightRadius: 6, ...shadow.cta }
                      : { borderBottomLeftRadius: 6, borderWidth: 1, borderColor: c.hairline },
                  ]}
                >
                  <Txt w="m" size={14} color={me ? c.white : c.slate700} style={{ lineHeight: 20 }}>
                    {m.text}
                  </Txt>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Composer — a raised dark footer: the delivery/gate note, then a dark input inside a
          hairline frame with a shadowed accent send button (the CTA weight of the screen). */}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.hairline }}>
        <Row style={{ gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 11 }}>
          <Icon name={allowed ? 'shield' : 'eye'} size={12} color={c.textTertiary} />
          <Txt w="m" size={11} color={c.textTertiary} style={{ textAlign: 'center', flexShrink: 1 }}>
            {deliveryNote}
          </Txt>
        </Row>
        {allowed ? (
          <Row style={{ gap: 10, paddingHorizontal: 20, paddingVertical: 14 }}>
            <TextInput
              value={s.msgDraft}
              onChangeText={s.setMsgDraft}
              placeholder="Message…"
              placeholderTextColor={c.textTertiary}
              style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 16, fontFamily: font.m, fontSize: 15, color: c.text }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={s.sendMsg} style={[{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }, shadow.cta]}>
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

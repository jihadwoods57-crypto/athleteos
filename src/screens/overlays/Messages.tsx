// OnStandard — Messages thread overlay (coach↔athlete / role↔athlete).
import React from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useStore } from '@/store';
import { messageDeliveryNote } from '@/core';
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

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, zIndex: 110 }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.divider2 }}>
        <Row style={{ gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={6} onPress={s.closeMsg} style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronLeft" size={20} color={c.slate600} />
          </Pressable>
          <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
            <Txt w="b" size={13} color={c.white}>
              {initials}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt w="eb" size={16} ls={-0.3}>
              {them}
            </Txt>
            {/* No "Active now" presence claim: the app has no real-time presence
                signal and delivery is gated to the backend, so an always-green
                "Active now" was a fabrication. The honest delivery state lives in
                the composer footer (messageDeliveryNote). */}
          </View>
        </Row>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {s.msgThread.map((m, i) => {
          const me = m.who === 'me';
          return (
            <View key={i} style={{ alignItems: me ? 'flex-end' : 'flex-start', gap: 4 }}>
              <Txt w="eb" size={10} color={c.textTertiary}>
                {me ? 'You' : them}
              </Txt>
              <View style={[{ maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, backgroundColor: me ? c.accent : c.card }, me ? undefined : shadow.card]}>
                <Txt w="m" size={14} color={me ? c.white : c.slate700} style={{ lineHeight: 20 }}>
                  {m.text}
                </Txt>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.divider2 }}>
        <Txt w="m" size={11} color={c.textTertiary} style={{ textAlign: 'center', paddingHorizontal: 20, paddingTop: 10 }}>
          {messageDeliveryNote(isBackendLive)}
        </Txt>
        <Row style={{ gap: 8, paddingHorizontal: 20, paddingVertical: 14 }}>
          <TextInput
            value={s.msgDraft}
            onChangeText={s.setMsgDraft}
            placeholder="Message…"
            placeholderTextColor={c.textTertiary}
            style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: c.bg, paddingHorizontal: 15, fontFamily: font.m, fontSize: 15, color: c.text }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={s.sendMsg} style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={19} color={c.white} />
          </Pressable>
        </Row>
      </SafeAreaView>
    </View>
  );
}

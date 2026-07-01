// OnStandard — full-screen overlay shell with a standard header.
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, shadow } from '@/ui/tokens';
import { Row, Txt, Pressable } from '@/ui/primitives';
import { Icon, IconName } from '@/icons';

export function Overlay({
  title,
  onClose,
  closeIcon = 'chevronLeft',
  right,
  children,
  bg = colors.bg,
}: {
  title: string;
  onClose: () => void;
  closeIcon?: IconName;
  right?: React.ReactNode;
  children: React.ReactNode;
  bg?: string;
}) {
  // aos-up entrance: slide-up + fade on mount, reduce-motion aware.
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!mounted) return;
      if (reduce) {
        anim.setValue(1);
      } else {
        Animated.timing(anim, {
          toValue: 1,
          duration: 320,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        }).start();
      }
    });
    return () => {
      mounted = false;
    };
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg, zIndex: 100 }}>
      <Animated.View style={{ flex: 1, opacity: anim, transform: [{ translateY }] }}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeIcon === 'close' ? 'Close' : 'Back'}
              hitSlop={6}
              onPress={onClose}
              style={[{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shadow.card]}
            >
              <Icon name={closeIcon} size={20} color={colors.slate600} />
            </Pressable>
            <Txt w="eb" size={17} ls={-0.3}>
              {title}
            </Txt>
            {right ?? <View style={{ width: 40, height: 40 }} />}
          </Row>
          {children}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

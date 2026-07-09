// OnStandard — app-level error boundary. A render/lifecycle throw in any screen (a malformed
// hydrated row, a NaN chart geometry) would otherwise unwind past the root flow switch and
// blank the whole app. This isolates it to one honest fallback with a retry, per the
// constitution's "error states tell the truth" rule.
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/ui/theme';
import { Txt, Pressable } from '@/ui/primitives';

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 28,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt w="eb" size={22} ls={-0.4} color={c.text} style={{ textAlign: 'center' }}>
        This screen hit a problem
      </Txt>
      <Txt w="sb" size={15} color={c.textSecondary} style={{ textAlign: 'center', marginTop: 10 }}>
        Your data is safe. Try again — and if it keeps happening, let your coach know.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={onRetry}
        style={{ marginTop: 24, paddingVertical: 13, paddingHorizontal: 30, borderRadius: 999, backgroundColor: c.text }}
      >
        <Txt w="eb" size={15} color={c.bg}>
          Try again
        </Txt>
      </Pressable>
    </View>
  );
}

interface State {
  hasError: boolean;
}

/** Catches render/lifecycle throws below it and shows an honest fallback instead of a blank
 *  app. Wrap the root flow switch so one screen's crash never takes down the whole app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    if (__DEV__) console.warn('[ErrorBoundary] caught a render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

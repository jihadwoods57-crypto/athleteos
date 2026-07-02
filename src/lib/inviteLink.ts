// OnStandard — invite deep link handling. A coach shares a link like
//   onstandard://join?code=EAGLES24   (or https://onstandard.app/join?code=EAGLES24)
// Tapping it opens the athlete's Connect overlay with the code prefilled, so joining is
// one confirmation. Scheme 'onstandard' is registered in app.json. In-app only: if the
// link arrives mid-onboarding the athlete finishes first, then uses the Home connect card.
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useStore } from '@/store';

/** Extract a join code from an invite URL's `?code=` query. Uppercased to match the
 *  server's code alphabet. Null when the URL carries no code. Pure + tested. */
export function parseInviteCode(url: string): string | null {
  const m = url.match(/[?&]code=([A-Za-z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Open the Connect overlay (code door, prefilled) when an invite link is opened and the
 *  athlete is already in the app. Wired once at the app root; no-op without a code. */
export function useInviteLink(): void {
  const openConnect = useStore((s) => s.openConnect);
  const flow = useStore((s) => s.flow);
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const code = parseInviteCode(url);
      if (code && flow === 'app') openConnect(code);
    };
    void Linking.getInitialURL().then(handle).catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [flow, openConnect]);
}

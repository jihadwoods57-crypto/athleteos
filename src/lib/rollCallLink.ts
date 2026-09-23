// OnStandard — the roll call's native deep link (roll call rebuilt, 2026-09-23).
// The lock-screen widget's body tap opens `onstandard://roll-call/<instanceId>`
// (ios-widget/OnStandardWidget.swift widgetURL). ProtoApp handled only invite links, so that tap
// landed wherever the app last was. This maps the URL to the proto route the tap means: that
// morning's team board. Pure (no imports) so it is unit-tested directly.

const ID = /^[A-Za-z0-9-]{1,64}$/;

/** `onstandard://roll-call/<id>` (or `onstandard://rollcall-board/<id>`) → `rollcall-board/<id>`.
 *  Null for any other URL, an empty id (the widget's no-snapshot case) or an id that is not a
 *  plain token (it is injected into the WebView's hash). */
export function rollCallRouteFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/^onstandard:\/\/(?:roll-call|rollcall-board)\/([^/?#]*)/i);
  if (!m) return null;
  const id = m[1];
  return ID.test(id) ? `rollcall-board/${id}` : null;
}

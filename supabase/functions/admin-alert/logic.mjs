// Pure helpers for admin-alert — testable outside Deno.

export function buildResendPayload({ from, to, subject, body }) {
  return { from, to: [to], subject, text: body };
}

// Suppress a repeat of the same alert kind already sent in the recent window.
export function shouldSend(recentKinds, kind) {
  return !recentKinds.includes(kind);
}

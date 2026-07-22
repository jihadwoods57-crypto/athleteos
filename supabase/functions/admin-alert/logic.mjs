// Pure helpers for admin-alert — testable outside Deno. Owns the ONE professional email template every
// Command Center security alert renders through, so quality is consistent regardless of which caller
// (monitor, recovery fn) triggered it. Table-based layout + inline styles for broad email-client support
// (Gmail/Outlook/Apple Mail all render this reliably, unlike flexbox/grid or <style> blocks in <head>).

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Severity drives the accent color + icon glyph. Unknown kinds fall back to 'info' (blue) rather than
// throwing, since a future caller may introduce a new kind before this map is updated.
const KIND_META = {
  suspicious_login: { severity: 'warning', headline: 'Suspicious sign-in detected', actionLabel: 'Review sign-in activity' },
  account_locked: { severity: 'critical', headline: 'Your admin account was temporarily locked', actionLabel: 'Review sign-in activity' },
  recovery_used: { severity: 'critical', headline: 'Two-factor authentication was reset', actionLabel: 'Review account security' },
};
// Darkened from the original palette to clear WCAG AA (4.5:1) at badge text size (11.5px) - the lighter
// originals (#d92d3c/#b3760a/#1d6fd6) measured 3.5-4.3:1 against their tinted backgrounds, which fails.
const SEVERITY_COLOR = { critical: '#b3273a', warning: '#92400e', info: '#1257a8' };
const SEVERITY_BG = { critical: '#fdecee', warning: '#fdf3e0', info: '#e9f2fd' };
const SEVERITY_LABEL = { critical: 'Security alert', warning: 'Security notice', info: 'Notice' };

export function metaForKind(kind) {
  return KIND_META[kind] || { severity: 'info', headline: null, actionLabel: 'Open Command Center' };
}

// details: Array<{label, value}> rendered as a clean key/value table. actionUrl/actionLabel render a
// single branded CTA button. All dynamic values are HTML-escaped — details can originate from network
// data (IP/geo lookups), so nothing here is trusted input.
export function renderAlertEmail({ kind, subject, body, details, actionUrl, occurredAt }) {
  const meta = metaForKind(kind);
  const color = SEVERITY_COLOR[meta.severity];
  const bg = SEVERITY_BG[meta.severity];
  const label = SEVERITY_LABEL[meta.severity];
  const headline = meta.headline || subject;
  const when = occurredAt ? new Date(occurredAt).toUTCString() : new Date().toUTCString();

  const detailRows = (details || []).map(({ label: k, value: v }) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #eef0f3;color:#6b7280;font-size:13px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
      <td style="padding:9px 0 9px 16px;border-bottom:1px solid #eef0f3;color:#161b22;font-size:13px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-weight:500;text-align:right">${escapeHtml(v)}</td>
    </tr>`).join('');

  const detailsBlock = detailRows ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px">
      ${detailRows}
    </table>` : '';

  const ctaBlock = actionUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px">
      <tr><td style="border-radius:8px" bgcolor="#1d6fd6">
        <a href="${escapeHtml(actionUrl)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background:linear-gradient(120deg,#3b82f6,#33c6d6)">${escapeHtml(meta.actionLabel)} &rarr;</a>
      </td></tr>
    </table>` : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(body)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08)">
        <tr><td style="height:4px;background:linear-gradient(120deg,#3b82f6,#33c6d6);line-height:0;font-size:0">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 0">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:26px;height:26px;border-radius:8px;background:linear-gradient(120deg,#3b82f6,#33c6d6)">&nbsp;</td>
            <td style="padding-left:11px;font-size:15px;font-weight:700;color:#161b22;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">OnStandard
              <div style="font-size:11px;font-weight:400;color:#6b7280;letter-spacing:.02em">Command Center</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:22px 32px 0">
          <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${color};font-size:11.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${label}</span>
        </td></tr>
        <tr><td style="padding:12px 32px 0">
          <h1 style="margin:0;font-size:20px;line-height:1.35;color:#161b22;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(headline)}</h1>
        </td></tr>
        <tr><td style="padding:10px 32px 0">
          <p style="margin:0;font-size:14.5px;line-height:1.6;color:#374151;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(body)}</p>
        </td></tr>
        <tr><td style="padding:0 32px">${detailsBlock}${ctaBlock}</td></tr>
        <tr><td style="padding:28px 32px 0"><div style="height:1px;background:#eef0f3"></div></td></tr>
        <tr><td style="padding:16px 32px 28px">
          <p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#6b7280;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
            Automated security notification for your OnStandard Command Center admin account &middot; ${escapeHtml(when)} UTC
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
            If this wasn't you, sign in and change your password immediately.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const textLines = [headline, '', body];
  if (details && details.length) { textLines.push(''); details.forEach((d) => textLines.push(`${d.label}: ${d.value}`)); }
  if (actionUrl) { textLines.push('', `${meta.actionLabel}: ${actionUrl}`); }
  textLines.push('', `Automated security notification · ${when} UTC`, "If this wasn't you, sign in and change your password immediately.");
  const text = textLines.join('\n');

  return { html, text };
}

export function buildResendPayload({ from, to, replyTo, kind, subject, body, details, actionUrl, occurredAt }) {
  const { html, text } = renderAlertEmail({ kind, subject, body, details, actionUrl, occurredAt });
  const payload = { from, to: [to], subject: `OnStandard Security: ${subject}`, html, text };
  if (replyTo) payload.reply_to = replyTo;
  return payload;
}

// Suppress a repeat of the same alert kind already sent in the recent window.
export function shouldSend(recentKinds, kind) {
  return !recentKinds.includes(kind);
}

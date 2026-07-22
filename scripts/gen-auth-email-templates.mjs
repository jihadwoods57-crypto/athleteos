// OnStandard — generates the 12 Supabase Auth transactional email templates as branded HTML, matching
// the app's real consumer identity (green checkmark mark + "OnStandard" wordmark, cream/white light
// theme — see docs/legal/public/reset.html, the shipped post-reset landing page these emails link to).
// Table-based layout + inline styles for Gmail/Outlook/Apple Mail compatibility (same discipline as the
// admin-alert template in supabase/functions/admin-alert/logic.mjs, which uses the ADMIN blue-teal brand
// — these are deliberately different themes for two different audiences: real end users vs. the founder).
//
// Supabase renders these server-side as Go templates — {{ .Field }} placeholders below are NOT touched
// by this script; they pass through verbatim into the final content Supabase stores and executes.
//
// Usage: node scripts/gen-auth-email-templates.mjs
// Writes rendered previews to supabase/email-templates/*.html (source of truth, version-controlled).

import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = new URL('../supabase/email-templates/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

// Button/mark gradient colors (large surfaces - contrast vs. their own dark text is separately fine).
const GREEN = '#37D586';
const GREEN_DEEP = '#16A34A';
const INK = '#161B22';
const INK2 = '#5B6470';
// MUT and the two badge-text colors are chosen to clear WCAG AA (4.5:1) against their backgrounds at
// small sizes (11.5-12px) - verified: MUT 4.83:1, GREEN_BADGE_TEXT 4.99:1, WARN_BADGE_TEXT 6.44:1.
// The brighter GREEN/GREEN_DEEP above stay reserved for large surfaces (buttons, the mark) where their
// own paired text (#05130B) is separately high-contrast; they are NOT used for small badge text.
const MUT = '#6B7280';
const GREEN_BADGE_TEXT = '#0F7A38';
const CREAM = '#F6F4EE';
const LINE = '#EDEBE3';

function shell({ badge, badgeColor = GREEN_BADGE_TEXT, badgeBg = '#E9F9F0', headline, bodyHtml, ctaLabel, ctaUrl, codeToken, footerNote }) {
  const cta = ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px">
      <tr><td style="border-radius:10px" bgcolor="${GREEN}">
        <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${'#05130B'};text-decoration:none;border-radius:10px;background:linear-gradient(150deg,${GREEN},${GREEN_DEEP})">${ctaLabel}</a>
      </td></tr>
    </table>` : '';

  const code = codeToken ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px">
      <tr><td style="background:${CREAM};border:1px solid ${LINE};border-radius:10px;padding:16px 22px">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:.12em;color:${INK}">${codeToken}</div>
      </td></tr>
    </table>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${headline}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:36px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08)">
        <tr><td style="height:4px;background:linear-gradient(150deg,${GREEN},${GREEN_DEEP});line-height:0;font-size:0">&nbsp;</td></tr>
        <tr><td style="padding:30px 34px 0">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;height:30px;border-radius:9px;background:linear-gradient(150deg,${GREEN},${GREEN_DEEP})">
              <table role="presentation" width="30" height="30" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#05130B" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </td></tr></table>
            </td>
            <td style="padding-left:10px;font-size:17px;font-weight:800;letter-spacing:-.3px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
              <span style="color:${GREEN_DEEP}">On</span><span style="color:${INK}">Standard</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:22px 34px 0">
          <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${badgeBg};color:${badgeColor};font-size:11.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${badge}</span>
        </td></tr>
        <tr><td style="padding:12px 34px 0">
          <h1 style="margin:0;font-size:21px;line-height:1.3;color:${INK};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${headline}</h1>
        </td></tr>
        <tr><td style="padding:10px 34px 0">
          <div style="font-size:14.5px;line-height:1.65;color:${INK2};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:0 34px">${code}${cta}</td></tr>
        <tr><td style="padding:28px 34px 0"><div style="height:1px;background:${LINE}"></div></td></tr>
        <tr><td style="padding:16px 34px 30px">
          <p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:${MUT};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${footerNote}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${MUT};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">OnStandard &middot; onstandard.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const WARN_BADGE = { badgeColor: '#92400E', badgeBg: '#FDF3E0' };

const TEMPLATES = {
  confirmation: shell({
    badge: 'Welcome',
    headline: 'Confirm your email address',
    bodyHtml: "Thanks for joining OnStandard. Confirm this email address to finish setting up your account and start tracking your standard today.",
    ctaLabel: 'Confirm email address', ctaUrl: '{{ .ConfirmationURL }}',
    footerNote: "If you didn't create an OnStandard account, you can safely ignore this email.",
  }),
  invite: shell({
    badge: 'Invitation',
    headline: "You've been invited to OnStandard",
    bodyHtml: 'Someone on your team invited you to create an OnStandard account. Accept the invitation below to get started.',
    ctaLabel: 'Accept invitation', ctaUrl: '{{ .ConfirmationURL }}',
    footerNote: "If you weren't expecting this invitation, you can safely ignore this email.",
  }),
  magic_link: shell({
    badge: 'Sign in',
    headline: 'Your sign-in link',
    bodyHtml: 'Use the button below to sign in to OnStandard. This link expires shortly and can only be used once.',
    ctaLabel: 'Sign in to OnStandard', ctaUrl: '{{ .ConfirmationURL }}',
    footerNote: "If you didn't request this, you can safely ignore this email.",
  }),
  recovery: shell({
    badge: 'Password reset', ...WARN_BADGE,
    headline: 'Reset your password',
    bodyHtml: 'We received a request to reset the password for your OnStandard account. Choose a new password using the button below - this link expires shortly.',
    ctaLabel: 'Reset password', ctaUrl: '{{ .ConfirmationURL }}',
    footerNote: "If you didn't request this, you can safely ignore this email - your password won't change.",
  }),
  email_change: shell({
    badge: 'Confirm change', ...WARN_BADGE,
    headline: 'Confirm your new email address',
    bodyHtml: 'Confirm <strong style="color:' + INK + '">{{ .NewEmail }}</strong> as the new email address for your OnStandard account.',
    ctaLabel: 'Confirm new email address', ctaUrl: '{{ .ConfirmationURL }}',
    footerNote: "If you didn't request this change, you can safely ignore this email - your address won't change.",
  }),
  reauthentication: shell({
    badge: "Verify it's you", ...WARN_BADGE,
    headline: 'Your verification code',
    bodyHtml: 'Enter this code in OnStandard to verify your identity. It expires shortly.',
    codeToken: '{{ .Token }}',
    footerNote: "If you didn't request this code, you can safely ignore this email.",
  }),
  password_changed_notification: shell({
    badge: 'Security', ...WARN_BADGE,
    headline: 'Your password was changed',
    bodyHtml: 'The password for your OnStandard account was just changed.',
    footerNote: "If you didn't make this change, reset your password immediately and contact support.",
  }),
  email_changed_notification: shell({
    badge: 'Security', ...WARN_BADGE,
    headline: 'Your email address was changed',
    bodyHtml: 'The email address for your OnStandard account was changed from <strong style="color:' + INK + '">{{ .OldEmail }}</strong> to <strong style="color:' + INK + '">{{ .Email }}</strong>.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
  phone_changed_notification: shell({
    badge: 'Security', ...WARN_BADGE,
    headline: 'Your phone number was changed',
    bodyHtml: 'The phone number for your OnStandard account was changed from <strong style="color:' + INK + '">{{ .OldPhone }}</strong> to <strong style="color:' + INK + '">{{ .Phone }}</strong>.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
  mfa_factor_enrolled_notification: shell({
    badge: 'Security',
    headline: 'A new verification method was added',
    bodyHtml: 'A new sign-in verification method (<strong style="color:' + INK + '">{{ .FactorType }}</strong>) was added to your OnStandard account.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
  mfa_factor_unenrolled_notification: shell({
    badge: 'Security', ...WARN_BADGE,
    headline: 'A verification method was removed',
    bodyHtml: 'A sign-in verification method (<strong style="color:' + INK + '">{{ .FactorType }}</strong>) was removed from your OnStandard account.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
  identity_linked_notification: shell({
    badge: 'Security',
    headline: 'A new sign-in method was linked',
    bodyHtml: 'Your <strong style="color:' + INK + '">{{ .Provider }}</strong> account was linked as a new sign-in method for <strong style="color:' + INK + '">{{ .Email }}</strong>.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
  identity_unlinked_notification: shell({
    badge: 'Security', ...WARN_BADGE,
    headline: 'A sign-in method was removed',
    bodyHtml: 'Your <strong style="color:' + INK + '">{{ .Provider }}</strong> account was removed as a sign-in method for <strong style="color:' + INK + '">{{ .Email }}</strong>.',
    footerNote: "If you didn't make this change, contact support immediately.",
  }),
};

for (const [name, html] of Object.entries(TEMPLATES)) {
  writeFileSync(new URL(`${name}.html`, OUT_DIR), html);
  console.log(`wrote supabase/email-templates/${name}.html (${html.length} bytes)`);
}

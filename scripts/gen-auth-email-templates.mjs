// OnStandard — generates the 13 Supabase Auth transactional email templates as branded HTML, matching
// the ACTUAL app brand (docs/brand/LOGO.md + src/brand/Logo.tsx + src/ui/tokens.ts — the founder-ratified
// source of truth), not a guess from one page. Primary accent is "Athlete Blue" #2563EB (tokens.ts
// `accent`); the signature sweep gradient (founder-ratified 2026-07-14) is green->teal->blue
// #34D399 -> #22D3EE -> #3B82F6; the wordmark is "On" in ink #0F172A + "Standard" in the blue accent —
// exactly as LOGO.md specifies. Green/success color is semantic-only in the real app (tokens.ts
// `success`), never the brand identity — an earlier version of this file wrongly generalized from a
// single success-checkmark icon on one page into "green is the brand," which was incorrect.
//
// Table-based layout + inline styles for Gmail/Outlook/Apple Mail compatibility (same discipline as the
// admin-alert template in supabase/functions/admin-alert/logic.mjs, which uses the ADMIN dark blue-teal
// theme — deliberately a different look for a different audience: the founder, not real end users).
//
// Supabase renders these server-side as Go templates — {{ .Field }} placeholders below are NOT touched
// by this script; they pass through verbatim into the final content Supabase stores and executes.
//
// Usage: node scripts/gen-auth-email-templates.mjs
// Writes rendered previews to supabase/email-templates/*.html (source of truth, version-controlled).

import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = new URL('../supabase/email-templates/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

// Real brand tokens (src/ui/tokens.ts, light palette) + the ratified signature sweep (docs/brand/LOGO.md).
const ACCENT = '#2563EB';       // tokens.ts `accent` - "Athlete Blue", the real primary
const ACCENT_LIGHT = '#3B82F6'; // tokens.ts `accentLight`
const ACCENT_SURFACE = '#EFF6FF'; // tokens.ts `accentSurface` - used for the default badge bg
const SWEEP = `linear-gradient(120deg,#34D399,#22D3EE,${ACCENT_LIGHT})`; // the ratified signature sweep
const INK = '#0F172A';          // tokens.ts `text`
const INK2 = '#475569';         // tokens.ts `slate600` - verified 7.58:1 on white
const MUT = '#6B7280';          // verified 4.83:1 on white (WCAG AA)
// Badge text colors, chosen to clear WCAG AA (4.5:1) against their tinted backgrounds at 11.5px:
// ACCENT_BADGE_TEXT 4.75:1 on ACCENT_SURFACE; WARN_BADGE_TEXT (amber, matches tokens.ts `warningDeep`
// family) 6.44:1 on its tint. Warning stays amber (a real semantic distinct from brand blue), matching
// the app's own warning token - it was never the green/blue question.
const ACCENT_BADGE_TEXT = ACCENT;
const BG = '#F8FAFC';           // tokens.ts `bg`
const LINE = '#E2E8F0';         // tokens.ts `hairline`-ish

function shell({ badge, badgeColor = ACCENT_BADGE_TEXT, badgeBg = ACCENT_SURFACE, headline, bodyHtml, ctaLabel, ctaUrl, codeToken, footerNote }) {
  const cta = ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px">
      <tr><td style="border-radius:10px" bgcolor="${ACCENT}">
        <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;background:linear-gradient(150deg,${ACCENT_LIGHT},${ACCENT})">${ctaLabel}</a>
      </td></tr>
    </table>` : '';

  const code = codeToken ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px">
      <tr><td style="background:${BG};border:1px solid ${LINE};border-radius:10px;padding:16px 22px">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:.12em;color:${INK}">${codeToken}</div>
      </td></tr>
    </table>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${headline}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:36px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08)">
        <tr><td style="height:4px;background:${ACCENT};background:${SWEEP};line-height:0;font-size:0">&nbsp;</td></tr>
        <tr><td style="padding:30px 34px 0">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:30px;height:30px;border-radius:9px;background:${ACCENT};background:${SWEEP}">
              <table role="presentation" width="30" height="30" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </td></tr></table>
            </td>
            <td style="padding-left:10px;font-size:17px;font-weight:800;letter-spacing:-.3px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
              <span style="color:${INK}">On</span><span style="color:${ACCENT}">Standard</span>
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

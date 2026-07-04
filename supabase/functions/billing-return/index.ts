// OnStandard — billing-return: the tiny public page the browser lands on after Stripe
// Checkout or the Billing Portal. Static, no data, no auth — its whole job is to say
// "you're set, head back to the app" and offer the deep link. Deploy with JWT OFF
// (a browser GET carries no Supabase JWT):
//   supabase functions deploy billing-return --no-verify-jwt
//
// The `state` query param is matched against a fixed allowlist and never echoed raw,
// so nothing user-controlled reaches the page (no reflected-XSS surface — the same
// discipline as guardian-verify after the 0035 audit).

const COPY: Record<string, { title: string; body: string }> = {
  success: {
    title: 'You are in.',
    body: 'Payment confirmed. Head back to the OnStandard app — your plan is active and your roster is unlocked.',
  },
  cancel: {
    title: 'No charge was made.',
    body: 'Checkout was canceled. You can restart it from the app any time.',
  },
  done: {
    title: 'All set.',
    body: 'Your billing changes are saved. Head back to the OnStandard app.',
  },
};

function page(state: string): string {
  const c = COPY[state] ?? COPY.done;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OnStandard</title>
<style>
  body{margin:0;font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e7ecf5;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
  main{max-width:420px;padding:32px}
  h1{font-size:26px;margin:0 0 10px;letter-spacing:-0.02em}
  p{font-size:15px;line-height:1.55;color:#9fb0c9;margin:0 0 26px}
  a{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;
    padding:14px 26px;border-radius:12px;font-size:15px}
  small{display:block;margin-top:18px;color:#64748b;font-size:12px}
</style></head>
<body><main>
  <h1>${c.title}</h1>
  <p>${c.body}</p>
  <a href="onstandard://">Open OnStandard</a>
  <small>If the button does nothing, just switch back to the app on your phone.</small>
</main></body></html>`;
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? 'done';
  return new Response(page(state in COPY ? state : 'done'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
});

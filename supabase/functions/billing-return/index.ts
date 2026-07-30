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
  // Pay-first purchase from a trainer's public page (0166). The buyer has no account yet, so the
  // page has to hand them the claim code that turns the payment into an account + premium.
  claim: {
    title: 'Payment confirmed.',
    body: 'Download OnStandard, create your account, and enter this code to connect with your trainer. Your membership is included.',
  },
};

/** The claim block, rendered only for state=claim. The code is fetched CLIENT-SIDE from
 *  public-offer-checkout rather than templated in, because the webhook that mints it races this
 *  redirect — Stripe sends the buyer here the moment payment succeeds, often before the webhook
 *  lands. So the page polls briefly instead of rendering "no code" once and being wrong.
 *
 *  Nothing user-controlled is interpolated: the session id is read from the URL by the script and
 *  only ever sent in a JSON body, never written into the DOM. The code is set via textContent. */
function claimBlock(fnBase: string): string {
  return `
  <div id="claim-wrap" style="margin:0 0 22px">
    <div id="claim-code" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;
         font-weight:800;letter-spacing:0.06em;background:#111c2f;border:1px solid #22314d;
         border-radius:12px;padding:16px 12px;color:#e7ecf5">…</div>
    <div id="claim-note" style="font-size:12px;color:#64748b;margin-top:10px">Fetching your code…</div>
  </div>
  <script>
  (function(){
    var p = new URLSearchParams(location.search);
    var sid = p.get('session') || '';
    var el = document.getElementById('claim-code');
    var note = document.getElementById('claim-note');
    if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) {
      el.textContent = '—';
      note.textContent = 'Check your email for your code.';
      return;
    }
    var tries = 0;
    function poll(){
      tries++;
      fetch(${JSON.stringify(fnBase)} + '/public-offer-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', sessionId: sid })
      }).then(function(r){ return r.json(); }).then(function(d){
        if (d && d.code) {
          el.textContent = d.code;
          note.textContent = 'Single use. Keep this code — you will need it when you create your account.';
          return;
        }
        if (d && d.claimed) {
          el.textContent = '✓';
          note.textContent = 'This code has already been used. You are all set.';
          return;
        }
        if (tries < 10) return setTimeout(poll, 1500);
        el.textContent = '—';
        note.textContent = 'Still processing — refresh in a moment, or check your email.';
      }).catch(function(){
        if (tries < 10) return setTimeout(poll, 1500);
        el.textContent = '—';
        note.textContent = 'Still processing — refresh in a moment, or check your email.';
      });
    }
    poll();
  })();
  </script>`;
}

function page(state: string): string {
  const c = COPY[state] ?? COPY.done;
  // Same origin as this function, so the claim lookup needs no configured base URL.
  const fnBase = Deno.env.get('SUPABASE_URL') ? `${Deno.env.get('SUPABASE_URL')}/functions/v1` : '/functions/v1';
  const extra = state === 'claim' ? claimBlock(fnBase) : '';
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
  ${extra}
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

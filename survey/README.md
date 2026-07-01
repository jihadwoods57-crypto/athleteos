# OnStandard — Coach Validation Survey

A standalone, mobile-first survey for validating demand and finding beta coaches.
One `index.html` file. No build step, no framework. Branches by role + clientele,
pipes the respondent's audience into every question, sends results to a Google Sheet.

## Files
- `index.html` — the survey itself. Open in any browser; works on phones.
- `AppsScript.gs` — the Google Sheet collector (paste into Apps Script).
- `README.md` — this file.

## Run it locally (test the flow)
Just open `index.html` in a browser, or serve it:
```
cd survey
python -m http.server 8090     # then open http://localhost:8090
```
With no `ENDPOINT` set, submissions print to the browser console (DevTools)
instead of going to a Sheet — handy for testing.

## Wire up the Google Sheet (2 minutes)
1. New Google Sheet → **Extensions ▸ Apps Script**.
2. Paste `AppsScript.gs`, save.
3. **Deploy ▸ New deployment ▸ Web app** → Execute as **Me**, access **Anyone** → Deploy.
4. Copy the `/exec` URL.
5. Open `index.html`, set `const ENDPOINT = "https://script.google.com/.../exec";`
6. Re-deploy the HTML wherever coaches will hit it.

Rows append automatically; new fields become new columns.

## Publish it (pick one)
- **Netlify Drop** — drag the `survey` folder onto app.netlify.com/drop → instant URL.
- **GitHub Pages / Vercel** — push the folder, point at `index.html`.
- **Cloudflare Pages** — connect repo or direct upload.

## The flow (branching)
```
Intro → Q1 role → Q2 clientele (multi) → [Q2b primary if >1] → ROUTER
  ↳ athlete clientele  → athlete-worded Q3,Q5,Q7
  ↳ fitness clientele  → fitness-worded Q3,Q5,Q7
Q4 how-you-know → [Q4b which app, if "software"]
Q6 pain frequency → Q8 magic-wand (open) → Q9–Q11 value scales → Q11b paid-before?
Q12 beta interest → [Capture if Yes/Maybe] → End
```

## Reading the results (what to look for)
- **Problem real?** Q6 frequency × Q5/Q7 consequence.
- **Strongest segment?** Group by `primary_clientele`, rank by avg(Q9,Q10,Q11).
- **Hot leads to interview:** Q4 = "I mostly don't know" + Q6 ≥ Often + a vivid Q8.
- **Beta priority:** Q12 = Yes, larger `client_count`, Q11b = "Yes" (already pays).

## Customize
- Questions/wording: edit the `Q` array in `index.html`.
- Brand: CSS variables at the top match `DESIGN.md` (Athlete Blue, Plus Jakarta Sans).
- Add/remove a branch: give a question a `when:(s)=>...` predicate or a `optionsFn()`.

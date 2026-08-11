# Expo HAS CHANGED

This app is on **Expo SDK 57** (`expo ~57.0.8`, `expo-router ~57.0.8`, React Native 0.86,
React 19.2). Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing any code — the unversioned docs track whatever is newest and will hand you APIs this
app does not have.

If `package.json` and this line ever disagree, `package.json` wins and this file is stale. It
said v56 for the whole of the SDK 57 cycle, which sent every agent that read it — and this is
the only standing instruction any of them get, since CLAUDE.md is just `@AGENTS.md` — to the
wrong version's documentation.

## The shipped UI is the proto, not `src/`

`proto/redesign-2026-07/` is the real app: plain ES modules, HTML and CSS with **no build step**,
bundled into `assets/proto.zip` and delivered over the air. `src/` is a legacy React Native
engine that mostly renders nothing. Audit and change the proto; do not assume a fix in `src/`
reaches a user.

Because there is no bundler, a missing import or a typo'd identifier throws at **click time**,
not at build time. `npm run verify` is what catches it.

## Before you claim anything works

`npm run verify` runs all nine gates and prints a verdict for each — it no longer stops at the
first failure, so you see the whole tree at once. `npm run verify:full` adds the SQL
authorization suite (needs a local Supabase stack). Neither ever reports a gate that did not run
as one that passed.

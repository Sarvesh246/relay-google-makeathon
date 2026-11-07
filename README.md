# Handoff: Relay — Student Org Officer Dashboard

## Local preview

With Node.js installed, run `npm run dev` and open http://localhost:3000.
No dependency installation is needed. This serves the interactive
app built from `Relay.dc.html` (the source of truth), including the glass-style sidebar and dashboard. To use a
different port, run `PORT=3001 npm run dev`.

## The Playbook (Gemini) and club memory

The Playbook panel (⌘K) is backed by `api/chat.mjs`, which asks Gemini and grounds every answer in the club's own docs. Think of it as a very well-read outgoing officer: it knows the rules, the recaps, and what worked or didn't.

**Two-minute setup**
1. Copy `.env.example` to `.env.local` and paste your key after `GEMINI_API_KEY=`. This file is gitignored.
2. `npm run dev`, open http://localhost:3000, press ⌘K.
3. In production, add the same `GEMINI_API_KEY` in Vercel (Project Settings → Environment Variables). The key only ever lives on the server.

No key? The Playbook still works with its built-in sample answers, so demos never break.

**How it remembers.** `knowledge/seed.json` holds the starter docs. At handoff, outgoing officers use **Docs → Import for handoff** to add TAMU rules, event recaps and "what worked / what didn't" notes. Every question retrieves the most relevant docs and sends them to Gemini. If the club has done the thing before, it gets the history and a recommendation; if not, it says so plainly and works from the closest precedents.

Heads up: imported docs are saved in the browser for now (so they follow that officer's browser, not the whole club). Moving them to shared storage is the next step.

### Google Drive sync (Docs tab)

Docs → **Google Drive** → paste the folder link → **Connect and sync**. Relay reads that folder (and its subfolders) and turns the documents into Playbook memory. It mirrors the folder, so a doc deleted from Drive disappears on the next sync, and docs imported by hand are left alone. Google Docs and Slides are read as text, Sheets as CSV, and `.md`/`.txt` files as-is. PDFs and images are skipped (and counted).

How it stays safe: each officer signs in with their own organization Google account (read-only access), and Relay reads Drive from their browser with that sign-in. There is no client secret and no server-side copy of anyone's token, so Relay can only see what that officer can see, and nobody who isn't signed in can read your Drive through the site.

**One-time admin setup (about 10 minutes)**
1. In [Google Cloud Console](https://console.cloud.google.com/), use the same project as the Gemini key and enable the **Google Drive API**.
2. **OAuth consent screen**: choose **External** to allow organizations outside your Google Workspace. Add the scope `.../auth/drive.readonly`. While the app is in testing, add each connecting account as a test user. Google verification may be required for broader access.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Under *Authorized JavaScript origins* add your site (for example `https://relay-google-makeathon.vercel.app`) and `http://localhost:3000`. No redirect URI is needed.
4. In Vercel (Project Settings → Environment Variables) add:
   - `GOOGLE_CLIENT_ID`: optional override for the public client ID configured in `api/config.mjs`.
   - `GOOGLE_ALLOWED_DOMAIN`: your organization's domain, e.g. `tamu.edu`. Optional, but it rejects personal accounts.
   - `GOOGLE_DRIVE_FOLDER_ID`: optional. Prefills the club's folder so officers just click connect.
5. Redeploy. For local dev, put the same variables in `.env.local`.

Heads up: synced docs are saved in each officer's browser (like imports), so every officer syncs once on their own machine. Shared storage is the next step.

### Marketing posts (Posts tab)

Type what the post is about, hit **Create post**, get a finished 4:5 graphic plus caption. Posts look consistent because the AI never designs anything: it only proposes words. The layout, fonts, colors and motifs are fixed in `poster.js`, and every post is drawn by that one renderer.

Guardrails, enforced in code (`lib/brand.mjs`, `api/post.mjs`) rather than just asked for in a prompt:
- **No invented facts.** Dates, times, places and prices only appear if you typed them. If the model gets one wrong, Relay uses your version; if you didn't give one, it's left out and Relay tells you what's missing.
- **No fake imagery.** Nano Banana (`gemini-2.5-flash-image`) may only draw flat abstract graphics. Its prompt is built from fixed menus, so nothing you type reaches the image model. A second Gemini pass inspects the result and rejects people, faces, photos, realistic scenes, text and logos. Anything rejected (or if inspection fails) is replaced by a built-in graphic.
- **Real photos only.** "Add a real photo" drops your own photo into the template. Nothing photographic is ever generated.
- **Fixed brand.** Two templates, six motifs, two accent colors, club fonts, capped text lengths, no emoji or links, hashtags from an allow-list.

Google Flow has no public API, so it isn't wired in. Video would also cut against the no-fake-footage rule. The posts use Gemini and Nano Banana through the same `GEMINI_API_KEY`; set `GEMINI_IMAGE_MODEL` to change the image model.

`npm test` runs the retrieval, guardrail and API tests (no network or key needed).

## Overview
Relay is a dashboard for student-organization officers (sample org: Aggie Robotics). It covers day-to-day ops (events, money, people, social posts) and continuity (officer handoffs, an archive of club docs). A slide-in "Playbook" panel answers questions from the club's docs with cited sources.

## About the Design Files
`Relay-standalone.html` is a **high-fidelity, fully interactive HTML prototype** — open it in any browser (works offline). It is the visual and behavioral source of truth. `Relay.dc.html` (+ `support.js`) is the editable source of the same prototype: the template markup holds every inline style verbatim, and the `<script data-dc-script>` class holds all state, data, and handlers.

The task is to **recreate this design in a real codebase** (recommended if none exists: React + TypeScript + Vite, plain CSS modules or Tailwind with the tokens below). Do not ship the HTML directly. Match it pixel-for-pixel: every value you need is either in this README or literally in `Relay.dc.html`.

**How to read `Relay.dc.html`:** markup between `<x-dc>` and `</x-dc>` is JSX-like. `{{ name }}` = a value returned from `renderVals()` in the script. `<sc-if value>` = conditional render, `<sc-for list as>` = map. `style-hover` / `style-active` / `style-focus` = `:hover` / `:active` / `:focus` styles. Computed style strings (e.g. `sideStyle`, `t.row`) are built in `renderVals()` — copy them exactly.

## Fidelity
**High-fidelity.** Final colors, type, spacing, copy, motion and interactions.

## Design Tokens

### Fonts (Google Fonts)
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=Geist+Mono:wght@400..600&display=swap
```
- **Display** — Bricolage Grotesque: page titles 700 22px/1.15 ls −.025em; card titles 700 15px/1; KPI values 700 26px/1 ls −.025em; hero title 800 42px/1 ls −.035em; hero countdown 800 128px/.8 ls −.06em; event detail title 800 30px/1.05 ls −.03em; interview question 700 22px/1.25; wordmark "relay" 800 20px ls −.03em (lowercase).
- **UI/body** — Instrument Sans: base 14px/1.45; secondary 12.5–13.5px; weights 500/600.
- **Mono** — Geist Mono: eyebrows/labels 500 10.5px/1 ls .08em UPPERCASE; nav group heads 500 10px ls .1em; pills 500 11px; figures/dates 12–13px.
- Body: `-webkit-font-smoothing: antialiased`; `box-sizing: border-box` globally.

### Colors — Light (default)
| token | hex | use |
|---|---|---|
| bg | #F2EFE7 | page |
| card | #FFFFFF | cards |
| sub | #F7F4EE | insets, tracks, hovers |
| line | #E3DED3 | borders/dividers |
| tx | #16161D | text |
| mu | #666471 | muted text |
| ok / okS | #13784A / #DDF1E4 | success |
| warn / warnS | #965700 / #FAEDD3 | warning |
| ink | #16161D | hero, handoff board, sidebar, toast |
| inkTx / inkMu | #F2EFE7 / #A3A1AD | text on ink |
| inkLine | rgba(255,255,255,.055) | track-lane lines on ink |
| sh | 0 1px 0 rgba(22,22,29,.04) | card shadow |
| drawerSh | 0 24px 60px rgba(22,22,29,.18) | Playbook panel |

### Colors — Dark
bg #0D0E13 · card #16171E · sub #1C1D25 · line #272833 · tx #EFECE4 · mu #9C9AA7 · ok #63D193 / okS #13301F · warn #EFB352 / warnS #33260C · ink #07080C · inkTx #F2EFE7 · inkMu #8F8D9B · inkLine rgba(255,255,255,.045) · sh none · drawerSh 0 24px 60px rgba(0,0,0,.55)

### Accent (brand) — 3 variants, default Vermilion
| | ac | onAc (text on ac) | acHi (on ink) | acT light/dark (accent text) | acS light/dark (accent tint) |
|---|---|---|---|---|---|
| Vermilion | #FF5A1F | #17130F | #FF6A2E | #B23A0C / #FF8F63 | #FFE6DA / #3A1B0F |
| Cobalt | #3456FF | #FFFFFF | #8A9BFF | #2A44D4 / #97A6FF | #E3E8FF / #1A2052 |
| Maroon | #8E1B3B | #FFFFFF | #F2839C | #8E1B3B / #F2839C | #F7E1E7 / #3A1421 |

### Sidebar tone
- **Ink (default):** sb = ink, sbTx #F2EFE7, sbMu #8F8D9B, sbSel rgba(255,255,255,.08), sbLine rgba(255,255,255,.08), sbAc = acHi.
- **Paper:** sb #EAE6DC (dark: #121319), sbTx = tx, sbMu = mu, sbSel rgba(22,22,29,.07) (dark rgba(255,255,255,.07)), sbLine = line, sbAc = ac (light) / acHi (dark).

### Radii, spacing, borders
- Radii: cards 12px; hero/board/drawer 14px; buttons/inputs 8–10px; pills 5px; checkboxes 6px; bars 3–5px.
- Spacing: section gap **12px** everywhere; main padding 14px 20px 28px; card header 12px 16px; list rows 9–10px 16px; max content width 1320px.
- Borders: 1px solid line. Stat strips: container `border:1px line; radius 12; overflow hidden`, grid `repeat(auto-fit,minmax(min(100%,150px),1fr))`, cells `box-shadow:1px 1px 0 var(--line)` (no orphan gap fill).

### Brand motifs (CSS only, no images)
- **Track lanes:** `repeating-linear-gradient(180deg, transparent 0 33px, inkLine 33px 34px)` behind hero (11px pitch on post tiles).
- **Exchange zone stripes:** `repeating-linear-gradient(115deg, acHi 0 2px, transparent 2px 14px)` at opacity .14 (hero right 230px) / .35 (lane end, 8px pitch).
- **Baton:** skewX(−18 to −20deg) rounded rectangle; logo = two 5×17 skewed bars on a 34px ac square (second bar 50% opacity, offset ±2px).

## Motion
Easing everywhere: **cubic-bezier(.2,.8,.2,1)** (call it `E`).
```css
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes pop{0%{transform:scale(.3);opacity:0}65%{transform:scale(1.18);opacity:1}100%{transform:scale(1)}}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,14px) scale(.96)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes shimmer{from{background-position:-240px 0}to{background-position:240px 0}}
@keyframes batonIn{from{left:0}}
```
- Screen mount: `rise .45s E both`. List rows: `rise .4s E` staggered **35ms × index**.
- Progress bars: `grow .8s E both`, `transform-origin:left`, plus `transition: width .5s E` for value changes (staggered 80ms on Money bars).
- Batons: `batonIn .9–1s E both` + `transition:left .5–.6s E`.
- Sidebar: width 236 ↔ 68px, `.32s E`; labels opacity .2s (delay .08s on expand); chevron rotates 180°; term card collapses max-height/padding.
- Playbook drawer: `transform translateX(calc(100% + 24px)) → 0`, `.42s E`, opacity .3s; pointer-events none when closed. Input autofocuses 320ms after open.
- Playbook answers: typing dots (blink 1s, 0/.15/.3s delays) for 700ms, then text streams **2 words / 28ms**; source chips `rise` in once complete.
- Checkbox tick: `pop .35s E`. Toast: `toastIn .35s E`, auto-dismiss 2.6s.
- People filter: sliding indicator 116px wide, `transform .35s E`.
- Post writing: shimmer skeleton row for 1.1s, then new post rises in.
- Buttons: `:active scale(.97)`; outline buttons hover border → ac.

## Layout Shell
Full-viewport `display:flex; height:100vh; overflow:hidden`.
1. **Sidebar** (236px / 68px collapsed): logo row (40px) → org chip ("AR" · Aggie Robotics · FALL '26 · 45 MEMBERS) → nav (scrolls if short; groups TODAY / RUN THE CLUB / PASS IT ON) → "BATON PASS · APR 28" card with handoff % (hidden when collapsed or viewport height < 640px) → user row (JE · Jordan Ellis · President) → Collapse button. Nav item: 36px tall, radius 9, active = sbSel bg + sbTx + icon in sbAc; badge = 18px ac circle with onAc mono number (becomes 14px dot-badge at top-right when collapsed).
2. **Main column:** header 62px (eyebrow mono + Bricolage title; "Ask the Playbook…" search-style button, flex 0 1 300px, 38px, with ⌘K kbd; theme toggle 38px square). Scrollable main below.
3. **Playbook drawer:** absolute, top/right/bottom 10px, width min(392px, 100% − 20px), overlays content (does not push).
4. **Toast:** absolute bottom 22px, centered, ink pill.

Nav → screen ids: Overview `home`, Events `evt`, Money `fin`, People `mem`, Posts `mkt`, Handoff `hand`, Docs `arc`.

## Screens
All copy is final — take exact strings from `Relay.dc.html`.

**Overview** — Ink hero (Robo-Rumble 2026, NEXT EVENT eyebrow, 6 readiness segments 22×6px, up to 2 "missing" chips, buttons "Open event plan" (ac) and "What went wrong last year?" (ghost), giant "8 / DAYS OUT"). KPI strip (Balance, Dues, Avg attendance, Handoff — each clickable to its screen). Row: "This week" card (flex 1.6, 5 checkable tasks with due pill + action button, "N OF 5 DONE" + mini bar) and right column (flex 1): Calendar (4 items, mono month + Bricolage day) and Handoff board mini (4 lanes with bar + baton).

**Events** — Left list card (360px): 5 events, selected row has `inset 3px 0 0 ac` + sub bg. Right detail: eyebrow, title, Playbook ask button, 3-stat strip. Upcoming → run-of-show checklist (6 toggles; "Promo post live" links to Posts and reflects post approval), "Cost check" block → "Run check" reveals $2,200–2,600 range. Past → Budget vs actual bars, KEEP (okS) / FIX NEXT TIME (acS) notes.

**Money** — 4-cell KPI strip; Money in (green bars) / Money out by event (accent bars); Transactions table (grid 64px | 1fr | 120 | 120 | 90, min-width 560, horizontal scroll), "Needs signature" warn pill on >$500.

**People** — Segmented filter (All / Eligible / Owe dues / Below 70%, with counts, sliding indicator), rule hint, "Text dues reminder · 2" button (→ "Reminders sent", toast, unpaid members show "Reminded"). Table: member avatar+name+role, dues pill, attendance bar (green ≥70 else accent), points, officer pill.

**Posts** — Composer (textarea w/ focus ring `0 0 0 3px acS`, tone chips Hype/Info/Short, "Write caption" → "Writing…" shimmer → new draft at top using the tone's caption). Queue: 84px 4:5 ink poster tile (uppercase Bricolage title in acHi + mono meta over lanes), caption, status pill, "Approve · Thu 10am" → scheduled + toast.

**Handoff** — Ink "Relay board": 4 lane rows (grid 36 | 150 | 1fr | 92): lane number, role/name, track with dashed centerline, striped exchange zone (right 13%), glowing baton at progress, status. Click selects. Treasurer → Exit interview card (4-segment progress, question, answer, Back / Next question / "Finish and file" → toast) beside a live Handoff doc whose 4 sections fill in (rise) as questions advance (skeleton bar until then). Other roles → summary card; VP Events offers "Send Priya an interview invite".

**Docs** — Filter input (38px) + table (Document w/ file icon | Type pill (Handoff = accent) | Written by | Year | Used ×N). Empty state: `No documents match "q".`

**Playbook drawer** — header (ink icon tile, "Playbook", "Answers from 18 club docs, with sources", close). Messages: user = tx-filled bubble (radius 12 12 3 12), answer = plain text 1.6 lh; source chips (24px, acT text) jump to Docs filtered by that source. "TRY ASKING" suggestions vary per screen. Input "How did we…" + 32px ac send button. Keyword routing to canned answers lives in `classify()`; replace with a real retrieval backend.

## Interactions & State
State (see `state = {…}` in script): `tab, dark, side, ai, draft, typing, msgs[], toast, evt, est, memF, step(0–4), q, role, reminded, nudged, writing, tone, check{room,cater,judges,brackets,budget}, tasks{}, mkt, posts[]`.
- ⌘K / Ctrl+K toggles Playbook; Esc closes it.
- Overview tasks and Events checklist share state (`check.room`, `check.cater`); "Approve post" task toggles the Robo-Rumble post status; dues task ↔ `reminded`.
- Readiness count (hero segments, checklist label) = checklist items done; Handoff % = average of 4 lanes (Treasurer = step/4).
- Sidebar badges: People = unpaid count (hidden after reminder), Posts = pending approvals.
- Tweakable props: `accent` (Vermilion | Cobalt | Maroon), `sidebar` (Ink | Paper), `startTab`.
- Responsive: cards use flex-wrap with flex-basis (e.g. `1.6 1 480px` / `1 1 300px`); tables scroll horizontally with min-widths; header title ellipsizes.

## Assets
No raster images. Icons are inline 24×24 stroke SVG paths (stroke-width 1.8, round caps/joins) — path data is in `I={…}` in the script; any Lucide-equivalent set at 18px is fine if it matches. Post images are CSS placeholder tiles — replace with real uploads.

## Files
- `Relay-standalone.html` — single offline file; open to see exact look and behavior.
- `Relay.dc.html` + `support.js` — editable source (template + logic + data).
- `README.md` — this spec.

## Suggested prompt for Codex
> Recreate `Relay-standalone.html` as a React + TypeScript app. Treat `Relay.dc.html` as the source of truth for markup, inline styles, copy, data, and behavior, and `README.md` for tokens and motion. Match it pixel-for-pixel, including all animations (easing cubic-bezier(.2,.8,.2,1)), light/dark themes, accent variants, collapsible sidebar, Playbook drawer, and every interaction listed. Put tokens in CSS variables with the exact names in the README.


## Events calendar

Events now includes a Monday-first month calendar with previous/next navigation, a Today shortcut, date selection, and links to existing event plans. Add Event saves a title, date, optional time, and location in this browser; saved events survive reloads and can be removed from the selected day’s agenda. This calendar does not sync with Google Calendar. Historical plans without exact dates remain in the list below the calendar. Date logic in `calendar-model.js` is tested for leap years, year boundaries, Chicago time, and daylight-saving changes.

# Skunk Watch: build plan

Kate's copy. Decisions, stage gates, and what to verify yourself.
Started 2026-11-07.

## What this is

A page you check before letting the dog into the yard. It estimates how likely
a skunk is to be active near you right now, from sun position, season, and
weather. It works for a single user with no network, on day one, anywhere in
North America.

Sightings reported by other users come later and improve the estimate. They are
not the core feature, because an alert network with four users alerts nobody.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Audience | Strangers, public | Decided 2026-11-07 |
| Format | PWA, installable, no app store | One codebase, free, no $124/yr in fees, no review |
| Native app | Later, via Capacitor wrap of the same code | ~1 day of config once there's reason to |
| Core feature | Risk score, not sightings | Works with zero other users; no cold-start problem |
| Dusk notification | Cut | Everyone can see it's dusk; a daily alert gets muted |
| Geographic scope | North America, latitude-general | Temperature-driven, so it self-adjusts |
| Species field | In the schema from day one, skunk only at launch | Retrofitting means a migration |
| Free text in reports | None, ever | It's the one dox vector no design can close |
| Output direction | Warns only; never reassures | Unvalidated weights can't support an all-clear, and skunks carry rabies |
| Levels | quiet / elevated / high, where quiet shows nothing | Three states, no green light |
| Report types | saw live / smelled fresh / smelled faint / roadkill | Smell is the commonest observation; roadkill is baseline evidence only |
| Vet advice line | Cut | Clutter on a page whose job is one glance |
| Geolocation prompt | Only on a button press, never first load | A permission wall before anything works loses users |
| Code location | C:\Users\kenne\Repos\skunk-tracker | Not the vault; Obsidian Sync and node_modules don't mix |

## Stages

Each stage ends at a gate you check before the next one starts.

### Stage 1: risk score, no server, no accounts
**Effort: 3-4 hrs, plus ~1 hr to make it latitude-general.**

One HTML file plus an isolated `risk.js`. Browser geolocation, one call to
Open-Meteo for temperature and recent precipitation, a level and its reasons on
screen. Nothing stored, no database, no account.

**Gate:** 
- The six hand-checked test cases in SPEC.md pass, and you have read the
  assertions yourself and agree with them.
- Computed sunset for Hamilton today matches a published value within a minute.
- It renders correctly on your actual phone, installed to the home screen.

### Stage 2: use it through one season
**Effort: 0 hrs of building.**

Open it before letting Charlie out. Keep a one-line note each time: what the app
said, what actually happened. Thirty entries is enough to see whether "high"
nights differ from "minimal" nights.

**Gate:**
- Do you still open it after three weeks? If not, stop here. That is the
  cheapest possible kill signal and it costs nothing to accept.
- Do high-scoring nights actually produce more skunk evidence (sightings, smell,
  dug lawn) than low-scoring ones? If the answer is no, fix the weights before
  building anything else.

### Stage 3: public hosting and a shareable link
**Effort: 1-2 hrs.**

Cloudflare Pages or Netlify, free tier. A domain if you want one, ~$15/yr.
Still no accounts, still no database, so still nothing to breach.

**Gate:** Five people you don't live with can install it from a link without
you talking them through it.

### Stage 4: sightings
**Effort: one weekend, ~8-10 hrs.**

Report form (species, cell, hour, optional "went under a deck/shed/porch"
checkbox). Grid-snapped storage, three retention tiers, device-local filtering.
The privacy design in SPEC.md is not optional and not negotiable with the agent.

**Gate:** You have personally read the ingest function that discards the raw
coordinate. It is about ten lines. Read those ten lines.

### Stage 5: stores, if warranted
**Effort: ~1 day plus $25 Google, $99/yr Apple.**

Capacitor wrap. Only if stage 4 showed people actually reporting.

## How to run the agent sessions

1. Point it at SPEC.md at the start of every session. It has no memory between
   sessions and will re-decide settled questions otherwise.
2. One layer per session. Scoring logic, then UI, then hosting. Long sessions drift.
3. Name the stage and refuse the rest: "stage one only, no database, no accounts."
4. Tests before logic. The assertions are readable English; the code isn't.
5. Ask to see it running. Screenshot or URL, not a description.
6. Ask before any dependency gets added.
7. Ugly first. Correct logic in unstyled HTML, styling last.
8. Three turns of "still broken" means stop editing and name the assumption
   that might be wrong.

## Your job, not the agent's

This is a model with predictors and a validation problem, which is your actual
day job. Before any code exists, write down in `MODEL.md`:

- Each predictor and the direction of its expected effect
- Your prior on relative weight (sun position should dominate; precipitation
  should be a nudge)
- What observation would tell you the model is wrong

Agents generate plausible-looking scoring functions endlessly and have no
instinct for whether one is calibrated. That gap is yours to fill.

## Open

- Name. "Skunk Watch" is memorable but skunk-only report volume is thin.
  "Wildlife near you" covering coyotes, raccoons, loose dogs has enough traffic
  to stay alive, and coyotes are what dog owners actually fear. Decide before
  stage 3, when the URL gets fixed.
- Whether to show a number at all. Current plan says no: show the level plus the
  reasons, because the weights are unvalidated guesses and a percentage implies
  precision you don't have.

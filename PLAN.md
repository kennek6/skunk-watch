# Skunk Watch: build plan

Kate's copy. Decisions, what is done, and what is left.
Started 2026-11-07. Rewritten the same evening, after the original plan turned
out to be wrong about its own premise.

## What this is

A page you check before letting the dog into the yard, and a way to tell your
neighbours what you saw so they can tell you.

Reporting is the point. The original plan had it as a distant stage 4 behind a
conditions model, on the reasoning that an alert network with four users alerts
nobody. That reasoning was sound and the conclusion was wrong: the conditions
model only knows things you can read off a window and a calendar, so no amount
of using it would have taught anything. Reporting was built the same day
instead.

The conditions model stays, for two reasons that survive. It works for one
person with no neighbours signed up, and it gives the map something to say
before anyone reports.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Audience | Strangers, public | Decided 2026-11-07 |
| Format | PWA, installable, no app store | One codebase, free, no $124/yr in fees, no review |
| Native app | Later, via Capacitor wrap of the same code | ~1 day of config once there's reason to |
| Dusk notification | Cut | Everyone can see it's dusk; a daily alert gets muted |
| Geographic scope | North America, latitude-general | Temperature-driven, so it self-adjusts |
| Species field | In the schema from day one, skunk only at launch | Retrofitting means a migration |
| Free text in reports | None, ever | The one dox vector no design can close |
| Output direction | Warns only; never reassures | Unvalidated weights can't support an all-clear, and skunks carry rabies |
| Levels | quiet / elevated / high, where quiet shows nothing | Three states, no green light |
| Report flow | Two buttons (saw / smelled), then where and when | Roadkill sits under "saw", findable without being in your face |
| Where a report happened | Tap the map, GPS only as a shortcut | Covers a skunk seen from a car, and the app never learns where the reporter is |
| When it happened | Fixed choices, not a date picker | A time control invites precision the design discards |
| Map cells | Rectangles at geohash 6, one colour for live | The honest shape of a stored cell; H3 hexes cost 50 KB gzipped and read busier |
| Vet advice line | Cut | Clutter on a page whose job is one glance |
| Geolocation prompt | Only on a button press, never first load | A permission wall before anything works loses users |
| Dependencies | Leaflet only | Everything else is hand-rolled and tested |
| Code location | `C:\Users\kenne\Repos\skunk-watch` | Not the vault; Obsidian Sync and node_modules don't mix |

## Done, 2026-11-07

| | Where |
|---|---|
| Activity model: sun position, season, temperature, rain | `risk.js` |
| 18-hour strip showing when activity rises tonight | `app.js` |
| Grid snapping, validated against the canonical geohash reference | `geo.js` |
| Backdating, with "last night" correct whether you report at 18:00 or 02:00 | `when.js` |
| Report API: snap on ingest, discard the coordinate | `worker.js`, `schema.sql` |
| Three retention tiers, counts incremented at insert | `worker.js` |
| GBIF historic records, fetched server-side and cached per region | `worker.js` |
| Map, report form, privacy page | `index.html`, `app.js`, `privacy.html` |
| 55 assertions | `test.js` |

Live at https://kennek6.github.io/skunk-watch/, API on Cloudflare Workers with
a D1 database and an hourly sweep.

## Left to do

### 1. Recruit about twenty neighbours
**Not a build task, and the only thing that decides whether this works.**

Urban Wild Watch, a comparable app with press coverage, has roughly 150
sightings across all of Canada and the US. Spread that thin, every user opens
an empty map. Twenty households on adjacent streets beats ten thousand users
scattered across a continent. The code is finished; this is not.

### 2. Push notifications
**Effort: 1-2 hrs.**

"If it's near your house you get an alert" was the original description and the
app still cannot do it. Web Push works on Android and desktop; iOS needs the
page added to the home screen first. The server pushes a coarse region event and
the device decides whether to show it, so no home location is ever stored.

**This reopens the privacy page.** A push subscription is a persistent
per-device identifier held on the server, which is the first thing the app
would keep that is arguably personal data. It needs an in-app "turn off alerts"
button that deletes the subscription, which is better than an email address
anyway: self-service, instant, and nothing public with your name on it.

### 3. UTC day boundaries
**Effort: ~20 min.**

Daily and weekly counts bucket in UTC, so the boundary falls around 7pm local
in Ontario, mid-evening. Harmless for a 14-day count, wrong for any per-day
analysis later. The fix is sending the browser's UTC offset with a report and
bucketing locally.

### 4. `MODEL.md`, still unwritten
**Yours, not the agent's.**

Each predictor, the direction of its expected effect, your prior on relative
weight, and what observation would falsify it. Agents produce plausible-looking
scoring functions endlessly and have no instinct for whether one is calibrated.

The GBIF data is now available as a first check and it does **not** validate
the model. Records near Hamilton by month, January to December:

```
2  7  15  9  18  11  11  13  16  6  1  3
```

March and September are high, which fits. May is the highest month, which does
not fit either modelled peak. Occurrence records measure observer effort as
much as animal activity, and people are outdoors more in May, so this cannot
settle anything on its own. Treating it as validation would be a mistake.

## Open

- **Name.** Skunk-only report volume is thin. Broadening to coyotes, raccoons
  and loose dogs gives enough traffic to keep an app installed, and coyotes are
  what dog owners actually fear. The URL is now fixed, so this costs a
  redirect.
- **Whether to show a number.** Currently no: a level and its reasons, because
  a percentage implies precision the weights do not have.
- **Whether this should exist at all.** WildBeacon and Coyote Maps already do
  alert zones. Recruiting your street onto one of those costs nothing and
  solves the same problem. Worth ten minutes before recruiting anyone.

## Working with an agent on this

1. Point it at SPEC.md at the start of every session. It has no memory between
   sessions and will re-decide settled questions otherwise.
2. One layer per session. Long sessions drift.
3. Name the stage and refuse the rest.
4. Tests before logic. The assertions are readable English; the code isn't.
5. Ask to see it running. Screenshot or URL, not a description.
6. Ask before any dependency gets added.
7. Three turns of "still broken" means stop editing and name the assumption
   that might be wrong.

Two failures from the first day, both worth repeating back at me:

- **A 200 status is not a working response.** CARTO's map tiles returned HTTP
  200 with an image reading "API KEY REQUIRED". Check content or byte size.
- **Cache-first service workers hide deploys.** A fix was live and invisible
  for twenty minutes because the old `app.js` was being served from cache. It
  is network-first now.

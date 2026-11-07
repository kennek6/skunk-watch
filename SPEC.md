# Skunk Watch: agent brief

Read this file in full before writing any code. It is the source of truth for
decisions already made. Do not re-open them. If you think one is wrong, say so
in one sentence and wait, rather than implementing the alternative.

## What is being built

A PWA that warns a dog owner when a skunk is likely to be active near them.
Audience is the general public. North America. The estimate comes from sun
position, season, and current weather, so it works for a single user with no
other users present.

## Non-negotiables

1. **The app warns, it never reassures.** Output is one-directional. It says
   "elevated" or "high" and otherwise displays no warning at all. There is no
   "low", no "minimal", no green light, no all-clear, no "safe to go out".
   The weights are unvalidated guesses and skunks are a rabies vector, so an
   all-clear this model cannot support is the one way the app can cause harm
   rather than merely be wrong. Absence of a warning is not a claim.
2. **Three display states: `quiet`, `elevated`, `high`.** `quiet` renders as the
   absence of a warning, never as reassuring text.
3. **`risk.js` returns `{score, level, factors[]}`.** `score` is a continuous
   internal value used only by tests. It is never displayed and never logged.
   `level` is one of the three states above. `factors[]` holds the
   human-readable reasons behind the level.
4. **No percentage, number, or score in the UI.** Show the level and its
   reasons: "High activity. Sunset was 22 minutes ago, and it's dispersal
   season." Never "73%".
5. **The scoring logic lives in `risk.js` with zero browser or DOM
   dependencies.** It takes `{lat, lon, timestampISO, tempC, precipMm24h}`.
   Pure function, no I/O, no globals. It must be callable from Node for tests
   and from a future Capacitor or Kotlin build.
6. **Tests before logic.** Write the cases in "Test cases" below as runnable
   assertions and show them failing before implementing `risk.js`.
7. **No dependency gets added without asking first.** Stage one is one HTML
   file plus sunrise/sunset math. `suncalc` is acceptable if asked for;
   inlining the ~40 lines of sunset calculation is better.
8. **No free-text field anywhere in the app, at any stage.** The report schema
   is a fixed enum plus a grid cell plus an hour. Nothing else. A free-text
   field is the one dox vector no amount of coarsening can close.
9. **Never store a precise coordinate.** From stage four onward: snap to grid on
   ingest, write the cell ID, discard the raw coordinate before anything touches
   disk.
10. **Snap to a fixed grid. Never add random jitter.** Jitter is recoverable by
    averaging repeat reports from the same house. Deterministic binning (geohash
    precision 7, or H3 resolution 9, roughly 150-250 m) returns the same cell
    every time and leaks nothing on repeat reports.
11. **Render the cell, not a point.** Shade the hex or square. A dot at the cell
    centre recreates the target and implies precision that was deliberately
    destroyed.
12. **No photo uploads.** EXIF carries exact GPS and a device ID, and the image
    itself shows whose fence it is.
13. **Do not request geolocation on first load, and never require it to
    report.** Conditions are checked by typed place name; reports are made by
    tapping the map. GPS is a shortcut behind a button in both places, never the
    main path. Two reasons: a permission wall before anything works loses a
    large share of users, and a tapped pin means the app never learns where the
    reporter is, only where the animal was, which is strictly more private than
    GPS reporting. It also lets someone report a skunk seen from a car.
14. **Leaflet is the one approved dependency** (CDN, no integrity hash, because
    a stale hash takes the page down). Everything else stays dependency-free.
15. **Build only the stage you were asked for.** Do not add accounts, a login
    screen, a database, or analytics unprompted.

## Stage 1 scope

In scope: one HTML page, `risk.js`, manual location entry plus an optional
geolocation button, one Open-Meteo call (no API key), a web app manifest and
minimal service worker so it installs to the home screen.

Out of scope: any server, any database, accounts, reports, notifications,
maps, analytics.

Coordinate sent to Open-Meteo must be rounded to 2 decimal places (~1 km)
before the request leaves the device.

## The model

Three factors. Sun position dominates.

**1. Sun position relative to sunset/sunrise (strongest).** Striped skunks are
crepuscular and nocturnal. Activity ramps from roughly 60 minutes before sunset,
stays high overnight, tapers before sunrise. Daylight hours are quiet. Compute
from lat/lon/date; this is already global and needs no regional tuning.

**2. Season.** Two peaks:

- Breeding: roughly February through mid-March at 43 degrees N. Males roam
  widely, spraying is common. Shifts earlier at lower latitudes. Hold this as a
  latitude-dependent function, and mark it in code comments as the
  lowest-confidence parameter in the model.
- Juvenile dispersal: roughly August through October. Naive young animals
  wandering into yards.

**3. Temperature and recent rain.** Drive the winter suppression off measured
temperature, not the calendar: skunks spend cold stretches denned in torpor and
emerge during mild spells, so an 8C February night scores well above a -18C one.
Using temperature rather than month makes the model self-adjust for latitude,
elevation, and unusual years, which is how stage one gets to be latitude-general
for about an extra hour of work. Damp soil improves grub foraging, so recent
rain is a modest positive.

Deliberately excluded: moon phase. Evidence in skunks specifically is thin and
it adds apparent sophistication without accuracy.

Range check: skunks are a New World family. If lat/lon falls outside a North
America bounding box, show "no skunk species range here" rather than a result.
Do not fetch real range maps at this stage.

## Test cases

Location for all cases: Hamilton, ON (43.26, -79.87). Assert `level`, and also
print the computed sunset so it can be checked against a published value.

| When (local) | Temp | Rain 24h | Expected level |
|---|---|---|---|
| 2026-10-15 19:30 | 12C | 4 mm | high (just past sunset, dispersal season, damp) |
| 2026-01-20 14:00 | -12C | 0 mm | quiet (daylight, deep cold) |
| 2026-02-25 19:00 | 8C | 0 mm | high (past sunset, breeding season, mild) |
| 2026-02-25 19:00 | -18C | 0 mm | quiet (breeding season but denned in cold) |
| 2026-07-04 13:00 | 26C | 0 mm | quiet (midday) |
| 2026-07-04 21:30 | 22C | 0 mm | elevated (past sunset, no seasonal peak) |

Also assert these orderings on the continuous `score`. They must hold regardless
of how the weights are tuned:

- `score(2026-02-25 19:00, 8C) > score(2026-02-25 19:00, -18C)`
- `score(2026-10-15 19:30) > score(2026-10-15 13:00)`
- `score(2026-10-15 19:30, 4mm) > score(2026-10-15 19:30, 0mm)`
- Highest daytime score across all seasons < lowest post-sunset score across all
  seasons at the same temperature

Add a case at 64 degrees N (Fairbanks) and one at 30 degrees N (Austin)
asserting that the output is sensible and that the breeding peak date differs
between them.

## Later stages

Do not build these until asked.

### Report schema

One structured enum, no free text. Four observation types, weighted and routed
differently:

| `observation_type` | Weight on live score | Cell precision | Feeds tiers |
|---|---|---|---|
| `saw_live` | Full | Grid cell (~200 m) | live, recent, baseline |
| `smelled_fresh` | High | One level coarser (~1 km) | live, recent, baseline |
| `smelled_faint` | Low | One level coarser | recent, baseline |
| `found_roadkill` | None | Grid cell (~200 m) | baseline only |

Smell carries much further than sight, commonly a few hundred metres and
sometimes over a kilometre downwind, so smell reports get a coarser cell and
less weight. They are also the most common observation people can actually
make, so they are first-class, not an afterthought.

Roadkill never raises the live score, because that animal is no longer active.
It is collected for two reasons: it is strong evidence skunks live in that cell,
and a carcass smells for days, so known roadkill in a cell explains the smell
reports that follow and must suppress their contribution to the live score for
about a week.

Stored row: `observation_type`, cell ID, hour-rounded timestamp, optional
`under_structure` boolean (seen going under a deck, shed, or porch), species.
No user ID in the stored row; a device-local random key for rate limiting only.
No real names, no profiles, no post history.

### Retention, three tiers

| Layer | Retain | Granularity |
|---|---|---|
| Live | 24-48 hrs | cell + hour |
| Recent activity | 14-30 days | cell + day |
| Established presence | indefinite | cell + week, count only |

Aggregate on the way IN, not during the sweep. Inserting a report increments
the daily and weekly counters in the same transaction, and the hourly sweep then
only deletes. REVISED 2026-11-07: a sweep that aggregates before deleting loses
history permanently if the cron fails, while incrementing at insert time leaves
the counts correct even if the sweep never runs again.

The counts carry no timestamp and no device key, so the ecological signal
survives while the privacy footprint shrinks.

### Display suppression

REVISED 2026-11-07, replacing the three-distinct-devices rule. That rule meant
a street with two participating neighbours would never show anything, which
defeats the point of the app on day one.

Instead the problem is solved geometrically: reports are stored at precision 7
for sightings and roadkill and 6 for smell, but the map only ever draws
precision 6 cells, about 900 x 610 m at Hamilton's latitude. A cell that size
contains hundreds of households even in semi-rural areas, so a single report
identifies nobody and can be shown immediately.

Storing at precision 7 keeps the option of finer display later, per cell, once
there is enough density to know it is safe. Do not enable that without a
population-density check.

### Querying

Ship the region's active cells to the device and filter locally. Do not accept a
"reports near me" request carrying the user's coordinates, because a server that
can log that builds a movement history. For alerts, push a coarse region event
and let the device decide whether to display it. The user's home location never
leaves the phone and is never stored server-side.

### Deferred ideas

- **Wind offset for smell reports.** Whoever smells a skunk is downwind of it.
  Open-Meteo already returns wind direction, so a smell report could be offset a
  few hundred metres upwind before snapping to a cell. Roughly 20 lines and
  genuinely more accurate. Do not build it before the basics work.
- **Species range maps** from GBIF or IUCN, to distinguish striped from
  hog-nosed from spotted skunk. About a day of work. The bounding-box check
  covers v1.

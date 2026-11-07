# Skunk Watch

A page you check before letting the dog into the yard. It estimates whether a
skunk is likely to be active near you from sun position, season, and current
weather, and shows the next 18 hours so you can see when the evening rise
starts.

**https://kennek6.github.io/skunk-watch/**

## The model is not validated

The three factors are grounded in striped skunk natural history: they are
crepuscular and nocturnal, they have a late-winter breeding peak and a
late-summer juvenile dispersal peak, and they den through cold spells rather
than hibernating. The *weights* combining those factors are informed guesses.
Nothing here has been fitted to observational data, because there isn't any yet.

Two consequences, both deliberate:

- **The output is one-directional.** The page warns when conditions favour
  activity and otherwise shows nothing. There is no "low", no "all clear", and
  no percentage, because an unvalidated model should not be telling anyone it is
  safe to go outside.
- **Moon phase is excluded** even though it would look plausible. The evidence
  for it in skunks specifically is thin, and adding factors that do not improve
  accuracy only makes a model look more confident than it is.

If a skunk sprays a dog near the face or bites it, that is a vet question, not
an app question.

## Running it

No dependencies and no build step. Any static file server works:

```
python -m http.server 8787 --bind 127.0.0.1
```

Tests:

```
node test.js
```

The 27 assertions in `test.js` are written to be read rather than just run.
They pin the model's behaviour by example (a July midday is quiet, a mild
February evening after sunset is high) and by ordering (recent rain always
scores above dry, no daytime hour ever outscores a night hour). Change a weight
and the orderings tell you whether you broke something.

## Layout

| File | What it is |
|---|---|
| `risk.js` | The model. Pure functions, no DOM, no network, no dependencies |
| `test.js` | The assertions |
| `index.html` | The page, with inline CSS and view logic |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Installable to a phone home screen |
| `SPEC.md` | Design decisions that should not be silently reopened |
| `PLAN.md` | Staged build plan and what each stage has to prove |

Weather and place lookup come from [Open-Meteo](https://open-meteo.com/), free
and without an API key. Coordinates are rounded to two decimal places (~1 km)
before any request leaves the device. Nothing is stored anywhere: no accounts,
no database, no server.

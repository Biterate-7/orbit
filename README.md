# ORBIT//LOST

**STAY IN ORBIT. SURVIVE THE UNIVERSE.**

A retro pixel-art arcade survival game built on real orbital physics. Your ship is
trapped orbiting a celestial body: shape your orbit with thrust, dodge what the
environment throws at you, collect energy, and survive an endless journey outward
through a procedurally generated universe built from real astronomical catalogues.

Every sector is a real object - a moon, an asteroid, an exoplanet, a pulsar, a galaxy -
or a clearly labelled procedural stand-in, and each kind of place plays differently.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # regression suite (catalogue, generation, headless simulation)
npm run build      # production bundle in dist/
npm run preview    # serve the production build
npm run ingest     # refresh the astronomical catalogue from the source databases
```

No backend, no accounts. **The game makes no network requests**: sprites, sound and fonts
are generated or bundled, and the astronomical catalogue ships with the build. Only
`npm run ingest`, a developer tool, talks to the outside world.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Accelerate along your path (raises the far side of the orbit) |
| `S` / `↓` | Decelerate against your path (lowers the far side) |
| `A` / `D` | Fine strafe left / right |
| `Space` / `Shift` | Boost — brief phase through hazards (destroys small rocks) |
| `Esc` / `P` | Pause / resume (the pause screen shows a scan of the current object) |
| Mouse | Hold left = accelerate, right = decelerate, middle = boost |
| Touch | On-screen BRAKE / ACCEL / BOOST buttons |

Keep the dotted trajectory between the two rings. Leaving the safe band, falling
inward, escaping, or entering heat zones drains **Orbit Stability**; at zero you lose
control. Touching a star, planet, moon or event horizon is fatal.

## The universe

### Where the data comes from

| Source | What is taken from it |
| --- | --- |
| NASA/JPL Small-Body Database | asteroids, comets, dwarf planets: orbit, diameter, rotation, albedo, taxonomy |
| NASA/JPL Horizons | Sun, planets and major moons: physical data, osculating elements, state vectors |
| NASA Exoplanet Archive (TAP) | confirmed exoplanets and their host stars |
| SIMBAD (CDS) | stars, variables, binaries, white dwarfs, pulsars, X-ray binaries, nebulae, remnants |
| NASA/IPAC Extragalactic Database | galaxies and quasars: type, position, redshift |
| NASA Image and Video Library | imagery, only when it verifiably shows the specific object |

`npm run ingest` runs the pipeline in `src/astronomy`: fetch → normalise → deduplicate →
merge into `src/astronomy/data/catalogue.json`. The bundled snapshot holds about 2,600
objects. `src/astronomy/data/ingest-report.json` records what each source returned.

- **Nothing is invented.** A value a source does not provide is stored as `null` and shown
  as absent. Unit conversions are the only arithmetic applied (plus distance from parallax
  and mass from JPL's `GM`, both noted in the normaliser).
- **Failures are contained.** Each source is an independent worker with rate limiting,
  retries with backoff and mirror fail-over. A source that is down is reported and skipped;
  what it contributed before stays in the catalogue. Re-runs are incremental and idempotent.
- **Fallback, clearly labelled.** If the NASA Exoplanet Archive is unreachable, exoplanets
  are taken from the Extrasolar Planets Encyclopaedia (exoplanet.eu) and carry that source
  label in game. NASA records replace them on the next successful run. *The bundled
  snapshot was built while the archive was in maintenance, so its exoplanets currently come
  from the fallback - run `npm run ingest -- --only exoplanets` to switch them over.*
- **Images are matched conservatively.** An image is attached only if its own metadata
  names the object, it comes from a science centre, and it is not a rocket, event,
  diagram or illustration; third-party copyrighted images are never used. Most objects
  therefore have no image and are drawn procedurally - by design. Matched images are
  reduced at ingestion to a 32×32, 12-colour pixel sprite; the photograph itself is never
  bundled or displayed, and the source and credit are shown wherever the sprite appears.

### How a level is made

A level is a pure function of **(catalogue version, sector number, seed)** - shown on the
pause screen as a sector code such as `C1-012-56115553`. The same code always rebuilds the
same level, down to hazard placement and colours.

1. **Environment** - one of 29, weighted by how far out the journey has reached
   (Solar System → nearby stars → deep galaxy → extragalactic).
2. **Host object** - a real catalogue object whose data maps to that environment, picked by
   rendezvous hashing so that growing the catalogue does not reshuffle old seeds.
3. **Blueprint** - the object's real radius, mass, temperature, rotation, moons and
   spectral type are mapped into gameplay ranges and into the look of the body.
4. **Orbital configuration** - circular, eccentric, inclined, binary, multi-body, decaying
   or unstable, chosen from the object's real eccentricity and inclination.
5. **Layered hazards** - more systems are stacked on as sectors deepen.
6. **Identity** - name, palette, sky and backdrop, all derived from the same data.

The run does not simply take the next roll. For each sector it rolls a dozen candidate
seeds and scores them against the journey so far (`src/generation/encounterSelector.ts`):
no environment twice in a row, no object twice in a run, unseen environments and
undiscovered objects preferred, rare encounters paced rather than random, and story beats
(a first star by sector 5, a first extreme-gravity object by sector 12).

### Environments

Each has a mechanic that changes how the orbit is flown, not just its colours.

| Family | Environment | What it does |
| --- | --- | --- |
| Planetary | Rocky world | baseline: a belt of co-orbiting rock |
| | Gas giant | real moons on rails carve the band into lanes |
| | Ringed planet | a ring rich in energy that bleeds orbital speed |
| | Ice world | a rotating cryo-plume that kicks you outward and carries crystals |
| | Lava world | eruptions lob ballistic ejecta up through the band |
| | Ocean world | one heavy moon raises tides in your orbit |
| | Desert world | dust storms and a thin, dragging atmosphere |
| | Tidally locked world | a permanently scorched sector on the day side |
| | Super-Earth | deep gravity well, fast orbits, dense atmosphere |
| | Starless world | total darkness; a radar ping to see by |
| Stellar | Red dwarf | rapid-fire flares |
| | Sun-like star | coronal mass ejections as shock waves |
| | Blue giant | radiation pressure pushes you outward in gusts |
| | Red giant | long flares and an extended envelope that drags |
| | White dwarf | lanes of orbiting debris to thread |
| | Neutron star | magnetic bursts knock the thrusters offline |
| | Pulsar | rotating beams sweep the sector |
| | Binary star | two primaries around a barycentre |
| | Multiple star | a close pair plus a third star patrolling the outer band |
| | Variable star | the heat zone breathes in and out of the band |
| Extreme | Black hole | frame dragging decays the orbit; deep orbits score more |
| | X-ray binary | a donor star feeds plasma across your path |
| | Quasar | twin relativistic jets on a precessing axis |
| | Galactic core | stars on plunging orbits around the central black hole |
| | Supernova remnant | repeated blast shells and shrapnel |
| | Nebula | low visibility and ion storms |
| | Asteroid field | weak gravity, slow orbits, rock arriving in clusters |
| | Cometary region | a river of ice flowing away from the Sun |
| | Gravitational anomaly | *fictional* - a mass that will not hold still |

### Real, procedural, fictional

Every level and catalogue entry says which of these it is:

- **REAL OBJECT** - a catalogued object; every number shown is from its source database.
- **PROCEDURAL VARIANT** - a generated setting modelled on a real class of object, used
  when an environment has few catalogued hosts. It carries an `OLS` designation
  ("ORBIT//LOST Survey") that imitates no real catalogue, and never enters the discovery log.
- **FICTIONAL OBJECT** - an invented setting with no real counterpart (one exists: the
  gravitational anomaly). It is labelled as such everywhere.

Which *environment* an object hosts is a gameplay interpretation and is labelled that way.
The mapping rules are in `src/generation/environments/classify.ts`; for exoplanets,
"ocean", "desert" and "tidally locked" are inferred from equilibrium temperature and
orbital period and are not claims about those planets. None of this suggests a spacecraft
could operate near a black hole or inside a stellar corona - these are game environments.

### Scientific simplifications

- **Scale is not physical.** Real radii, masses and periods are mapped (mostly on a log
  scale) into ranges that play well. Ordering is preserved - a heavier real body is a
  heavier game body - ratios are not. Orbits that take days or centuries take seconds.
- **Two dimensions.** Everything moves in one plane. Inclination is modelled as a height
  above that plane which varies around the orbit, so inclined debris can only be hit near
  its two nodes; it is not a 3D simulation.
- **Restricted n-body.** The ship, hazards and energy motes feel Newtonian point-mass
  gravity from every body (leapfrog / semi-implicit Euler, softened at close range).
  Moons, companion stars and binary primaries move on fixed Keplerian rails: they pull on
  the ship but are not perturbed by it or by each other.
- **Binary periods are slowed threefold** relative to the Keplerian value so a pair
  whirling around its barycentre stays readable.
- **Moon masses are not to scale**: band-crossing moons are light enough to tug rather
  than capture; the ocean world's moon is exaggerated so its tides can be felt.
- **Effects are stylised**: frame dragging is a retrograde drag growing as 1/r³, stellar
  wind is an outward push with gusts, a ring is a uniform drag zone, magnetic bursts
  disable thrust, relativistic jets and pulsar beams are damage zones. Time dilation,
  redshift and tidal forces on the ship are not simulated.
- **The periapsis cycle is real mathematics on compressed time**: the body's catalogued
  eccentricity is fed through Kepler's equation and activity scales with received flux
  (1/r²), with the orbital period compressed to 22-34 seconds.
- **Star colours** come from a black-body fit to the catalogued effective temperature; when
  a star has no measured temperature the typical value for its spectral class is used for
  colour only and is never stored or shown as data.
- **Embedded stars in nebulae are generated**, since the catalogue describes the nebula,
  not an individual star inside it. The level text says so.

## Progression

- **Discovery log / Celestial Catalogue** (main menu): every real object you meet is
  logged with its data, source, a pixel portrait and how it was rendered. Objects you have
  not met stay dark. Environment and milestone tabs track the wider journey.
- **Milestones**: first ten sectors, 50 and 100 sectors cleared, first stellar system,
  first extreme-gravity object, first rare encounter, reaching another galaxy, catalogue
  size, and seeing every environment. Each pays credits once.
- **Difficulty** grows along separate axes - intensity (saturating), layered hazard systems,
  correction time, sector length, central mass - so later sectors are more involved rather
  than merely faster.

## Structure

```
src/
  astronomy/
    api/                clients for SBDB, Horizons, Exoplanet Archive, SIMBAD, NED, NASA images
                        (+ shared http layer: rate limit, retry, cache, mirrors)
    ingestion/          pipeline, normaliser, deduplicator, image -> pixel sprite
    database/           unified schema, catalogue (index + search), compact codec, derived visuals
    data/               the bundled catalogue snapshot, pixel sprites, last ingestion report
  generation/
    seed.ts             hashing, sector codes, rendezvous picking
    levelGenerator.ts   seed -> encounter -> complete level
    encounterSelector.ts  history-aware choice among seeded candidates
    environmentGenerator.ts  theme and sky composition
    orbitalConfiguration.ts  circular / eccentric / inclined / binary / ...
    difficulty.ts       the difficulty axes
    naming.ts           level names from the level's own data
    environments/       planetary, stellar, extreme definitions + object classification
  progression/          discovery log, milestones, unlocks
  game/                 framework-free simulation (no React)
    engine.ts           rAF loop, fixed-timestep accumulator, state machine, events
    run.ts              one run: ship, hazards, every environment mechanic, scoring
    rails.ts            Keplerian rails for companions; periapsis cycle
    physics.ts          Newtonian point-mass gravity, leapfrog integrator
    orbital.ts          orbit elements, stability model, trajectory prediction
    levels.ts           bridge from a run to the generation engine
    render/             low-res pixel renderer: bodies from catalogue-derived looks,
                        per-level skies, portraits
  ui/                   React menus, HUD, catalogue, discovery toast
scripts/
  ingest.ts             catalogue ingestion CLI
  survey.ts             generation statistics and survivability survey
tests/                  vitest suite + headless autopilot harness
```

The world renders into a low-resolution canvas that the browser upscales by an
integer factor with `image-rendering: pixelated`, so every sprite, glow and particle
stays crisp. React never re-renders per frame: the HUD writes to the DOM directly
from the engine's frame callback.

## Testing

`npm test` runs four suites:

- **astronomy** - catalogue integrity (unique ids, schema validation, no invented values,
  image attribution), unit conversion, deduplication, HTTP retry / rate limit / mirror
  fail-over, image matching, and a pipeline run through a simulated partial outage.
- **generation** - seed determinism and sector-code round trips, 1,200 seeded levels
  checked for uniqueness and structural soundness, every environment's mechanical
  signature being distinct, difficulty shape, and 60- and 200-sector journeys.
- **simulation** - the real simulation run headlessly with an orbit-keeping autopilot:
  every generated configuration must be able to hold its orbit for the whole sector, the
  mechanics must measurably do what they claim, and a multi-sector run must complete with
  networking disabled.
- **progression** - discovery log, milestones, unlocks, and tolerance of corrupt saves.

`npx vite-node scripts/survey.ts -- 900 1` prints the same statistics in readable form.

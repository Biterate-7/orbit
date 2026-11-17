# ORBIT//LOST

**STAY IN ORBIT. SURVIVE THE UNIVERSE.**

A retro pixel-art space adventure built on real orbital physics. Your ship is caught in
the gravity of a celestial body: shape your orbit with thrust and fly a different mission
in every sector - sixteen kinds, drawn at random, so no two runs go the same way - on an
endless journey through a universe built from real astronomical catalogues. Real star
systems from the NASA Exoplanet Archive (TRAPPIST-1, Kepler-16, Proxima Centauri,
Kepler-90 ...) are playable, and more can be imported from NASA and JPL while you play.
Major encounters arrive every few sectors, never on a fixed beat.

**2.0** adds the mission director, eight new mission types, real star systems and binary
stars as environments, live astronomical imports, ship modules and synergies, a cosmetic
hangar and shop, a pilot profile with lifetime statistics and achievements, and a versioned
save that migrates 1.x progress.

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
npm run ingest     # refresh the astronomical object catalogue from the source databases
npm run ingest:systems   # refresh the star-system snapshot from the NASA Exoplanet Archive
```

No accounts and no backend of our own. Sprites, sound, fonts and the astronomical data are
generated or bundled, so **the game plays fully offline**. The only network traffic is the
optional *live import* in the catalogue, made when the player asks for it (see below).

### Windows desktop build

The same `dist/` build is packaged as a standalone Windows game with Electron and
electron-builder. Players need nothing else installed.

```bash
npm run dist:win        # release/Lost-Orbit-Setup.exe (NSIS setup wizard, x64)
npm run pack:win        # release/win-unpacked/Lost Orbit.exe, unpackaged, for quick checks
npm run electron:start  # build, then run the game in Electron without packaging
npm run icon            # regenerate build/icon.ico + build/icon.png from public/favicon.svg
```

- `electron/main.cjs` opens the game in a sandboxed window (no Node.js in the page) and serves
  `dist/` from a private `app://lost-orbit/` origin with a strict Content-Security-Policy.
  F11 or Alt+Enter toggles fullscreen. Live catalogue imports are fetched by the main process
  on the page's behalf (`astroFetch` in `preload.cjs`), and only from the three NASA / JPL
  services the game uses; the page's own `connect-src` stays `'self'`.
- `electron-builder.yml` holds the installer settings: per-user install by default (no admin
  needed), folder choice, and Desktop and Start Menu shortcuts. `build/installer.nsh` adds the
  Welcome page.
- Desktop saves are stored in `%APPDATA%\Lost Orbit` and kept if the game is uninstalled.
- The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC"
  on first run (**More info → Run anyway**). Signing needs a code-signing certificate.

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

The dotted line is your coasting trajectory. In orbit-holding missions keep it between the
two rings; in travel missions only the inner ring (too close) and the arena edge matter.
Leaving the safe zone or entering heat zones drains **Orbit Stability**; at zero you lose
control. Touching a star, planet, moon or event horizon is fatal.

## Missions

Every sector is flown for a mission with its own logic, objective and win condition. The
objective sits under the sector name in the HUD; an edge arrow points to it when it is off
screen, and the trajectory preview lights a target green ("ON COURSE") when your coasting
path reaches it. **PE / AP** markers show your periapsis and apoapsis on travel missions.

| Mission | What you do | How it is won | Its own pressure |
| --- | --- | --- | --- |
| Survival | Hold the orbit band through 2-5 escalating waves; each wave switches on more of the sector's hazard systems, with short lulls between | Survive the last wave | Waves |
| Precision Navigation | Thread 5-8 narrow radial gates in order by raising / lowering the orbit. The HUD reads the preview: `RAISE ORBIT +12`, `ON LINE` | All gates passed | Jump window; a missed gate costs a lap; posts damage |
| Energy Extraction | Harvest an energy quota (rich crystal cells sit at the heat edge, in ring planes, at band edges), then rendezvous with the dock on its orbit | Tractor lock held until docked | Jump window; hazards |
| Asteroid Run | Climb from an inner lane through belts of rock on Keplerian orbits. Each belt has a wide gap and a narrow shard-carrying gap; from tier 2 the belts counter-rotate | Reach the jump gate | Jump window; collisions |
| Gravity Slingshot | Not enough fuel to burn straight out: fly past a moving planet (a real n-body flyby) to be flung to a beacon | Reach the beacon | Fuel (slow trickle refill) |
| Event Horizon | A feeding black hole grows in mass and horizon; frame dragging decays the orbit. Burn (best at periapsis: the Oberth effect) and climb past the escape ring | Cross the escape ring | Growth, fuel, accretion heat |
| Nebula Navigation | Follow buoy-marked corridors through ionised gas (contact burns the hull). A wide main corridor, or a narrow two-hop route with the shards | Reach the exit beacon | Ion surges that invert the controls |
| Pursuit | A hostile craft with its own engines, physics and pursuit autopilot hunts you and fires gravity-bent bolts | Jump drive charges (2x faster beyond 165 units) - or lure it into the environment | The hunter |
| Binary Star Navigation | Thread tidal gates that breathe with the two stars' orbit, around a pair whose pull swings as they turn | All gates passed | The mass-transfer stream flares along the axis of the two stars, both ways, sweeping the band as the pair turns |
| Solar Flare Avoidance | Superflares scour every direction except the shadow behind a shield planet on a real Keplerian orbit. Match two clocks - the flare and the shadow's arrival - by choosing your lane (higher lanes let the faster planet's shadow catch up sooner) | Survive every superflare | Each one caught in the open burns the hull |
| Wormhole Traversal | The beacon is far beyond your fuel. A chain of tuned wormholes (one-way, matching colours link) each sets you on the next shelf's circular orbit; a decoy throws you back | Reach the beacon | Fuel for trims only |
| Gravitational Anomaly | The central mass breathes, so every orbit breathes with it, while push and pull waves roll out. Hold a narrow resonance lane until it charges, then follow it to its next radius | Charge every lane | Breathing mass, alternating waves |
| Escort | A survey tender crosses the sector on its own orbit while rock is thrown at it. Fly in formation: your shield link absorbs impacts but drains, and only recharges in range | The tender reaches its jump point | The tender's hull; gravity waves shake the link loose |
| Resource Extraction | Match orbits with ore rocks and hold the mining laser on them; a cut rock breaks into debris. Rich veins (double) hug the band's edges | Mine the quota | Heat and drag at the edges, fragments |
| Astronomical Discovery | An unlisted source hides in the sector; only its signal strength (and whether it is closing) gives it away. Find it, then hold it in the scan field | Complete the scan | The window |
| System Survey | Fly through the scan field of every world in a real system - the closer the pass, the faster the scan, and the harder the world's real gravity pulls | Survey every world | Close passes |

Failing a jump window (or losing an escorted tender) does not end the run: the drive forces
a jump that costs a quarter of the hull and earns no rank.

### The mission director

There is no fixed sequence of missions any more. `src/generation/missionDirector.ts` draws
each sector from the whole mission registry (`src/game/missions/catalog.ts`):

- **Weighted random choice** with per-mission weights, rarity (common / uncommon / rare),
  an earliest sector and a cool-down; a type not seen for a while grows more likely.
- **No repeats**: never the same mission twice running, and never inside its cool-down.
- **Major encounters** come after a varying number of sectors (first between sectors 4 and 7,
  then every 4-7), never the same boss twice running, MK II and MK III when they return.
- **Twists and variants**: from the early sectors on, a sector can carry *twists* - solar storm,
  reserve tanks, rich veins, minefield, torn space, magnetic knots, closing window, dense field,
  aegis cache, salvage field - each of which really adds or changes something in the sector.
  Rare variants: *elite* (a tier harder), *pristine* (more to find, a hidden cache), *anomalous*
  (one more twist). Their chances grow with depth.
- **The pilot is considered**: a first-ever sector is always gentle and plain; veterans meet the
  harder missions sooner. Difficulty tiers rise with depth.
- **Reproducible**: the director is a pure function of run seed, sector and history. Sector codes
  carry the mission, tier, variant and twists (`C1-014-1A2B3C4D-PN2E+GMV`) and rebuild exactly.
  Every probability lives in the `DIRECTOR` table; a new mission type is a registry entry plus a
  planner and a controller, with no change to the director.

### Environmental mechanics

All of these act through the same integrator as everything else:

- **Wormholes** carry the ship (and loose rock) between two mouths and preserve the *shape*
  of its orbit: a circular orbit in is a circular orbit out.
- **Gravity waves** push outward; the Neutron Core also fires **pull waves** that drag inward.
- **Solar flares** open telegraphed damage wedges (and heat the Sentinel).
- **Magnetic fields** rotate velocity (a = ω × v) without changing speed; the preview bends with them.
- **Moving planets** on rails: real gravity, real assists, real crashes - the preview stops where it would hit one.
- **Limited fuel** on selected missions (and on every mission with the DRY TANKS modifier).
- **Aegis pickups**: 7 s of immunity to impacts *and heat*; repair, fuel and energy-cell pickups.
- **Dynamic obstacles**: proximity mines that arm, chase and detonate; gates that drift in and out.

### Major encounters

Every few sectors (see the mission director), returning as MK II, MK III with faster attacks:

| Boss | Phases and attacks | Weakness | Victory |
| --- | --- | --- | --- |
| **The Neutron Core** | Push waves → alternating push / pull waves → paired double waves; pulsar beams speed up; magnetic bursts | Its stabiliser nodes: match orbits with each node until the tractor lock synchronises it | Sync every node of all three phases |
| **The Devourer** | Grows continuously; from phase 2 smooth gravity surges, from phase 3 relativistic jets | Destabiliser charges: pick one up on the outer orbit, carry it down to the photon ring, climb back out | Three charges delivered |
| **The Sentinel** | Pursuit with aimed bolts → spread volleys and mines dropped in its wake → telegraphed dash attacks | Heat: armour shrugs off impacts, but it vents slowly, so luring it through the corona or a flare overheats a core. It grows warier of the heat each phase | Three cores overheated |

## Progression and replayability

- **Ranks.** Every sector ends with a debrief - S to C from completion, bonus objectives
  (no hull damage, beat par, all shards, each mission's own challenge ...) and time against par.
  The debrief shows the credits the sector paid.
- **Shards.** Placed off the safe line - in narrow belt gaps, beside gate posts, at the heat
  edge, on the alternative nebula route. They unlock advanced ship parts.
- **Run modifiers** (main menu): Glass Hull ×1.4, Swarm ×1.3, No Flight Plan ×1.5,
  Dry Tanks ×1.25, Calm Skies ×0.6 - multiplied together into the run's score.
- **Mission log and practice.** Best rank per mission type, and a practice sector of any mission
  already met (half pay, no records).

### Economy

Everything is earned in play; there is no other currency and nothing can be bought with money.
Credits come from missions (scaled by the sector's difficulty, tier, variant and twists, the
rank, and how deep the run is), discoveries (a new object, a new star system, planets, rare
encounters, located signals, hidden caches), achievements, pilot levels and the energy banked at
the end of a run. They are spent on ship parts, modules, cosmetics and cases. All transactions go
through one reducer (`src/progression/events.ts`): a reward is paid in exactly one place, credits
can only leave through `spend`, which refuses to go below zero, and every change is saved in one
atomic write.

### Ship modules and synergies (ENGINEERING)

Modules change how a mission is flown. Each is unlocked by something the pilot has done, bought
and levelled (3 levels) with credits, and fitted into one of the ship's bays (two, a third at
pilot level 6).

| Module | What it does | Unlock |
| --- | --- | --- |
| Gravitational Anchor | Less push from waves, wind, storms and plumes; absorbs a gravity wave outright on a cooldown | Clear 5 sectors |
| Dual-Core Thrusters | More thrust, and a second boost burst within a few seconds of the first | Complete 8 missions |
| Quantum Collector | Draws energy and pickups in from range (violet tethers) | Catalogue 6 objects or systems |
| Deep-Space Scanner | Hidden supply caches become visible and collectable; wormhole routes are drawn; longer signal range and hazard warning | Discover 2 star systems |
| Phase Drive | Longer phasing on boost, and phasing passes through moons and planets; shorter cooldown; an exit shock at level 3 | Defeat a major encounter |
| Orbital Resonator | Longer preview, slower stability drain, easier tractor locks, more strafe | A binary mission or 2 gravity assists |
| Resonance Drill | Faster mining; rammed rock always sheds energy | Mine 4 ore rocks |
| Aegis Link | Longer, faster-charging escort link; aegis pickups last longer | Complete an escort |

Pairs form **synergies**, discovered by fitting both halves: Prospector (scanner + collector:
finds pay 50% more, caches drawn in from range), Binary Harmonics (anchor + resonator: steadier
around two stars), Phase Dash, Deep Vein, Bulwark, Pathfinder and Ghost Survey. The table lives
in `src/game/modules.ts`.

### Hangar, cosmetics and the shop

The hangar shows the ship as it will fly - drawn live by the same painter the game uses
(`src/game/render/shipPainter.ts`) - and the whole collection: search, rarity and ownership
filters, try-on before fitting, a side-by-side comparison, acquisition details and NEW markers.
Eight independent slots: hull skin, wings, cockpit, energy core, engine, engine trail, exhaust
particles and a special effect. 83 items over six rarities, each with its own visual language:
flat colourways (common), two-tone patterns (uncommon), panelling with moving lights and distinct
trails (rare), emissive animated hulls and engines (epic), fully animated skins - holographic,
crystalline, aurora - with their own trail geometry (legendary), and signature pieces where the
hull itself becomes an effect: a window onto a nebula, an event horizon with a burning edge
(mythic). Cosmetics never change how the ship flies.

The **shop** sells some items directly and four **cases** for credits. Every case shows the odds
it is rolled with (the same table), its full contents and how many you own; new items always come
before duplicates, a duplicate is converted to credits, and each case guarantees a stated rarity
within a stated number of opens. Some items come only from achievements or pilot levels.

### Pilot profile and achievements (PROFILE)

A persistent pilot: a name, a level and rank from experience, a favourite ship (the hull flown
most), and lifetime statistics computed from game events - missions completed and attempted,
bosses, distance flown, systems, objects and worlds discovered, asteroids mined, credits earned
and spent, cases, playtime, longest survival, most-played missions and most-used modules - plus
boss records and personal records. Values that can be derived from the save (systems discovered,
cosmetics owned ...) are never stored twice.

68 **achievements** in seven categories - including First Contact, Binary Explorer, Galactic
Cartographer, Boss Hunter, Collector, Cosmic Veteran, Beyond the Horizon and Master Explorer -
with progress bars, hidden ones, badges, credit and cosmetic rewards and unlock notifications.
The journey **milestones** of 1.x are part of the same list, under their original ids.

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

### Star systems

The in-game catalogue's STAR SYSTEMS tab is built from three layers (`src/astronomy/systems`):

1. **A NASA Exoplanet Archive snapshot** (`npm run ingest:systems`): every confirmed planet in a
   system with 3+ planets, a circumbinary flag, two or more stars, or within 25 pc - about 900
   systems and 1,900 planets, fetched as disjoint TAP queries on `pscomppars`, validated,
   normalised, grouped by host star, deduplicated and packed into `data/systems.json`
   (report in `data/systems-report.json`).
2. **Systems from the object catalogue**: the Solar System, assembled from the JPL Horizons
   records, and stars SIMBAD types as binaries. A SIMBAD entry for a star the archive already
   lists (e.g. Kepler-90, filed by the archive as KOI-351) is dropped as a duplicate.
3. **Live imports**, made in the catalogue when the player asks: search the archive by host
   star, pull further selections (nearby, multi-star, recent discoveries), refresh imports, or
   look an asteroid or comet up in the JPL Small-Body Database. Requests go one at a time with a
   minimum gap, bounded retries with backoff, timeouts and a cool-down after failure; every
   record passes the same validation as the bundle, is merged with what is on file, and is
   cached locally (bounded) so it stays available offline. A failure leaves the catalogue as it
   was. Nothing is ever fetched while a mission loads.

**Binary stars**: a system is only classified as binary or multiple when its source says so - the
archive's star count (`sy_snum`) and circumbinary flag (`cb_flag`), or a SIMBAD binary type. The
archive does not catalogue companion stars' own properties, so those are drawn with an
illustrative tint and labelled as such.

Browse, search and filter by single, binary, multiple-star, planetary, circumbinary,
asteroids & comets, and discovered / undiscovered. Each entry shows the official name and
aliases, type, star and planet counts, the host star, distance, every planet's period, axis,
radius, mass and temperature, discovery year, method and facility, source and link, last update
and the pilot's exploration record. Missing values read **Unknown**.

**Real systems are playable**, either when a run draws one or with FLY THIS SYSTEM. Three
environments are hosted by system records instead of single objects (`environments/systems.ts`):
*planetary system*, *circumbinary system* (two stars on their orbit about the barycentre, two
gravitational centres, the planets riding outside the pair) and *multi-star planetary system*
(planets around one star, a companion on a wide orbit). The host's temperature sets the star's
colour, its radius and mass its size and pull; the known planets appear in their real order,
spaced by their real semi-major axes on a log scale, sized and coloured from their measured
radius, mass and equilibrium temperature, with their real (capped) eccentricity. Scale and
periods are compressed for play; this is not a scientifically exact simulation.

On the web, live imports go through a same-origin proxy (`api/astro.js`): a serverless function
on the web host, and middleware on the Vite dev and preview servers. It forwards only to the three
fixed upstreams. A static host without it simply reports imports as unavailable.

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
- **Mission planets are lighter than they look** (4-5% of the primary's mass). Because
  companions ride fixed rails, their pull on the inner system is not cancelled by the primary
  being pulled too; heavier planets would drag the starting orbit around on their own.
  Flybys still bend a path by tens of degrees, so gravity assists are genuine n-body physics.
- **Wormholes** are fictional. They preserve the shape of an orbit (velocity rotated with the
  position, scaled by √(r_in / r_out)) rather than raw momentum, which would make every
  outward transit an escape trajectory.
- **Tractor locks** hold a true circular orbit at the ship's radius while drifting it towards
  the target: a plain spring towards a target on a higher orbit would push the ship backwards
  and lower its orbit, opening the gap (the classic rendezvous paradox).
- **A growing black hole grows adiabatically**: mass rises smoothly, so orbits shrink
  reversibly. Gravity surges swell and ease on a smooth envelope for the same reason - an
  abrupt drop in mass would fling every orbit outward.
- **Corridors and belt gaps are sized from real flights**: the nebula's corridors are traced
  by a simulated finite-thrust climb with the ship's own engine, and each asteroid belt's gap
  is sized from how long that climb spends inside the belt and how fast the gap sweeps past.

## Progression

- **Discovery log / Celestial Catalogue** (main menu): every real object and star system you
  meet is logged with its data, source, and how it was rendered. Objects you have not met stay
  dark. Environment and milestone tabs track the wider journey.
- **Difficulty** grows along separate axes - intensity (saturating), layered hazard systems,
  correction time, sector length, central mass - so later sectors are more involved rather
  than merely faster.

## Saves

Progress is one versioned document in `localStorage` (`orbitlost.save.v2`; on the desktop app in
`%APPDATA%\Lost Orbit`). A 1.x save (`orbitlost.save.v1`) is migrated on first launch and left in
place: records, credits, ship parts, unlocks, settings, the discovery log, mission records,
bosses and modifiers carry over unchanged; milestones become achievements (and are never paid
again); statistics and experience are seeded from what the old save recorded. Every field is
validated on load - a damaged field falls back to its default without taking the rest with it,
and an unreadable document is copied aside to `orbitlost.save.corrupt` rather than overwritten.
Live imports are cached separately (`orbitlost.astro.v1`).

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
    missionDirector.ts  which mission each sector is flown for (weights, cool-downs, bosses, twists, variants)
    missionGenerator.ts seeded mission layouts: gates, belts, corridors, docks, ore, convoys, twists
    environments/       planetary, stellar, extreme and real-system definitions + classification
  astronomy/systems/    star systems: types, normalise + validate, archive / JPL queries, codec,
                        catalogue store, live imports (rate limit, retry, cache)
  progression/          events (the one reducer for rewards, purchases, statistics), achievements,
                        stats, pilot level, discovery log, milestones, unlocks
  game/                 framework-free simulation (no React)
    engine.ts           rAF loop, fixed-timestep accumulator, state machine, events
    run.ts              one run: ship, hazards, every environment mechanic, scoring
    missions/           mission data model, registry, runtime (pickups, gates, clouds,
                        wormholes, fields, mines, enemy craft, ranking) and one controller
                        per mission type and boss (controllersExtra.ts: the 2.0 missions)
    modules.ts          ship modules and synergies
    cosmetics/          cosmetic catalogue and cases
    persistence.ts      versioned save, migration from 1.x, validation
    modifiers.ts        run modifiers and their score multipliers
    rails.ts            Keplerian rails for companions; periapsis cycle
    physics.ts          Newtonian point-mass gravity, leapfrog integrator
    orbital.ts          orbit elements, stability model, trajectory prediction
    levels.ts           bridge from a run to the generation engine
    render/             low-res pixel renderer: bodies from catalogue-derived looks,
                        per-level skies, portraits
    render/shipPainter.ts  the ship drawn from a cosmetic loadout (game, hangar, shop, profile)
  ui/                   React menus, HUD, catalogue + star systems, hangar, shop, engineering,
                        profile, reward toasts
api/
  astro.js              same-origin proxy for live imports (serverless function + Vite middleware)
scripts/
  ingest.ts             catalogue ingestion CLI
  ingest-systems.ts     star-system ingestion CLI
  survey.ts             generation statistics and survivability survey
tests/                  vitest suite + headless autopilot harness
```

The world renders into a low-resolution canvas that the browser upscales by an
integer factor with `image-rendering: pixelated`, so every sprite, glow and particle
stays crisp. React never re-renders per frame: the HUD writes to the DOM directly
from the engine's frame callback.

## Testing

`npm test` runs six suites (167 tests):

- **missions** - the mission director (no fixed sequence across runs, reproducibility, no repeats
  and cool-downs honoured, every type keeps coming up, rare types rarer, bosses at varying
  intervals and never twice running, gentle first sectors, veterans meet more sooner, tiers and
  twists scale with depth, twists only where supported and really changing the sector, rewards),
  sector codes rebuilding exactly (twists and variants included, old codes still valid), a
  distinct layout per mission type, and **every mission type flown to completion** on four seeds
  by autopilots that use only the ship's controls and what the HUD shows (`tests/pilots.ts`,
  `tests/missionHarness.ts`) - the eight 2.0 missions included. Plus the mechanics themselves.
- **expansion** - save migration from 1.x (nothing lost, milestones never paid twice, the old save
  left untouched, a damaged save kept aside, every field validated, exact round trip); the economy
  (statistics counted from events once, discoveries paid once, achievements unlocked and paid
  once, levels, credits never negative, purchases refused when unaffordable or locked, module
  bays and synergy discovery, practice pay); cases (stated odds match a 20,000-roll sample, new
  items before duplicates, duplicate conversion, guaranteed drops, price charged once); cosmetics
  (every item obtainable, loadout fallback, high rarity animated, the run using the fitted
  exhaust); modules in flight (the anchor absorbing a wave, the scanner revealing caches, the
  collector pulling pickups); the star-system pipeline (normalisation, units, deduplication,
  merging, validation, the bundled snapshot and its showcase systems, search and filters, JPL
  and Horizons parsing); live imports against a fake transport (caching across restarts,
  offline behaviour, retries, cool-down, no retry on 4xx, bad data, concurrency, corrupt cache)
  and the proxy's allow-list; and real systems as playable sectors.
- **astronomy** - catalogue integrity (unique ids, schema validation, no invented values,
  image attribution), unit conversion, deduplication, HTTP retry / rate limit / mirror
  fail-over, image matching, and a pipeline run through a simulated partial outage.
- **generation** - seed determinism and sector-code round trips, 1,200 seeded levels
  checked for uniqueness and structural soundness, every environment's mechanical
  signature being distinct (the real-system ones included), difficulty shape, and 60- and
  200-sector journeys.
- **simulation** - the real simulation run headlessly with an orbit-keeping autopilot:
  every generated configuration must be able to hold its orbit for the whole sector, the
  mechanics must measurably do what they claim, and a multi-sector run must complete with
  networking disabled.
- **progression** - discovery log, milestones, unlocks, and tolerance of corrupt saves.

`npx vite-node scripts/survey.ts -- 900 1` prints the same statistics in readable form.

# ORBIT//LOST

**STAY IN ORBIT. SURVIVE THE UNIVERSE.**

A retro pixel-art arcade survival game built on real orbital physics. Your ship is
trapped orbiting a celestial body: shape your orbit with thrust, dodge asteroids,
comets, flares and pulsar beams, collect energy, and survive an endless chain of
procedurally remixed sectors.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # production bundle in dist/
npm run preview    # serve the production build
```

No backend, no accounts, no network calls — everything (sprites, sound, fonts) is
generated or bundled locally, so it works offline after the first load.

## Controls

| Input | Action |
| --- | --- |
| `W` / `↑` | Accelerate along your path (raises the far side of the orbit) |
| `S` / `↓` | Decelerate against your path (lowers the far side) |
| `A` / `D` | Fine strafe left / right |
| `Space` / `Shift` | Boost — brief phase through hazards (destroys small rocks) |
| `Esc` / `P` | Pause / resume |
| Mouse | Hold left = accelerate, right = decelerate, middle = boost |
| Touch | On-screen BRAKE / ACCEL / BOOST buttons |

Keep the dotted trajectory between the two rings. Leaving the safe band, falling
inward, escaping, or entering heat zones drains **Orbit Stability**; at zero you lose
control. Touching a star, planet or event horizon is fatal.

## Structure

```
src/
  game/                 framework-free simulation (no React)
    engine.ts           rAF loop, fixed-timestep accumulator, state machine, events
    run.ts              one run: ship, hazards, environment events, progression, scoring
    physics.ts          Newtonian point-mass gravity, leapfrog integrator
    orbital.ts          orbit elements, stability model, trajectory prediction
    player.ts           ship state and controller helpers
    collision.ts        circle / wedge / beam / closest-approach tests
    hazards.ts          asteroid, debris and comet factories + edge spawning
    levels.ts           authored sectors 1-5 and procedural remixes from sector 6
    upgrades.ts         in-run modules and permanent ship upgrades
    particles.ts        fixed-capacity struct-of-arrays particle pool
    audio.ts            procedural Web Audio sound effects and ambient drone
    input.ts            keyboard, mouse and virtual (touch) input
    persistence.ts      localStorage save (records, credits, upgrades, settings)
    render/             low-res pixel renderer, sprites, celestial bodies, starfield
  ui/                   React menus, HUD, upgrade picker, game over, settings
```

The world renders into a low-resolution canvas that the browser upscales by an
integer factor with `image-rendering: pixelated`, so every sprite, glow and particle
stays crisp. React never re-renders per frame: the HUD writes to the DOM directly
from the engine's frame callback.

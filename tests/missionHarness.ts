/**
 * Flies one mission sector headlessly with the matching autopilot and reports how it went.
 */
import { CONFIG } from '../src/game/config';
import { wrapAngle } from '../src/game/math';
import { orbitInfo } from '../src/game/orbital';
import type { Controls } from '../src/game/player';
import { Run } from '../src/game/run';
import type { RunSink } from '../src/game/run';
import { relOrbitVelocity } from '../src/game/missions/controllers';
import type { DevourerBoss } from '../src/game/missions/controllers';
import type { TargetRt } from '../src/game/missions/runtime';
import type { MissionDebrief, MissionKind } from '../src/game/missions/types';
import type { LevelDef } from '../src/game/types';
import { generateLevelFromSeed } from '../src/generation/levelGenerator';
import { gravityAt } from '../src/game/physics';
import { placeAttractors } from '../src/game/rails';
import { CURRICULUM } from '../src/game/missions/catalog';
import { anchorAt, gatePilot, holdOrbit, phaseAndHold, shootFor } from './pilots';

export interface MissionResult {
  kind: MissionKind;
  code: string;
  env: string;
  completed: boolean;
  failure: string;
  died: string;
  time: number;
  hull: number;
  debrief: MissionDebrief | null;
  messages: string[];
}

export interface PilotState {
  released: boolean;
  burning: boolean;
  done: boolean;
  plan?: { start: number; burn: number; miss: number } | null;
  planned?: number;
  stage?: number;
  climbing?: boolean;
  circularising?: boolean;
}

/**
 * Simulate a burn starting now: prograde until the apoapsis reaches `apo`, then coast to that
 * apoapsis. Returns false if the path crosses any belt outside its gap; else where it ends.
 */
function hopThroughGaps(run: Run, apo: number): { ok: boolean; x: number; y: number } {
  const L = run.level;
  const m = L.mission;
  const mu = L.orbitMu;
  const acc = CONFIG.THRUST * L.thrustScale * run.mods.thrustMul;
  const t0 = run.mission.t;
  const dt = 1 / 60;
  let { x, y, vx, vy } = run.ship;
  let burning = true;
  for (let i = 0; i < 20 / dt; i++) {
    const r = Math.hypot(x, y);
    const sp = Math.hypot(vx, vy);
    if (burning) {
      const info = orbitInfo(x, y, vx, vy, mu);
      if (info.escaping || info.apo >= apo) burning = false;
    }
    let ax = (-mu * x) / (r * r * r);
    let ay = (-mu * y) / (r * r * r);
    if (burning) {
      ax += (vx / sp) * acc;
      ay += (vy / sp) * acc;
    }
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    const rr = Math.hypot(x, y);
    for (const b of m.rockBelts) {
      const band = 7 + 4.2 + 2;
      if (Math.abs(rr - b.radius) > band) continue;
      const w = b.dir * Math.sqrt(mu / (b.radius * b.radius * b.radius));
      const a = Math.atan2(y, x) - run.frameAngle;
      const clear = band / b.radius;
      if (!b.gaps.some((g) => Math.abs(wrapAngle(a - (g.angle + w * (t0 + i * dt)))) < g.width / 2 - clear)) return { ok: false, x, y };
    }
    if (!burning && (x * vx + y * vy) / rr <= 0) break;
  }
  return { ok: true, x, y };
}

/**
 * Staged asteroid run, the way the mission is meant to be flown: hop through one belt's gap at a
 * time, settle in the clear lane beyond it, and wait for the next gap to come round. The last hop
 * waits for a gap that also puts the apoapsis on the jump gate.
 */
export function stagedRunPilot(run: Run, st: PilotState): Controls {
  const m = run.level.mission;
  const s = run.ship;
  const belts = m.rockBelts;
  const gate = run.mission.targets[0];
  const r = Math.hypot(s.x, s.y);
  const lanes = belts.map((b, k) => (k < belts.length - 1 ? (b.radius + belts[k + 1].radius) / 2 : gate.anchor.r));
  const stage = st.stage ?? 0;
  const target = lanes[stage];
  const coast: Controls = { accel: false, brake: false, lateral: 0, boost: false };
  const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.level.orbitMu);
  if (st.burning) {
    if (!info.escaping && info.apo < target) return { accel: true, brake: false, lateral: 0, boost: false };
    st.burning = false;
    st.climbing = true;
  }
  if (st.climbing) {
    // Coast up to the new apoapsis, then lift the periapsis into the lane.
    if ((s.x * s.vx + s.y * s.vy) / r > 2 && !st.circularising) return coast;
    // Past the last belt the sky is clear: steer onto the gate with the preview.
    if (stage === belts.length - 1) return shootFor(run, (t) => anchorAt(run, gate.anchor, t), gate.r, 8);
    st.circularising = true;
    if (info.peri < target - 4) return { accel: true, brake: false, lateral: 0, boost: false };
    st.climbing = false;
    st.circularising = false;
    st.stage = stage + 1;
    return coast;
  }
  // Waiting in a lane: go when a hop from here threads the next gap (and, last, ends on the gate).
  const hop = hopThroughGaps(run, target);
  if (hop.ok) {
    st.burning = true;
    return { accel: true, brake: false, lateral: 0, boost: false };
  }
  return holdOrbit(run, stage === 0 ? run.level.startRadius : lanes[stage - 1]);
}

/**
 * Asteroid run: find a single burn whose path crosses every belt inside one of its (rotating) gaps
 * and ends at the jump gate - the timing puzzle the mission is built around.
 */
export function planGapRun(run: Run): { start: number; burn: number; miss: number } | null {
  const L = run.level;
  const m = run.level.mission;
  const mu = L.orbitMu;
  const acc = CONFIG.THRUST * L.thrustScale * run.mods.thrustMul;
  const target = anchorAt(run, run.mission.targets[0].anchor, 0);
  const t0 = run.mission.t;
  const dt = 1 / 60;
  let best: { start: number; burn: number; miss: number } | null = null;
  for (let start = 0; start <= 14; start += 0.1) {
    for (let burn = 0.6; burn <= 4.5; burn += 0.1) {
      let { x, y, vx, vy } = run.ship;
      let miss = Infinity;
      let ok = true;
      const crossed = new Set<number>();
      for (let i = 0; i < 24 / dt && ok; i++) {
        const t = i * dt;
        const r = Math.hypot(x, y);
        let ax = (-mu * x) / (r * r * r);
        let ay = (-mu * y) / (r * r * r);
        if (t >= start && t < start + burn) {
          const sp = Math.hypot(vx, vy);
          ax += (vx / sp) * acc;
          ay += (vy / sp) * acc;
        }
        vx += ax * dt;
        vy += ay * dt;
        x += vx * dt;
        y += vy * dt;
        const rr = Math.hypot(x, y);
        m.rockBelts.forEach((b, k) => {
          if (Math.abs(rr - b.radius) > 9) return;
          crossed.add(k);
          // Where is the ship relative to each gap's centre at this moment (belts rotate)?
          const w = b.dir * Math.sqrt(mu / (b.radius * b.radius * b.radius));
          const a = Math.atan2(y, x) - run.frameAngle;
          const inGap = b.gaps.some((g) => Math.abs(wrapAngle(a - (g.angle + w * (t0 + t)))) < g.width / 2 - 0.08);
          if (!inGap) ok = false;
        });
        miss = Math.min(miss, Math.hypot(x - target.x, y - target.y));
        if (miss < 10) break;
      }
      if (ok && crossed.size === m.rockBelts.length && (!best || miss < best.miss)) best = { start, burn, miss };
    }
    if (best && best.miss < 10) break;
  }
  return best;
}

/**
 * Search (wait, burn length) for a single prograde burn whose coasting path - through the moving
 * planets' gravity - passes closest to `target`. Burns are modelled as continuous thrust.
 */
export function planBurn(run: Run, target: { x: number; y: number }, fuel: number): { start: number; burn: number; miss: number } {
  const L = run.level;
  const acc = CONFIG.THRUST * L.thrustScale * run.mods.thrustMul;
  const dt = 1 / 40;
  const g = { x: 0, y: 0 };
  let best = { start: 0, burn: 0, miss: Infinity };
  const crashR = L.body.radius + 2;
  const burns = [0];
  for (let b = 0.15; b <= fuel - 0.02; b += 0.15) burns.push(b);
  for (let start = 0; start <= 10; start += 0.25) {
    for (const burn of burns) {
      if (burn === 0 && start > 0) continue;
      const att = run.attractors.map((a) => ({ ...a }));
      let { x, y, vx, vy } = run.ship;
      let miss = Infinity;
      for (let i = 0; i < 30 / dt; i++) {
        const t = i * dt;
        placeAttractors(L, run.simTime + t, att);
        gravityAt(x, y, att, 1, g);
        let ax = g.x;
        let ay = g.y;
        if (t >= start && t < start + burn) {
          const sp = Math.hypot(vx, vy) || 1;
          ax += (vx / sp) * acc;
          ay += (vy / sp) * acc;
        }
        vx += ax * dt;
        vy += ay * dt;
        x += vx * dt;
        y += vy * dt;
        if (Math.hypot(x - att[0].x, y - att[0].y) < crashR || L.companions.some((c, k) => Math.hypot(x - att[k + 1].x, y - att[k + 1].y) < c.radius + 4)) {
          miss = Infinity;
          break;
        }
        miss = Math.min(miss, Math.hypot(x - target.x, y - target.y));
        if (Math.hypot(x, y) > (L.mission.arena || 400) + 20) break;
      }
      // Coasting wins ties: only burn when it clearly helps.
      if (miss < (burn === 0 ? best.miss : best.miss - 2) || (burn === 0 && miss < 12)) best = { start, burn, miss };
    }
  }
  return best;
}

/** First curriculum sector of a mission type (where it is introduced). */
export function sectorFor(kind: MissionKind, tier: number): number {
  const first = CURRICULUM.indexOf(kind) + 1;
  if (tier <= 1) return first;
  const last = CURRICULUM.lastIndexOf(kind) + 1;
  return last > first ? last : 16 + (tier - 2) * 15;
}

export function missionLevel(kind: MissionKind, tier: number, seed: number, index = sectorFor(kind, tier)): LevelDef {
  return generateLevelFromSeed(seed, index, new Set(), undefined, { kind, tier });
}

function dockPilot(run: Run, tg: TargetRt): Controls {
  const s = run.ship;
  // Inside the capture field with speeds roughly matched: let go and let the tractor hold you.
  const d = Math.hypot(tg.x - s.x, tg.y - s.y);
  const rv = relOrbitVelocity(run, tg);
  if (d < tg.r * 0.9 && Math.hypot(rv.x, rv.y) < 30) return { accel: false, brake: false, lateral: 0, boost: false };
  return phaseAndHold(run, tg.x, tg.y, tg.anchor.r);
}

/** Keep an eccentric orbit whose periapsis dips to `peri` and whose apoapsis sits at `apo`. */
function shapeOrbit(run: Run, peri: number, apo: number): Controls {
  const s = run.ship;
  const info = orbitInfo(s.x - run.bx, s.y - run.by, s.vx, s.vy, run.attractors[0].mu);
  if (info.escaping) return { accel: false, brake: true, lateral: 0, boost: false };
  const nearApo = info.r > (info.peri + info.apo) / 2;
  if (nearApo) return { accel: info.peri < peri - 2, brake: info.peri > peri + 2, lateral: 0, boost: false };
  return { accel: info.apo < apo - 3, brake: info.apo > apo + 3, lateral: 0, boost: false };
}

export function pilotFor(run: Run, phase: PilotState): Controls {
  const m = run.mission;
  const kind = run.level.mission.kind;
  const s = run.ship;
  switch (kind) {
    case 'survival':
    case 'pursuit':
      return holdOrbit(run, run.level.startRadius);
    case 'precision':
      return gatePilot(run);
    case 'extraction': {
      const dock = m.targets[0];
      if (dock.hidden) return holdOrbit(run, run.level.startRadius);
      return dockPilot(run, dock);
    }
    case 'boss_neutron': {
      const open = m.targets.filter((t) => !t.hidden && !t.done);
      if (open.length === 0) return holdOrbit(run, run.level.startRadius);
      const near = open.reduce((a, b) => (Math.hypot(a.x - s.x, a.y - s.y) < Math.hypot(b.x - s.x, b.y - s.y) ? a : b));
      return dockPilot(run, near);
    }
    case 'nebula': {
      // Follow the main corridor: it is the transfer orbit from its mouth to the exit beacon.
      const tg = m.targets[0];
      const mouth = run.level.mission.params.mouth;
      const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.level.orbitMu);
      if (!phase.burning && !phase.done) {
        const ang = wrapAngle(Math.atan2(s.y, s.x) - run.frameAngle - mouth);
        if (ang > -0.03 && ang < 0.2) phase.burning = true;
        else return holdOrbit(run, run.level.startRadius);
      }
      if (phase.burning) {
        if (!info.escaping && info.apo < tg.anchor.r - 1) return { accel: true, brake: false, lateral: 0, boost: false };
        phase.burning = false;
        phase.done = true;
      }
      return Math.hypot(s.x, s.y) > tg.anchor.r * 0.8 ? shootFor(run, (t) => anchorAt(run, tg.anchor, t), tg.r, 6) : { accel: false, brake: false, lateral: 0, boost: false };
    }
    case 'slingshot': {
      // Plan a burn (when, how long) through the moving planet's gravity; re-plan while coasting,
      // the way a player keeps re-reading the preview.
      const tg = m.targets[0];
      const now = run.mission.activeT;
      const p = phase.plan;
      if (p && now >= p.start && now < p.start + p.burn) return { accel: true, brake: false, lateral: 0, boost: false };
      if (run.phase === 'active' && (!p || now >= p.start + p.burn || now - (phase.planned ?? -9) > 1.5)) {
        const plan = planBurn(run, anchorAt(run, tg.anchor, 0), m.fuel);
        phase.planned = now;
        phase.plan = plan.burn > 0 ? { start: now + plan.start, burn: plan.burn, miss: plan.miss } : null;
      }
      return { accel: false, brake: false, lateral: 0, boost: false };
    }
    case 'asteroid_run': {
      const tg = m.targets[0];
      return shootFor(run, (t) => anchorAt(run, tg.anchor, t), tg.r, 10);
    }
    case 'event_horizon': {
      const info = orbitInfo(s.x, s.y, s.vx, s.vy, run.attractors[0].mu);
      const esc = run.level.mission.params.escapeR;
      return { accel: info.escaping ? false : info.apo < esc + 20, brake: false, lateral: 0, boost: false };
    }
    case 'boss_devourer': {
      const dev = m as DevourerBoss;
      const charge = m.pickups.find((p) => p.kind === 'charge' && !p.taken);
      const info = orbitInfo(s.x - run.bx, s.y - run.by, s.vx, s.vy, run.attractors[0].mu);
      if (dev.carryingCharge) {
        phase.released = false;
        return shapeOrbit(run, dev.deliverR - 8, 200);
      }
      if (dev.falling || info.peri < 110) return shapeOrbit(run, 150, 210);
      if (charge) return phaseAndHold(run, charge.x, charge.y, charge.anchor.r);
      return holdOrbit(run, 170);
    }
    case 'boss_sentinel': {
      const heat = run.level.body.heatRadius;
      return shapeOrbit(run, heat - 5, run.level.safeMax - 20);
    }
  }
  return holdOrbit(run, run.level.startRadius);
}

export function flyMission(level: LevelDef, opts: { noSpawns?: boolean; seconds?: number; pilot?: (run: Run) => Controls } = {}): MissionResult {
  let died = '';
  let debrief: MissionDebrief | null = null;
  const messages: string[] = [];
  const sink: RunSink = {
    sfx: () => undefined,
    message: (t) => {
      if (messages[messages.length - 1] !== t) messages.push(t);
    },
    levelIntro: () => undefined,
    upgradeReady: () => undefined,
    died: (c) => {
      died = c;
    },
    missionComplete: (d) => {
      debrief = d;
    },
  };
  const run = new Run({ demo: false, sink, seed: level.seed, level, noSpawns: opts.noSpawns ?? true });
  // Extraction is tested from the docking half: the quota is handed over up front.
  if (level.mission.kind === 'extraction') run.energy += level.mission.params.quota;
  const limit = opts.seconds ?? (level.mission.window > 0 ? level.mission.window + 10 : 240);
  const phase: PilotState = { released: false, burning: false, done: false, plan: null };
  let controls: Controls = { accel: false, brake: false, lateral: 0, boost: false };
  const steps = Math.ceil(limit / CONFIG.STEP);
  for (let i = 0; i < steps; i++) {
    if (i % 4 === 0) run.updatePrediction();
    if (i % 12 === 0) controls = opts.pilot ? opts.pilot(run) : pilotFor(run, phase);
    // A pilot reads CONTROLS INVERTED on the HUD and compensates.
    const c = run.mission.invertT > 0 ? { accel: controls.brake, brake: controls.accel, lateral: -controls.lateral, boost: controls.boost } : controls;
    run.step(CONFIG.STEP, c);
    if (run.phase === 'clearing' || run.phase === 'warping' || run.phase === 'dying' || run.phase === 'dead') break;
  }
  const d = debrief as MissionDebrief | null;
  return {
    kind: level.mission.kind,
    code: level.code,
    env: level.identity.environment,
    completed: !!d && d.success,
    failure: d?.failure ?? '',
    died: died || (run.phase === 'dying' ? run.deathCause : ''),
    time: run.mission.activeT,
    hull: run.ship.hull,
    debrief: d,
    messages,
  };
}

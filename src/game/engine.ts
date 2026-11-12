import { AudioManager } from './audio';
import { CONFIG } from './config';
import { Input } from './input';
import { clamp } from './math';
import type { SaveStore, Settings } from './persistence';
import { Renderer } from './render/renderer';
import { Run } from './run';
import type { RunSink } from './run';
import type { Controls } from './player';
import { progressFrom, recordVisit } from '../progression/discovery';
import { newlyCompleted } from '../progression/milestones';
import { PERMANENTS, UPGRADES, UPGRADE_ORDER, partUnlocked } from './upgrades';
import { betterRank } from './persistence';
import { MISSIONS } from './missions/catalog';
import { generateLevelFromSeed } from '../generation/levelGenerator';
import { CURRICULUM } from './missions/catalog';
import type {
  HudMessage,
  HudState,
  LevelDef,
  LevelIntro,
  MessageTone,
  MissionDebrief,
  MissionKind,
  ObjectiveHud,
  RunSummary,
  SfxName,
  UpgradeId,
  UpgradeOffer,
} from './types';

export type EnginePhase = 'menu' | 'playing' | 'paused' | 'upgrade' | 'gameover';

export type EngineEvent =
  | { type: 'phase'; phase: EnginePhase }
  | { type: 'offer'; options: UpgradeOffer[] }
  | { type: 'intro'; intro: LevelIntro }
  | { type: 'debrief'; debrief: MissionDebrief }
  | { type: 'gameover'; summary: RunSummary };

const EMPTY_OBJECTIVE: ObjectiveHud = {
  title: '',
  detail: '',
  progress: 0,
  timer: -1,
  bonuses: [],
  shards: 0,
  shardsTotal: 0,
  boss: null,
  fuel: 0,
  fuelMax: 0,
  alert: '',
};

type Listener = (e: EngineEvent) => void;

/**
 * Owns the canvas, the requestAnimationFrame loop, the fixed-timestep simulation and the
 * high-level game state machine. React only observes it through events and the HUD snapshot.
 */
export class Engine {
  readonly input = new Input();
  readonly audio = new AudioManager();
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private store: SaveStore;
  private run: Run;
  private menuRun: Run;
  phase: EnginePhase = 'menu';
  private listeners = new Set<Listener>();
  private frameListeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private timeScale = 1;
  private timeScaleTarget = 1;
  private offerAt = -1;
  private realTime = 0;
  private resizeObs: ResizeObserver | null = null;
  private messageSeq = 0;
  private settings: Settings;
  private introKey = 0;
  private destroyed = false;
  private boostPrimed = false;
  /** Titles of milestones completed during the current run. */
  private runMilestones: string[] = [];
  /** Ship parts unlocked during the current run. */
  private runParts: string[] = [];
  readonly hud: HudState = {
    level: 1,
    levelName: '',
    levelProgress: 0,
    levelPhase: '',
    score: 0,
    time: 0,
    hull: 100,
    hullMax: 100,
    shield: 0,
    shieldMax: 3,
    stability: 100,
    stabilityReason: null,
    energy: 0,
    milestonePrev: 0,
    milestoneNext: 6,
    boostReady: true,
    boostCharge: 1,
    overdrive: 0,
    temporalReady: false,
    hasTemporal: false,
    combo: 0,
    message: null,
    objective: EMPTY_OBJECTIVE,
  };

  constructor(container: HTMLElement, store: SaveStore) {
    this.container = container;
    this.store = store;
    this.settings = store.get().settings;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-label', 'ORBIT//LOST game view');
    container.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    this.menuRun = new Run({ demo: true, sink: this.demoSink, seed: 77 });
    this.run = this.menuRun;
    this.applySettings(this.settings);
    this.input.attach(this.canvas);

    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onWindowBlur);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ public API

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.audio.applySettings(s);
    this.renderer.opts = { screenShake: s.screenShake, reducedEffects: s.reducedEffects };
    this.run.setPreferences(s.sensitivity, s.reducedEffects);
  }

  startRun(level?: LevelDef, single = false): void {
    this.audio.unlock();
    const save = this.store.get();
    this.introKey++;
    this.runMilestones = [];
    this.runParts = [];
    this.run = new Run({
      demo: false,
      sink: this.sink,
      save,
      sensitivity: save.settings.sensitivity,
      reducedEffects: save.settings.reducedEffects,
      progress: progressFrom(save.journey),
      level,
      modifiers: save.runModifiers,
      single,
    });
    this.resize();
    this.acc = 0;
    this.timeScale = 1;
    this.timeScaleTarget = 1;
    this.offerAt = -1;
    this.hud.message = null;
    this.input.clear();
    this.input.flushQueue();
    this.boostPrimed = false;
    this.audio.setAmbienceLevel(1);
    this.audio.play('level');
    this.setPhase('playing');
  }

  pause(): void {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
    this.audio.setThrust(0);
    this.audio.setAmbienceLevel(0.4);
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.input.clear();
    this.input.flushQueue();
    this.audio.setAmbienceLevel(1);
    this.setPhase('playing');
    // Ease back in so the player can re-orient.
    this.timeScale = 0.3;
    this.timeScaleTarget = 1;
  }

  togglePause(): void {
    if (this.phase === 'playing') this.pause();
    else if (this.phase === 'paused') this.resume();
  }

  chooseUpgrade(id: UpgradeId): void {
    if (this.phase !== 'upgrade') return;
    this.run.applyUpgrade(id);
    this.audio.play('upgrade');
    this.input.clear();
    this.input.flushQueue();
    this.setPhase('playing');
    this.timeScale = 0.25;
    this.timeScaleTarget = 1;
    if (this.run.pendingUpgrades > 0) this.offerAt = this.realTime + 1.2;
  }

  toMenu(): void {
    this.run = this.menuRun;
    this.audio.setThrust(0);
    this.audio.setDrone('menu');
    this.audio.setAmbienceLevel(0.7);
    this.timeScale = 1;
    this.timeScaleTarget = 1;
    this.offerAt = -1;
    this.resize();
    this.setPhase('menu');
  }

  sfx(name: SfxName): void {
    this.audio.play(name);
  }

  /** The sector currently being played (for the pause screen's scan read-out). */
  get currentLevel(): LevelDef {
    return this.run.level;
  }

  /**
   * Development aid: jump straight into a specific generated level.
   * `levelFromCode` in src/generation rebuilds any level from its sector code.
   */
  playLevel(level: LevelDef): void {
    this.startRun(level);
  }

  /**
   * Mission practice: one freshly seeded sector of a mission type the player has already met,
   * at the sector where the curriculum first introduces it.
   */
  playMission(kind: MissionKind, tier = 1): void {
    const first = CURRICULUM.indexOf(kind) + 1 || 16;
    const index = tier > 1 ? Math.max(first, CURRICULUM.lastIndexOf(kind) + 1) : first;
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.startRun(generateLevelFromSeed(seed, index, new Set(), undefined, { kind, tier }), true);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.resizeObs?.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onWindowBlur);
    this.audio.destroy();
    this.listeners.clear();
    this.frameListeners.clear();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------ internals

  private emit(e: EngineEvent): void {
    this.listeners.forEach((l) => l(e));
  }

  private setPhase(p: EnginePhase): void {
    this.phase = p;
    this.input.capture = p === 'playing';
    this.emit({ type: 'phase', phase: p });
  }

  private resize = (): void => {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const { hw, hh } = this.renderer.resize(rect.width, rect.height, dpr);
    this.menuRun.setView(hw, hh);
    this.run.setView(hw, hh);
  };

  private onVisibility = (): void => {
    if (document.hidden && this.settings.autoPause) this.pause();
  };

  private onWindowBlur = (): void => {
    if (this.settings.autoPause) this.pause();
  };

  private message(text: string, tone: MessageTone): void {
    const m: HudMessage = { id: ++this.messageSeq, text, tone, time: this.realTime };
    this.hud.message = m;
  }

  private demoSink: RunSink = {
    sfx: () => undefined,
    message: () => undefined,
    levelIntro: () => undefined,
    upgradeReady: () => undefined,
    died: () => undefined,
  };

  private sink: RunSink = {
    sfx: (name, intensity) => this.audio.play(name, intensity),
    message: (text, tone) => this.message(text, tone),
    levelIntro: (level: LevelDef, discovery: boolean, newMission: boolean) => {
      this.audio.setDrone(level.body.kind);
      // The visit is saved straight away, so the catalogue fills even if this sector ends the run.
      const now = new Date().toISOString();
      this.store.update((d) => {
        recordVisit(d.journey, level.identity, level.index, now);
      });
      this.awardMilestones(Math.max(this.store.get().records.highestLevel, level.index));
      const rare = level.identity.rarity === 'rare' || level.identity.rarity === 'legendary';
      if (level.mission.boss) this.audio.play('alarm');
      else if (rare) this.audio.play('upgrade');
      this.emit({
        type: 'intro',
        intro: {
          index: level.index,
          name: level.name,
          tagline: level.tagline,
          classification: level.classification,
          newMechanics: level.newMechanics,
          identity: level.identity,
          discovery,
          key: ++this.introKey,
          missionKind: level.mission.kind,
          missionTitle: level.mission.title,
          missionBrief: level.mission.brief,
          boss: level.mission.boss,
          newMission,
        },
      });
    },
    missionComplete: (debrief: MissionDebrief) => {
      this.recordMission(debrief);
      this.emit({ type: 'debrief', debrief });
    },
    upgradeReady: () => {
      if (this.offerAt < 0) this.offerAt = this.realTime + 0.45;
      this.timeScaleTarget = 0.3;
      this.audio.play('offer');
    },
    died: (cause: string) => this.finishRun(cause),
  };

  /** Save a finished sector straight away: best ranks, shards and bosses survive a later death. */
  private recordMission(d: MissionDebrief): void {
    const before = this.store.get();
    const progressBefore = { shards: before.records.shards, bosses: before.bosses };
    this.store.update((s) => {
      s.records.shards += d.shards;
      if (d.success) {
        s.records.missionsCompleted += 1;
        const rec = s.missions[d.kind] ?? { completed: 0, best: '-' as const };
        s.missions[d.kind] = { completed: rec.completed + 1, best: betterRank(rec.best, d.rank) };
        if (d.boss && !s.bosses.includes(d.kind)) s.bosses.push(d.kind);
      }
    });
    const after = this.store.get();
    for (const p of PERMANENTS) {
      if (!partUnlocked(p, progressBefore) && partUnlocked(p, { shards: after.records.shards, bosses: after.bosses })) {
        this.runParts.push(p.name);
        this.message(`SHIP PART UNLOCKED · ${p.name}`, 'upgrade');
      }
    }
  }

  /** Pay out any milestone that has just been completed. Returns their titles. */
  private awardMilestones(highestLevel: number): string[] {
    const save = this.store.get();
    const fresh = newlyCompleted({ log: save.journey, highestLevel }, save.milestones);
    if (fresh.length === 0) return [];
    this.store.update((d) => {
      for (const m of fresh) {
        d.milestones.push(m.id);
        d.credits += m.reward;
      }
    });
    for (const m of fresh) {
      this.runMilestones.push(m.title);
      this.message(`MILESTONE · ${m.title}  +${m.reward} CR`, 'upgrade');
    }
    return fresh.map((m) => m.title);
  }

  private openOffer(): void {
    this.offerAt = -1;
    const options = this.run.makeOffer();
    if (options.length === 0) {
      this.run.skipUpgrade();
      this.timeScaleTarget = 1;
      return;
    }
    this.audio.setThrust(0);
    this.setPhase('upgrade');
    this.emit({ type: 'offer', options });
  }

  private finishRun(cause: string): void {
    const run = this.run;
    const save = this.store.get();
    const rec = save.records;
    const level = run.levelIndex;
    // Practice sectors do not count towards records and pay half.
    const practice = run.single;
    const finalScore = Math.floor(run.score * run.scoreMul);
    const shards = run.debriefs.reduce((s, d) => s + d.shards, 0);
    const credits = Math.floor(
      (run.energy + run.levelsCleared * 6 + Math.floor(finalScore / 1500) + shards * 4) * run.mods.creditMul * (practice ? 0.5 : 1),
    );
    const newBestScore = !practice && finalScore > rec.bestScore && finalScore > 0;
    const newBestLevel = !practice && level > rec.highestLevel;
    const newBestTime = !practice && run.time > rec.bestTime;
    const lifetimeEnergy = rec.lifetimeEnergy + run.energy;
    const highest = practice ? rec.highestLevel : Math.max(rec.highestLevel, level);
    const unlocked: UpgradeId[] = [];
    const have = new Set(save.unlocked);
    for (const id of UPGRADE_ORDER) {
      const u = UPGRADES[id].unlock;
      if (!u || have.has(id)) continue;
      const ok = u.kind === 'level' ? highest >= u.value : lifetimeEnergy >= u.value;
      if (ok) unlocked.push(id);
    }
    this.store.update((d) => {
      if (!practice) {
        d.records.bestScore = Math.max(d.records.bestScore, finalScore);
        d.records.bestTime = Math.max(d.records.bestTime, run.time);
      }
      d.records.highestLevel = highest;
      d.records.totalRuns += 1;
      d.records.lifetimeEnergy = lifetimeEnergy;
      d.records.lifetimeTime += run.time;
      d.records.asteroidsAvoided += run.avoided;
      d.records.asteroidsDestroyed += run.destroyed;
      d.credits += credits;
      d.unlocked = UPGRADE_ORDER.filter((id) => d.unlocked.includes(id) || unlocked.includes(id));
      d.journey.sectorsCleared += run.levelsCleared;
    });
    this.awardMilestones(highest);
    const summary: RunSummary = {
      cause,
      level,
      time: run.time,
      score: finalScore,
      energy: run.energy,
      avoided: run.avoided,
      destroyed: run.destroyed,
      nearMisses: run.nearMisses,
      creditsEarned: credits,
      newBestScore,
      newBestLevel,
      newBestTime,
      unlocked,
      upgrades: run.upgradesSummary,
      discoveries: run.visits.filter((v) => v.discovery).map((v) => v.identity.objectName),
      milestones: [...this.runMilestones],
      missionsCompleted: run.debriefs.filter((d) => d.success).length,
      bossesDefeated: run.bossesDefeated.map((k) => MISSIONS[k].title),
      shards,
      ranks: run.debriefs.map((d) => d.rank),
      partsUnlocked: [...this.runParts],
      scoreMultiplier: run.scoreMul,
    };
    this.audio.setThrust(0);
    this.audio.play(practice && run.debriefs.some((d) => d.success) ? 'clear' : 'gameover');
    this.audio.setAmbienceLevel(0.6);
    this.setPhase('gameover');
    this.emit({ type: 'gameover', summary });
  }

  private frame = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > CONFIG.MAX_FRAME_DT) dt = CONFIG.MAX_FRAME_DT;
    this.realTime += dt;

    const run = this.run;
    const playing = this.phase === 'playing';

    // Input that is handled outside the simulation.
    if (playing && this.input.consume('pause')) {
      this.pause();
    }
    if (!playing) this.input.flushQueue();

    // Smooth time-scale transitions (slow-mo before upgrade picks, ease back after).
    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt * 4);
    if (Math.abs(this.timeScale - this.timeScaleTarget) < 0.01) this.timeScale = this.timeScaleTarget;

    const simulate = this.phase === 'playing' || this.phase === 'menu' || this.phase === 'gameover';
    if (simulate) {
      const scale = this.phase === 'gameover' ? 0.45 : this.timeScale;
      this.acc += dt * scale;
      let steps = 0;
      const controls: Controls = {
        accel: this.input.accel,
        brake: this.input.brake,
        lateral: this.input.lateral,
        boost: false,
      };
      if (playing && this.input.consume('boost')) this.boostPrimed = true;
      while (this.acc >= CONFIG.STEP && steps < CONFIG.MAX_STEPS_PER_FRAME) {
        if (this.boostPrimed) {
          controls.boost = true;
          this.boostPrimed = false;
        } else {
          controls.boost = false;
        }
        run.step(CONFIG.STEP, playing ? controls : { accel: false, brake: false, lateral: 0, boost: false });
        this.acc -= CONFIG.STEP;
        steps++;
      }
      if (steps >= CONFIG.MAX_STEPS_PER_FRAME) this.acc = 0;
    }

    if (playing && this.offerAt > 0 && this.realTime >= this.offerAt) this.openOffer();

    // Audio: engine rumble follows thrust input.
    if (playing && run.ship.visible && (run.phase === 'active' || run.phase === 'intro' || run.phase === 'clearing')) {
      const t = Math.abs(run.ship.thrust) + Math.abs(run.ship.lateral) * 0.5;
      this.audio.setThrust(t > 0 ? 0.6 + (run.overdrive > 0 ? 0.4 : 0) : 0, run.ship.thrust < 0 ? 1.6 : 1);
    } else {
      this.audio.setThrust(0);
    }

    run.updatePrediction();
    this.renderer.render(run, dt, this.phase === 'menu');
    if (this.phase !== 'menu') this.updateHud();
    this.frameListeners.forEach((f) => f());
  };

  private updateHud(): void {
    const r = this.run;
    const s = r.ship;
    const h = this.hud;
    h.level = r.levelIndex;
    h.levelName = r.level.name;
    h.levelProgress = r.levelProgress;
    h.levelPhase = r.phase;
    h.score = Math.floor(r.score * r.scoreMul);
    h.objective = r.demo ? EMPTY_OBJECTIVE : r.mission.hud();
    h.time = r.time;
    h.hull = Math.max(0, s.hull);
    h.hullMax = s.hullMax;
    h.shield = s.shield;
    h.stability = s.stability;
    h.stabilityReason = r.stabilityReason;
    h.energy = r.energy;
    h.milestonePrev = r.milestonePrev;
    h.milestoneNext = r.milestoneNext;
    h.boostReady = s.boostCd <= 0;
    h.boostCharge = clamp(1 - s.boostCd / s.boostCdMax, 0, 1);
    h.overdrive = Math.max(0, r.overdrive);
    h.hasTemporal = r.mods.temporal > 0;
    h.temporalReady = r.temporalCd <= 0;
    h.combo = r.combo;
    if (h.message && this.realTime - h.message.time > 2.6) h.message = null;
  }
}

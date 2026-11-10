import { CONFIG } from './config';
import { approachAngle } from './math';
import type { LeapfrogBody } from './physics';

export interface Controls {
  accel: boolean;
  brake: boolean;
  lateral: number;
  boost: boolean;
}

export const NO_CONTROLS: Controls = { accel: false, brake: false, lateral: 0, boost: false };

const TRAIL_LEN = 48;

/** Player ship state. Physics integration happens in Run via leapfrogStep. */
export class Ship implements LeapfrogBody {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  gx = 0;
  gy = 0;
  heading = 0;
  /** -1 brake, 0 none, +1 accelerate (for visuals / audio). */
  thrust = 0;
  lateral = 0;
  hull: number;
  hullMax: number;
  shield = 0;
  shieldTimer = 0;
  stability = 100;
  invuln = 0;
  boostT = 0;
  boostCd = 0;
  boostCdMax: number = CONFIG.BOOST_COOLDOWN;
  alive = true;
  visible = true;
  spin = 0;
  /** Ring buffer of recent positions (world units). */
  readonly trail = new Float32Array(TRAIL_LEN * 2);
  trailHead = 0;
  trailCount = 0;
  private trailTick = 0;

  constructor(hullMax: number) {
    this.hullMax = hullMax;
    this.hull = hullMax;
  }

  get radius(): number {
    return CONFIG.SHIP_RADIUS;
  }

  get phasing(): boolean {
    return this.boostT > 0;
  }

  /** Prograde unit vector (direction of travel), falls back to heading when nearly stationary. */
  prograde(out: { x: number; y: number }): { x: number; y: number } {
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 1e-3) {
      out.x = this.vx / sp;
      out.y = this.vy / sp;
    } else {
      out.x = Math.cos(this.heading);
      out.y = Math.sin(this.heading);
    }
    return out;
  }

  updateHeading(dt: number, spinning: boolean): void {
    if (spinning) {
      this.heading += this.spin * dt;
      return;
    }
    const target = Math.atan2(this.vy, this.vx);
    this.heading = approachAngle(this.heading, target, 9 * dt);
  }

  pushTrail(): void {
    this.trailTick++;
    if (this.trailTick % 2 !== 0) return;
    this.trail[this.trailHead * 2] = this.x;
    this.trail[this.trailHead * 2 + 1] = this.y;
    this.trailHead = (this.trailHead + 1) % TRAIL_LEN;
    this.trailCount = Math.min(TRAIL_LEN, this.trailCount + 1);
  }

  clearTrail(): void {
    this.trailCount = 0;
  }

  /** Iterate trail from newest to oldest. */
  trailPoint(i: number, out: { x: number; y: number }): void {
    const idx = (this.trailHead - 1 - i + TRAIL_LEN * 2) % TRAIL_LEN;
    out.x = this.trail[idx * 2];
    out.y = this.trail[idx * 2 + 1];
  }

  static get trailLength(): number {
    return TRAIL_LEN;
  }
}

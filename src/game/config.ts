/** Global tuning constants. World units are roughly "pixels at zoom 1". */
export const CONFIG = {
  /** Fixed physics timestep (seconds). */
  STEP: 1 / 120,
  /** Max real frame delta fed into the accumulator. */
  MAX_FRAME_DT: 0.1,
  MAX_STEPS_PER_FRAME: 14,

  /** Half of the short screen dimension, in world units, that must be visible. */
  VIEW_RADIUS: 205,

  SHIP_RADIUS: 4.2,
  /** Base main-engine acceleration (u/s^2). */
  THRUST: 11,
  LATERAL_FACTOR: 0.6,
  BOOST_COOLDOWN: 6.5,
  BOOST_TIME: 0.75,
  BOOST_DV: 6,
  GRACE_TIME: 1.4,
  HULL_BASE: 100,

  STABILITY_REGEN: 6,
  STABILITY_HIT: 8,

  PICKUP_RADIUS: 10,
  MAX_MOTES: 10,
  MOTE_INTERVAL: 1.25,
  MOTE_LIFE: 16,

  INTRO_TIME: 2.4,
  CLEAR_TIME: 1.6,
  WARP_TIME: 1.5,
  DYING_TIME: 1.9,

  TRAJECTORY_TIME: 3.4,
  WARN_WINDOW: 0.9,
  SPAWN_LEAD: 2.6,

  /** Energy milestones for in-run upgrades: first + (base + k*grow). */
  MILESTONE_FIRST: 6,
  MILESTONE_BASE: 10,
  MILESTONE_GROW: 4,
} as const;

export const PALETTE = {
  bg: '#04050b',
  navy: '#0a0d1f',
  white: '#e8f0ff',
  cyan: '#3ef2ff',
  cyanDim: '#1a7f8f',
  violet: '#9b5cff',
  violetDim: '#4b2a8a',
  blue: '#3d6bff',
  orange: '#ff8a3d',
  amber: '#ffc94d',
  red: '#ff4d5e',
  green: '#5dffa0',
  gray: '#8a96b8',
  dark: '#1c2240',
} as const;

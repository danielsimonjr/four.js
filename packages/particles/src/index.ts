export const PACKAGE_NAME = "@four/particles";

export type { ParticleEmitterOptions } from "./emitter.js";
export {
  DEFAULT_PARTICLE_LIFETIME_SECONDS,
  DEFAULT_PARTICLE_RESTITUTION,
  DEFAULT_PARTICLE_SEED,
  DEFAULT_PARTICLE_SIZE,
  PARTICLE_DRAWS_PER_SPAWN,
  ParticleEmitter,
} from "./emitter.js";
export { ParticlePool } from "./pool.js";
// --- WP-9.2: §27 force fields (begin) ---
export type {
  BoxFieldVolume,
  FieldVolume,
  RadialFieldOptions,
  SphereFieldVolume,
  TurbulenceFieldOptions,
  VortexFieldOptions,
} from "./fields.js";
export {
  DEFAULT_GRAVITY_Y,
  DEFAULT_RADIAL_MIN_DISTANCE,
  DEFAULT_TURBULENCE_AMPLITUDE,
  DEFAULT_TURBULENCE_FREQUENCY,
  DEFAULT_VORTEX_MIN_DISTANCE,
  TURBULENCE_DIFFERENCE_CELLS,
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
} from "./fields.js";
// --- WP-9.2: §27 force fields (end) ---
// --- WP-9.3: batched particle rendering (begin) ---
export type { ParticleRenderableOptions } from "./particle-renderable.js";
export {
  PARTICLE_INSTANCE_FLOATS,
  ParticleRenderable,
} from "./particle-renderable.js";
// --- WP-9.3: batched particle rendering (end) ---
// --- WP-9.4: §39 particle simulation system (begin) ---
export type {
  ParticleFixedUpdateContext,
  ParticleStepTime,
  ParticleSystemOptions,
  SteppableEmitter,
} from "./particle-system.js";
export { PRIORITY_PARTICLES, ParticleSystem } from "./particle-system.js";
// --- WP-9.4: §39 particle simulation system (end) ---
export { SeededRandom } from "./random.js";
export type {
  ParticleBurst,
  ParticleColor,
  ParticleForceField,
  ParticleGpuSimulation,
  ParticleLifetimeRamp,
  ParticleRange,
  ParticleSimulationMode,
} from "./types.js";

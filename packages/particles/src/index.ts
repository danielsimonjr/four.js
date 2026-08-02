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
export { SeededRandom } from "./random.js";
export type {
  ParticleBurst,
  ParticleColor,
  ParticleForceField,
  ParticleLifetimeRamp,
  ParticleRange,
} from "./types.js";

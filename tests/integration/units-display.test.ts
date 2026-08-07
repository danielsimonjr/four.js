/**
 * A-2 / PH-13 — §40's `UnitSystem` is a **display and authoring** tier, and
 * nothing below it moves (2026-08-07).
 *
 * §40 was narrowed by spec revision 1.3 to exactly one claim: *"The `angle` and
 * `time` selections govern display and authoring-input conversion only: the
 * engine's internal representation and every API signature remain radians and
 * seconds (§7a)."* A unit test inside `@four/core` can check that the
 * conversion arithmetic is right; it cannot check that claim, because the claim
 * is about **every other package**. That is what this file is for, and it makes
 * the check in two directions:
 *
 * 1. **Authoring composes.** A real `@four/motion` kinematic command, issued on
 *    a real `@four/scene` node, authored as *"90 degrees over 500 milliseconds,
 *    1 500 millimetres along X"* through the §40 helpers, produces a
 *    **bit-identical** simulation to the same command authored directly as
 *    `Math.PI / 2`, `0.5`, and `1.5`. The helpers are a boundary, not a mode.
 *
 * 2. **Nothing downstream imports them.** `packages/core/src/units.ts` states
 *    that its functions must never run inside a simulation path — determinism
 *    (§33–§34) is the reason, and it is not a stylistic one: the conversions
 *    are inexact in the last bits by construction. A prose rule decays; this
 *    test scans every package source file and fails if one of them reaches for
 *    the module. {@link ALLOWED} is the escape hatch, and editing it is
 *    deliberately a visible act — a UI or tooling package that legitimately
 *    displays units gets added there, with a dated note, after someone has
 *    confirmed the import is not on a per-step path.
 *
 * The second test is the one that will still be earning its keep in a year.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  angleFromDisplay,
  lengthFromDisplay,
  resolveUnitSystem,
  timeFromDisplay,
} from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import {
  DEFAULT_FIXED_DELTA_TIME,
  KinematicController,
  KinematicSystem,
  createTimeState,
  type ReadonlyTimeState,
} from "@four/motion";
import { Group } from "@four/scene";
import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/**
 * A metre-and-kilogram world whose UI is millimetres, grams, milliseconds, and
 * degrees — the §40 audience, an engineering application, in one record. The
 * `scale` factors stay 1 because the *world* is still SI; only the readouts and
 * the input fields are not.
 */
const WORKSHOP_UNITS = resolveUnitSystem({
  length: "millimeter",
  mass: "gram",
  time: "millisecond",
  angle: "degree",
});

/** A node with a kinematic controller, stepped at the fixed rate. */
function scenario(): {
  node: Group;
  controller: KinematicController;
  step: (count: number) => void;
} {
  const node = new Group();
  node.transformAuthority = "kinematic";
  const controller = node.addComponent(new KinematicController());
  const system = new KinematicSystem();
  system.track(node);
  const time: ReadonlyTimeState = createTimeState({
    fixedDeltaTime: DEFAULT_FIXED_DELTA_TIME,
  });
  return {
    node,
    controller,
    step: (count: number) => {
      for (let i = 0; i < count; i += 1) {
        system.fixedUpdate({ time });
      }
    },
  };
}

describe("§40 authoring in display units drives an identical simulation", () => {
  it("converts once at the boundary and hands the engine its own units", () => {
    // What an inspector would collect: 90°, 500 ms, 1500 mm.
    const radians = angleFromDisplay(90, WORKSHOP_UNITS);
    const seconds = timeFromDisplay(500, WORKSHOP_UNITS);
    const worldUnits = lengthFromDisplay(1500, WORKSHOP_UNITS);

    // These three are exact, which is why the simulations below can be compared
    // bit for bit rather than approximately. Where a §40 conversion is *not*
    // exact (see the module header), it is the authored number that shifts by
    // an ulp — before the engine ever sees it — and never a simulation step.
    expect(radians).toBe(Math.PI / 2);
    expect(seconds).toBe(0.5);
    expect(worldUnits).toBe(1.5);

    const authoredInDisplayUnits = scenario();
    const axis = new Vector3(0, 0, 1);
    authoredInDisplayUnits.controller.rotateTo(
      new Quaternion().setFromAxisAngle(axis, radians),
      { duration: seconds },
    );
    authoredInDisplayUnits.controller.moveTo(new Vector3(worldUnits, 0, 0), {
      duration: seconds,
    });

    const authoredInEngineUnits = scenario();
    authoredInEngineUnits.controller.rotateTo(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
      { duration: 0.5 },
    );
    authoredInEngineUnits.controller.moveTo(new Vector3(1.5, 0, 0), {
      duration: 0.5,
    });

    // Mid-flight, not only at the end: an engine that "applied" units anywhere
    // would diverge on the interpolation, not on the target.
    for (const steps of [1, 5, 14, 40]) {
      authoredInDisplayUnits.step(steps);
      authoredInEngineUnits.step(steps);
      const a = authoredInDisplayUnits.node.transform;
      const b = authoredInEngineUnits.node.transform;
      expect(Object.is(a.position.x, b.position.x)).toBe(true);
      expect(Object.is(a.position.y, b.position.y)).toBe(true);
      expect(Object.is(a.position.z, b.position.z)).toBe(true);
      expect(Object.is(a.rotation.x, b.rotation.x)).toBe(true);
      expect(Object.is(a.rotation.y, b.rotation.y)).toBe(true);
      expect(Object.is(a.rotation.z, b.rotation.z)).toBe(true);
      expect(Object.is(a.rotation.w, b.rotation.w)).toBe(true);
    }

    // And the command really did run: 1 500 mm is 1.5 world units, reached.
    expect(authoredInDisplayUnits.node.transform.position.x).toBe(1.5);
  });
});

/**
 * The only files permitted to name the §40 conversion module.
 *
 * `units.ts` is the module; `index.ts` is `@four/core`'s public re-export.
 * Everything else is a simulation-adjacent package until someone argues
 * otherwise in writing.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  join("packages", "core", "src", "units.ts"),
  join("packages", "core", "src", "index.ts"),
]);

/** Every `.ts` file under `packages/<name>/src`, repository-relative. */
function packageSources(): string[] {
  const out: string[] = [];
  const packagesDir = join(repositoryRoot, "packages");
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    let stats;
    try {
      stats = statSync(src);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) {
      continue;
    }
    walk(src, out);
  }
  return out.map((file) => relative(repositoryRoot, file));
}

/** Depth-first collection of `.ts` files, skipping nothing — `src` has no build output. */
function walk(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
}

/**
 * Names that only appear in a file that has reached for the §40 tier. The
 * module path catches a relative import inside `@four/core`; the identifiers
 * catch a cross-package one, whatever spelling the import takes.
 */
const FORBIDDEN = [
  /from\s+"[^"]*\/units\.js"/,
  /\bresolveUnitSystem\b/,
  /\bUnitSystem\b/,
  /\bangleToDisplay\b/,
  /\bangleFromDisplay\b/,
  /\btimeToDisplay\b/,
  /\btimeFromDisplay\b/,
  /\blengthToDisplay\b/,
  /\blengthFromDisplay\b/,
  /\bmassToDisplay\b/,
  /\bmassFromDisplay\b/,
];

describe("§40 conversion helpers stay out of the engine (§33–§34 determinism)", () => {
  it("is imported by no package source outside @four/core's own surface", () => {
    const offenders: string[] = [];
    for (const file of packageSources()) {
      if (ALLOWED.has(file.split("/").join(sep))) {
        continue;
      }
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${file} matches ${pattern.source}`);
          break;
        }
      }
    }
    expect(
      offenders,
      "§40 conversions are display-only and inexact by construction; a simulation " +
        "path that calls them breaks replay determinism (§33–§34). If this import " +
        "is genuinely a UI or tooling surface, add the file to ALLOWED with a dated note.",
    ).toEqual([]);
  });

  it("scans a plausible number of files, so a broken walk cannot pass vacuously", () => {
    const files = packageSources();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(join("packages", "core", "src", "units.ts"));
    expect(files).toContain(join("packages", "physics", "src", "world.ts"));
  });
});

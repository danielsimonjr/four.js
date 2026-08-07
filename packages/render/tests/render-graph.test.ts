/**
 * Unit tests for `RenderGraph` (§63; R-5, 2026-08-07).
 *
 * Four things are under test:
 *
 * 1. **Construction rules** — unique names, inputs that must already exist
 *    (which is what makes a cycle unconstructable), removal refused while a
 *    consumer names the pass.
 * 2. **Execution** — enabled passes, in order, one `renderer.render(root,
 *    views, interpolation, target)` per scene pass, with the frame's
 *    interpolation record threaded through unchanged. `NullRenderer` records
 *    all four arguments, so the assertion is on the real interface rather than
 *    on a double invented here.
 * 3. **Validation** — the inter-pass rule the graph exists to enforce (a pass
 *    sampling a target another pass writes must run after it), the intra-pass
 *    feedback case R-4's backend refuses, the never-written case, and the
 *    custom-pass case where the graph admits it cannot see.
 * 4. **`describe()`** — §63's debug visualization at its textual tier.
 *
 * The scenes are real (`Scene`, `Renderable`, `Sprite`, real materials, a real
 * `RenderTarget`) because validation discovers what a pass samples by building
 * the actual render list: a fabricated item would test a walk this module does
 * not do.
 */

import { planeGeometry } from "@four/geometry";
import { FourError } from "@four/core";
import { LitMaterial, SpriteMaterial, UnlitMaterial } from "@four/materials";
import {
  Node,
  OrthographicCamera,
  PoseBuffer,
  Scene,
  createFullscreenViewport,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  NullRenderer,
  PARTICLE_INSTANCE_FLOATS,
  RenderGraph,
  RenderTarget,
  Renderable,
  Sprite,
  Texture,
  type ParticleDrawable,
  type RenderInterpolation,
  type RenderPass,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function view(id = "main"): Viewport {
  return createFullscreenViewport(new OrthographicCamera(), id);
}

/** A scene holding one unlit renderable whose `map` is `texture`. */
function sceneSampling(texture: UnlitMaterial["map"]): Scene {
  const scene = new Scene();
  scene.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ map: texture })),
  );
  return scene;
}

/** A scene that samples nothing at all. */
function plainScene(): Scene {
  const scene = new Scene();
  scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
  return scene;
}

function target(): RenderTarget {
  return new RenderTarget({ width: 8, height: 8 });
}

/**
 * One recorded `render` call. `NullRenderer` keeps only the most recent one;
 * a graph's whole point is the *sequence*, so this suite keeps them all.
 */
interface RecordedRender {
  readonly root: Node;
  readonly views: readonly Viewport[];
  readonly target: RenderTarget | null;
}

/** `NullRenderer` with a tape — a real `Renderer`, no cast anywhere. */
class RecordingRenderer extends NullRenderer {
  readonly calls: RecordedRender[] = [];

  override render(
    root: Node,
    views: readonly Viewport[],
    interpolation?: RenderInterpolation,
    passTarget?: RenderTarget | null,
  ): void {
    super.render(root, views, interpolation, passTarget);
    this.calls.push({ root, views, target: passTarget ?? null });
  }
}

/**
 * A conforming §36 particle node — the one drawable that carries **no
 * material**, and therefore the one the sampled-texture scan has to survive
 * without asking for one.
 */
class TestParticles extends Node implements ParticleDrawable {
  readonly isParticleDrawable = true;

  renderLayer = 0;

  renderOrder = 0;

  particleCount = 1;

  readonly particleInstances = new Float32Array(PARTICLE_INSTANCE_FLOATS);

  updateParticleInstances(): void {
    /* nothing to repack for this test */
  }
}

// ---------------------------------------------------------------------------
// Construction (§63).
// ---------------------------------------------------------------------------

describe("RenderGraph — passes and construction rules (§63)", () => {
  it("starts empty and appends passes in call order", () => {
    const graph = new RenderGraph();
    expect(graph.passes).toEqual([]);

    const root = plainScene();
    graph
      .addPass("world", { root, views: [view()] })
      .addPass("ui", { root, views: [view("ui")] });

    expect(graph.passes.map((entry) => entry.name)).toEqual(["world", "ui"]);
    expect(graph.passes[0].enabled).toBe(true);
    expect(graph.passes[0].inputs).toEqual([]);
  });

  it("records §63's `inputs` and defaults `enabled`", () => {
    const graph = new RenderGraph();
    const root = plainScene();
    graph.addPass("world", { root, views: [view()] });
    graph.addPass(
      "bloom",
      { root, views: [view("bloom")] },
      { inputs: ["world"], enabled: false },
    );

    const bloom = graph.getPass("bloom");
    expect(bloom?.inputs).toEqual(["world"]);
    expect(bloom?.enabled).toBe(false);
    expect(graph.getPass("absent")).toBeUndefined();
  });

  it("copies the inputs array rather than retaining the caller's", () => {
    const graph = new RenderGraph();
    const root = plainScene();
    graph.addPass("world", { root, views: [view()] });
    const inputs = ["world"];
    graph.addPass("bloom", { root, views: [view()] }, { inputs });
    inputs.push("mutated-after-the-fact");

    expect(graph.getPass("bloom")?.inputs).toEqual(["world"]);
  });

  it("rejects an empty pass name", () => {
    const graph = new RenderGraph();
    expect(() => graph.addPass("", { root: plainScene(), views: [] })).toThrow(
      /non-empty pass name/,
    );
  });

  it("rejects a duplicate pass name", () => {
    const graph = new RenderGraph();
    const pass = { root: plainScene(), views: [view()] };
    graph.addPass("world", pass);
    expect(() => graph.addPass("world", pass)).toThrow(
      /already has a pass named "world"/,
    );
  });

  it("rejects an input that is not already a pass — which is what makes a cycle unconstructable", () => {
    const graph = new RenderGraph();
    let thrown: unknown;
    try {
      graph.addPass(
        "bloom",
        { root: plainScene(), views: [view()] },
        { inputs: ["world"] },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FourError);
    expect((thrown as FourError).code).toBe("INVALID_APPLICATION_STATE");
    expect((thrown as FourError).message).toMatch(/declares input "world"/);
    // The failed add left nothing behind.
    expect(graph.passes).toEqual([]);
  });

  it("removes a pass, and answers false for one it does not have", () => {
    const graph = new RenderGraph();
    const root = plainScene();
    graph.addPass("world", { root, views: [view()] });
    graph.addPass("ui", { root, views: [view("ui")] });

    expect(graph.removePass("nope")).toBe(false);
    expect(graph.removePass("world")).toBe(true);
    expect(graph.passes.map((entry) => entry.name)).toEqual(["ui"]);
    expect(graph.getPass("world")).toBeUndefined();
    // The name is free again after removal.
    expect(() =>
      graph.addPass("world", { root, views: [view()] }),
    ).not.toThrow();
  });

  it("refuses to remove a pass another pass declares as an input", () => {
    const graph = new RenderGraph();
    const root = plainScene();
    graph.addPass("world", { root, views: [view()] });
    graph.addPass("bloom", { root, views: [view()] }, { inputs: ["world"] });

    expect(() => graph.removePass("world")).toThrow(
      /cannot be removed while "bloom" declares it as an input/,
    );
    expect(graph.passes).toHaveLength(2);
  });

  it("enables and disables a pass by name, and throws for an unknown one", () => {
    const graph = new RenderGraph();
    graph.addPass("world", { root: plainScene(), views: [view()] });

    expect(graph.setPassEnabled("world", false)).toBe(graph);
    expect(graph.getPass("world")?.enabled).toBe(false);
    graph.setPassEnabled("world", true);
    expect(graph.getPass("world")?.enabled).toBe(true);

    expect(() => graph.setPassEnabled("ghost", false)).toThrow(
      /no pass named "ghost"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Execution (§63 over R-4's seam).
// ---------------------------------------------------------------------------

describe("RenderGraph.execute — one render call per pass (§63, R-4)", () => {
  it("drives each enabled pass with its own root, views and target, in order", () => {
    const recording = new RecordingRenderer();
    const offscreen = target();
    const worldRoot = plainScene();
    const uiRoot = plainScene();
    const worldViews = [view("world")];
    const uiViews = [view("ui")];

    const graph = new RenderGraph();
    graph.addPass("world", {
      root: worldRoot,
      views: worldViews,
      target: offscreen,
    });
    graph.addPass("ui", { root: uiRoot, views: uiViews });

    expect(graph.execute(recording)).toBe(2);
    expect(recording.calls).toEqual([
      { root: worldRoot, views: worldViews, target: offscreen },
      { root: uiRoot, views: uiViews, target: null },
    ]);
  });

  it("passes the frame's §43 interpolation record through unchanged", () => {
    const renderer = new NullRenderer();
    const interpolation: RenderInterpolation = {
      poseBuffer: new PoseBuffer(),
      alpha: 0.25,
    };
    const graph = new RenderGraph();
    graph.addPass("world", { root: plainScene(), views: [view()] });

    graph.execute(renderer, interpolation);
    expect(renderer.lastInterpolation).toBe(interpolation);

    // …and a later un-interpolated frame clears it, exactly as a direct
    // `render` call would.
    graph.execute(renderer);
    expect(renderer.lastInterpolation).toBeNull();
  });

  it("skips disabled passes entirely (§63 enable/disable)", () => {
    const renderer = new NullRenderer();
    const graph = new RenderGraph();
    graph.addPass("world", { root: plainScene(), views: [view()] });
    graph.addPass(
      "ui",
      { root: plainScene(), views: [view("ui")] },
      { enabled: false },
    );

    expect(graph.execute(renderer)).toBe(1);
    expect(renderer.renderCount).toBe(1);

    graph.setPassEnabled("ui", true);
    expect(graph.execute(renderer)).toBe(2);
    expect(renderer.renderCount).toBe(3);
  });

  it("an empty graph renders nothing", () => {
    const renderer = new NullRenderer();
    expect(new RenderGraph().execute(renderer)).toBe(0);
    expect(renderer.renderCount).toBe(0);
  });

  it("hands a custom pass the renderer and its context — the escape hatch", () => {
    const renderer = new NullRenderer();
    const interpolation: RenderInterpolation = {
      poseBuffer: new PoseBuffer(),
      alpha: 0.5,
    };
    const front = target();
    const back = target();
    const root = plainScene();
    const seen: {
      name: string;
      sameGraph: boolean;
      interpolation: RenderInterpolation | undefined;
    }[] = [];

    const graph = new RenderGraph();
    const custom: RenderPass = {
      kind: "custom",
      target: back,
      execute: (passRenderer, context) => {
        seen.push({
          name: context.name,
          sameGraph: context.graph === graph,
          interpolation: context.interpolation,
        });
        passRenderer.render(root, [view()], context.interpolation, front);
        passRenderer.render(root, [view()], context.interpolation, back);
      },
    };
    graph.addPass("ping-pong", custom);

    expect(graph.execute(renderer, interpolation)).toBe(1);
    expect(seen).toEqual([
      { name: "ping-pong", sameGraph: true, interpolation },
    ]);
    // Two render calls from one pass: the graph counts passes, not draws.
    expect(renderer.renderCount).toBe(2);
    expect(renderer.lastRenderTarget).toBe(back);
  });
});

// ---------------------------------------------------------------------------
// Validation (§63 pass dependencies).
// ---------------------------------------------------------------------------

describe("RenderGraph.validate — pass dependencies (§63)", () => {
  it("is silent for a producer-then-consumer graph", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("world", {
      root: plainScene(),
      views: [view()],
      target: offscreen,
    });
    graph.addPass(
      "composite",
      { root: sceneSampling(offscreen.colorTexture), views: [view("main")] },
      { inputs: ["world"] },
    );

    expect(graph.validate()).toEqual([]);
  });

  it("reports the consumer-before-producer ordering error", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("composite", {
      root: sceneSampling(offscreen.colorTexture),
      views: [view("main")],
    });
    graph.addPass("world", {
      root: plainScene(),
      views: [view()],
      target: offscreen,
    });

    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("order");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].pass).toBe("composite");
    expect(issues[0].producer).toBe("world");
    expect(issues[0].target).toBe(offscreen);
    expect(issues[0].message).toMatch(/a \*later\* pass/);
  });

  it("reports the intra-pass feedback loop the backend refuses (R-4)", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("mirror", {
      root: sceneSampling(offscreen.colorTexture),
      views: [view()],
      target: offscreen,
    });

    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("feedback");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].pass).toBe("mirror");
    expect(issues[0].producer).toBe("mirror");
    expect(issues[0].target).toBe(offscreen);
  });

  it("warns when nothing writes a sampled target", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("composite", {
      root: sceneSampling(offscreen.colorTexture),
      views: [view()],
    });

    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("unwritten");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].producer).toBeNull();
    expect(issues[0].target).toBe(offscreen);
  });

  it("treats a disabled producer as no producer at all", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("world", {
      root: plainScene(),
      views: [view()],
      target: offscreen,
    });
    graph.addPass(
      "composite",
      { root: sceneSampling(offscreen.colorTexture), views: [view("main")] },
      { inputs: ["world"] },
    );
    expect(graph.validate()).toEqual([]);

    graph.setPassEnabled("world", false);
    const issues = graph.validate();
    expect(issues.map((issue) => issue.code)).toEqual(["unwritten"]);
  });

  it("accepts two passes writing one target (a prepass), consumer last", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("depth", {
      root: plainScene(),
      views: [view("depth")],
      target: offscreen,
    });
    graph.addPass("opaque", {
      root: plainScene(),
      views: [view("opaque")],
      target: offscreen,
    });
    graph.addPass("composite", {
      root: sceneSampling(offscreen.colorTexture),
      views: [view("main")],
    });

    expect(graph.validate()).toEqual([]);
  });

  it("reports one issue per sampled target, in pass order", () => {
    const first = target();
    const second = target();
    const scene = new Scene();
    scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ map: first.colorTexture }),
      ),
    );
    scene.add(
      new Renderable(
        planeGeometry(),
        new LitMaterial({ map: second.colorTexture }),
      ),
    );

    const graph = new RenderGraph();
    graph.addPass("composite", { root: scene, views: [view()] });

    const issues = graph.validate();
    expect(issues.map((issue) => issue.target)).toEqual([first, second]);
    expect(issues.every((issue) => issue.code === "unwritten")).toBe(true);
  });

  it("sees a sprite's texture as well as a surface material's map", () => {
    const offscreen = target();
    const scene = new Scene();
    scene.add(
      new Sprite(new SpriteMaterial({ texture: offscreen.colorTexture })),
    );

    const graph = new RenderGraph();
    graph.addPass("composite", { root: scene, views: [view()] });

    const issues = graph.validate();
    expect(issues.map((issue) => issue.code)).toEqual(["unwritten"]);
    expect(issues[0].target).toBe(offscreen);
  });

  it("ignores ordinary textures and untextured surfaces", () => {
    const scene = new Scene();
    scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({
          map: new Texture({
            width: 1,
            height: 1,
            data: new Uint8Array([255, 255, 255, 255]),
          }),
        }),
      ),
    );
    scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));

    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [view()] });
    expect(graph.validate()).toEqual([]);
  });

  it("survives a particle system, which has no material to sample through", () => {
    const offscreen = target();
    const scene = new Scene();
    scene.add(new TestParticles());
    scene.add(
      new Sprite(new SpriteMaterial({ texture: offscreen.colorTexture })),
    );

    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [view()] });

    // The particle item contributes nothing; the sprite's target is still seen.
    expect(graph.validate().map((issue) => issue.target)).toEqual([offscreen]);
  });

  it("reports a custom pass as opaque rather than clean", () => {
    const graph = new RenderGraph();
    graph.addPass("effect", {
      kind: "custom",
      execute: () => {
        /* nothing */
      },
    });

    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("opaque");
    expect(issues[0].severity).toBe("info");
    expect(issues[0].pass).toBe("effect");
    expect(issues[0].producer).toBeNull();
    expect(issues[0].target).toBeNull();
  });

  it("skips a disabled custom pass with the rest", () => {
    const graph = new RenderGraph();
    graph.addPass(
      "effect",
      {
        kind: "custom",
        execute: () => {
          /* nothing */
        },
      },
      { enabled: false },
    );
    expect(graph.validate()).toEqual([]);
  });

  it("counts a custom pass's declared target as a write for later passes", () => {
    const offscreen = target();
    const graph = new RenderGraph();
    graph.addPass("effect", {
      kind: "custom",
      target: offscreen,
      execute: () => {
        /* writes `offscreen`, somehow */
      },
    });
    graph.addPass("composite", {
      root: sceneSampling(offscreen.colorTexture),
      views: [view()],
    });

    // The only finding is the custom pass's own opacity: the declared target
    // satisfies the consumer's dependency.
    expect(graph.validate().map((issue) => issue.code)).toEqual(["opaque"]);
  });
});

// ---------------------------------------------------------------------------
// describe() — §63 debug visualization, textual tier.
// ---------------------------------------------------------------------------

describe("RenderGraph.describe — §63 debug visualization (textual)", () => {
  it("lists passes with kind, enablement, target and inputs", () => {
    const offscreen = target();
    const root = plainScene();
    const graph = new RenderGraph();
    graph.addPass("world", { root, views: [view()], target: offscreen });
    graph.addPass(
      "ui",
      { root, views: [view("ui")] },
      { inputs: ["world"], enabled: false },
    );
    graph.addPass(
      "composite",
      {
        kind: "custom",
        execute: () => {
          /* nothing */
        },
      },
      { inputs: ["world", "ui"] },
    );

    expect(graph.describe()).toBe(
      [
        "RenderGraph: 3 passes, 2 enabled",
        `1. world [scene] -> ${offscreen.id}`,
        "2. ui [scene, disabled] -> screen <- world",
        "3. composite [custom] -> screen <- world, ui",
      ].join("\n"),
    );
  });

  it("describes an empty graph", () => {
    expect(new RenderGraph().describe()).toBe(
      "RenderGraph: 0 passes, 0 enabled",
    );
  });
});

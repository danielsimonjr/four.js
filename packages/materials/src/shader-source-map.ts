/** One generated shader statement's location in its original graph. */
export interface ShaderSourceLocation {
  /** One-based generated line and column, matching GPU compiler diagnostics. */
  readonly line: number;
  readonly column: number;
  readonly nodeId: number;
  readonly stage: "vertex" | "fragment";
}

/** Read-only per-node locations; unreachable nodes have no generated statement. */
export type ShaderSourceMap = readonly ShaderSourceLocation[];

/**
 * Maps the compiler's deterministic local declarations without changing shader
 * bytes (and therefore without invalidating existing program caches/goldens).
 * This accepts compiler output, never author-supplied shader code. WGSL modules
 * contain both stages; the fragment annotation switches the current stage.
 */
export function createShaderSourceMap(
  source: string,
  initialStage: "vertex" | "fragment" = "vertex",
): ShaderSourceMap {
  let stage = initialStage;
  const result: ShaderSourceLocation[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "@fragment") stage = "fragment";
    const match =
      /^\s*(?:let |(?:float|vec[234]|mat[34]) )n(\d+)\s*(?::[^=]+)?=/.exec(
        line,
      );
    if (match !== null) {
      result.push(
        Object.freeze({
          line: index + 1,
          column: line.indexOf(`n${match[1]}`) + 1,
          nodeId: Number(match[1]),
          stage,
        }),
      );
    }
  }
  return Object.freeze(result);
}

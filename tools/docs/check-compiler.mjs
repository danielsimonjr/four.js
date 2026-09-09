/**
 * TypeDoc 0.28 still consumes the TypeScript 6 compiler API. Dependabot #82
 * bumped this package to typescript@7.0.2 with the root and CI died on
 * `Cannot read properties of undefined (reading 'PropertyDeclaration')`.
 *
 * Fail here with that sentence, not from inside TypeDoc's loader, so the next
 * accidental bump is a one-line revert rather than a research project.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const resolved = require.resolve("typescript/package.json");
const { version } = require(resolved);

if (!version.startsWith("6.0.")) {
  console.error(
    `tools/docs must resolve typescript@6.0.x (TypeDoc 0.28 peer is 5.0–6.0). ` +
      `Got ${version} from ${resolved}. ` +
      `Do not bump this package's typescript until TypeDoc ships TS 7 support ` +
      `(typedoc#3098). The root compiler is free to move; this one is not.`,
  );
  process.exit(1);
}

console.log(`tools/docs: TypeDoc will use TypeScript ${version} from ${resolved}`);

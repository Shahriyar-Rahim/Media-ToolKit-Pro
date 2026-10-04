// A production build does not catch a missing component (it fails only when that screen renders).
// This lints every source file for undefined identifiers so a typo can never ship silently.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const walk = (d) =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(d, e.name))
        : /\.jsx?$/.test(e.name)
          ? [path.join(d, e.name)]
          : [],
    );
test("no undefined components or variables in renderer source", () => {
  const bad = [];
  for (const f of walk(path.join(__dirname, "../src"))) {
    const code = esbuild.transformSync(fs.readFileSync(f, "utf8"), {
      loader: "jsx",
      jsx: "transform",
      jsxFactory: "h",
      format: "esm",
    }).code;
    const decl = new Set(
      [
        ...code.matchAll(
          /(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
        ),
      ].map((m) => m[1]),
    );
    for (const m of code.matchAll(
      /(?:import\s+(?:[\w$]+\s*,?\s*)?(?:\{([^}]*)\})?[^;]*?from)/g,
    ))
      (m[1] || "").split(",").forEach((x) =>
        decl.add(
          x
            .trim()
            .split(/\s+as\s+/)
            .pop(),
        ),
      );
    for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g))
      decl.add(m[1]);
    for (const m of code.matchAll(/h\(\s*([A-Z][\w$]*)/g))
      if (
        !decl.has(m[1]) &&
        !["Fragment"].includes(m[1]) &&
        !/Icon|\.\w/.test(m[1])
      )
        bad.push(`${path.relative(path.join(__dirname, ".."), f)}: <${m[1]}>`);
  }
  assert.deepStrictEqual([...new Set(bad)], []);
});

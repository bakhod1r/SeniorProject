# tsconfig.json — Practical Tasks

> Hands-on tasks ordered from junior to professional. Each task has a goal, requirements,
> starter context, and acceptance criteria. Do them in a scratch repo with TypeScript installed
> (`npm i -D typescript`). Verify with the commands shown.

## Table of Contents

1. [Task 1 — Junior: Scaffold a Config from Scratch](#task-1--junior-scaffold-a-config-from-scratch)
2. [Task 2 — Junior: Tame include / exclude](#task-2--junior-tame-include--exclude)
3. [Task 3 — Junior: Separate Output Folder](#task-3--junior-separate-output-folder)
4. [Task 4 — Middle: Base + Leaf Configs with extends](#task-4--middle-base--leaf-configs-with-extends)
5. [Task 5 — Middle: Split Build vs Editor Config](#task-5--middle-split-build-vs-editor-config)
6. [Task 6 — Middle: Adopt a Community Base Config](#task-6--middle-adopt-a-community-base-config)
7. [Task 7 — Senior: Two-Package Project References](#task-7--senior-two-package-project-references)
8. [Task 8 — Senior: Solution-Style Root + tsc -b](#task-8--senior-solution-style-root--tsc--b)
9. [Task 9 — Senior: Incremental Build Caching](#task-9--senior-incremental-build-caching)
10. [Task 10 — Professional: Diagnose with --showConfig](#task-10--professional-diagnose-with---showconfig)
11. [Task 11 — Professional: Layered extends Hierarchy](#task-11--professional-layered-extends-hierarchy)
12. [Task 12 — Professional: CI Type-Check Gate](#task-12--professional-ci-type-check-gate)
13. [Stretch Goals](#stretch-goals)

---

## Task 1 — Junior: Scaffold a Config from Scratch

**Goal:** Create a working `tsconfig.json` for a small Node.js project without using `tsc --init`.

**Requirements:**
- Create `src/index.ts` that logs a message.
- Hand-write `tsconfig.json` with `target`, `module`, `outDir`, `rootDir`, and `strict`.
- Point `include` at `src`.

**Starter:**
```typescript
// src/index.ts
const greeting: string = "Hello, tsconfig!";
console.log(greeting);
```

**Acceptance Criteria:**
- [ ] `npx tsc` produces `dist/index.js`.
- [ ] `node dist/index.js` prints the message.
- [ ] `dist` mirrors the `src` structure (because `rootDir` is `src`).
- [ ] No errors with `strict: true`.

**Reference solution:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src"]
}
```

---

## Task 2 — Junior: Tame include / exclude

**Goal:** Compile only `src`, excluding all test files, and prove `exclude` works.

**Requirements:**
- Add `src/math.ts` and `src/math.test.ts`.
- Configure `include`/`exclude` so the test file is not in the build.
- Verify with `tsc --showConfig` (or check `dist`).

**Acceptance Criteria:**
- [ ] `dist/math.js` exists; `dist/math.test.js` does NOT.
- [ ] `tsc --showConfig` shows `math.test.ts` absent from the `files` list.
- [ ] Adding `import "./math.test"` to `math.ts` causes the test file to compile anyway — observe and explain why.

**Reference solution:**
```json
{
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "strict": true },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

---

## Task 3 — Junior: Separate Output Folder

**Goal:** Keep compiled output out of source and out of git.

**Requirements:**
- Set `outDir` to `dist`.
- Add `dist/` and `*.tsbuildinfo` to `.gitignore`.
- Confirm `outDir` is auto-excluded from compilation.

**Acceptance Criteria:**
- [ ] `git status` shows no `dist` files staged.
- [ ] Re-running `tsc` does not try to recompile its own output.
- [ ] `outDir` does not overlap `rootDir`.

---

## Task 4 — Middle: Base + Leaf Configs with extends

**Goal:** Eliminate duplication across two configs by extracting a base.

**Requirements:**
- Create `tsconfig.base.json` holding `strict`, `target`, `esModuleInterop`, `skipLibCheck`.
- Create `tsconfig.json` that extends the base and adds `outDir`/`include`.
- Verify the merged result with `--showConfig`.

**Acceptance Criteria:**
- [ ] `tsc --showConfig` shows the base's strict settings present in the merged config.
- [ ] Removing `strict` from the base disables it in the leaf (proving inheritance).
- [ ] Overriding `target` in the leaf wins over the base.

**Reference solution:**
```json
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```
```json
// tsconfig.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

---

## Task 5 — Middle: Split Build vs Editor Config

**Goal:** Type-check tests in the editor but exclude them from production output.

**Requirements:**
- `tsconfig.json` (editor): `noEmit: true`, includes `src` and `tests`.
- `tsconfig.build.json`: emits to `dist`, includes only `src`, excludes tests.
- Both extend `tsconfig.base.json`.

**Acceptance Criteria:**
- [ ] `tsc -p tsconfig.build.json` emits `dist` without any test files.
- [ ] `tsc` (default config) reports type errors found in test files.
- [ ] No option duplication between the two configs (everything shared is in the base).

---

## Task 6 — Middle: Adopt a Community Base Config

**Goal:** Replace hand-tuned target/lib with `@tsconfig/node20`.

**Requirements:**
- `npm i -D @tsconfig/node20`.
- Extend `@tsconfig/node20/tsconfig.json`.
- Override only `outDir`/`include`.

**Acceptance Criteria:**
- [ ] Build still succeeds.
- [ ] `--showConfig` shows target/lib coming from the base package.
- [ ] You can articulate why no `./` prefix is used for the package path.

---

## Task 7 — Senior: Two-Package Project References

**Goal:** Build a monorepo with `utils` and `app`, where `app` references `utils`.

**Requirements:**
```
repo/
├── tsconfig.base.json
├── packages/utils/{tsconfig.json, src/index.ts}
└── packages/app/{tsconfig.json, src/index.ts}
```
- `utils` is `composite`, emits `.d.ts`.
- `app` references `utils` and imports from it.
- Build with `tsc -b packages/app`.

**Acceptance Criteria:**
- [ ] `tsc -b packages/app` builds `utils` first, then `app`.
- [ ] `app` consumes `utils`'s `.d.ts` (not its source).
- [ ] Editing `utils` and rebuilding only rebuilds what changed (`tsc -b --verbose` confirms).

**Reference solution:**
```json
// packages/utils/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "declaration": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```
```json
// packages/app/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../utils" }],
  "include": ["src"]
}
```

---

## Task 8 — Senior: Solution-Style Root + tsc -b

**Goal:** Add a root build orchestrator.

**Requirements:**
- Root `tsconfig.json` with `"files": []` and `references` to both packages.
- Build the entire repo with a single `tsc -b`.

**Acceptance Criteria:**
- [ ] `tsc -b` at the root builds all packages in dependency order.
- [ ] `tsc -b --dry` lists what would build without building.
- [ ] `tsc -b --clean` removes all outputs and `.tsbuildinfo`.

**Reference solution:**
```json
// tsconfig.json (root)
{
  "files": [],
  "references": [
    { "path": "packages/utils" },
    { "path": "packages/app" }
  ]
}
```

---

## Task 9 — Senior: Incremental Build Caching

**Goal:** Demonstrate signature-based incremental rebuilds.

**Requirements:**
- Build the monorepo once (cold).
- Edit a function body in `utils` WITHOUT changing its signature; rebuild.
- Edit the function's signature; rebuild.

**Acceptance Criteria:**
- [ ] Cold build builds everything.
- [ ] Body-only edit rebuilds `utils` but NOT `app` (signature unchanged).
- [ ] Signature edit rebuilds `utils` AND `app`.
- [ ] `tsc -b --verbose` output is captured to explain each decision.

---

## Task 10 — Professional: Diagnose with --showConfig

**Goal:** Use `--showConfig` to debug a mysterious file set.

**Requirements:**
- Create a config where a file appears in the build "by surprise" (e.g., imported by an included file but listed in `exclude`).
- Use `tsc --showConfig` to inspect the resolved `files`.
- Explain the discrepancy.

**Acceptance Criteria:**
- [ ] You correctly predict which files `--showConfig` lists before running it.
- [ ] You explain why `exclude` did not remove the imported file.
- [ ] You produce a fix (remove the import or restructure).

---

## Task 11 — Professional: Layered extends Hierarchy

**Goal:** Build a 3-layer config hierarchy: org → repo → package.

**Requirements:**
- Layer 1 (`configs/strict.json`): pure strictness flags.
- Layer 2 (`tsconfig.base.json`): extends strict, adds target/module/composite.
- Layer 3 (each package): extends base, adds outDir/include/references.

**Acceptance Criteria:**
- [ ] Changing a flag in Layer 1 propagates to every package.
- [ ] `--showConfig` in a package shows flags merged from all three layers.
- [ ] You can explain the override order (leaf wins last).

**Reference solution:**
```json
// configs/strict.json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true } }
```
```json
// tsconfig.base.json
{ "extends": "./configs/strict.json", "compilerOptions": { "target": "ES2022", "module": "NodeNext", "composite": true, "declaration": true } }
```

---

## Task 12 — Professional: CI Type-Check Gate

**Goal:** Add a fast, cacheable type-check step suitable for CI.

**Requirements:**
- A CI command that type-checks the whole solution.
- Cache `.tsbuildinfo` and `dist` keyed on source + tsconfig + TS version.
- Demonstrate cache invalidation on a TS upgrade.

**Acceptance Criteria:**
- [ ] CI uses `tsc -b` (or `tsc --noEmit` for non-references repos) as a separate step from bundling.
- [ ] A no-change re-run completes in a fraction of the cold time.
- [ ] Bumping the TypeScript version triggers a full rebuild (explain why: TS version baked into `.tsbuildinfo`).

**Reference (conceptual CI):**
```bash
# Restore cache: key = ts-${{ hashFiles('**/*.ts', '**/tsconfig*.json') }}-${{ TS_VERSION }}
tsc -b --verbose
# Save cache: paths = **/.tsbuildinfo, **/dist
```

---

## Stretch Goals

- **Config linter:** Write a Node script that loads a `tsconfig.json` (via `tsc --showConfig` output) and warns when `strict` is false, `outDir` overlaps `rootDir`, or `skipLibCheck` is missing.
- **Migration:** Convert a flat single-config repo into a project-references monorepo and measure the build-time difference.
- **Watch tuning:** On a large repo (or Docker volume), tune `watchOptions` to reduce CPU and confirm with a stopwatch.
- **paths alignment:** Add `paths` aliases and a matching runtime resolver (`tsconfig-paths` or a bundler alias), proving both type-time and runtime resolution work.

---

> Completion check: you should now be able to scaffold configs, split them with `extends`,
> build a project-references monorepo with `tsc -b`, leverage incremental caching, and debug
> any config with `--showConfig` and `tsc -b --verbose`.

---

## Bonus Task A — Junior: Inspect a Generated Config

**Goal:** Understand what `tsc --init` produces.

**Requirements:**
- Run `npx tsc --init` in an empty folder.
- Read every commented option in the output.
- Identify which options are top-level vs inside `compilerOptions`.

**Acceptance Criteria:**
- [ ] You can name at least 5 options the generated file enables by default.
- [ ] You can explain why `strict: true` is enabled by default in recent versions.
- [ ] You delete the comments you don't need and keep a clean, minimal config.

---

## Bonus Task B — Middle: Prove Array Replacement

**Goal:** Demonstrate that `lib` arrays replace (not merge) across `extends`.

**Requirements:**
- Base config sets `"lib": ["ES2022"]`.
- Child sets `"lib": ["DOM"]`.
- Write code using a `Promise` (ES2022) and observe the error.
- Fix by restating the full array.

**Acceptance Criteria:**
- [ ] Before the fix: `Cannot find name 'Promise'` (or similar).
- [ ] After restating `["ES2022", "DOM", "DOM.Iterable"]`: code compiles.
- [ ] `tsc --showConfig` confirms the final `lib` value.

---

## Bonus Task C — Middle: resolveJsonModule

**Goal:** Import a JSON file with full typing.

**Requirements:**
- Create `src/config.json` with a couple of fields.
- Enable `resolveJsonModule` and `esModuleInterop`.
- Import it in `src/index.ts` and read a typed field.

**Acceptance Criteria:**
- [ ] `import config from "./config.json"` type-checks.
- [ ] Accessing a non-existent field is a compile error.
- [ ] The build emits and runs correctly.

**Reference solution:**
```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "module": "NodeNext"
  },
  "include": ["src"]
}
```

---

## Bonus Task D — Senior: declarationMap Go-to-Source

**Goal:** Make cross-package "Go to Definition" land on `.ts` source, not `.d.ts`.

**Requirements:**
- In the `utils` package, enable `declaration` + `declarationMap`.
- Build, then from `app`, use the editor "Go to Definition" on a `utils` symbol.

**Acceptance Criteria:**
- [ ] Without `declarationMap`: navigation lands in `utils/dist/*.d.ts`.
- [ ] With `declarationMap`: navigation lands in `utils/src/*.ts`.
- [ ] You can explain what the `.d.ts.map` file does.

---

## Bonus Task E — Senior: Break and Fix a Circular Reference

**Goal:** Experience the circular-reference error and resolve it.

**Requirements:**
- Make `a` reference `b` and `b` reference `a`.
- Run `tsc -b` and capture the error.
- Extract the shared type into a new leaf package `shared` that both depend on.

**Acceptance Criteria:**
- [ ] You reproduce the cycle error from `tsc -b`.
- [ ] After extracting `shared`, the cycle is gone and the build succeeds.
- [ ] You can draw the before/after dependency graph.

---

## Bonus Task F — Professional: Trace a Slow Type-Check

**Goal:** Find the most expensive file in a type-check.

**Requirements:**
- Generate a trace: `tsc --noEmit --generateTrace ./trace`.
- Analyze with `npx @typescript/analyze-trace ./trace`.
- Identify the top file/type instantiation.

**Acceptance Criteria:**
- [ ] You produce a ranked list of hotspots.
- [ ] You explain why the top entry is expensive (e.g., a deep recursive generic).
- [ ] You propose a config or code change to reduce it.

---

## How to Self-Grade

| Level | You can… |
|-------|----------|
| Junior | Hand-write a working config; control include/exclude; separate output |
| Middle | Use `extends` correctly; split build/editor configs; adopt a base package |
| Senior | Set up references + `tsc -b`; reason about incremental rebuilds; layer configs |
| Professional | Diagnose with `--showConfig`/`--verbose`/traces; design CI caching; build layered hierarchies |

---

## Suggested Order & Time Budget

```mermaid
flowchart LR
    T1[Tasks 1-3\nJunior ~1h] --> T2[Tasks 4-6\nMiddle ~2h]
    T2 --> T3[Tasks 7-9\nSenior ~3h]
    T3 --> T4[Tasks 10-12\nPro ~3h]
    T4 --> B[Bonus A-F\nas needed]
```

> Do the tasks in a throwaway repo and commit after each one, so you can `git diff` the config
> changes and see exactly what each setting did.

---

## Bonus Task G — Professional: Build a Config Linter

**Goal:** Write a Node script that audits a `tsconfig.json` for risky settings.

**Requirements:**
- Run `tsc --showConfig` and parse its JSON output.
- Warn if: `strict` is not `true`, `skipLibCheck` is missing, `outDir` overlaps `rootDir`, or no `exclude` is set.
- Exit non-zero on any error-level finding.

**Acceptance Criteria:**
- [ ] The linter detects a config with `strict: false`.
- [ ] It detects `outDir` overlapping `rootDir`.
- [ ] It passes a clean, recommended config.

**Hints:**
```bash
# Get the resolved config as JSON
npx tsc --showConfig > resolved.json
```
```typescript
// audit.ts (sketch)
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("resolved.json", "utf8"));
const opts = cfg.compilerOptions ?? {};
const findings: string[] = [];
if (opts.strict !== true) findings.push("strict is not enabled");
if (opts.skipLibCheck !== true) findings.push("skipLibCheck is off (slow builds)");
if (opts.outDir && opts.rootDir && opts.outDir === opts.rootDir)
  findings.push("outDir overlaps rootDir");
console.log(findings.length ? findings.join("\n") : "OK");
process.exit(findings.length ? 1 : 0);
```

---

## Bonus Task H — Senior: Measure References vs Flat

**Goal:** Quantify the build-time difference between a flat config and project references.

**Requirements:**
- Take a 3-package repo.
- Build it once as a single flat `tsconfig.json` (one program over all `src`).
- Restructure into references and build with `tsc -b`.
- Measure a single-package change rebuild in both setups.

**Acceptance Criteria:**
- [ ] Flat: a one-file change retype-checks the whole program.
- [ ] References: a one-file change rebuilds only the affected package(s).
- [ ] You record before/after wall-clock numbers and explain the delta.

---

## Bonus Task I — Professional: CI Cache Invalidation Proof

**Goal:** Prove that a TypeScript upgrade busts the incremental cache.

**Requirements:**
- Build with incremental enabled; note the warm rebuild time.
- Upgrade TypeScript (e.g., a patch version) in `devDependencies`.
- Rebuild and observe a full rebuild.

**Acceptance Criteria:**
- [ ] Pre-upgrade warm rebuild is near-instant.
- [ ] Post-upgrade first build is full (cold).
- [ ] You can point to the `version` field in `.tsbuildinfo` as the cause.

---

## Common Pitfalls While Doing These Tasks

| Pitfall | Fix |
|---------|-----|
| `tsc` "no inputs found" | Your `include` doesn't match real files — check the path |
| Config ignored | You passed files on the CLI; use `tsc` or `tsc -p` |
| References don't build | Use `tsc -b`, not `tsc` |
| Arrays lost on extend | Restate full arrays in the child |
| `.tsbuildinfo` committed | gitignore it; cache in CI instead |
| Output in source folder | Separate `outDir`; add to `.gitignore` and `exclude` |

---

## Verification Commands You'll Use Constantly

```bash
tsc --init               # scaffold a starter config
tsc                      # compile using nearest config
tsc -p tsconfig.x.json   # compile a specific config
tsc --noEmit             # type-check only
tsc --showConfig         # print the resolved config + file set
tsc --explainFiles       # why each file is in the program
tsc -b                   # build references in order
tsc -b --verbose         # show rebuild reasons
tsc -b --dry             # show what WOULD build
tsc -b --clean           # delete all outputs + caches
tsc --extendedDiagnostics # phase timing + memory
```

---

## Final Capstone

**Goal:** Combine everything into one realistic monorepo.

**Requirements:**
- 3 packages with a layered config hierarchy (org strictness → repo base → package).
- Project references with a `files: []` solution root.
- A split editor/build/test config inside one package.
- Incremental caching configured outside the cleaned output dir.
- A CI script that type-checks with `tsc -b` and caches `.tsbuildinfo`.

**Acceptance Criteria:**
- [ ] `tsc -b` builds everything in order; a one-package change rebuilds minimally.
- [ ] `tsc --showConfig` in a package shows options from all three config layers.
- [ ] Editor type-checks tests; production build excludes them.
- [ ] CI warm run is dramatically faster than cold.
- [ ] No `.tsbuildinfo` or `dist` is committed to git.

> Finishing the capstone means you can architect TypeScript configuration for a real production
> monorepo end to end — from strictness policy to fast, cached CI builds.

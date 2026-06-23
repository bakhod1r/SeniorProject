# TS and JS Interoperability — Optimization Guide

> 12+ exercises focused on making TS/JS interop **faster, safer, and cleaner** — both build performance
> and developer-experience quality. Each entry states the problem, the change, the expected improvement,
> and how to measure it. Measure before and after — `time tsc --noEmit` is your friend.

## Table of Contents

1. [Optimization 1: skipLibCheck for Dependency-Heavy Interop](#optimization-1-skiplibcheck-for-dependency-heavy-interop)
2. [Optimization 2: Narrow `types` to Cut @types Load](#optimization-2-narrow-types-to-cut-types-load)
3. [Optimization 3: Scope `allowJs` with include/exclude](#optimization-3-scope-allowjs-with-includeexclude)
4. [Optimization 4: Replace @ts-ignore with @ts-expect-error](#optimization-4-replace-ts-ignore-with-ts-expect-error)
5. [Optimization 5: Prefer Bundled Types over @types](#optimization-5-prefer-bundled-types-over-types)
6. [Optimization 6: Migrate from JSDoc to .ts for Hot Files](#optimization-6-migrate-from-jsdoc-to-ts-for-hot-files)
7. [Optimization 7: Use import type / verbatimModuleSyntax](#optimization-7-use-import-type--verbatimmodulesyntax)
8. [Optimization 8: Replace Broad declare module any-Shims](#optimization-8-replace-broad-declare-module-any-shims)
9. [Optimization 9: Validate at the Boundary, Trust Types Inside](#optimization-9-validate-at-the-boundary-trust-types-inside)
10. [Optimization 10: Align @types Versions](#optimization-10-align-types-versions)
11. [Optimization 11: Incremental Builds in Mixed Projects](#optimization-11-incremental-builds-in-mixed-projects)
12. [Optimization 12: isolatedModules for Transpile-Only Tools](#optimization-12-isolatedmodules-for-transpile-only-tools)
13. [Optimization 13: Validate Published Interop Types](#optimization-13-validate-published-interop-types)
14. [Optimization 14: Project References for Mixed Packages](#optimization-14-project-references-for-mixed-packages)
15. [Optimization 15: Replace const enum Across Interop Boundaries](#optimization-15-replace-const-enum-across-interop-boundaries)
16. [Optimization 16: Cache .tsbuildinfo in CI](#optimization-16-cache-tsbuildinfo-in-ci)
17. [Optimization 17: Split Editor vs Build Configs in Mixed Projects](#optimization-17-split-editor-vs-build-configs-in-mixed-projects)
18. [Optimization 18: Drop sourceMap/declarationMap in CI Type-Checks](#optimization-18-drop-sourcemapdeclarationmap-in-ci-type-checks)
19. [Diagnostics & Profiling](#diagnostics--profiling)
20. [Optimization Summary Table](#optimization-summary-table)

---

## Optimization 1: skipLibCheck for Dependency-Heavy Interop

**Problem:** Cold `tsc` spends a large fraction of its time checking `.d.ts` files in `node_modules` — exactly the files that pile up when you depend on many JS libraries plus their `@types`.

```json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

```bash
time tsc --noEmit   # before
# add skipLibCheck, then:
time tsc --noEmit   # after
```

**Expected improvement:** Often 20–40% off cold check time on `@types`-heavy projects, and it sidesteps conflicts between mismatched `@types` versions.

**Trade-off:** It won't catch a broken `.d.ts` (yours or a dependency's). For a *library* you publish, keep a separate CI job without it (see Optimization 13).

---

## Optimization 2: Narrow `types` to Cut @types Load

**Problem:** By default TypeScript auto-includes *every* package under `node_modules/@types`. In a big repo that loads many ambient declaration packages you never use, slowing checks and polluting the global namespace.

```json
{
  "compilerOptions": {
    "types": ["node"]
  }
}
```

**Expected improvement:** Faster program construction and fewer accidental globals; only the listed `@types` packages are auto-loaded (others must be imported explicitly).

**How to measure:** `tsc --extendedDiagnostics` and compare "Files" and "Program time" before/after.

---

## Optimization 3: Scope `allowJs` with include/exclude

**Problem:** With `allowJs` on, TypeScript reads and emits *every* matched `.js` file — including huge minified vendor bundles and generated code you never need typed.

```json
{
  "compilerOptions": { "allowJs": true },
  "include": ["src/**/*"],
  "exclude": ["src/vendor/**/*.js", "**/*.min.js"]
}
```

**Expected improvement:** Smaller program, faster builds, and no time wasted parsing megabyte bundles.

**How to measure:** `tsc --listFilesOnly | wc -l` before and after to confirm the file count dropped.

---

## Optimization 4: Replace @ts-ignore with @ts-expect-error

**Problem:** `@ts-ignore` is a *quality* leak: it suppresses forever, hides future errors, and rots silently. A codebase full of them slowly loses type safety.

```typescript
// Before
// @ts-ignore
doThing(a, b);

// After
// @ts-expect-error -- @types/foo@2 omits the second arg (issue #12)
doThing(a, b);
```

**Expected improvement:** Suppressions become self-cleaning — once the underlying error is fixed, `@ts-expect-error` errors (`TS2578`), forcing removal. Future unrelated errors on that line are no longer hidden.

**How to enforce:** eslint `@typescript-eslint/ban-ts-comment` with `ts-ignore: true` and `ts-expect-error: "allow-with-description"`.

---

## Optimization 5: Prefer Bundled Types over @types

**Problem:** A separate `@types/x` package can drift out of sync with `x`, declaring methods that don't exist. It is also one more dependency to resolve and check.

```bash
# If the library ships its own types, drop the @types package:
npm uninstall @types/some-lib   # if some-lib now bundles types
```

**Expected improvement:** Types always match the runtime version, fewer phantom-method bugs, one fewer dependency. Many libraries (e.g. modern versions of axios, chalk) now bundle their own types.

**How to verify:** Check the library's `package.json` for a `types`/`exports.types` field; if present, the `@types` package is redundant.

---

## Optimization 6: Migrate from JSDoc to .ts for Hot Files

**Problem:** JSDoc typing in `.js` is great for gradual adoption but is verbose and slower to author than native syntax, and some advanced types are awkward in JSDoc.

```typescript
// Before (geometry.js)
// @ts-check
/** @param {number} w @param {number} h @returns {number} */
function area(w, h) { return w * h; }

// After (geometry.ts)
export function area(w: number, h: number): number {
  return w * h;
}
```

**Expected improvement:** Cleaner code, full type-system access, and (on heavily-edited files) faster inner-loop authoring. Convert the *hot* files first; leave stable JS as JSDoc.

**How to prioritize:** `git log --format= --name-only | sort | uniq -c | sort -rn` to find the most-changed files.

---

## Optimization 7: Use import type / verbatimModuleSyntax

**Problem:** Ambiguous import elision can produce surprising CJS/ESM emit and accidental runtime imports of type-only modules, causing bundler bloat or circular-import runtime errors.

```typescript
import type { User } from "./models";   // erased — never emitted
import { createUser } from "./factory"; // value import — kept
```

```json
{ "compilerOptions": { "verbatimModuleSyntax": true } }
```

**Expected improvement:** Predictable emit, no accidental runtime dependency on type-only modules, smaller bundles, and clearer intent. Replaces the deprecated `importsNotUsedAsValues`/`preserveValueImports`.

---

## Optimization 8: Replace Broad declare module any-Shims

**Problem:** A `declare module "lib";` shim types the entire module as `any`, silencing `TS7016` but throwing away all safety — every call through it is unchecked.

```typescript
// Before: everything is `any`
declare module "chart-lib";

// After: type only the surface you actually use
declare module "chart-lib" {
  export interface ChartOptions { responsive?: boolean }
  export class Chart {
    constructor(ctx: unknown, opts?: ChartOptions);
    render(): void;
  }
}
```

**Expected improvement:** Real type-checking on the parts you touch, catching argument and property mistakes that the `any` shim let through.

---

## Optimization 9: Validate at the Boundary, Trust Types Inside

**Problem:** Types from `.d.ts`/`@types` are promises, not guarantees. Sprinkling defensive checks throughout the code is noisy and slow; trusting types blindly is unsafe at the JS boundary.

```typescript
import { z } from "zod";

const ConfigSchema = z.object({ port: z.number(), host: z.string() });
type Config = z.infer<typeof ConfigSchema>;

// Validate ONCE at the untyped boundary...
function loadConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw); // throws on bad shape
}
// ...then trust the static type everywhere inside.
```

**Expected improvement:** Safety where it matters (untrusted/untyped input) without scattering runtime checks across already-typed internal code. One validation point, full static confidence downstream.

---

## Optimization 10: Align @types Versions

**Problem:** A `@types/x` version mismatched with `x` produces wrong signatures, phantom options, or missing members — type errors that aren't your fault and runtime bugs that pass the type-checker.

```bash
npm ls react @types/react      # check alignment
npm install --save-dev @types/react@18  # pin to the matching major
```

**Expected improvement:** Fewer false errors, fewer runtime surprises from declared-but-absent APIs, and reproducible builds. Consider pinning `@types/*` ranges to match the library major.

**How to enforce:** A CI script that fails when a `@types/*` major diverges from its library major.

---

## Optimization 11: Incremental Builds in Mixed Projects

**Problem:** Every `tsc` run re-checks the whole mixed JS/TS program, even when one file changed.

```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./.tsbuildinfo"
  }
}
```

```bash
tsc --noEmit            # first run: full
# edit one file
tsc --noEmit            # second run: only affected files re-checked
```

**Expected improvement:** Large speedups on warm rebuilds; the `.tsbuildinfo` cache lets `tsc` skip unchanged files. Cache the file in CI for cross-run speedups.

**Trade-off:** A stale cache can mask issues; clear it (`rm .tsbuildinfo`) when changing config.

---

## Optimization 12: isolatedModules for Transpile-Only Tools

**Problem:** When a bundler (esbuild, swc, Babel) transpiles files one at a time, it can't see cross-file types. Certain TS constructs (re-exporting a type without `type`, `const enum`) emit incorrectly or break.

```json
{
  "compilerOptions": {
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

```typescript
// Now the compiler flags single-file-unsafe patterns:
export { SomeType } from "./types";       // error → must be `export type`
export type { SomeType } from "./types";  // correct
```

**Expected improvement:** Your code stays compatible with fast transpile-only pipelines, avoiding subtle interop bugs where the bundler and `tsc` disagree on emit. Type-checking stays with `tsc`; emit goes to the fast tool.

---

## Optimization 13: Validate Published Interop Types

**Problem:** A library can build green locally with `skipLibCheck` but ship `.d.ts` that break for consumers using different module settings (the classic dual CJS/ESM interop trap).

```bash
# In CI, separately validate the emitted types
npx @arethetypeswrong/cli --pack .
tsc --noEmit -p tsconfig.libcheck.json   # this one has skipLibCheck:false
```

**Expected improvement:** Catches `export =` vs default mismatches, missing `.d.cts`/`.d.mts`, and wrong `exports` `types` conditions *before* publishing, so consumers don't inherit broken interop.

**How to measure:** A passing `attw` report and a clean no-`skipLibCheck` check in CI.

---

## Optimization 14: Project References for Mixed Packages

**Problem:** A monorepo with several JS/TS packages re-type-checks everything on every build, and the editor reloads the whole graph. Interop boundaries between packages are checked repeatedly.

```json
// root tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/web" }
  ]
}
```

```json
// packages/core/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "dist",
    "allowJs": true
  }
}
```

```bash
tsc -b            # builds only changed projects in dependency order
```

**Expected improvement:** `tsc -b` builds each referenced project once, caches via `.tsbuildinfo`, and rebuilds only what changed. Downstream packages consume the upstream's emitted `.d.ts` instead of re-checking its source — a big win at interop boundaries.

**Trade-off:** Requires `composite:true` and `declaration` emit on referenced projects, plus discipline about import paths.

---

## Optimization 15: Replace `const enum` Across Interop Boundaries

**Problem:** `const enum` is inlined at compile time and is invisible to transpile-only tools and to JS consumers — it breaks under `isolatedModules` and can produce wrong values when a `.d.ts` consumer can't see the constant.

```typescript
// Before — fragile across interop boundaries
const enum Color { Red, Green }

// After — a plain object/union travels safely to JS and bundlers
const Color = { Red: 0, Green: 1 } as const;
type Color = (typeof Color)[keyof typeof Color];
```

**Expected improvement:** The value survives transpile-only emit and is consumable from JS, eliminating a class of "the enum is `undefined` at runtime" interop bugs.

---

## Optimization 16: Cache `.tsbuildinfo` in CI

**Problem:** CI starts cold every run, so even `incremental`/`tsc -b` projects pay full type-check cost each pipeline.

```yaml
# pseudo-CI
- uses: actions/cache
  with:
    path: |
      .tsbuildinfo
      packages/*/.tsbuildinfo
    key: tsbuildinfo-${{ hashFiles('**/*.ts', '**/*.js', '**/tsconfig*.json') }}
```

**Expected improvement:** Warm CI builds skip unchanged files, often cutting type-check time dramatically on large mixed codebases. Invalidate the cache on source or config changes via the hash key.

**Trade-off:** A poorly-keyed cache can serve stale results; key on both source and config files.

---

## Optimization 17: Split Editor vs Build Configs in Mixed Projects

**Problem:** One config that checks all JS *and* TS (including tests and vendored JS) gives a slow editor and a slow CI build, because both do the maximal work.

```json
// tsconfig.json — fast editor: check src + tests, no emit
{
  "compilerOptions": { "allowJs": true, "checkJs": true, "noEmit": true },
  "include": ["src", "test"]
}
```
```json
// tsconfig.build.json — emit only production code
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist" },
  "include": ["src"],
  "exclude": ["test", "**/*.test.*"]
}
```

**Expected improvement:** The editor still type-checks everything for good DX, while `tsc -p tsconfig.build.json` emits a lean `dist` without test files, speeding the production build and shrinking output.

---

## Optimization 18: Drop `sourceMap`/`declarationMap` in CI Type-Checks

**Problem:** A CI step that only needs to *verify* types still generates source maps and declaration maps, wasting time and disk.

```bash
# Type-check only — no maps, no emit
tsc --noEmit
```
```json
// If you must emit in CI, disable maps there:
{ "compilerOptions": { "sourceMap": false, "declarationMap": false } }
```

**Expected improvement:** Faster CI type-check passes; maps are a dev/debug convenience not needed for a pass/fail gate.

**How to measure:** `time tsc --noEmit` vs `time tsc` (with maps) on the same tree.

---

## Diagnostics & Profiling

Use these to find *where* interop is costing you:

```bash
# Per-phase timing and file counts
tsc --noEmit --extendedDiagnostics

# List exactly which files entered the program (spot stray JS/@types)
tsc --listFilesOnly

# Why is this file included? (trace the import/typeRoots chain)
tsc --explainFiles | less

# CPU/memory trace for the type-checker
tsc --noEmit --generateTrace ./trace
# then open ./trace/trace.json in chrome://tracing or the analyzer
```

Key signals:

- A surprising file count in `--listFilesOnly` → over-broad `include`/`allowJs`, fix with Optimization 3.
- Lots of `@types` in `--explainFiles` → narrow `types` (Optimization 2).
- High "Check time" → try `skipLibCheck` (Optimization 1) and `incremental` (Optimization 11).

---

## Optimization Summary Table

| # | Optimization | Primarily Improves | Key Trade-off |
|---|--------------|--------------------|---------------|
| 1 | `skipLibCheck` | Build speed | Misses broken `.d.ts` |
| 2 | Narrow `types` | Build speed, fewer globals | Must import others explicitly |
| 3 | Scope `allowJs` | Build speed | Must maintain excludes |
| 4 | `@ts-expect-error` | Code quality / safety | Slightly more verbose |
| 5 | Bundled types over `@types` | Correctness | Depends on library shipping types |
| 6 | JSDoc → `.ts` | DX, type power | Conversion effort |
| 7 | `verbatimModuleSyntax` | Predictable emit, bundle size | Requires `import type` discipline |
| 8 | Typed shim over `any` shim | Safety | Must write the surface |
| 9 | Boundary validation | Runtime safety | Validation cost at edges |
| 10 | Align `@types` versions | Correctness | Maintenance of pins |
| 11 | `incremental` | Warm-rebuild speed | Stale cache risk |
| 12 | `isolatedModules` | Transpiler compatibility | Forbids some patterns |
| 13 | Validate published types | Consumer correctness | Extra CI job |
| 14 | Project references (`tsc -b`) | Monorepo build speed | Needs `composite` + `declaration` |
| 15 | Avoid `const enum` | Transpiler/JS safety | Slightly more verbose pattern |
| 16 | Cache `.tsbuildinfo` in CI | Warm CI speed | Cache-key discipline |
| 17 | Split editor/build configs | Editor + build speed | Two configs to maintain |
| 18 | Drop maps in CI checks | CI speed | No maps for debugging that step |

**Golden rule:** Optimize build speed with `skipLibCheck` + `incremental` + narrowed scope; optimize *safety* by replacing `any`-shims and `@ts-ignore`, aligning `@types`, and validating at the boundary. The two goals rarely conflict — measure with `--extendedDiagnostics` and `--explainFiles` before and after each change.

---

## Worked Example: Tuning a Slow Mixed Codebase

A realistic before/after walkthrough combining several optimizations.

**Baseline:** A 1,200-file app, half `.js` (some vendored), full `tsc --noEmit` takes ~40s. Editor feels sluggish; CI runs cold every time.

**Step 1 — Measure.**
```bash
tsc --noEmit --extendedDiagnostics
tsc --listFilesOnly | wc -l        # 4,800 files (!) — way more than 1,200
```
The file count reveals `allowJs` is pulling in minified vendor bundles and every `@types` package.

**Step 2 — Scope the program (Opt 3 + Opt 2).**
```json
{
  "compilerOptions": { "allowJs": true, "checkJs": true, "types": ["node"] },
  "include": ["src", "test"],
  "exclude": ["src/vendor/**", "**/*.min.js"]
}
```
`--listFilesOnly` now reports ~1,500 files. Check time drops noticeably.

**Step 3 — Skip lib check (Opt 1).**
```json
{ "compilerOptions": { "skipLibCheck": true } }
```
Cold `tsc --noEmit` falls from ~40s to ~26s.

**Step 4 — Incremental + CI cache (Opt 11 + Opt 16).**
```json
{ "compilerOptions": { "incremental": true, "tsBuildInfoFile": "./.tsbuildinfo" } }
```
Warm rebuilds drop to a few seconds; CI caches `.tsbuildinfo` keyed on source+config hash.

**Step 5 — Split configs (Opt 17).**
The editor uses the broad config; the production build uses `tsconfig.build.json` that emits only `src` with maps off (Opt 18).

**Step 6 — Safety pass (Opt 4, 8, 10).**
Replace every bare `@ts-ignore` with `@ts-expect-error + reason`, upgrade `declare module "x";` any-shims to typed surfaces, and align `@types/*` majors with their libraries.

**Result:** Cold check ~26s → warm rebuilds ~3s, CI warm ~5s, and the type safety of the JS/TS boundary is *higher* than before despite the speedups. Each step was validated with `--extendedDiagnostics`.

---

## Anti-Patterns to Avoid

- **Disabling `strict` to "fix" interop errors.** It hides real bugs; fix the types or validate at the boundary instead.
- **Deleting `@types/*` for speed.** Turns imports into `any`; use `skipLibCheck`/`types`/`incremental` instead.
- **Blanket `// @ts-nocheck` on whole files to silence migration noise.** You lose all safety; prefer per-line `@ts-expect-error` with reasons.
- **Broad `declare module "*"`-style any-shims kept permanently.** Fine as a temporary unblock; replace with real types.
- **Flipping `esModuleInterop` mid-project without auditing imports.** It changes the value default imports resolve to; verify the whole graph.
- **`skipLibCheck` on a published library with no compensating CI check.** You may ship broken `.d.ts` to every consumer.

---

## Measuring Safety, Not Just Speed

Speed is easy to measure; interop *safety* needs its own signals. Track these over time:

```bash
# Count remaining suppressions (lower is better)
grep -rn "@ts-ignore" src | wc -l
grep -rn "@ts-expect-error" src | wc -l   # acceptable, but each should have a reason

# Count any-shims and bare module declarations
grep -rn "declare module" types src | grep -v "{" | wc -l   # bare any-shims

# Count implicit-any escapes if you can't yet enable noImplicitAny globally
tsc --noEmit --noImplicitAny 2>&1 | grep -c "implicitly has an 'any'"

# Count files still relying on JSDoc vs converted to .ts (migration progress)
find src -name "*.js" | wc -l
find src -name "*.ts" | wc -l
```

**Targets for a healthy mixed codebase:**

| Metric | Goal |
|--------|------|
| Bare `@ts-ignore` count | 0 (all migrated to `@ts-expect-error`) |
| `@ts-expect-error` without a reason | 0 (lint-enforced) |
| Bare `declare module "x";` any-shims | trending to 0 |
| Implicit-any errors under `noImplicitAny` | trending to 0 |
| `.js` files in `src` | trending to 0 (migration progress) |
| Stale `@types/*` majors | 0 |

Wire the first two into CI via eslint `@typescript-eslint/ban-ts-comment` so they can never regress. The rest make good dashboard metrics that show migration and safety progress alongside the raw build-time numbers.

---

## Quick Decision Guide

- **Build is slow and you depend on many libraries?** → `skipLibCheck` + narrow `types` (Opt 1, 2).
- **Build pulls in too many files?** → scope `allowJs` with `include`/`exclude` (Opt 3).
- **Warm rebuilds slow?** → `incremental` + cache `.tsbuildinfo` (Opt 11, 16).
- **Monorepo re-checking everything?** → project references with `tsc -b` (Opt 14).
- **Bundler emits wrong/bloated output?** → `verbatimModuleSyntax` + `isolatedModules` (Opt 7, 12).
- **Untyped imports everywhere?** → typed shims over `any`-shims (Opt 8).
- **Runtime bugs slipping past types?** → boundary validation (Opt 9) + align `@types` (Opt 10).
- **Publishing a library?** → validate types with `attw` and a no-`skipLibCheck` check (Opt 13).

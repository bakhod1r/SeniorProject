# tsc — Practical Tasks

> Hands-on exercises for the `tsc` CLI, from first compile to monorepo build orchestration and build-performance work. Difficulty: 🟢 beginner, 🟡 intermediate, 🔴 advanced. Each task lists a goal, steps, and acceptance criteria.

## Table of Contents

1. [Task 1 — First Compile 🟢](#task-1--first-compile-)
2. [Task 2 — tsconfig Project Build 🟢](#task-2--tsconfig-project-build-)
3. [Task 3 — Watch Loop 🟢](#task-3--watch-loop-)
4. [Task 4 — Type-Check-Only CI Gate 🟡](#task-4--type-check-only-ci-gate-)
5. [Task 5 — Two-Config Setup 🟡](#task-5--two-config-setup-)
6. [Task 6 — Reading & Fixing Errors 🟡](#task-6--reading--fixing-errors-)
7. [Task 7 — Library with Declarations 🟡](#task-7--library-with-declarations-)
8. [Task 8 — Incremental Build 🟡](#task-8--incremental-build-)
9. [Task 9 — Project References Monorepo 🔴](#task-9--project-references-monorepo-)
10. [Task 10 — Build-Mode Orchestration 🔴](#task-10--build-mode-orchestration-)
11. [Task 11 — Build Performance Investigation 🔴](#task-11--build-performance-investigation-)
12. [Task 12 — tsc + Bundler Split 🔴](#task-12--tsc--bundler-split-)
13. [Task 13 — Inspect & Audit the File Set 🟡](#task-13--inspect--audit-the-file-set-)
14. [Task 14 — Diagnose a Module Resolution Failure 🔴](#task-14--diagnose-a-module-resolution-failure-)
15. [Task 15 — Localized Diagnostics & Exit-Code Script 🟢](#task-15--localized-diagnostics--exit-code-script-)
16. [Stretch Goals](#stretch-goals)

---

## How to Work Through These Tasks

Each task is self-contained and builds toward real-world `tsc` fluency. A suggested order:

1. **Tasks 1–3 (🟢)** establish the fundamentals: compiling a file, compiling a project via `tsconfig.json`, and the watch loop. Do these first even if you have used `tsc` before — they cement the file-argument-vs-config distinction that trips up most people.
2. **Tasks 4–8 (🟡)** cover the day-to-day professional workflow: the CI type gate, multi-config setups, reading errors, library declaration emit, and incremental builds.
3. **Tasks 9–12 (🔴)** are the scale-and-performance tier: project references, build-mode orchestration, trace-driven optimization, and the bundler split.
4. **Tasks 13–15** round out tooling literacy: auditing the file set, debugging module resolution, and exit-code-correct scripting.

For every task, **verify with the exit code** (`echo $?`) and, where relevant, confirm the resolved configuration with `tsc --showConfig`. Treat "the command printed something" as insufficient — confirm the actual artifact (a file in `dist/`, a `.tsbuildinfo`, a `0`/`2` exit) matches the acceptance criteria.

A small starter scaffold you can reuse for most tasks:

```bash
mkdir tsc-practice && cd tsc-practice
npm init -y
npm install --save-dev typescript
npx tsc --init
mkdir src
printf 'export const ok = (): boolean => true;\n' > src/index.ts
npx tsc --noEmit && echo "scaffold ready (exit $?)"
```

---

## Task 1 — First Compile 🟢

**Goal:** Compile a single TypeScript file and run the output.

**Steps:**
1. Install TypeScript locally: `npm init -y && npm install --save-dev typescript`.
2. Create `hello.ts`:

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
console.log(greet("World"));
```

3. Compile and run:

```bash
npx tsc hello.ts
node hello.js
```

**Acceptance Criteria:**
- [ ] `npx tsc --version` prints a version.
- [ ] `hello.js` is created and contains no type annotations.
- [ ] `node hello.js` prints `Hello, World!`.
- [ ] You can explain why `tsc hello.ts` ignores any `tsconfig.json`.

---

## Task 2 — tsconfig Project Build 🟢

**Goal:** Build a project using `tsconfig.json` (not a file argument).

**Steps:**
1. Run `npx tsc --init`.
2. Edit `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

3. Create `src/index.ts`:

```typescript
export const add = (a: number, b: number): number => a + b;
console.log(add(2, 3));
```

4. Build with bare `tsc` and run:

```bash
npx tsc
node dist/index.js
```

**Acceptance Criteria:**
- [ ] Output appears under `dist/`, **not** next to source.
- [ ] `node dist/index.js` prints `5`.
- [ ] Changing `outDir` and re-running bare `tsc` moves the output.
- [ ] Running `npx tsc src/index.ts` ignores `outDir` (observe the difference).

---

## Task 3 — Watch Loop 🟢

**Goal:** Use watch mode and observe incremental recompilation.

**Steps:**
1. Run `npx tsc --watch`.
2. Introduce a type error in `src/index.ts` and save; observe the error appear.
3. Fix it and save; observe `Found 0 errors`.

**Acceptance Criteria:**
- [ ] The first line reads `Starting compilation in watch mode...`.
- [ ] Saving a file triggers `File change detected. Starting incremental compilation...`.
- [ ] Errors appear and clear without restarting `tsc`.
- [ ] You can run `npx tsc --noEmit --watch` and confirm no files are written.

---

## Task 4 — Type-Check-Only CI Gate 🟡

**Goal:** Add a CI step that fails on type errors.

**Steps:**
1. Add an npm script:

```json
{ "scripts": { "typecheck": "tsc --noEmit --pretty false" } }
```

2. Add a GitHub Actions workflow:

```yaml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
```

3. Locally verify the exit code:

```bash
npm run typecheck; echo $?
```

**Acceptance Criteria:**
- [ ] A clean repo prints exit code `0`.
- [ ] Introducing a type error makes the script exit `2`.
- [ ] The workflow fails the job when the script exits non-zero.
- [ ] No `|| true` anywhere in the command.

---

## Task 5 — Two-Config Setup 🟡

**Goal:** Separate a dev/check config from a production build config.

**Steps:**
1. Keep `tsconfig.json` as the dev/check config:

```json
{
  "compilerOptions": { "strict": true, "noEmit": true },
  "include": ["src", "tests"]
}
```

2. Add `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist" },
  "include": ["src"]
}
```

3. Wire scripts:

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "build": "tsc -p tsconfig.build.json"
  }
}
```

**Acceptance Criteria:**
- [ ] `npm run typecheck` checks `src` + `tests`, emits nothing.
- [ ] `npm run build` emits only `src` to `dist`.
- [ ] `tsc --showConfig -p tsconfig.build.json` shows the merged result with `outDir`.
- [ ] Tests are excluded from the production output.

---

## Task 6 — Reading & Fixing Errors 🟡

**Goal:** Practice interpreting `TSxxxx` errors.

**Steps:** Compile this file and fix every error, identifying each code.

```typescript
// src/orders.ts
interface Order { id: string; total: number; }

function summarize(orders: Order[]): string {
  const first = orders[0];
  return `First order ${first.id} totals ${first.totl}`; // typo
}

function pay(amount: number): void { /* ... */ }
pay("100");                                              // wrong type

const maybe: string | undefined = undefined;
console.log(maybe.length);                               // possibly undefined
```

**Acceptance Criteria:**
- [ ] You identify `TS2339` (property `totl` does not exist), `TS2345` (string not assignable to number), and `TS2532` (possibly undefined).
- [ ] All three are fixed without using `any` or `as`.
- [ ] `tsc --noEmit` exits `0`.
- [ ] With `noUncheckedIndexedAccess`, you also handle `orders[0]` being possibly `undefined`.

---

## Task 7 — Library with Declarations 🟡

**Goal:** Emit `.js` + `.d.ts` for a tiny library.

**Steps:**
1. Configure:

```json
{
  "compilerOptions": {
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

2. Build and inspect:

```bash
npx tsc
ls dist
# index.js  index.js.map  index.d.ts  index.d.ts.map
```

**Acceptance Criteria:**
- [ ] `dist/index.d.ts` contains accurate type signatures.
- [ ] `dist/index.d.ts.map` exists (declaration map).
- [ ] A consumer importing the library gets full autocomplete.
- [ ] `tsc --emitDeclarationOnly` produces only the `.d.ts` files.

---

## Task 8 — Incremental Build 🟡

**Goal:** Measure the speedup from incremental compilation.

**Steps:**
1. Enable incremental:

```json
{ "compilerOptions": { "incremental": true, "tsBuildInfoFile": "./.cache/tsc.tsbuildinfo" } }
```

2. Time a cold and warm run:

```bash
rm -f .cache/tsc.tsbuildinfo
time npx tsc --noEmit     # cold
time npx tsc --noEmit     # warm (no changes)
```

**Acceptance Criteria:**
- [ ] A `.tsbuildinfo` file is created at the configured path.
- [ ] The warm run is noticeably faster than the cold run.
- [ ] Editing one file's **body** only re-checks a small set.
- [ ] Deleting `.tsbuildinfo` restores cold-build timing.

---

## Task 9 — Project References Monorepo 🔴

**Goal:** Build a three-package monorepo with references.

**Steps:** Create `packages/{utils,core,app}` each with its own `tsconfig.json`.

```json
// packages/utils/tsconfig.json
{ "compilerOptions": { "composite": true, "declaration": true, "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

```json
// packages/core/tsconfig.json
{
  "compilerOptions": { "composite": true, "declaration": true, "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../utils" }],
  "include": ["src"]
}
```

```json
// packages/app/tsconfig.json
{
  "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../core" }, { "path": "../utils" }],
  "include": ["src"]
}
```

```json
// tsconfig.json (root solution)
{ "files": [], "references": [{ "path": "packages/utils" }, { "path": "packages/core" }, { "path": "packages/app" }] }
```

**Acceptance Criteria:**
- [ ] `tsc --build` builds utils → core → app in order.
- [ ] Each package has its own `.tsbuildinfo`.
- [ ] Editing only `utils` triggers rebuild of `utils` (and dependents), not unrelated work on a re-run.
- [ ] A reference cycle produces `TS6202`.

---

## Task 10 — Build-Mode Orchestration 🔴

**Goal:** Master the build-mode flags.

**Steps:** Using the Task 9 repo, run and interpret:

```bash
npx tsc --build --verbose     # why each project (re)builds
npx tsc --build --dry         # plan without building
npx tsc --build --force       # rebuild everything
npx tsc --build --clean       # delete all outputs + tsbuildinfo
```

**Acceptance Criteria:**
- [ ] `--verbose` explains up-to-date vs. out-of-date per project.
- [ ] `--dry` writes nothing.
- [ ] After `--clean`, all `dist/` and `.tsbuildinfo` are gone.
- [ ] You can describe the difference between `--force` and a normal incremental build.

---

## Task 11 — Build Performance Investigation 🔴

**Goal:** Profile and reduce type-checking time.

**Steps:**
1. Capture a baseline:

```bash
npx tsc --noEmit --extendedDiagnostics | tee before.txt
```

2. Generate and analyze a trace:

```bash
npx tsc --noEmit --generateTrace .trace
npx @typescript/analyze-trace .trace
```

3. Refactor the worst hot spot (e.g., bound a deep recursive type, name an inlined complex type, enable `skipLibCheck`).
4. Re-measure:

```bash
npx tsc --noEmit --extendedDiagnostics | tee after.txt
```

**Acceptance Criteria:**
- [ ] `before.txt` and `after.txt` show **Check time** and **Instantiations**.
- [ ] Instantiations and/or Check time measurably drop after the refactor.
- [ ] You can name the single most expensive type from `analyze-trace`.
- [ ] No new type errors are introduced.

---

## Task 12 — tsc + Bundler Split 🔴

**Goal:** Use esbuild for emit and `tsc` for checking + types.

**Steps:**
1. Configure tsc to only check:

```json
{ "compilerOptions": { "noEmit": true, "isolatedModules": true, "verbatimModuleSyntax": true, "skipLibCheck": true } }
```

2. Add scripts:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build:js": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.js",
    "build:types": "tsc --emitDeclarationOnly --declaration --outDir dist",
    "build": "npm run typecheck && npm run build:js && npm run build:types"
  }
}
```

**Acceptance Criteria:**
- [ ] `npm run build:js` produces bundled JS quickly (no type checking).
- [ ] Introducing a type error does **not** break `build:js` but **does** fail `typecheck`.
- [ ] `build:types` produces `.d.ts`.
- [ ] `isolatedModules` flags any file that can't be transpiled standalone.

---

## Task 13 — Inspect & Audit the File Set 🟡

**Goal:** Use `--showConfig`, `--listFiles`, and `--explainFiles` to understand exactly what `tsc` compiles.

**Steps:**
1. Print the resolved config:

```bash
npx tsc --showConfig
```

2. List every file in the compilation and count them:

```bash
npx tsc --noEmit --listFiles | wc -l
```

3. Explain why files are included, focusing on anything surprising:

```bash
npx tsc --noEmit --explainFiles | grep -A1 "node_modules" | head -40
```

4. Tighten `include`/`exclude` to drop tests, fixtures, and generated code, then re-count.

**Acceptance Criteria:**
- [ ] You can name one file pulled in only because another file imported it.
- [ ] You can identify which `@types` packages are in the compilation.
- [ ] The file count drops after tightening `exclude`.
- [ ] `--showConfig` reflects your `extends` chain fully merged.

---

## Task 14 — Diagnose a Module Resolution Failure 🔴

**Goal:** Use `--traceResolution` to fix a `TS2307`.

**Steps:**
1. Reproduce a failure by importing a package that ships no types:

```typescript
// src/cache.ts
import Redis from "ioredis";   // may error: cannot find module or its types
```

2. Trace resolution:

```bash
npx tsc --noEmit --traceResolution 2>&1 | grep -A8 "ioredis"
```

3. Read the trace to see whether a `types` condition was found; install `@types/*` or adjust `moduleResolution` as needed.

```bash
npm install --save-dev @types/ioredis   # if the package has no bundled types
```

**Acceptance Criteria:**
- [ ] You can read the trace and identify where resolution failed.
- [ ] The `TS2307` is resolved without `@ts-ignore`.
- [ ] You can explain how `moduleResolution` (`nodenext` vs `bundler`) changed the lookup.
- [ ] A final `tsc --noEmit` exits `0`.

---

## Task 15 — Localized Diagnostics & Exit-Code Script 🟢

**Goal:** Wrap `tsc` in a script that reports a clean pass/fail and try localization.

**Steps:**
1. Add a shell wrapper:

```bash
#!/usr/bin/env bash
if npx tsc --noEmit --pretty false; then
  echo "TYPES OK"
else
  echo "TYPES FAILED (exit $?)"
  exit 1
fi
```

2. Try a localized run:

```bash
npx tsc --noEmit --locale ja
```

**Acceptance Criteria:**
- [ ] The wrapper prints `TYPES OK` on a clean repo and exits `0`.
- [ ] On an error it prints the failure line and exits non-zero.
- [ ] `--locale ja` shows Japanese diagnostic text (codes unchanged).
- [ ] The script is safe to call from CI (no masked exit code).

---

## Stretch Goals

- **CI cache:** Add an `actions/cache` step keyed on the lockfile that persists `**/*.tsbuildinfo`; observe warm CI builds.
- **Localized errors:** Run `tsc --locale ja --noEmit` and see localized diagnostics.
- **Resolution debugging:** Add `--traceResolution` to diagnose a "cannot find module" issue.
- **`--noCheck` (TS 5.6+):** Emit without full checking and compare timing to a normal emit; discuss when this is safe.
- **`--isolatedDeclarations` (TS 5.5+):** Enable it and observe the stricter requirements it imposes on exported declarations.
- **Nightly cold build:** Add a scheduled `tsc --build --force` job to catch cache-masked regressions.

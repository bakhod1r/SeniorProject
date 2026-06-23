# ts-node — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Professional Tasks](#professional-tasks)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)
7. [Self-Check Questions](#self-check-questions)

---

## Junior Tasks

### Task 1: First ts-node Run

**Type:** Setup + Code

**Goal:** Install `ts-node` locally and run a typed file.

**Steps:**
1. Create a folder, run `npm init -y`.
2. Install: `npm install -D ts-node typescript @types/node`.
3. Create `src/hello.ts`.

**Starter code:**

```typescript
// src/hello.ts
function greet(name: string): string {
  // TODO: return a greeting string using the name parameter
  return "TODO";
}

console.log(greet("ts-node"));
```

**Expected output:**
```
Hello, ts-node!
```

**Evaluation criteria:**
- [ ] `npx ts-node src/hello.ts` runs without error
- [ ] No `.js` file appears in `src/`
- [ ] The function is correctly typed

---

### Task 2: Use the REPL

**Type:** Exploration

**Goal:** Practice TypeScript interactively.

**Steps:**
1. Run `npx ts-node` with no file.
2. In the REPL, evaluate the following and record the results:

```typescript
> const nums: number[] = [1, 2, 3, 4];
> nums.filter(n => n % 2 === 0);
> type Point = { x: number; y: number };
> const p: Point = { x: 1, y: 2 };
> p.x + p.y;
```

3. Try `p.z` and observe the type error.

**Evaluation criteria:**
- [ ] You can evaluate expressions and see results
- [ ] You triggered and read a type error in the REPL
- [ ] You exited cleanly with `Ctrl+D`

---

### Task 3: Add an npm Script

**Type:** Config

**Goal:** Replace long `npx` commands with a memorable script.

**Starter:**

```json
{
  "scripts": {
    "TODO": "TODO"
  }
}
```

**Requirements:**
- Add a `"start"` script that runs `src/hello.ts` with `ts-node`.
- Add a `"start:fast"` script that uses `--transpile-only`.

**Evaluation criteria:**
- [ ] `npm start` works
- [ ] `npm run start:fast` skips type checking
- [ ] Scripts use the local `ts-node`, not a global one

---

### Task 4: Observe transpile-only Behavior

**Type:** Experiment

**Goal:** See the safety/speed trade-off directly.

**Starter code:**

```typescript
// src/bad.ts
function double(n: number): number {
  return n * 2;
}
console.log(double("oops" as unknown as number));
```

**Requirements:**
1. Run `npx ts-node src/bad.ts` — note the result.
2. Add a real type error (remove the cast) and run again in default mode — note it fails.
3. Run with `--transpile-only` — note it runs anyway.

**Evaluation criteria:**
- [ ] You observed default mode rejecting the type error
- [ ] You observed `--transpile-only` running despite it
- [ ] You can explain the difference in one sentence

---

## Middle Tasks

### Task 5: Make node Understand .ts

**Type:** Code + CLI

**Goal:** Use the register hook.

**Requirements:**
1. Create `scripts/report.ts` that prints `process.version` and `process.argv`.
2. Run it with `node -r ts-node/register scripts/report.ts extra arg`.
3. Confirm `process.argv` includes `extra` and `arg`.

**Evaluation criteria:**
- [ ] Runs via plain `node` + register hook
- [ ] CLI arguments are forwarded correctly
- [ ] You can explain what `-r` does

---

### Task 6: ESM Project Setup

**Type:** Config + Code

**Goal:** Run TypeScript under ESM correctly.

**Requirements:**
1. Set `"type": "module"` in `package.json`.
2. Create `src/util.ts` exporting a `sum(a, b)` function.
3. Create `src/main.ts` importing it — use the `.js` extension in the import.
4. Run with `npx ts-node --esm src/main.ts`.

**Starter code:**

```typescript
// src/util.ts
export function sum(a: number, b: number): number {
  return a + b;
}

// src/main.ts
// TODO: import sum from ./util using the correct extension
console.log(/* TODO call sum */);
```

**Evaluation criteria:**
- [ ] Import uses `./util.js`
- [ ] Runs under `--esm` without `ERR_MODULE_NOT_FOUND`
- [ ] You can explain why the extension is `.js`

---

### Task 7: nodemon Dev Loop

**Type:** Config

**Goal:** Auto-restart a server on file change.

**Requirements:**
1. Install `nodemon` and create a tiny HTTP server in `src/server.ts`.
2. Create `nodemon.json` watching `src`, ext `ts`, exec `ts-node --transpile-only src/server.ts`.
3. Add `"dev": "nodemon"` to scripts.
4. Edit the server's response string and confirm it restarts.

**Starter code:**

```typescript
// src/server.ts
import { createServer } from "node:http";

const server = createServer((_req, res) => {
  res.end("Hello v1"); // change this and watch it restart
});

server.listen(3000, () => console.log("http://localhost:3000"));
```

**Evaluation criteria:**
- [ ] `npm run dev` starts the server
- [ ] Editing the file triggers a restart
- [ ] Uses `--transpile-only` for fast restarts

---

### Task 8: Path Aliases at Runtime

**Type:** Config

**Goal:** Make `@app/*` aliases work under `ts-node`.

**Requirements:**
1. Add `baseUrl` and `paths` (`"@app/*": ["src/*"]`) to `tsconfig.json`.
2. Import a module via `@app/util`.
3. Run with `tsconfig-paths/register` so it resolves.

**Evaluation criteria:**
- [ ] Alias import works at runtime (no `Cannot find module`)
- [ ] `tsconfig-paths/register` is wired via `-r` or the `ts-node.require` config
- [ ] You can explain why Node alone can't resolve `paths`

---

### Task 9: Separate Scripts Config

**Type:** Config

**Goal:** Run scripts as CommonJS while the app is ESM.

**Requirements:**
1. Keep `"type": "module"` for the app.
2. Create `tsconfig.scripts.json` extending base with `module: CommonJS`.
3. Run a script with `ts-node -P tsconfig.scripts.json scripts/seed.ts` (no `.js` extension gymnastics needed).

**Evaluation criteria:**
- [ ] Script runs as CommonJS without ESM extension requirements
- [ ] App still builds/runs as ESM
- [ ] Documented trade-off in a comment

---

## Senior Tasks

### Task 10: Decouple Running from Type Checking

**Type:** Pipeline

**Goal:** Fast dev + authoritative type safety.

**Requirements:**
1. `"dev"` uses `ts-node --swc` (or `tsx watch`).
2. `"typecheck"` runs `tsc --noEmit`.
3. `"build"` runs `tsc -p tsconfig.build.json`; `"start"` runs `node dist/...`.
4. Add a CI workflow that runs `typecheck` as a required gate.

**Evaluation criteria:**
- [ ] Dev loop does not type-check (fast)
- [ ] CI fails on a type error via `tsc --noEmit`
- [ ] Production runs compiled JS, not `ts-node`

---

### Task 11: Benchmark Runners

**Type:** Measurement

**Goal:** Choose a runner with data.

**Requirements:**
1. Pick a representative script in your repo.
2. Use `hyperfine` to compare: default `ts-node`, `--transpile-only`, `--swc`, `tsx`, and `node --experimental-strip-types` (if Node ≥ 22.6).
3. Record median cold-start times in a table.

**Evaluation criteria:**
- [ ] At least 4 runners benchmarked
- [ ] Warm-up iteration used; median reported
- [ ] A recommendation justified by the numbers

---

### Task 12: Migrate to tsx

**Type:** Refactor

**Goal:** Replace `ts-node` in the dev loop with `tsx`.

**Requirements:**
1. Replace `nodemon --exec ts-node` with `tsx watch`.
2. Verify path aliases and ESM imports still work.
3. Confirm `tsc --noEmit` still gates CI.
4. Document any `const enum` usages found and fix them.

**Evaluation criteria:**
- [ ] Dev loop runs on `tsx`, faster restarts
- [ ] No runtime regressions
- [ ] Type safety preserved via CI

---

## Professional Tasks

### Task 13: Build a Minimal Require Hook

**Type:** Internals

**Goal:** Implement a tiny transpile-only `.ts` loader.

**Requirements:**
1. Write `mini-register.ts` that patches `require.extensions[".ts"]`.
2. Use `ts.transpileModule` with `module: CommonJS`, inline source maps.
3. Run an entry file with `node -r ./mini-register.js entry.ts`.

**Starter code:**

```typescript
// mini-register.ts
import * as fs from "node:fs";
import * as ts from "typescript";

// TODO: assign require.extensions[".ts"] to a handler that
// reads the file, transpiles to CommonJS, and calls module._compile
```

**Evaluation criteria:**
- [ ] A `.ts` entry runs through plain node + your hook
- [ ] Stack traces map to `.ts` lines (inline source maps)
- [ ] You can explain how this relates to `ts-node --transpile-only`

---

### Task 14: Native Stripping Compatibility Audit

**Type:** Migration

**Goal:** Make a codebase runnable with `node --experimental-strip-types`.

**Requirements:**
1. Enable `erasableSyntaxOnly: true` in `tsconfig.json`.
2. Replace any `enum`/`namespace`/parameter-property usage flagged.
3. Add explicit import extensions.
4. Run a script with `node --experimental-strip-types script.ts`.

**Evaluation criteria:**
- [ ] No non-erasable syntax remains
- [ ] Script runs under native stripping
- [ ] `tsc --noEmit` still passes

---

### Task 15: Production Dockerfile Without ts-node

**Type:** Deployment

**Goal:** Ship compiled JS, leave the compiler out of the runtime image.

**Requirements:**
1. Multi-stage Dockerfile: a build stage that runs `tsc`, a runtime stage with `npm ci --omit=dev`.
2. Runtime `CMD` is `node dist/server.js`.
3. Confirm `ts-node`/`typescript` are absent from the runtime image.

**Evaluation criteria:**
- [ ] Runtime image has no `ts-node`/`typescript`
- [ ] `CMD` runs compiled JS
- [ ] Image size is smaller than a single-stage `ts-node` image

---

## Mini Projects

### Project A: Typed CLI Tool

Build a small CLI (e.g. a TODO manager) you iterate on with `ts-node` in dev, then package for distribution by compiling with `tsc` and shipping `dist/`. Compare startup time dev vs prod.

### Project B: Dev Server Template

Create a reusable Express/Fastify template with a fast dev loop (`tsx watch` or `ts-node-dev`), a `tsc --noEmit` CI gate, and a production `node dist` start command. Document the rationale in the README.

### Project C: Script Runner Library

Write a set of typed maintenance scripts (seed, migrate, backfill) that run under `ts-node` with a dedicated `tsconfig.scripts.json`. Add error handling that sets a non-zero exit code on failure.

---

## Challenge

**The Universal Runner Bench.** Create a repo with a non-trivial script (imports a few modules, uses async I/O). Provide npm scripts to run it under `ts-node`, `ts-node --transpile-only`, `ts-node --swc`, `tsx`, `@swc-node/register`, and native Node stripping. Write a `BENCHMARK.md` with `hyperfine` results, a recommendation for dev/CI/prod, and an explanation of why each tool does or doesn't type-check.

**Acceptance criteria:**
- [ ] All six run paths work
- [ ] `BENCHMARK.md` has reproducible numbers
- [ ] A clear, justified recommendation per environment
- [ ] Production path uses compiled output, never `ts-node`

---

### Task 16: REPL-Driven API Exploration

**Type:** Exploration

**Goal:** Use the REPL to learn an unfamiliar library quickly.

**Requirements:**
1. Install a small typed library (e.g. `date-fns` or `zod`).
2. Start `npx ts-node`.
3. Import the library and call a few functions, reading the inferred types.

```typescript
> import { z } from "zod";
> const Schema = z.object({ name: z.string(), age: z.number() });
> Schema.parse({ name: "Ada", age: 36 });
> Schema.parse({ name: "Ada" }); // observe the ZodError
```

**Evaluation criteria:**
- [ ] You imported a real dependency in the REPL
- [ ] You read at least one inferred type
- [ ] You triggered a runtime validation error and read it

---

### Task 17: Environment-Variable Configuration

**Type:** Config

**Goal:** Drive `ts-node` behavior with `TS_NODE_*` variables.

**Requirements:**
1. Run a script with `TS_NODE_TRANSPILE_ONLY=true ts-node scripts/seed.ts`.
2. Run another with `TS_NODE_PROJECT=tsconfig.scripts.json ts-node scripts/seed.ts`.
3. Confirm each behaves like the equivalent flag.

**Evaluation criteria:**
- [ ] `TS_NODE_TRANSPILE_ONLY` skips checking
- [ ] `TS_NODE_PROJECT` selects the config
- [ ] You can name the flag each variable maps to

---

### Task 18: Ignore a Specific Diagnostic

**Type:** Config

**Goal:** Suppress one diagnostic code without turning off all checks.

**Requirements:**
1. Write a script that triggers a specific TS error (note its code, e.g. `TS7006`).
2. Add `"ignoreDiagnostics": [<code>]` to the `ts-node` config block.
3. Confirm the script runs while other type errors are still caught.

**Evaluation criteria:**
- [ ] Only the targeted code is ignored
- [ ] Other type errors still block the run
- [ ] You documented why the suppression is acceptable

---

### Task 19: Compare Stack Traces With and Without Source Maps

**Type:** Experiment

**Goal:** See the effect of source maps on error output.

**Requirements:**
1. Write a script that throws from a nested function.
2. Run it normally and confirm the stack trace shows `.ts` lines.
3. Run with `-O '{"sourceMap":false}'` and observe the difference.

**Evaluation criteria:**
- [ ] Default run shows `.ts` line numbers
- [ ] Disabling maps changes the trace
- [ ] You can explain the role of `source-map-support`

---

### Task 20: Guardrail Against ts-node in Production

**Type:** CI / Tooling

**Goal:** Prevent `ts-node`/`typescript` from leaking into runtime dependencies.

**Requirements:**
1. Write a small Node check that fails if either appears in `dependencies`.
2. Wire it into a `prebuild` or CI step.

**Starter code:**

```javascript
// scripts/check-deps.js
const pkg = require("../package.json");
const deps = pkg.dependencies || {};
// TODO: exit non-zero if deps["ts-node"] or deps["typescript"] exists
```

**Evaluation criteria:**
- [ ] Check fails when the forbidden deps are present
- [ ] Check passes when they are dev-only
- [ ] Integrated into CI

---

## Self-Check Questions

1. Where does `ts-node` write compiled output? (Answer: nowhere — memory.)
2. What two things must you do to support ESM correctly? (`--esm`/loader + `.js` extensions.)
3. How do you keep dev fast without losing type safety? (Transpile-only/swc + `tsc --noEmit`.)
4. Why never `ts-node` in prod? (Startup cost, dependency surface, no build-time guarantee, non-determinism.)
5. What makes a codebase compatible with native stripping? (`erasableSyntaxOnly`; no enums/namespaces; explicit extensions.)
6. Which `TS_NODE_*` variable maps to `--transpile-only`? (`TS_NODE_TRANSPILE_ONLY`.)
7. How do you ignore a single diagnostic code? (`ignoreDiagnostics` in the `ts-node` config block.)
8. What keeps the compiler warm across nodemon-style restarts? (`ts-node-dev`.)

---

## Solutions Sketch (Try First, Then Peek)

<details>
<summary>Task 1 — greet</summary>

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}
```
</details>

<details>
<summary>Task 6 — ESM import</summary>

```typescript
// src/main.ts
import { sum } from "./util.js";
console.log(sum(2, 3));
```
Run: `npx ts-node --esm src/main.ts`
</details>

<details>
<summary>Task 20 — dep guardrail</summary>

```javascript
const pkg = require("../package.json");
const deps = pkg.dependencies || {};
if (deps["ts-node"] || deps["typescript"]) {
  console.error("ts-node/typescript must be devDependencies");
  process.exit(1);
}
```
</details>

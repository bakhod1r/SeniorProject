# ts-node — Interview Questions

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Scenario Questions](#scenario-questions)
7. [Whiteboard / Live Tasks](#whiteboard--live-tasks)

---

## Junior Questions

**Q1: What is `ts-node` and what problem does it solve?**
> `ts-node` runs TypeScript files directly, compiling them in memory so you skip the separate `tsc` build step. It removes the edit → compile → run friction during development, letting you do `ts-node app.ts` instead of `tsc && node dist/app.js`.

```bash
# Without ts-node: two steps, files on disk
tsc && node dist/app.js
# With ts-node: one step, nothing written to disk
ts-node src/app.ts
```

**Q2: Does `ts-node` write `.js` files to disk?**
> No. Compilation happens entirely in memory. If you want emitted files, use `tsc`. This is one of the most common misconceptions.

**Q3: How do you install and run `ts-node`?**
> `npm install -D ts-node typescript`, then `npx ts-node src/app.ts` (or via an npm script). Local install is preferred so the version is pinned per project.

**Q4: What is the difference between `ts-node` and `tsc`?**
> `tsc` is the compiler: it converts `.ts` to `.js` on disk and can type-check. `ts-node` runs `.ts` directly (compiling in memory) and, by default, type-checks before running. `ts-node` is for executing; `tsc` is for building.

**Q5: What does the `ts-node` REPL do?**
> Running `ts-node` with no file opens an interactive prompt where each line of TypeScript is type-checked and evaluated. It is great for quick experiments and exploring APIs.

**Q6: What does `--transpile-only` do?**
> It strips types and converts syntax without running the type checker, making startup much faster — but type errors no longer stop the program.

```bash
# Default: type error halts the run
ts-node src/app.ts            # TSError if types are wrong
# transpile-only: ignores type errors, runs anyway
ts-node --transpile-only src/app.ts
```

**Q7: Is `ts-node` appropriate for production?**
> No. For production you compile ahead of time with `tsc` and run plain JavaScript. `ts-node` is a development tool; running it in production adds startup cost and ships the compiler.

**Q7b: What does `npx ts-node` do that `ts-node` alone might not?**
> `npx` finds and runs the project-local `ts-node` from `node_modules/.bin` even if it is not on your global `PATH`. Calling `ts-node` directly works only if it is installed globally or you are inside an npm script (where `node_modules/.bin` is on the PATH). Prefer `npx` or npm scripts so you always use the pinned local version.

**Q7c: What is the difference between `ts-node file.ts` and `tsc && node file.js`?**
> `ts-node` compiles in memory and runs in a single step, leaving no files on disk. `tsc && node` writes `.js` (and optionally `.d.ts`, source maps) to disk first, then executes them. The two-step path is what you ship to production; `ts-node` is the convenience path for development.

**Q7d: How do you run a one-off TypeScript expression without creating a file?**
> Use the `-e`/`--eval` flag: `ts-node -e 'console.log(([1,2,3] as number[]).length)'`. Add `-p` to print the result of the expression automatically.

---

## Middle Questions

**Q8: What is the single biggest gotcha when using `ts-node` with ESM?**
> The CommonJS-vs-ESM distinction. In ESM mode you must use `--esm`/`--loader ts-node/esm`, and relative imports must include the `.js` extension even though the source file is `.ts`, because TypeScript doesn't rewrite specifiers and Node's ESM resolver requires extensions.

**Q9: Why do ESM relative imports use `.js` when the file is `.ts`?**
> TypeScript leaves import specifiers untouched. The emitted/runtime path is `.js`, and `ts-node` maps `./util.js` back to `./util.ts` on disk. This is the documented `NodeNext`/ESM behavior.

```typescript
// util.ts exists on disk, but the import says .js
import { sum } from "./util.js"; // correct under ESM
// import { sum } from "./util";  // ERR_MODULE_NOT_FOUND
```

**Q10: How do you make plain `node` understand `.ts` files?**
> Preload the register hook: `node -r ts-node/register app.ts` for CommonJS, or `node --loader ts-node/esm app.ts` / `node --import ts-node/register/esm app.ts` for ESM.

**Q11: How do you keep fast dev startup without losing type safety?**
> Run with `--transpile-only` or `--swc` for speed, and run `tsc --noEmit` separately (locally and in CI) as the authoritative type check.

**Q12: Your `@app/db` alias import fails at runtime. Why and how do you fix it?**
> Node doesn't understand `tsconfig` `paths`. `ts-node` doesn't resolve them on its own. Register `tsconfig-paths/register` (via `-r` or the `ts-node.require` config) so aliases resolve at runtime.

**Q13: How do you configure `ts-node` separately from your build?**
> Use a `ts-node` block in `tsconfig.json` with `compilerOptions` overrides (e.g. force `module: CommonJS` for scripts), a dedicated `tsconfig.scripts.json` via `--project`, or `TS_NODE_*` env vars.

```json
// tsconfig.json — overrides apply only under ts-node
{
  "compilerOptions": { "module": "ESNext" },
  "ts-node": {
    "transpileOnly": true,
    "compilerOptions": { "module": "CommonJS" }
  }
}
```

**Q14: What breaks under `--transpile-only` that works in default mode?**
> Whole-program features like `const enum` inlining, because each file is transpiled in isolation with no cross-file type info. Enable `isolatedModules: true` to catch these.

**Q15: How do you set up a `nodemon` + `ts-node` dev loop?**
> Configure `nodemon.json` with `"exec": "ts-node --transpile-only src/server.ts"` and watch `src`. `--transpile-only` keeps restarts fast. Alternatively use `ts-node-dev` (keeps the compiler warm) or `node --watch`.

**Q15b: How does `ts-node-dev` differ from `nodemon` + `ts-node`?**
> `nodemon` spawns a brand-new `ts-node` process on every change, paying full compiler startup each time. `ts-node-dev` keeps the compiler service alive across restarts and recompiles only the files that changed, so restarts are noticeably faster on large projects.

**Q15c: How do you make source maps work so stack traces point to `.ts` files?**
> `ts-node` emits inline source maps and installs `source-map-support` automatically, so by default stack traces already map to `.ts` lines. If they don't, a custom compiler config probably disabled inline maps, or `source-map-support` was overridden. For VS Code debugging, launch with `runtimeArgs: ["-r", "ts-node/register"]`.

**Q15d: How do you suppress a specific diagnostic in `ts-node` without disabling all checks?**
> Use `ignoreDiagnostics` (CLI `-D`, or the `ts-node` config block) with the numeric TS error codes you want to ignore — e.g. `"ignoreDiagnostics": [7006]`. This keeps full type checking on for everything else.

**Q15e: What is the `files` option for and when do you need it?**
> By default `ts-node` only loads files it actually imports. `"files": true` additionally pulls in the `files`/`include` entries from `tsconfig.json`. You need it when ambient declarations (global `.d.ts` augmentations) must be visible even though no module imports them directly.

---

## Senior Questions

**Q16: Compare `ts-node`, `tsx`, and swc for the dev inner loop.**
> `ts-node` (default) uses the tsc engine and type-checks (slowest, highest fidelity). `tsx` uses esbuild — very fast, ESM-friendly, no type checking. swc (`@swc-node` / `ts-node --swc`) uses a Rust transpiler — fastest, no checks. For dev speed, `tsx` or native stripping usually win; `ts-node` shines when you need type-checked runs or exact tsc semantics.

```bash
ts-node src/app.ts          # tsc engine, type-checked, slowest
ts-node --swc src/app.ts    # swc engine, no check, very fast
tsx src/app.ts              # esbuild, no check, very fast, ESM-easy
node src/app.ts             # native strip (Node 23.6+), no tool
```

**Q17: Why should you never ship `ts-node` to production? Give concrete reasons.**
> (1) Startup cost — compiling on every cold start hurts serverless/autoscaling latency. (2) Dependency surface — ships `typescript` + `ts-node`, enlarging images and CVE exposure. (3) No build-time guarantee — type/syntax errors crash at deploy instead of failing the build. (4) Non-determinism — a prebuilt `dist/` is a reproducible, hashable artifact. (5) Per-file overhead even in transpile-only.

**Q18: What changed with Node's native type stripping, and how does it affect tool choice?**
> Node 22.6+ added `--experimental-strip-types` (erase types, no checking), 22.7+ added `--experimental-transform-types` (handle enums/namespaces), and 23.6+ enables stripping by default. For many scripts this removes the need for a runner: `node --watch app.ts` plus `tsc --noEmit`. `ts-node`'s remaining edge is type-checked runs and full-syntax/compiler fidelity.

**Q19: Where should type checking live in a modern pipeline?**
> In exactly one authoritative place — `tsc --noEmit` (or `tsc -b`) as a CI gate — not implicitly inside every runner. Runners (`tsx`, swc, native strip, `ts-node --transpile-only`) are untyped execution; the CI gate guarantees safety. Relying on default `ts-node` for "free" checks in CI is slower and incomplete (lazy, per-file).

**Q20: How would you migrate a project from `ts-node` to `tsx`?**
> Swap dev scripts (`nodemon --exec ts-node` → `tsx watch`), verify path aliases (tsx reads tsconfig `paths`), enable `verbatimModuleSyntax` to keep imports portable, audit any `const enum` usage, and ensure `tsc --noEmit` still gates CI. Keep `tsc` for builds.

**Q21: When is `ts-node` still the right choice over alternatives?**
> When you need a type-checked run (it fails on type errors), when compilation must exactly match `tsc` semantics, when you need the REPL, or when integrating via the require hook with a tool that already expects `ts-node/register`. Also if the project is already standardized on it and works.

**Q21b: Bun and Deno both run TypeScript natively — why not just use them instead of ts-node?**
> Because they are different runtimes, not drop-in tools. Bun and Deno re-implement (most of) Node's APIs but have behavioral differences and their own ecosystems. Adopting them to "run TypeScript" is a runtime migration decision with broad implications. `ts-node`/`tsx`/native Node stripping keep you on Node. Choose Bun/Deno when you want the whole runtime, not merely a TS runner.

**Q21c: How would you decide between `tsx` and native Node type stripping for a new project's dev loop?**
> If the team is on Node 23.6+ and the code is erasable-syntax-only (no enums/namespaces/parameter properties), native stripping plus `node --watch` is the lightest option — zero dependencies. If you need broader syntax support, older Node compatibility, or smoother path-alias/ESM handling today, `tsx` is the pragmatic default. Both require a separate `tsc --noEmit` for type safety.

**Q21d: A serverless function's cold start is dominated by ts-node compilation. What do you change?**
> Stop running `ts-node` at runtime entirely. Compile with `tsc` at build/deploy time, bundle if needed, and run the prebuilt `.js`. This removes per-cold-start compilation, drops the `typescript`/`ts-node` packages from the deployment artifact, and makes cold start a function of code size, not compile time.

---

## Professional / Deep-Dive Questions

**Q22: Explain how `ts-node` intercepts CommonJS module loading.**
> It overrides `require.extensions[".ts"]` (the `Module._extensions` map). When CommonJS `require()` hits a `.ts` file, the handler reads the source, compiles it to JS via the TypeScript compiler API, and calls `module._compile(js, filename)`. Node then wraps and executes the JS exactly like any `.js` module.

```javascript
// Conceptual shape of the installed hook
require.extensions[".ts"] = (module, filename) => {
  const src = fs.readFileSync(filename, "utf8");
  const js = tsNodeService.compile(src, filename);
  module._compile(js, filename);
};
```

**Q23: How does `ts-node` integrate with ESM, and why is it harder than CommonJS?**
> Via Node's loader hooks: a `resolve` hook (map `./util.js` → `./util.ts`, set `format`) and a `load` hook (read, compile, return `{ format, source }`). It's harder because the hooks are async, run in an isolated context, and `ts-node` must reproduce Node's CJS-vs-ESM determination to report the correct `format` — getting it wrong yields `ERR_REQUIRE_ESM` or `Unexpected token 'export'`.

**Q24: How does `ts-node` make stack traces point to `.ts` lines if no `.map` files exist?**
> It emits inline source maps and installs `source-map-support` with a `retrieveSourceMap` callback that returns the in-memory map for each compiled file. When a stack trace is formatted, frame positions are translated back to TS coordinates.

```typescript
// Conceptually:
install({
  retrieveSourceMap: (path) => tsNodeService.getSourceMap(path), // in-memory map
});
```

**Q25: What is the registration mechanism, and why does load order matter?**
> Registration installs the hooks (`-r ts-node/register`, `--import`, `module.register()`, or programmatic `register()`). Order matters because the hook must exist before the first `.ts` require/import; otherwise Node loads the raw file and throws a syntax error.

**Q26: Contrast `ts-node`'s approach with Node native type stripping at the implementation level.**
> `ts-node` runs a full parse/check/emit (or swc transpile) through user-space loader hooks. Native stripping does a lightweight tokenize-and-erase inside the runtime, replacing annotation spans (often preserving offsets so source maps are unneeded), never type-checks, and can't handle non-erasable syntax (`enum`) in strip-only mode — that needs `--experimental-transform-types` (swc-backed).

**Q27: How does the compiler service cache work, and what invalidates it?**
> `ts-node` keeps an in-memory LanguageService/Program with parsed ASTs and emit results for the process lifetime, so re-requiring a file doesn't recompile. The cache key includes source text, resolved compiler options, and mode, so a config change invalidates stale output. Long-lived watchers (`ts-node-dev`) keep this warm across restarts.

**Q28: Why isn't default `ts-node` a substitute for `tsc --noEmit`?**
> `ts-node` checks lazily, per file, only as modules are imported. Files no script imports are never checked. `tsc --noEmit` checks the entire program graph. So `ts-node` can run "clean" while a type error lurks in an unimported file.

**Q28b: Walk through the lifecycle of `node -r ts-node/register app.ts` from process start.**
> Node parses `-r ts-node/register` and `require()`s it before the entrypoint. That module calls `register()`, which builds a compiler service and overrides `require.extensions[".ts"]`. Node then loads `app.ts`; the override reads the source, compiles it to CommonJS in memory, and calls `module._compile`. Node wraps and runs the JS. Any subsequent `require("./x.ts")` flows through the same override, hitting the in-memory cache on repeat requires.

**Q28c: Why does the ESM loader run in a separate thread/context, and what consequence does that have?**
> Modern Node runs `--import`/`register()` loader hooks off the main thread for isolation and to keep the resolution pipeline asynchronous. The consequence is that the loader cannot freely share mutable state with the main module graph the way the synchronous CommonJS `require.extensions` hook can, which is part of why ESM `ts-node` is more constrained and version-sensitive than the CJS path.

**Q28d: How does `ts-node` decide whether to emit CommonJS or ESM for a given `.ts` file?**
> It reproduces Node's own determination: `.cts`/`.cjs` → CommonJS, `.mts`/`.mjs` → ESM, and for `.ts` it walks up to the nearest `package.json` and reads `"type"` (`"module"` → ESM, otherwise CommonJS). It must then report a matching `format` to Node's loader; a mismatch produces `ERR_REQUIRE_ESM` or `Unexpected token 'export'`.

**Q28e: What does native type stripping do with an `enum`, and why?**
> In strip-only mode it rejects the `enum` because an enum is not erasable — it requires emitting runtime object code, not just deleting annotations. Stripping only removes type-only spans (often preserving byte offsets). To handle enums you need `--experimental-transform-types`, which pulls in a real transform (swc) at the cost of being a heavier, flagged feature.

---

## Rapid-Fire Round

**Q29: Flag to skip type checking?** → `--transpile-only` (`-T`).

**Q30: Flag for ESM?** → `--esm`.

**Q31: Make node read `.ts`?** → `node -r ts-node/register file.ts`.

**Q32: Resolve `paths` aliases at runtime?** → `tsconfig-paths/register`.

**Q33: Fastest ts-node backend?** → `--swc`.

**Q34: Native strip default-on since which Node?** → 23.6.

**Q35: Where does ts-node write compiled JS?** → Memory (nowhere on disk).

**Q36: Env var to force transpile-only?** → `TS_NODE_TRANSPILE_ONLY=true`.

**Q37: Modern replacement for `--loader`?** → `--import` + `module.register()`.

**Q38: Tool to run TS via esbuild?** → `tsx`.

**Q38a: Force REPL even with `-e`?** → `-i` / `--interactive`.

**Q38b: Print result of `-e` expression?** → `-p` / `--print`.

**Q38c: Alternate compiler module flag?** → `-C` / `--compiler`.

**Q38d: Skip `.d.ts` checking for speed?** → `skipLibCheck: true`.

**Q38e: Catch isolated-transpile-unsafe code at check time?** → `isolatedModules: true`.

**Q38f: tsconfig flag for native-strip compatibility?** → `erasableSyntaxOnly: true`.

**Q38g: Modern flag to register an ESM loader?** → `--import`.

**Q38h: Programmatic ESM loader registration API?** → `module.register()`.

**Q38i: Keep the compiler warm across restarts?** → `ts-node-dev`.

**Q38j: Built-in Node watch flag?** → `--watch`.

---

## Scenario Questions

**Q39: A teammate added `"start": "ts-node src/server.ts"`. What do you say in review?**
> Reject it. Production should run compiled output: add `"build": "tsc"` and `"start": "node dist/server.js"`. Running `ts-node` in prod adds cold-start compile cost, ships the compiler, and loses build-time error guarantees.

```json
// Suggested change in the PR
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js"
  }
}
```

**Q40: CI passes but a type bug shipped. The team uses `ts-node --transpile-only` everywhere. Diagnose.**
> Transpile-only never type-checks, and there's no separate `tsc --noEmit`. The bug slipped because nothing ever checked types. Fix: add `tsc --noEmit` as a required CI gate.

**Q41: After switching to `"type": "module"`, every script throws `ERR_UNKNOWN_FILE_EXTENSION`. Why?**
> The project is now ESM but scripts still use the CommonJS hook. Use `ts-node --esm`/`--loader ts-node/esm`, add `.js` extensions to relative imports — or migrate the dev loop to `tsx`, which handles ESM with no config.

```bash
# Was (CJS hook on ESM project): fails
node -r ts-node/register src/app.ts
# Fix:
node --import ts-node/register/esm src/app.ts
```

**Q42: Stack traces show generated JS line numbers, not `.ts`. What's wrong?**
> Source maps aren't being applied — `source-map-support` isn't installed or inline maps were stripped (e.g. a custom compiler config disabled them). Ensure default `ts-node` map handling is intact.

---

## Whiteboard / Live Tasks

**Task A: Configure a project where the app is ESM but scripts run as CommonJS via ts-node.**
> Expected: `package.json` `"type": "module"`; a `tsconfig.scripts.json` extending base with `module: CommonJS`; scripts invoked as `ts-node -P tsconfig.scripts.json scripts/x.ts`. Discuss the `.js`-extension trade-off avoided by using CJS for scripts.

**Task B: Write a minimal transpile-only require hook from scratch.**
> Expected: patch `require.extensions[".ts"]`, read source, `ts.transpileModule(..., { module: CommonJS })`, call `module._compile`. Mention this is essentially `ts-node --transpile-only` for CJS.

**Task C: Set up a fast dev loop with type safety.**
> Expected: `"dev": "tsx watch src/server.ts"` (or `ts-node --swc`), `"typecheck": "tsc --noEmit"`, and a CI job running `typecheck`. Articulate why checking is decoupled from running.

**Task D: Given a `const enum` failing under swc, fix it.**
> Expected: replace with a regular `enum` or `as const` object; enable `isolatedModules`/`erasableSyntaxOnly` to prevent recurrence and keep code portable across transpilers and native stripping.

**Task E: Wire `ts-node` into a Mocha test setup.**
> Expected: a `.mocharc.json` with `"require": "ts-node/register"`, `"extensions": ["ts"]`, and a `"spec"` glob pointing at `test/**/*.spec.ts`. Discuss using `--transpile-only` via the `ts-node` config block to speed up the test run while a separate `tsc --noEmit` enforces types.

**Task F: Debug a `ts-node` script in VS Code.**
> Expected: a `launch.json` with `"runtimeArgs": ["-r", "ts-node/register"]` and `"args": ["${workspaceFolder}/src/app.ts"]`. Confirm breakpoints land on `.ts` lines thanks to inline source maps, and explain that `source-map-support` is what makes that mapping happen.

---

## Trade-off Discussion Questions

These open-ended questions test judgment, not recall. Strong answers weigh both sides.

**T1: "We could just turn on `--transpile-only` everywhere and call it a day." Argue both sides.**
> For: dramatically faster dev and test runs, simpler mental model. Against: you lose all runtime type enforcement, so a missing/late `tsc --noEmit` lets real type bugs ship. The resolution is not "never transpile-only" but "transpile-only for running, `tsc --noEmit` as the authoritative gate." The risk is purely organizational: forgetting the gate.

**T2: "Native Node type stripping makes `ts-node` obsolete." Evaluate.**
> Partly true for many scripts: `node --watch app.ts` plus `tsc --noEmit` covers a large fraction of use cases with zero tooling. But native stripping never type-checks, rejects non-erasable syntax in strip-only mode, and lacks `ts-node`'s compiler-fidelity and type-checked-run features. So `ts-node` is diminished, not obsolete — its niche narrows to type-checked runs and full-syntax compatibility.

**T3: "Let's standardize the whole org on Bun to get fast TS execution." What questions do you ask?**
> Are all required Node APIs fully supported in Bun for our services? What is our tolerance for runtime behavioral differences? Do our deployment targets support Bun? Is the speed win worth a runtime migration versus just adopting `tsx`/native stripping on Node? Speed of TS execution alone rarely justifies a runtime change.

**T4: "Our CI uses `ts-node` to run a smoke test and we consider that our type check." Critique.**
> It is not a real type check. `ts-node` checks lazily and only the files the smoke test imports. A type error in any unexercised path ships. Replace with a dedicated `tsc --noEmit` (or `tsc -b`) job; keep the smoke test for behavior, not for types.

---

## Knowledge-Check Matrix

| Concept | Junior can | Middle can | Senior can |
|---------|-----------|-----------|-----------|
| Run a `.ts` file | ✅ | ✅ | ✅ |
| Explain in-memory compilation | ✅ | ✅ | ✅ |
| Configure ESM correctly | — | ✅ | ✅ |
| Wire path aliases / register hooks | — | ✅ | ✅ |
| Choose runner for dev/CI/prod | — | partial | ✅ |
| Justify "never ship to prod" | partial | ✅ | ✅ |
| Explain loader-hook internals | — | — | ✅ |
| Reason about native stripping vs ts-node | — | partial | ✅ |

---

## Long-Form System-Design Questions

These mirror real senior interviews: pick a tool, defend it, and design the surrounding pipeline.

**L1: Design the TypeScript execution strategy for a 30-service Node monorepo.**

A strong answer separates four concerns and assigns one tool to each:

```mermaid
flowchart LR
    A[Editor: live errors] --> B[Dev loop: tsx watch]
    B --> C[CI typecheck: tsc -b]
    C --> D[CI tests: vitest / swc]
    D --> E[Build: tsc -b emit]
    E --> F[Prod: node dist]
```

- **Dev loop:** `tsx watch` (or `ts-node --swc`) per service for fast restarts; no type checking inline.
- **Type safety:** one `tsc -b` job over project references — incremental, complete, the single gate.
- **Tests:** `vitest`/`@swc/jest` for transpile speed, types covered by the gate.
- **Build:** `tsc -b` emits `dist/` with `.d.ts` for cross-package consumption.
- **Prod:** `node dist/...`; the compiler is absent from runtime images.

Justification points: project references make checking incremental and parallel; decoupling running from checking keeps dev fast without sacrificing safety; production determinism comes from prebuilt artifacts.

**L2: A team reports flaky "works locally, fails in CI" type behavior with ts-node. Diagnose the class of bug.**

> The likely cause is reliance on `ts-node`'s lazy, per-file checking locally while CI runs a full `tsc --noEmit`. Code paths not exercised locally (unimported files, conditional branches) are unchecked by `ts-node` but caught by `tsc`. The fix is to make `tsc --noEmit` the local source of truth too (editor + a `typecheck` script), so local and CI agree. This also surfaces config drift: a local `ts-node` block overriding `compilerOptions` can mask errors that the build config (used by CI) would catch.

**L3: You must support both Node 18 (legacy service) and Node 23 (new service). How does that constrain your ts-node usage?**

> On Node 18 you cannot use `--import`/`module.register()` (Node 20.6+) or native stripping (22.6+), so ESM `ts-node` must use the older `--loader ts-node/esm` form and you accept the deprecation warnings. On Node 23 you can adopt native stripping or `--import`. To keep one consistent tool across both, `tsx` is the safest choice — it works on both Node versions with the same invocation. Standardize on `tsx` for the dev loop and gate both with `tsc --noEmit`.

**L4: Justify a migration off ts-node, with a rollback plan.**

> Drivers: slow dev restarts, fragile ESM config, large dependency surface. Target: `tsx` for dev, native stripping where Node version allows. Plan: (1) add `tsx` and a parallel `dev:tsx` script; (2) run both for a sprint, comparing behavior; (3) verify path aliases, ESM imports, and `const enum` usages; (4) switch the default `dev` script; (5) keep the old `ts-node` script for one release as rollback. Throughout, `tsc --noEmit` is unchanged — the safety net does not move during the migration, which is what makes the rollback safe.

---

## Common Wrong Answers to Avoid

| Wrong answer | Why it's wrong | Correct framing |
|--------------|----------------|-----------------|
| "ts-node compiles to dist/" | It compiles in memory only | Use `tsc` to emit files |
| "If ts-node runs, types are fine" | Lazy/transpile-only skips checks | `tsc --noEmit` is authoritative |
| "ts-node is faster than tsc" | It does tsc's work plus runs | It's one-step, not less work |
| "Just use ts-node in prod, it's fine" | Cold-start cost, deps, non-determinism | Compile and run `node dist` |
| "tsx type-checks for me" | tsx (esbuild) never type-checks | Pair with `tsc --noEmit` |
| "Native stripping replaces tsc" | Stripping never checks types | tsc still gates safety |

---

## Final Self-Test

Answer these from memory before an interview:

1. Two ways to run a `.ts` file, and what each writes to disk.
2. The exact reason ESM imports need `.js` extensions.
3. The four reasons never to ship `ts-node` to production.
4. Where type checking should live and why not inside the runner.
5. How `require.extensions` and ESM loader hooks differ.
6. What native stripping can and cannot do, by Node version.
7. The fastest dev-loop options and their shared caveat (no type checking).

---

## Term Glossary (Interview Vocabulary)

Interviewers expect precise vocabulary. Be ready to define each crisply.

| Term | One-line definition |
|------|---------------------|
| In-memory compilation | Compiling source to JS in RAM and handing it to the runtime without writing files |
| Register hook | A function installed into Node's loader so a non-JS extension can be compiled on load |
| `require.extensions` | The CommonJS map from file extension to a compile handler (how the CJS hook works) |
| Loader hooks | The ESM `resolve`/`load` functions that customize module resolution and loading |
| Transpile-only | Strip types and downlevel syntax with no type checking |
| Type stripping | Erasing type-only syntax spans, the minimal form of transpilation (native Node) |
| `format` field | The value a loader returns telling Node whether output is `module` or `commonjs` |
| Source map | A mapping from generated JS positions back to original `.ts` positions |
| `isolatedModules` | A tsconfig flag ensuring each file compiles independently (per-file transpilers) |
| `erasableSyntaxOnly` | A tsconfig flag banning non-erasable syntax so native stripping works |
| `verbatimModuleSyntax` | A tsconfig flag that preserves import/export syntax verbatim, aiding ESM correctness |

---

## Pair-Programming Prompts

Interviewers may ask you to think aloud while configuring. Practice narrating these.

**P1: "Add ts-node to this repo so `npm run seed` works."**
> Install `ts-node typescript @types/node` as dev deps, add `"seed": "ts-node scripts/seed.ts"`, confirm a `tsconfig.json` exists. If the project is ESM, either add `--esm` and fix import extensions, or add a `tsconfig.scripts.json` with `module: CommonJS` and run `-P tsconfig.scripts.json`.

**P2: "Make this slow seed script start faster."**
> Add `--transpile-only` (or `--swc` after installing `@swc/core`), and turn on `skipLibCheck`. Move the type guarantee to a separate `tsc --noEmit`. Measure before/after with `hyperfine`.

**P3: "Tests fail with `Unexpected token ':'` under Mocha."**
> Mocha launches `node`, which can't parse TS. Add `"require": "ts-node/register"` and `"extensions": ["ts"]` to `.mocharc.json`. Optionally use `--transpile-only` for speed.

**P4: "Stack traces show compiled line numbers."**
> Ensure inline source maps are on and `source-map-support` is installed (default with `ts-node`). Check that no custom `compilerOptions` disabled `sourceMap`/`inlineSourceMap`. For VS Code, launch with `-r ts-node/register`.

**P5: "We're moving to `"type": "module"` — what breaks and how do we fix it?"**
> CJS hooks (`-r ts-node/register`) stop working for the entry; switch to `--esm`/`--import ts-node/register/esm`. Add `.js` extensions to relative imports. Replace `__dirname`/`require` with `import.meta.url`/`createRequire`. Consider `tsx` to sidestep most of this.

---

## Code-Reading Questions

You are shown a snippet and asked "what happens?"

**C1:**
```bash
ts-node --transpile-only -e 'const x: string = 42; console.log(x)'
```
> Prints `42`. Transpile-only never checks types, so the obviously-wrong annotation is ignored; the value runs as-is.

**C2:**
```bash
node src/app.ts   # Node 18, plain
```
> `SyntaxError: Unexpected token ':'` — Node 18 has no native TS support and no hook is installed.

**C3:**
```bash
node src/app.ts   # Node 23.8
```
> Runs, if `app.ts` uses only erasable syntax. Native stripping is on by default in 23.6+. If it contains an `enum`, it errors unless `--experimental-transform-types` is set.

**C4:**
```json
{ "type": "module" }
```
```typescript
import { x } from "./mod";   // no extension
```
> `ERR_MODULE_NOT_FOUND` under ESM. Add `./mod.js`.

**C5:**
```typescript
const enum E { A }   // compiled with ts-node --swc
console.log(E.A);
```
> May error or log `undefined` — swc cannot inline `const enum` across files. Use a regular enum or `as const`.

---

## Behavioral / Process Questions

**B1: How do you onboard a new engineer to a repo that uses ts-node for scripts but tsc for prod?**
> Document the four commands (dev, typecheck, build, start), explain that `ts-node` is dev-only, point them at the `tsconfig.scripts.json` rationale, and show the CI gate. The key cultural message: "running clean under ts-node does not mean your types are clean — `tsc --noEmit` is the truth."

**B2: A junior keeps adding `as any` to make `ts-node` run. What feedback do you give?**
> `as any` silences the checker but hides real bugs that will surface at runtime. In code review, require a runtime validation (e.g. a schema parse) instead of a cast at trust boundaries, and reserve `as` for cases backed by a preceding narrowing check.

**B3: How do you prevent the "stale .js shadows .ts" class of bug across a team?**
> Gitignore all emitted output, never commit `.js` next to sources, run builds into a dedicated `dist`/`.scripts-dist` directory, and optionally set `preferTsExts`. Add a CI check that fails if compiled output is committed alongside source.

**B4: When would you push back on adopting Bun org-wide despite its speed?**
> When services depend on Node-specific APIs or deployment targets that Bun doesn't fully support, when behavioral differences create risk, or when the speed need is satisfied more cheaply by `tsx`/native stripping. Speed of TS execution alone rarely justifies a full runtime migration.

---

## One-Sentence Summaries to Memorize

- `ts-node` runs `.ts` by compiling in memory and hooking Node's module loader.
- Default mode type-checks; `--transpile-only`/`--swc` trade safety for speed.
- ESM needs `--esm`/`--import` and `.js` extensions on relative imports.
- `tsx`, `@swc-node`, and native stripping are faster runners that never type-check.
- Native Node stripping: flagged in 22.6+, default in 23.6+, transforms (enums) need `--experimental-transform-types`.
- Type safety belongs in one authoritative `tsc --noEmit`/`tsc -b` CI gate.
- Never ship `ts-node` to production — compile with `tsc`, run `node dist`.
- Keep code `erasableSyntaxOnly`/`isolatedModules`-clean for portability across runners.

---

## Interviewer Red Flags (What Weak Candidates Say)

- "ts-node is the production runtime for TypeScript." (No — it's dev-only.)
- "It compiles to a dist folder." (No — in memory.)
- "If it runs, my types are correct." (Only in default mode, and even then only for imported files.)
- "ESM just works the same as CommonJS." (No — extensions, loaders, and `__dirname` differ.)
- "tsx and swc type-check for you." (No — they only transpile.)

Strong candidates instead separate *running* from *checking*, name the right tool per environment, and can explain the loader-hook mechanism at least at a high level.

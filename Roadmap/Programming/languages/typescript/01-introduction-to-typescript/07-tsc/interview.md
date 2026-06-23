# tsc — Interview Questions

> 25+ questions across junior, middle, senior, and professional/deep-dive levels. Each has a concise model answer plus, where useful, a code or shell snippet.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Scenario Questions](#scenario-questions)
7. [How to Approach tsc Questions in an Interview](#how-to-approach-tsc-questions-in-an-interview)

---

## How to Approach tsc Questions in an Interview

Before the questions, a quick framing that interviewers look for. When asked anything about `tsc`, strong candidates consistently separate **two responsibilities** in their answer:

1. **Type checking** — the correctness verdict, surfaced as `TSxxxx` diagnostics and an exit code.
2. **Emitting** — turning TypeScript into JavaScript (and optionally `.d.ts`).

A large fraction of `tsc` interview questions are really probing whether you understand that these are independent, that bundlers do the *emit* but never the *check*, and that the *exit code* — not the printed text — is what gates CI. Keep those three ideas in your back pocket; most answers below lean on them.

A second framing that signals seniority: distinguish **modes**. Plain `tsc` (one program), `tsc --watch` (resident, reuses program state), `tsc --incremental` (persists `.tsbuildinfo` so a fresh process skips unchanged work), and `tsc --build` (orchestrates a project-reference graph). Naming the right mode for the situation — and why — is what separates a middle from a senior answer.

---

## Junior Questions

**Q1: What is `tsc` and what two jobs does it do?**

> `tsc` is the TypeScript compiler, shipped by the `typescript` npm package. It does two things: (1) **type checking** — validating your annotations and reporting errors, and (2) **emitting** — stripping TypeScript syntax and writing plain JavaScript that Node/browsers can run.

---

**Q2: What is the difference between `tsc` and `tsc file.ts`?**

> Bare `tsc` reads `tsconfig.json` and compiles the whole project per that config. `tsc file.ts` compiles just that file using **default** options and **ignores** `tsconfig.json` entirely. The second form is a common source of "my outDir/strict settings did nothing" confusion.

---

**Q3: Do TypeScript types exist at runtime?**

> No. Types are erased during emit. The output JavaScript has no annotations, interfaces, or type-only imports. You cannot do `typeof x === "MyInterface"`. Anything you need at runtime must be expressed in real JavaScript (e.g., a discriminant field or a runtime validator).

---

**Q4: What does `tsc --init` do?**

> It generates a starter `tsconfig.json` with sensible defaults and many commented-out options you can enable later. It is the standard way to bootstrap a new project's config.

---

**Q5: What does `tsc --watch` (`-w`) do?**

> It keeps `tsc` running and recompiles incrementally whenever a watched file changes, printing new errors immediately. It reuses the previous program state, so rebuilds after the first are fast.

```bash
tsc --watch
# [..] Found 0 errors. Watching for file changes.
```

---

**Q6: What is `--noEmit` for?**

> It runs a full type check but writes no output files. It is used when another tool (Vite/esbuild/swc) does the JavaScript emit and you only want `tsc` to be the type checker — most commonly as a CI gate.

---

**Q7: Where does `tsc --outDir dist` put the compiled files?**

> Into `dist/`, mirroring the structure of inputs relative to `rootDir`. Without `outDir`, `.js` files land next to your `.ts` files.

---

## Middle Questions

**Q8: Does running esbuild/Vite/swc type-check your code?**

> No. Those tools only **strip** types; they never check them. Your build can succeed with type errors present. That is why `tsc --noEmit` must be a separate, mandatory step — it is the only thing actually verifying types.

---

**Q9: How does `tsc` signal failure to a CI pipeline?**

> Through the process **exit code**, not the printed text. `0` = clean, `2` = type errors were reported. A non-zero code fails the CI job automatically. Never mask it with `|| true`.

```bash
tsc --noEmit; echo $?   # 2 means errors
```

---

**Q10: What is the difference between `--noEmit` and `--noEmitOnError`?**

> `--noEmit` never writes output (pure check). `--noEmitOnError` writes output normally **unless** an error occurred, in which case it suppresses emit so you never ship broken JS.

---

**Q11: Walk through reading a nested `TS2322` error.**

> Read top-to-bottom. The outer line states the two whole types don't match; each indented line drills into the specific incompatible property until the deepest line shows the primitive mismatch (e.g., `number` not assignable to `string`). The deepest line is usually where you fix it.

---

**Q12: What do `--listFiles` and `--explainFiles` show?**

> `--listFiles` prints every file in the compilation, including `node_modules` `.d.ts` and `lib` files. `--explainFiles` additionally prints *why* each file was included (matched by an include glob, pulled in as a type library, imported by another file). Both are key for debugging "why is this file being compiled?".

---

**Q13: What does `--showConfig` print and when do you use it?**

> The fully-resolved config after all `extends` are merged and defaults applied. Use it when an option "isn't taking effect" — it shows what `tsc` actually believes the configuration to be.

---

**Q14: How do you use a non-default config file?**

> `tsc -p path/to/tsconfig.json` (or a directory containing one). You cannot combine `-p` with explicit file arguments.

---

**Q15: What does `--pretty false` change?**

> Only the *formatting* — it disables colors and the caret/underline display, producing the machine-friendly `file(line,col): error TSxxxx:` form. The error codes and messages are identical. CI logs and parsers usually prefer non-pretty output.

---

## Senior Questions

**Q16: What does `tsc --build` (`-b`) add over plain `tsc`?**

> Build mode orchestrates a graph of project references. It topologically sorts the referenced projects, determines which are out of date (via timestamps and per-project `.tsbuildinfo`), and rebuilds only those — checking downstream projects against upstream **`.d.ts`** rather than upstream source. Plain `tsc` only compiles a single program and does not honor the reference graph.

---

**Q17: What does `composite: true` require and enable?**

> It enables a project to participate in `--build`. It forces `declaration: true` (so dependents can check against `.d.ts`) and writes a `.tsbuildinfo`. It is incompatible with `noEmit`.

---

**Q18: How do project references speed up a monorepo build?**

> Each package is an independently-checkable program with its own incremental cache. A change in one package only invalidates that package and its dependents; unrelated packages are skipped. Downstream packages check against compiled `.d.ts` (fast) instead of re-processing upstream source. CI can cache each `.tsbuildinfo` for near-instant warm builds.

---

**Q19: What is `.tsbuildinfo` and why is it safe to cache in CI?**

> It is the persisted incremental state: file versions, per-file `.d.ts` signatures, the reference graph, the exact compiler options, and cached diagnostics. On the next run `tsc` validates the stored options and file versions; any mismatch invalidates the relevant entries. So a stale cache can only cause *redundant rebuilding*, never *wrong results* — making it safe to cache aggressively.

---

**Q20: How would you diagnose a slow `tsc` build?**

> Start with `--diagnostics` to see which phase dominates (usually **Check time**). Then `--extendedDiagnostics` for instantiation counts and cache sizes — a huge `Instantiations` number points at expensive generics. Finally `--generateTrace traceDir` and `npx @typescript/analyze-trace traceDir` to pinpoint the exact expression and type costing the most milliseconds.

---

**Q21: Describe the recommended split between `tsc` and a bundler.**

> Let the bundler (esbuild/swc/Vite) transpile/bundle JS because it is far faster and only needs to strip types. Use `tsc` as the dedicated type checker (`--noEmit`) and as the `.d.ts` generator for libraries. Enable `isolatedModules` and `verbatimModuleSyntax` so single-file transpilers stay correct.

---

**Q22: Why might you keep app packages non-composite but libraries composite?**

> Libraries must emit `.d.ts` for consumers, so they are `composite`. App leaves are bundler-built and often use `noEmit`, which is incompatible with `composite`. So apps stay non-composite and are checked with `tsc --noEmit`, while libraries are composite and part of the `--build` graph.

---

## Professional / Deep-Dive Questions

**Q23: Walk through the tsc pipeline from source to output.**

> Scanner → tokens; Parser → AST (`SourceFile` nodes); Binder → symbol table + control-flow graph (no types yet); Type Checker → lazily computes types, runs assignability/inference/narrowing, emits diagnostics; Transformers + Emitter → lower the AST (down-level target, module form, JSX, erase types) and print `.js`, `.js.map`, and `.d.ts`. The checker is the dominant cost.

---

**Q24: How does watch mode reuse program state?**

> It holds the previous `Program`. On change, it reuses unchanged `SourceFile`s verbatim (no re-scan/parse/bind), re-parses/binds the changed files (often incrementally), and re-checks only the *affected set* — files whose meaning could have changed because of the edit. The cold start is expensive; subsequent passes touch a small set.

---

**Q25: How does incremental invalidation decide whether dependents must re-check?**

> Via the file's emitted `.d.ts` **signature**. If you edit a function body but not its signature, the `.d.ts` signature is unchanged, so dependents are skipped. If you change a signature (parameters, return type), the signature changes and dependents are invalidated and re-checked.

```typescript
// body-only edit -> dependents NOT re-checked
export function area(r: number): number { return 3.14159 * r * r; }
// signature edit  -> dependents re-checked
export function area(r: number): string { /* ... */ }
```

---

**Q26: What is inside `.tsbuildinfo`?**

> A file-names list; per-file version + signature info; the resolved `compilerOptions`; the reference/exported-modules maps (dependency graph); per-file cached semantic diagnostics; and bookkeeping for affected files. The options and versions act as cache-validity gates.

---

**Q27: What does `--generateTrace` produce and how do you read it?**

> `trace.json` (a Chrome-tracing event log of `createProgram`, `bindSourceFile`, `checkSourceFile`, `structuredTypeRelatedTo`, `instantiateType`, etc.) and `types.json` (type metadata). Load `trace.json` in `chrome://tracing`/Perfetto, or run `@typescript/analyze-trace` to get a ranked, human-readable hot-spot list correlated with type names.

---

**Q28: Why is the type checker usually the bottleneck, not the emitter?**

> Emit is roughly linear in code size. Type checking involves recursive structural assignability and generic instantiation, which can fan out enormously for deep conditional/mapped types and large unions. Caches help, but cache-hostile patterns (fresh complex types per call site, deep recursion) blow up `Instantiations` and `Check time`.

---

## Rapid-Fire Round

**Q29: Exit code for type errors?** → `2`.

**Q30: Flag to skip checking node_modules `.d.ts`?** → `skipLibCheck`.

**Q31: Flag to print all compiler options?** → `--all`.

**Q32: Build-mode flag to preview without building?** → `--build --dry`.

**Q33: Build-mode flag to delete outputs?** → `--build --clean`.

**Q34: Option that makes `arr[i]` return `T | undefined`?** → `noUncheckedIndexedAccess`.

**Q35: Option replacing `importsNotUsedAsValues` + `preserveValueImports`?** → `verbatimModuleSyntax`.

**Q36: Error code for a reference cycle?** → `TS6202`.

**Q37: Error code for "type instantiation excessively deep"?** → `TS2589`.

**Q38: Flag to see why each project rebuilds in build mode?** → `--build --verbose`.

**Q38a: Flag to print files emitted by a build?** → `--listEmittedFiles`.

**Q38b: Flag to log module-resolution decisions?** → `--traceResolution`.

**Q38c: Flag to localize diagnostics to Japanese?** → `--locale ja`.

**Q38d: Option that suppresses emit when any error exists?** → `noEmitOnError`.

**Q38e: Exit code for a clean run?** → `0`.

**Q38f: Two files produced by `--generateTrace`?** → `trace.json` and `types.json`.

**Q38g: Counter in `--extendedDiagnostics` that flags expensive generics?** → `Instantiations`.

**Q38h: Phase that usually dominates `--diagnostics`?** → `Check time`.

---

## Scenario Questions

**Q39: CI reports green, but you can see type errors locally. What are the likely causes?**

> (1) CI runs the bundler (`vite build`) which doesn't type-check; (2) CI runs `tsc` but the command is wrapped with `|| true`; (3) CI runs `tsc file.ts` (file argument) which ignores tsconfig and may compile a different/looser set; (4) CI uses a different `typescript` version than local. Fix: run `tsc --noEmit` (or `tsc --build`) with `npm ci`-pinned version and no exit-code masking.

---

**Q40: A teammate set `outDir: "dist"` but `.js` files keep appearing next to sources. Why?**

> They are almost certainly running `tsc src/index.ts` (with a file argument), which ignores `tsconfig.json` and thus `outDir`. Running bare `tsc` (or `tsc -p tsconfig.json`) fixes it.

---

**Q41: Your monorepo full type-check takes 4 minutes in CI. What's your first move?**

> Persist `.tsbuildinfo` between CI runs and switch to `tsc --build`. A restored cache makes most PRs an incremental check of only changed packages. Then measure with `--extendedDiagnostics` and, if needed, `--generateTrace` to attack the worst generic hot spots. Also confirm `skipLibCheck` is on.

---

**Q42: After switching git branches, `tsc --build` says everything is up to date but the output is clearly wrong. What do you do?**

> Build mode keys off timestamps and `.tsbuildinfo`; unusual git operations can leave timestamps inconsistent. Run `tsc --build --clean` then a fresh `tsc --build` (or `--force`) to rebuild from scratch and reconcile state.

---

**Q43: You need `.d.ts` files but want esbuild to emit the JS. How do you configure it?**

> Let esbuild bundle the JS, and run `tsc --emitDeclarationOnly --declaration` (often `--isolatedDeclarations` in TS 5.5+ for speed) to produce just the types. Combine the two in parallel build scripts.

---

**Q44: How do you ensure every file is independently transpilable by esbuild?**

> Enable `isolatedModules: true`. `tsc` will flag constructs that require whole-program type info to transpile correctly (certain `const enum` usages, ambiguous re-exports), and `verbatimModuleSyntax: true` makes import elision explicit so single-file transpilation preserves the right imports.

---

**Q45: A junior runs `tsc` and sees `Found 5 errors` but the `dist/*.js` files were still written. They ask whether the build "passed." How do you explain it?**

> By default `tsc` emits output even when type errors exist — emit success is not the same as type correctness. The build "passed" only in the sense that JS was produced; it did **not** pass type checking. The errors are real and the exit code was non-zero (`2`). If you want emit to be suppressed on errors, set `noEmitOnError: true`. For a pure verdict, run `tsc --noEmit` and check the exit code.

---

**Q46: Why might `tsc --version` work in your shell but `npx tsc` use a different version, and which should CI use?**

> A global install puts `tsc` on `PATH` at whatever version you installed globally; `npx tsc` resolves to the project-local `typescript` in `node_modules` (the version pinned in `package.json`/lockfile). CI must use the **project-local** version (`npm ci` then `npx tsc`) so the compiler matches local development and produces identical diagnostics across machines.

---

**Q47: What is the practical difference between `--listFiles`, `--listEmittedFiles`, and `--explainFiles`?**

> `--listFiles` prints every file *included* in the compilation (sources + `lib` + `@types`). `--listEmittedFiles` prints every file *written* by emit (`.js`/`.d.ts`/maps). `--explainFiles` prints the included files **plus the reason** each one was pulled in (matched an include glob, imported by another file, an implicit type library). Use `--explainFiles` to debug "why is this file in my build?" and `--listEmittedFiles` to verify what was produced.

---

**Q48: How does `--traceResolution` help, and when would you reach for it?**

> `--traceResolution` logs every step the module resolver takes for each import: which directories it probed, which `package.json` `exports`/`types` fields it consulted, and what it ultimately resolved to. You reach for it when you get a `TS2307 Cannot find module` that "should" resolve — it shows exactly where resolution diverged from your expectation (wrong `moduleResolution`, missing `types` field, a path-mapping miss).

---

**Q49: You enabled `incremental: true` but warm builds are not faster. What would you check?**

> First, confirm the `.tsbuildinfo` is actually being written and re-read (correct `tsBuildInfoFile` path, not deleted between runs, not gitignored *and* cleaned in CI). Second, check that compiler options aren't changing between runs — any option change discards the cache. Third, verify the edits aren't signature-level changes that legitimately invalidate many dependents. Use `--diagnostics` to compare cold vs. warm `Check time`.

---

**Q50: In build mode, what does "a project is out of date with upstream" mean?**

> It means one of the project's referenced dependencies was rebuilt and its emitted `.d.ts` (the public type surface) changed, so this project must be re-checked against the new declarations — even though this project's own source did not change. Build mode reports this as `OutOfDateWithUpstream` under `--verbose`. If the upstream `.d.ts` signature were unchanged, the downstream project would stay up to date.

---

**Q51: A type-heavy file triggers `TS2589: Type instantiation is excessively deep and possibly infinite`. What does it indicate and how do you fix it?**

> It indicates a recursive conditional/mapped type whose instantiation depth exceeded the compiler's guard (a safety limit that prevents infinite/runaway type computation). It is both a correctness signal (the type may be effectively infinite) and a performance smell. Fixes: bound the recursion with a depth counter, restructure the type to be tail-recursive (TS 4.5+ supports tail recursion in conditional types), or replace the deep generic with a simpler concrete type or a runtime validator that yields a flat inferred type.

---

**Q52: How would you set a build-time budget and enforce it?**

> Capture a baseline with `tsc --noEmit --diagnostics` (record `Total time` and `Check time`). Add a CI assertion that fails if the measured time exceeds an agreed threshold (e.g., wrap the command, parse `Total time`, compare). Pair it with `--extendedDiagnostics` thresholds on `Instantiations` so a single bad generic that explodes type-checking is caught in review rather than discovered as a slow CI months later. Re-baseline deliberately when the codebase grows.

---

## Worked Whiteboard Questions

These are longer, open-ended prompts where the interviewer wants you to reason out loud. Strong answers walk through trade-offs, not just a single command.

**Q53: Design the TypeScript build for a new monorepo with a shared `ui` library, a `web` app, and an `api` service. Where does `tsc` fit?**

> Make `ui` a **composite** library: `composite: true`, `declaration: true`, `declarationMap: true`, emitting `.d.ts` so `web` and `api` type-check against compiled declarations rather than `ui`'s source. Make `web` and `api` **bundler-built leaves** (Vite for `web`, esbuild for `api`) with `noEmit: true`, `isolatedModules: true`, and `verbatimModuleSyntax: true`, and check them with `tsc --noEmit`. Add a root **solution** `tsconfig.json` with `files: []` that references all three so `tsc --build` drives the graph. In CI, `npm ci`, restore a cached `**/*.tsbuildinfo`, then run `tsc --build --pretty false`. This gives fast bundler emit, a single authoritative type check, shared `.d.ts` for the library, and incremental warm builds. I would keep the reference graph acyclic by routing any shared contracts through a small `types` package rather than letting `ui`, `web`, and `api` cross-reference each other.

**Follow-up: why not just one big `tsconfig.json` for everything?**

> A single program re-checks all files on any change — the invalidation blast radius is the whole repo. References shrink that radius to the changed package plus its dependents, and give each package its own `.tsbuildinfo`, which is what makes warm CI builds near-instant.

---

**Q54: A teammate proposes deleting the `tsc --noEmit` CI step because "Vite already builds the app and the tests pass." How do you respond?**

> Vite (esbuild under the hood) strips types but does not check them, and tests only exercise the code paths they cover — neither validates the full type surface. Removing `tsc --noEmit` removes the *only* thing that verifies types across the entire codebase. A passing Vite build and green tests can coexist with real type errors (an unsafe `as`, a wrong return type on an untested branch, a `null` not handled). I would keep the gate, and if the concern is speed, address that with `skipLibCheck`, incremental + cached `.tsbuildinfo`, or project references — not by deleting the check.

---

**Q55: Explain, end to end, what happens when you save a file in `tsc --watch`.**

> The watcher receives a file-system event for the changed file and invalidates it. The builder constructs a new `Program` from the old one: every unchanged `SourceFile` is reused verbatim (no re-scan, re-parse, or re-bind), the changed file is re-parsed (often incrementally), re-bound, and re-checked. The builder then computes the *affected set* — files whose meaning could have changed because the edit altered the changed file's public surface — and re-checks only those. New diagnostics are printed with their `TSxxxx` codes, and the process stays resident. Because most of the program is shared with the previous compilation, the work is proportional to the affected set, not the whole repo — which is why the first compile is slow and subsequent ones are fast.

---

## Common Mistakes Interviewers Probe

A checklist of misconceptions that frequently surface. Being able to correct each crisply is a strong signal.

| Misconception | Correct understanding |
|---------------|------------------------|
| "TypeScript runs in the browser/Node." | Only the emitted JavaScript runs; types are erased. |
| "If `tsc` emitted JS, the types were fine." | Emit happens even with errors unless `noEmitOnError`. |
| "esbuild/swc/Babel check my types." | They only strip types; `tsc` is the only checker. |
| "`tsc file.ts` uses my tsconfig." | A file argument ignores `tsconfig.json` and uses defaults. |
| "CI passed, so types are correct." | Only true if `tsc --noEmit` ran and its exit code wasn't masked. |
| "`--watch` is fine in CI." | It never exits; use a one-shot `tsc --noEmit`. |
| "Editing a function body re-checks all importers." | Only signature (`.d.ts`) changes ripple to dependents. |
| "A stale `.tsbuildinfo` causes wrong results." | Option/version gating means worst case is redundant work. |
| "`composite` and `noEmit` can be combined." | They are mutually exclusive. |
| "Project references are only about organization." | They primarily shrink invalidation radius and enable per-package caching. |

---

## Deep-Dive Follow-ups (Senior+)

Interviewers often chain a basic question into a deeper one. Here are common chains with model continuations.

**Chain A — from "what is `--noEmit`" to architecture**

> Q: What is `--noEmit`? → A: Type-check only, no files written.
> Q: So how does the app get built? → A: A bundler (Vite/esbuild/swc) emits JS; it strips types but never checks them.
> Q: Then what guarantees type safety? → A: A separate `tsc --noEmit` step, run in CI, whose non-zero exit code gates merges.
> Q: How do you keep that step fast? → A: `skipLibCheck`, incremental with a cached `.tsbuildinfo`, and project references to shrink the invalidation radius; for libraries, `--emitDeclarationOnly` (optionally `--isolatedDeclarations`) for the `.d.ts`.

**Chain B — from "incremental" to internals**

> Q: What does `incremental: true` do? → A: Persists `.tsbuildinfo` so a fresh process skips unchanged work.
> Q: How does it know what's unchanged? → A: It stores per-file versions and the emitted `.d.ts` signature; it compares versions on the next run.
> Q: Why doesn't editing a function body re-check importers? → A: The `.d.ts` signature is unchanged, so dependents aren't invalidated; only signature changes ripple downstream.
> Q: Could a stale `.tsbuildinfo` give wrong results? → A: No — stored `compilerOptions` and versions are validated; a mismatch discards the cache, so the worst case is redundant work.

**Chain C — from "build mode" to graph design**

> Q: What's `tsc --build`? → A: Orchestrates a project-reference DAG, building only stale projects in topological order.
> Q: What does each project need? → A: `composite: true` (implies `declaration`), which is incompatible with `noEmit`.
> Q: How do downstream projects check against upstream? → A: Against the emitted `.d.ts`, not the source — that's the speed win.
> Q: What breaks build mode? → A: A reference cycle (`TS6202`); fix by extracting a shared `contracts`/`types` package to make the graph acyclic.

---

## One-Line Summaries to Memorize

- `tsc` = **type check** + **emit**; the two are independent and should be controlled independently.
- A **file argument** disables `tsconfig.json`; bare `tsc` / `tsc -p` honors it.
- **Bundlers strip, never check** — `tsc --noEmit` is the only type gate.
- The **exit code** (`0` clean, `2` errors) gates CI; never mask it.
- **Watch** reuses program state; **incremental** persists it to `.tsbuildinfo`; **build mode** orchestrates a reference graph.
- Invalidation ripples by **`.d.ts` signature**, so body-only edits are cheap.
- The **checker** is the bottleneck; profile with `--diagnostics` → `--extendedDiagnostics` → `--generateTrace`.

---

## Code-Reading Questions

Interviewers sometimes show a command or config and ask "what happens?" Practice these.

**Q56: What does each line do?**

```bash
tsc --noEmit --pretty false
tsc --build --dry
tsc --showConfig
tsc --noEmit --explainFiles
```

> Line 1: type-check only, with machine-friendly (non-colored) output — the canonical CI gate. Line 2: in build mode, print the build *plan* without writing anything. Line 3: print the fully-resolved config (after `extends` merge + defaults) and exit. Line 4: type-check and print every included file along with the reason it was included.

---

**Q57: This config is for a library. Spot anything notable.**

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

> It is a well-formed composite library config: `composite` lets it participate in `tsc --build`; `declaration` emits `.d.ts` so dependents check against compiled types; `declarationMap` lets consumers' editors jump to the original `src`. `rootDir`/`outDir` keep output isolated. One thing to confirm: a root solution config should `reference` this package, and you'd build with `tsc --build`, not bare `tsc`.

---

**Q58: Why would adding `"noEmit": true` to the config above break the build?**

> `composite: true` requires declaration emit; `noEmit` forbids all emit. They are mutually exclusive and `tsc` errors with `TS5069`. A library that needs `.d.ts` cannot also be `noEmit`. If you wanted check-only behavior for this package, you'd drop `composite` and check it with `tsc --noEmit` separately — but then it can't be a build-mode reference target.

---

## Take-Home / System-Design Style Prompt

**Q59: You're asked to "make the team's TypeScript builds trustworthy and fast" for a 40-person codebase. Outline your plan.**

> **Trustworthy first.** Add a single mandatory CI gate: `npm ci` then `npx tsc --noEmit --pretty false` (or `tsc --build` once references exist). Forbid `|| true`. Pin `typescript` in `package.json`. Enable `strict: true` and `forceConsistentCasingInFileNames`. Make sure the bundler is never mistaken for a type checker — document that esbuild/Vite only strip types.
>
> **Then fast.** Turn on `skipLibCheck` and `incremental`, and cache `**/*.tsbuildinfo` in CI. Audit the file set with `--explainFiles` and exclude tests/fixtures from the build config. As the repo grows, introduce project references (libraries `composite`, apps bundler-built with `noEmit`) and a root solution config so `tsc --build` drives everything. Split JS emit to the bundler and run it in parallel with the type check.
>
> **Then keep it fast.** Establish a build-time budget from a `--diagnostics` baseline; alert on regressions. When a specific slowdown appears, profile with `--extendedDiagnostics` then `--generateTrace`, and fix the worst generic hot spot. Run a nightly cold `tsc --build --force` to catch cache-masked regressions.
>
> The plan sequences correctness before speed deliberately: a fast build that doesn't actually check types is worse than a slow one that does.

---

## Closing Advice

When you don't know an exact flag, **reason from the two responsibilities** (check vs. emit) and the **four modes** (plain, watch, incremental, build). Most `tsc` answers fall out of: "Is this about checking or emitting? Cold or warm? One program or a graph?" Demonstrating that structured thinking impresses more than memorizing every flag name.

A final tip: when an interviewer asks "how would you debug X," narrate the **escalation ladder** — `--showConfig` and `--explainFiles` first (cheap, reveals config/file-set issues), then `--diagnostics`/`--extendedDiagnostics` (find the slow phase), then `--generateTrace` (pinpoint the exact cost). Showing you reach for the cheapest diagnostic first signals real operational experience.

---

## Flag Recall Table (Last-Minute Review)

| Flag | One-line purpose |
|------|------------------|
| `--init` | Scaffold `tsconfig.json` |
| `-p` / `--project` | Use a specific config (no file args allowed) |
| `-w` / `--watch` | Resident recompile-on-change |
| `--noEmit` | Type-check only, write nothing |
| `--noEmitOnError` | Emit unless an error occurred |
| `--emitDeclarationOnly` | Emit only `.d.ts` |
| `--declaration` / `--declarationMap` | Emit types / type source maps |
| `-b` / `--build` | Orchestrate project references |
| `--build --verbose` | Explain rebuild decisions |
| `--build --dry` | Preview build, do nothing |
| `--build --force` | Rebuild all, ignore cache |
| `--build --clean` | Delete all outputs |
| `--incremental` | Persist `.tsbuildinfo` |
| `--skipLibCheck` | Skip checking `.d.ts` files |
| `--pretty false` | Plain (CI-friendly) error format |
| `--showConfig` | Print fully-resolved config |
| `--listFiles` / `--explainFiles` | Files included (+ reasons) |
| `--listEmittedFiles` | Files written by emit |
| `--diagnostics` / `--extendedDiagnostics` | Timing / counters |
| `--generateTrace <dir>` | Profiling trace + types metadata |
| `--traceResolution` | Log module-resolution steps |
| `--locale <code>` | Localize diagnostic text |
| `--noCheck` | (5.6+) emit without full check |
| `--all` | Print every compiler option |

If you can explain *when* you'd reach for each row above and *why*, you are well prepared for any `tsc` interview question across levels.

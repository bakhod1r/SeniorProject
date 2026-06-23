# tsconfig.json — Interview Questions

> 20+ questions across junior, middle, senior, and professional levels.
> Each answer is concise but complete. Practice explaining out loud, not just recognizing the answer.

## Table of Contents

1. [Junior Interview Questions](#junior-interview-questions)
2. [Middle Interview Questions](#middle-interview-questions)
3. [Senior Interview Questions](#senior-interview-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Scenario Questions](#scenario-questions)

---

## Junior Interview Questions

**Q1: What is `tsconfig.json` and what does it do?**

> It is the configuration file for the TypeScript compiler. It tells `tsc` which files to compile (`include`/`exclude`/`files`) and how to compile them (`compilerOptions`). Its presence in a directory marks that directory as a TypeScript project root, and editors, CI, and CLI all read the same file for consistent behavior.

**Q2: Name the main top-level fields of `tsconfig.json`.**

> `compilerOptions`, `include`, `exclude`, `files`, `extends`, `references`, `watchOptions`, and `typeAcquisition`. Everything except `compilerOptions` configures structure and file selection; `compilerOptions` holds the actual compiler flags.

**Q3: What is the difference between `include` and `files`?**

> `include` takes glob patterns (`src/**/*`) that TypeScript expands to discover files. `files` is an explicit list of individual file paths with no globbing. `files` is rarely needed; `include` is the normal approach. Also, `exclude` filters `include` results but never affects `files`.

**Q4: Does `exclude` guarantee a file is never compiled?**

> No. `exclude` only filters the initial file discovery (the root set). If an included file imports an excluded file, the excluded file is still compiled because it is reachable through the module graph.

**Q5: Can `tsconfig.json` contain comments?**

> Yes. TypeScript parses it as JSONC, so `//` line comments, `/* */` block comments, and trailing commas are all allowed. This lets you document each option inline.

**Q6: What does an empty `{}` config do?**

> It is valid. TypeScript applies defaults and compiles every `.ts`/`.tsx`/`.d.ts` file under the project root (excluding `node_modules` and the output directory).

**Q7: How do you create a starter `tsconfig.json`?**

> Run `tsc --init`, which generates a heavily commented config with sensible defaults and explanations for common options.

---

## Middle Interview Questions

**Q8: How does `tsc` find the `tsconfig.json`?**

> With no file arguments, `tsc` looks in the current directory and walks up parent directories until it finds a `tsconfig.json`. You can point at a specific one with `-p`/`--project`. Important: passing file arguments directly (`tsc src/index.ts`) disables config reading entirely.

**Q9: What glob wildcards are supported in `include`/`exclude`?**

> `*` (any characters except path separator), `?` (one character), and `**/` (any directory at any depth). Extension-less globs auto-expand to supported extensions (`.ts`, `.tsx`, `.d.ts`, plus `.js`/`.jsx` if `allowJs`).

**Q10: Explain how `extends` merges configurations.**

> The base config is loaded first, then the child overrides it. `compilerOptions` merge key-by-key (child wins). Arrays like `lib` are **replaced**, not concatenated. `files`/`include`/`exclude` from the child fully replace the base's (if the child defines them). `references` are never inherited.

**Q11: How do you reference a community base config like `@tsconfig/node20`?**

> Install it (`npm i -D @tsconfig/node20`) and set `"extends": "@tsconfig/node20/tsconfig.json"`. No `./` prefix — it resolves as a Node module from `node_modules`. Local files need `./` or `../`.

**Q12: Why split a project into `tsconfig.json` and `tsconfig.build.json`?**

> So the editor type-checks everything (including tests) for a good DX, while the production build emits only `src` and excludes tests from `dist`. Both extend a shared base to avoid duplication.

**Q13: What does `noEmit: true` mean and when do you use it?**

> It tells `tsc` to type-check but produce no output files. You use it when a bundler (Vite, esbuild, webpack) handles transpilation and you only want TypeScript as a type-checker, typically in CI as `tsc --noEmit`.

**Q14: What's the relationship between `rootDir` and `outDir`?**

> `rootDir` defines the base of your source tree; `outDir` is where compiled output goes. TypeScript mirrors the directory structure from `rootDir` into `outDir`. If `rootDir` is `src` and a file is `src/api/user.ts`, the output is `dist/api/user.js`.

---

## Senior Interview Questions

**Q15: What are project references and why do they speed up monorepo builds?**

> Project references let you split a repo into independent TS projects with declared dependencies via `references`. Each referenced project sets `composite: true`, emits `.d.ts`, and writes a `.tsbuildinfo`. Downstream projects type-check against the cheap `.d.ts` declarations rather than re-processing upstream source. `tsc -b` builds them in dependency order and skips up-to-date projects.

**Q16: What does `composite: true` require and imply?**

> It implies `declaration: true` and enables incremental `.tsbuildinfo` output, marking the project as referenceable. It requires that every input file be listed by `include`/`files`, and typically a `rootDir`. Stray files cause "not listed in project" errors.

**Q17: Difference between `tsc` and `tsc -b`?**

> Plain `tsc` compiles a single project and does not follow `references`; it expects referenced outputs to already exist. `tsc -b` (build mode) understands references, topologically orders projects, performs up-to-date checks, and incrementally builds only what changed. In a references repo you must use `tsc -b`.

**Q18: How does incremental rebuilding decide what to rebuild?**

> Via `.tsbuildinfo`, which stores per-file content hashes and `.d.ts` signatures plus the import graph. A changed file is rebuilt; dependents are rebuilt only if the changed file's public `.d.ts` signature changed. Editing a function body without changing its type doesn't cascade. Changing compiler options or the TS version invalidates the whole cache.

**Q19: What is a "solution-style" root config?**

> A root `tsconfig.json` with `"files": []` and only `references`. It compiles nothing itself; running `tsc -b` at the root builds every referenced project in order. It is the idiomatic monorepo build entry point.

**Q20: How should `paths`/`baseUrl` be handled in a monorepo, and what's the catch?**

> `paths`/`baseUrl` only affect TypeScript's *type* resolution — they do not rewrite emitted import specifiers. So a matching runtime/bundler alias is required, or imports break at runtime. In references monorepos, prefer real package names via workspaces (which give correct build order and runtime resolution) over `paths`.

**Q21: Why might you set `declarationMap: true`?**

> It emits `.d.ts.map` files so that "Go to Definition" across package boundaries jumps to the original `.ts` source instead of the generated `.d.ts`. A big DX win in monorepos.

---

## Professional / Deep-Dive Questions

**Q22: Walk through how `tsc` turns a tsconfig.json on disk into a compilation.**

> Locate config (walk up dirs unless `-p`/files given) → parse as JSONC into a JSON AST → convert to object → resolve and merge `extends` recursively → normalize options (string enums to internal enums), apply defaults, compute implied options → expand `include`/`exclude`/`files` into a concrete `fileNames` list → build the `Program`, during which module resolution may add more files reachable by imports.

**Q23: What exactly is stored in `.tsbuildinfo`?**

> A serialized program state: a file-name table, per-file content hashes (`version`) and `.d.ts` signatures, the import/reference graph (`referencedMap`), cached semantic diagnostics, the compiler options used, and the TypeScript version that wrote it. Option or version mismatches invalidate it entirely.

**Q24: Why are comments allowed in `tsconfig.json` when it ends in `.json`?**

> Because TypeScript parses it with its own scanner/parser (JSONC), not `JSON.parse`. The parser preserves node positions so diagnostics can point at exact lines.

**Q25: How does the up-to-date check in `tsc -b` work?**

> For each project: if no `.tsbuildinfo`, or the TS version differs, or options changed, or any input file is newer than the build info, or a referenced project has newer `.d.ts` output, or outputs are missing/older than inputs → rebuild. Otherwise skip. `tsc -b --verbose` prints the reason per project.

**Q26: What's the single best command to debug "why is this file in/out of my build"?**

> `tsc --showConfig` — it prints the fully resolved config after `extends` merging and glob expansion, including the concrete `files` list. It is the authoritative view of what the compiler actually sees.

**Q27: How do default excludes behave when you specify your own `exclude`?**

> The default excludes (`node_modules`, `bower_components`, `jspm_packages`) apply only when you do not provide your own `exclude`. If you set a custom `exclude`, it replaces those defaults — except `outDir`, which is always excluded. So a custom `exclude` should typically re-list `node_modules`.

---

## Rapid-Fire Round

| Question | Answer |
|----------|--------|
| Field for inheritance? | `extends` |
| Field for monorepo deps? | `references` |
| Build all references? | `tsc -b` |
| Type-check only? | `noEmit: true` |
| Skip node_modules .d.ts checking? | `skipLibCheck: true` |
| Implies `declaration`? | `composite: true` |
| Incremental cache file? | `.tsbuildinfo` |
| Emit `.d.ts`? | `declaration: true` |
| Master strictness switch? | `strict: true` |
| Output folder option? | `outDir` |
| Show resolved config? | `tsc --showConfig` |
| Array `extends` since? | TypeScript 5.0 |
| `paths` affects runtime? | No — type-only |
| Default include if none set? | `**/*` |
| Does `exclude` stop imported files? | No |

---

## Scenario Questions

**S1: A teammate says "I excluded `legacy.ts` but it's still in `dist`." What happened?**

> Some included file imports `legacy.ts`. `exclude` only filters root discovery, not the import graph. Either remove the import or restructure so excluded files aren't referenced.

**S2: CI passes but the editor shows type errors (or vice versa). Why?**

> The editor and CI are likely using different configs. The editor picks the nearest `tsconfig.json` to the open file; CI may run `tsc -p tsconfig.build.json`. Align them (shared base, consistent `include`), and use `--showConfig` to compare.

**S3: After upgrading TypeScript, the first CI build is slow even with caching. Why?**

> `.tsbuildinfo` records the TS version. A version change invalidates all incremental caches, forcing a full rebuild. Bust the CI cache key on TS version bumps; subsequent runs are fast again.

**S4: You added `"lib": ["DOM"]` to a child config and lost all your ES2022 types. Fix?**

> Arrays are replaced, not merged, across `extends`. Restate the full array: `"lib": ["ES2022", "DOM", "DOM.Iterable"]`.

**S5: `tsc` reports "File is not listed within the file list of project." What's wrong?**

> A `composite` project has an input file not covered by `include`/`files`. Composite projects must list all their files. Widen `include` to cover the file (e.g., `["src"]`) or add it to `files`.

**S6: You run `tsc src/index.ts` and none of your config's strict settings apply. Why?**

> Passing files directly disables `tsconfig.json` reading entirely. Use `tsc` (no args) or `tsc -p tsconfig.json` so the config is honored.

**S7: A monorepo build rebuilds every package on every CI run. How do you investigate?**

> Run `tsc -b --verbose` to see the per-project rebuild reasons. Common causes: `.tsbuildinfo` not cached between runs, compiler options changing per run, or a TS version mismatch. Cache `.tsbuildinfo` + `dist` keyed on source + tsconfig + TS version.

**S8: How would you onboard `strict` mode incrementally on a huge legacy repo?**

> Add `strict: false` plus individual flags (`noImplicitAny`, then `strictNullChecks`) one at a time in a base config, fixing errors per flag. Or scope strictness per-package via separate configs that extend a stricter base only where the team is ready. The goal is one base config that ratchets strictness upward over time.

---

> Practice tip: for each answer, be ready to back it with a concrete `tsconfig.json` snippet or a `tsc` command. Interviewers value the ability to show, not just tell.

---

## Extended Q&A — Configuration Mechanics

**Q28: What is the difference between `module` and `moduleResolution`?**

> `module` controls the **module format of the emitted JavaScript** (e.g., `CommonJS` produces `require`/`module.exports`, `ESNext` produces `import`/`export`). `moduleResolution` controls **how the compiler finds imported modules** at type-check time (e.g., `Node10`, `Node16`, `NodeNext`, `Bundler`). They are related but distinct: one is about output, the other about resolution. Modern settings often pair `module: "NodeNext"` with `moduleResolution: "NodeNext"`.

**Q29: When would you use `moduleResolution: "bundler"`?**

> When a bundler (Vite, esbuild, webpack, Parcel) handles the actual module loading. `Bundler` resolution (TS 5.0+) mirrors how bundlers resolve imports — it allows extensionless imports and `package.json` `exports` resolution without forcing Node's strict ESM rules. It pairs with `noEmit: true` because the bundler, not `tsc`, produces output.

**Q30: What does `esModuleInterop` actually do?**

> It changes how default imports of CommonJS modules are emitted and typed. Without it, `import express from "express"` may fail because CommonJS modules have no real default export. With `esModuleInterop`, TypeScript emits interop helpers (`__importDefault`) so the import behaves intuitively, and it implies `allowSyntheticDefaultImports` for the type side.

**Q31: How do `typeRoots` and `types` differ?**

> `typeRoots` lists the **folders** scanned for declaration packages (default: `./node_modules/@types`). `types` lists the **specific packages** from those roots whose global declarations are included. Setting `types: ["node"]` means only `@types/node` globals load, even if other `@types/*` packages are installed.

**Q32: Why might a project set `forceConsistentCasingInFileNames`?**

> To prevent bugs where an import works on case-insensitive filesystems (macOS, Windows) but breaks on case-sensitive ones (Linux/CI). With the flag on, `import "./User"` and `import "./user"` referring to the same file is an error. It is part of `strict` family hygiene in cross-platform teams. (It defaults to `true` in recent TypeScript versions.)

**Q33: What is `resolveJsonModule` and how does it interact with `include`?**

> It lets you `import data from "./config.json"` with the JSON typed by its contents. When enabled, `.json` files become valid module inputs; extension-less `include` globs will also match `.json` when appropriate. Without it, importing JSON is a type error.

---

## Extended Q&A — Project References Depth

**Q34: Walk me through setting up project references from scratch.**

> 1) Create a `tsconfig.base.json` with shared options and `composite: true`. 2) In each package's `tsconfig.json`, extend the base, set `outDir`/`rootDir`, and add `references` to its dependencies. 3) Add a root `tsconfig.json` with `"files": []` and `references` to all packages. 4) Replace `tsc` with `tsc -b` everywhere (CI, scripts). 5) gitignore `*.tsbuildinfo` and `dist`. 6) Ensure cross-package imports go through real package names or declared references, not direct source paths.

**Q35: What error tells you a composite project is missing files, and how do you fix it?**

> `TS6307: File '...' is not listed within the file list of project`. Composite projects must include every input file. Fix by using an `include` glob (`["src"]`) instead of a partial `files` list, or by adding the missing file to `files`.

**Q36: Can two project references depend on each other?**

> No — circular references are forbidden and `tsc -b` errors on them. The standard fix is to extract the shared pieces (usually shared types) into a third, leaf-level package that both depend on, breaking the cycle.

**Q37: What does `prepend` do in a reference, and why is it rarely used?**

> `{ "path": "...", "prepend": true }` prepends the referenced project's output into the current project's output file. It only works with `outFile` (single-file output), which is itself a legacy/AMD-era feature. Modern module-based projects don't use `outFile`, so `prepend` is effectively obsolete.

---

## Extended Q&A — Build & Cache Internals

**Q38: What is the `version` field inside `.tsbuildinfo` and why does it matter?**

> It records the TypeScript compiler version that wrote the cache. On the next build, if the running `tsc` version differs, the cache is discarded and a full rebuild occurs. This is why upgrading TypeScript makes the first CI build slow, and why you should include the TS version in CI cache keys.

**Q39: If you `touch` a source file without editing it, what happens on `tsc -b`?**

> The file's modification timestamp is newer than the build info, so the **owning project** is considered stale and rebuilt. However, because the file's content hash and `.d.ts` signature are unchanged, **dependent projects** are not rebuilt. Timestamp affects the local project; signature affects downstream.

**Q40: How would you debug "the whole monorepo rebuilds on every CI run"?**

> Run `tsc -b --verbose` to see the per-project rebuild reason. Common causes: (a) `.tsbuildinfo` not cached/restored between CI runs, (b) compiler options differing per run (e.g., an env-injected flag), (c) a TypeScript version mismatch, or (d) timestamps changing due to a fresh checkout. Fix by caching `.tsbuildinfo` + `dist` keyed on source + tsconfig + TS version.

**Q41: Why does `tsc --showConfig` sometimes list files you didn't expect?**

> Because it shows the **resolved** file set after `extends` merge and glob expansion. If `include` defaults to `**/*` (because neither `files` nor `include` is set), or a glob is broader than intended, extra files appear. It does NOT show import-reachable files — those are added later during program construction, which is a separate source of "surprise" compilation.

---

## Extended Q&A — Real-World Judgment

**Q42: A junior sets `strict: false` to make errors go away before a deadline. What's your guidance?**

> Disabling `strict` repo-wide trades long-term safety for a short-term unblock and tends to be permanent. Better: keep `strict: true` and silence the specific failing spots with narrow, commented suppressions, or ratchet individual strict sub-flags. If strictness truly must be relaxed, scope it to one package via a config, with a tracked plan to re-enable.

**Q43: How do you keep the editor and CI in perfect agreement?**

> Use a single shared base config (`tsconfig.base.json`) that both the editor config and the CI/build config extend. Keep `include` consistent. Run the same `tsc -b`/`tsc --noEmit` locally as in CI. When they disagree, `tsc --showConfig` from each entry config reveals the difference.

**Q44: When is a single flat `tsconfig.json` the right choice over project references?**

> For small-to-medium single-package projects (apps or libraries) where build time is already fast and there's no need to publish independent packages or parallelize builds. References add real setup and maintenance cost; only adopt them when build time, package boundaries, or independent versioning justify it.

**Q45: How would you incrementally adopt project references in an existing repo?**

> Identify clear package boundaries, extract a shared base config, add `composite`/`declaration` per package, declare `references`, add a `files: []` solution root, switch CI to `tsc -b`, then cache `.tsbuildinfo`. Break any circular dependencies by extracting shared types. Do it package-by-package, verifying builds at each step.

---

## Mixed Difficulty Drill

Answer each in one sentence, then expand if asked.

1. Where does `include` live? *(top level)*
2. What does `composite` imply? *(`declaration` + incremental)*
3. Which command builds references? *(`tsc -b`)*
4. Are arrays merged across `extends`? *(no — replaced)*
5. Does `paths` change runtime resolution? *(no — type-only)*
6. What invalidates `.tsbuildinfo` fully? *(option or TS-version change)*
7. What does `noEmit` do? *(type-check only, no output)*
8. Does `exclude` stop imported files? *(no)*
9. How is `tsconfig.json` parsed? *(as JSONC)*
10. What is a solution-style root? *(`files: []` + `references`)*

---

> Practice tip 2: many interviewers probe the **"exclude doesn't stop imports"** and **"arrays replace, not merge"** facts because they catch even experienced developers. Internalize both with a concrete example you can draw on a whiteboard.

---

## Whiteboard Challenges

These ask you to *produce* config, not just describe it.

**WB1: Write a tsconfig for a Node 20 ESM library that publishes types.**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```
> Talk through: `declaration` for consumers, `NodeNext` for ESM, separate `outDir`, test exclusion.

**WB2: Write the three configs for a base + build + test split.**

```json
// tsconfig.base.json
{ "compilerOptions": { "strict": true, "target": "ES2022", "esModuleInterop": true, "skipLibCheck": true } }
```
```json
// tsconfig.json (editor)
{ "extends": "./tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }
```
```json
// tsconfig.build.json
{ "extends": "./tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"], "exclude": ["**/*.test.ts"] }
```

**WB3: Write a solution root + two referenced packages.**

```json
// tsconfig.json (root)
{ "files": [], "references": [{ "path": "packages/core" }, { "path": "packages/app" }] }
```
```json
// packages/core/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```
```json
// packages/app/tsconfig.json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "composite": true, "outDir": "dist", "rootDir": "src" }, "references": [{ "path": "../core" }], "include": ["src"] }
```

---

## "Explain This Output" Questions

**EO1: What does `tsc --showConfig` give you that reading the file doesn't?**

> The fully resolved view: merged `compilerOptions` from all `extends` layers, defaults applied, string enums shown, and the concrete expanded `files` list. It answers "what does the compiler actually see?" after all inheritance and globbing.

**EO2: `tsc -b --verbose` prints "Project 'core' is up to date because newest input is older than oldest output." Interpret it.**

> The builder compared input file timestamps to output timestamps and the `.tsbuildinfo`, found nothing newer than the last build, and skipped `core`. This is the normal "skip" message — it confirms incremental caching is working.

**EO3: You see `error TS6306: Referenced project '...' must have setting "composite": true.` What's the fix?**

> A project listed in `references` is not composite. Add `"composite": true` to that referenced project's `compilerOptions` (which also implies `declaration`).

---

## Anti-Pattern Spotting

For each snippet, state what's wrong.

| Snippet | Problem |
|---------|---------|
| `{ "compilerOptions": { "include": ["src"] } }` | `include` misplaced inside `compilerOptions` |
| `{ "extends": "base.json" }` | Missing `./` for a local file |
| `{ "compilerOptions": { "outDir": "src" } }` | Output overlaps source |
| `tsc src/index.ts` (expecting config) | Files on CLI bypass `tsconfig.json` |
| `tsc` at a `files: []` root | Need `tsc -b` for references |
| child `lib: ["DOM"]` over base `["ES2022"]` | Array replaced; ES2022 lost |
| `paths` set, no runtime alias | Type-only; breaks at runtime |

---

> Closing advice: in interviews, when unsure, narrate your debugging approach — "I'd run
> `tsc --showConfig` to confirm the file set, then `--explainFiles` to see why a file is included."
> Demonstrating a systematic process scores as well as knowing the answer outright.

---

## Deep Follow-Up Q&A

**Q46: A candidate says "`tsc` reads `tsconfig.json` no matter how you call it." Correct them.**

> That's false. If you pass file arguments (`tsc src/a.ts`), `tsc` ignores `tsconfig.json` entirely and uses only CLI flags. The config is read only when you run `tsc` with no files (it searches up the tree) or `tsc -p <config>`.

**Q47: Why is `composite` required on referenced projects, conceptually?**

> Because a referenced project must publish a stable, declared type surface (`.d.ts`) that dependents consume instead of its source, and it must keep incremental state so the build graph can determine staleness. `composite` bundles those requirements: it forces `declaration` output and enables `.tsbuildinfo`, and it requires the project to list all its files so the graph is complete.

**Q48: What's the practical difference between `incremental` and `composite`?**

> `incremental` alone gives you `.tsbuildinfo`-based fast rebuilds for a single project. `composite` is a superset for the references world: it implies `incremental` + `declaration` and marks the project as referenceable by others. Use `incremental` for a standalone project; use `composite` for a project that participates in `references`.

**Q49: How would you let a TypeScript app and a Jest/Vitest setup share types but build differently?**

> One `tsconfig.base.json` with shared strictness/target. The app build config extends it and emits to `dist` excluding tests. A test config extends it, sets `noEmit` and test `types` (e.g., `["node", "vitest/globals"]`), and includes both `src` and `test`. The editor uses the broad (test-inclusive) config so you get errors while writing tests.

**Q50: What does `verbatimModuleSyntax` do and why does it matter for modern builds?**

> It enforces that `import`/`export` syntax is emitted verbatim, requiring explicit `import type` for type-only imports and forbidding ambiguous elision. This makes per-file transpilation by esbuild/swc safe and predictable (no surprise import removal), which matters when `tsc` only type-checks and a bundler emits.

**Q51: When debugging "module not found" in the editor only, what do you check first?**

> Confirm which `tsconfig.json` the editor uses for that file (nearest config wins), then run `tsc --traceResolution` to see the resolution steps. Common causes: wrong `moduleResolution`, missing `types`/`typeRoots`, or a `paths` alias the editor honors but the runtime/bundler doesn't.

---

## Behavioral / Architecture Questions

**Q52: Your team's CI type-check takes 4 minutes and blocks every PR. What's your plan?**

> Profile with `--extendedDiagnostics` to find the dominant phase. Quick wins: `skipLibCheck`, `incremental` with cached `.tsbuildinfo`. Structural wins: project references so only changed packages re-check, and offloading emit to esbuild while `tsc --noEmit` is the gate. Cache keyed on source + tsconfig + TS version. Measure each change; target the biggest phase first.

**Q53: How do you prevent config drift between developers?**

> Commit all configs (base + leaves) to the repo; never rely on per-machine flags. Pin the TypeScript version exactly in `devDependencies`. Make CI run the same `tsc`/`tsc -b` command developers run. Use `--showConfig` in onboarding docs so everyone can verify the effective config.

**Q54: A library you maintain needs to support both ESM and CommonJS consumers. How does tsconfig play in?**

> You typically build twice (or use a dual-emit tool) with two configs differing in `module`/`moduleResolution` (`NodeNext` ESM vs `CommonJS`), both emitting `declaration`. Your `package.json` `exports` maps `import`/`require` conditions to the right outputs and types. The tsconfigs control the emitted module format; `package.json` wires the conditions.

---

## One-Minute Summary You Can Recite

> "`tsconfig.json` configures the TypeScript compiler. Top-level fields are `compilerOptions`,
> `include`, `exclude`, `files`, `extends`, `references`, `watchOptions`, and `typeAcquisition`.
> `tsc` finds it by walking up directories unless you pass `-p` or explicit files. `include`/`exclude`
> use globs and define only the root set — imported files compile regardless of `exclude`. `extends`
> inherits config, merging `compilerOptions` key-by-key but replacing arrays and never inheriting
> `references`. For monorepos, project references with `composite: true` plus `tsc -b` give
> dependency-ordered, incremental builds cached via `.tsbuildinfo`."

> If you can deliver that paragraph cleanly and then go deep on any clause when probed, you're
> well-prepared for any tsconfig.json interview question.

---

## Common Wrong Answers (and the Correct Version)

| Wrong answer | Correct answer |
|--------------|----------------|
| "`exclude` removes files from the build." | It removes them from the *root set* only; imported files still compile. |
| "`extends` deep-merges everything." | `compilerOptions` merge key-by-key; arrays and file-selection fields are *replaced*. |
| "`paths` makes imports work at runtime." | `paths` is type-only; you need a matching runtime/bundler alias. |
| "`tsc` always reads `tsconfig.json`." | Passing files on the CLI bypasses it. |
| "`tsc` builds project references." | Only `tsc -b` does. |
| "`composite` is just for incremental." | It also implies `declaration` and marks the project referenceable, and requires listing all files. |
| "Committing `.tsbuildinfo` shares the cache." | It's version/path-bound; commit nothing, cache it in CI. |
| "Lower `target` is safer." | It forces heavier downleveling and is rarely needed on modern runtimes. |

---

## Quick Definitions to Have Ready

| Term | One-liner |
|------|-----------|
| `compilerOptions` | The object holding all compiler flags. |
| `include` / `exclude` | Globs that define the root file set (not the import closure). |
| `files` | Explicit file list, immune to `exclude`. |
| `extends` | Config inheritance; merges options, replaces arrays. |
| `references` | Declares dependencies between TS projects for `tsc -b`. |
| `composite` | Makes a project referenceable; implies `declaration` + incremental. |
| `.tsbuildinfo` | Incremental cache: file hashes, `.d.ts` signatures, options, TS version. |
| Solution root | A `files: []` config that only orchestrates references. |
| `--showConfig` | Prints the fully resolved config and file set. |
| `noEmit` | Type-check only, produce no output. |

---

## Final Self-Check

Before an interview, confirm you can:

- [ ] List all eight top-level fields from memory.
- [ ] Explain `tsc` config discovery and the CLI-files bypass.
- [ ] State the `extends` merge rules precisely (arrays replace; `references` not inherited).
- [ ] Explain why `exclude` can't stop imported files.
- [ ] Set up project references + a solution root and build with `tsc -b`.
- [ ] Describe what `.tsbuildinfo` stores and what invalidates it.
- [ ] Name the two highest-leverage build optimizations (`skipLibCheck`, incremental/references caching).
- [ ] Debug any config with `--showConfig`, `--explainFiles`, and `tsc -b --verbose`.

> If every box is checked, you can confidently field junior-through-professional questions on `tsconfig.json`.

---

## Bonus: Five Questions Candidates Often Miss

1. **Does adding a comment break `tsconfig.json`?** No for `tsc` (JSONC), but some strict third-party JSON parsers may choke.
2. **Is `node_modules` always excluded?** It's excluded by default discovery, but a custom `exclude` replaces defaults — and an `include` glob reaching into it overrides that anyway.
3. **What happens if `files` lists a missing file?** A hard error (`TS6053: File not found`), unlike `include` which silently matches nothing.
4. **Can `extends` point to a package?** Yes — bare specifiers resolve from `node_modules` (e.g., `@tsconfig/node20/tsconfig.json`).
5. **Does `tsc -b --clean` touch source?** No — it deletes only outputs (`.js`, `.d.ts`, maps) and `.tsbuildinfo`, never your `.ts` sources.

> Knowing these five sets you apart, because each targets a precise behavior that surface-level
> familiarity misses.

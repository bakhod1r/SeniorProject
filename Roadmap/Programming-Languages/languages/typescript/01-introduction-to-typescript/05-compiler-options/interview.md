# Compiler Options — Interview Questions

> 25+ questions across Junior, Middle, Senior, and Professional levels.
> Each answer is concise but complete enough to satisfy a real interviewer.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Rapid-Fire Round](#rapid-fire-round)

---

## Junior Questions

### Q1: Where do compiler options live and what is `compilerOptions`?

They live in `tsconfig.json` under the `compilerOptions` key. That object holds every flag that controls how `tsc` type-checks and emits JavaScript. Other top-level keys (`include`, `exclude`, `extends`, `references`) control *which* files and inheritance, not the compiler's behavior per file.

### Q2: What does `target` do?

`target` sets the JavaScript language version of the emitted code. If you write modern syntax (arrow functions, `async/await`, private fields) but the target is older, the compiler **downlevels** it into equivalent older JavaScript. Newer targets produce smaller, faster output because fewer rewrites are needed.

### Q3: What does `strict: true` enable?

It is an umbrella that turns on `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`, `useUnknownInCatchVariables`, and `alwaysStrict`. The single most valuable member is `strictNullChecks`.

### Q4: What is the difference between `module` and `moduleResolution`?

`module` is the **output** module format (what `import`/`export` compile to: CommonJS, ESM, etc.). `moduleResolution` is the **algorithm** the compiler uses to *find* a module file on disk (`node`, `node16`/`nodenext`, `bundler`). One is about emit; the other is about lookup.

### Q5: What do `outDir` and `rootDir` control?

`outDir` is the folder where compiled JavaScript is written. `rootDir` is the base folder used to compute the output structure under `outDir`. With `rootDir: "./src"` and `outDir: "./dist"`, `src/a/b.ts` becomes `dist/a/b.js`.

### Q6: Why set `skipLibCheck: true`?

It skips type-checking the `.d.ts` declaration files (mostly in `node_modules`), which makes builds noticeably faster and avoids errors caused by mismatched library types you cannot fix. Almost every project uses it.

### Q7: What does `lib` do, and what's a common mistake with it?

`lib` declares which built-in type definitions are available (e.g. `ES2022`, `DOM`). The common mistake is setting it manually with only a partial set — since `lib` **replaces** the target-derived default, forgetting to include an ES version removes `Array`, `Promise`, etc.

### Q8: What does `noEmit` do and when would you use it?

`noEmit` type-checks but writes no output files. You use it when a bundler (Vite, esbuild, SWC) does the actual compilation and you only want `tsc` to verify types, e.g. `tsc --noEmit` in CI.

---

## Middle Questions

### Q9: Explain `strictNullChecks` with a before/after.

Without it, `null` and `undefined` are assignable to every type, so `getLength(null)` against `(s: string)` compiles and crashes at runtime. With it, `null`/`undefined` are distinct types; the same call is a compile error, and accessing `user.nickname` (optional) requires narrowing first. It eliminates the most common crash class.

### Q10: What does `noUncheckedIndexedAccess` change?

It adds `| undefined` to the result of array element access and index-signature access. `arr[10]` becomes `number | undefined`, forcing you to handle the out-of-bounds case. It is **not** part of `strict`; you opt in.

### Q11: What is `exactOptionalPropertyTypes` and how does it differ from `strictNullChecks`?

`strictNullChecks` makes `undefined` a real type. `exactOptionalPropertyTypes` additionally distinguishes *property absent* from *property present but set to `undefined`*: with it on, `{ x?: number }` rejects `{ x: undefined }`. It matters for code that uses `"key" in obj` checks where the two cases behave differently.

### Q12: Why does `catch (e)` give `unknown` and not `Error`?

Because JavaScript can `throw` any value, not just an `Error`. `useUnknownInCatchVariables` (default under `strict` since 4.4) types the binding as `unknown`, forcing you to narrow (`if (e instanceof Error)`) before accessing `.message`. This prevents the false assumption that every thrown value is an `Error`.

### Q13: What does `strictFunctionTypes` catch, and why are methods exempt?

It checks function-type parameters **contravariantly**, rejecting unsafe callback assignments (assigning a narrower-parameter function where a wider one is expected). Methods are intentionally exempt (kept bivariant) because common APIs like `Array.prototype.push`/event handlers would otherwise be unusable. The carve-out is a deliberate soundness/usability trade-off.

### Q14: What do `noUnusedLocals` and `noUnusedParameters` do, and how do you intentionally ignore a parameter?

They error on dead local variables and unused parameters, catching typos and dead code. To intentionally keep an unused parameter (e.g. to access a later one), prefix its name with an underscore: `(_event: MouseEvent) => ...`.

### Q15: When does `noImplicitReturns` fire?

When some code paths in a function explicitly return a value and at least one path falls off the end (implicitly returning `undefined`). It forces every branch to return explicitly, catching forgotten `return`s in `if`/`switch` ladders.

### Q16: What do `paths` and `baseUrl` do, and what is the runtime gotcha?

They create import aliases (`@/utils` → `src/utils`). The gotcha: `paths` resolves only at the **type level**. At runtime, Node cannot resolve `@/utils` unless a bundler, `tsconfig-paths`, or a `package.json` `imports` map applies the same mapping. Type-check passes, runtime throws "module not found".

### Q17: Why enable `resolveJsonModule` and `esModuleInterop`?

`resolveJsonModule` lets you `import data from "./data.json"` with inferred types. `esModuleInterop` injects interop helpers so importing CommonJS packages with `import x from "x"` works correctly, and it implies `allowSyntheticDefaultImports`. Both smooth out everyday import friction.

---

## Senior Questions

### Q18: How would you adopt `strict` in a large legacy codebase without blocking work?

Start with `strict: false` and ratchet flags one at a time, easiest first: `noImplicitAny` → `strictNullChecks` (last among the big ones, it produces the most errors) → the rest. Keep a scoped `tsconfig.strict.json` that `extends` the base and `include`s only migrated folders; run both configs in CI and gate on a monotonically increasing count of strict-passing files. Prefer real fixes over `!`/`as`.

### Q19: How do project references and `composite` improve monorepo builds?

`composite: true` makes a package independently buildable: it forces `declaration` emit and a complete `include`, and implies `incremental`. `tsc --build` then walks the `references` DAG, building each package to its `.d.ts` once; downstream packages type-check against those `.d.ts` files instead of re-processing source. Only changed packages and their dependents rebuild, cutting full-repo check time dramatically.

### Q20: Which flags keep `tsc` and a single-file transpiler (esbuild/SWC) in agreement, and why?

`isolatedModules` and `verbatimModuleSyntax`. `isolatedModules` rejects constructs that need whole-program info (`const enum`, type-only re-exports without `export type`). `verbatimModuleSyntax` makes import/export elision purely syntactic (no `type` modifier → kept; with `type` → erased), so the bundler and `tsc` produce the same imports. Together they prevent the bug where one tool keeps an import the other drops.

### Q21: What does `importHelpers` do and what is its trade-off?

It imports downlevel helpers (`__awaiter`, `__spreadArray`, ...) from the `tslib` package instead of inlining them into every file. Trade-off: smaller total output and one shared implementation, at the cost of a runtime dependency on `tslib`. Libraries almost always want it.

### Q22: A monorepo's full type-check takes 90 seconds and blocks PRs. What do you do?

Three levers: `skipLibCheck: true`; `incremental: true` with a `.tsbuildinfo` cached across CI runs; and project references with `composite: true` so only changed packages rebuild. If still slow, profile with `tsc --generateTrace` and simplify expensive recursive generics and oversized union types.

### Q23: What's the difference between `node`, `node16`/`nodenext`, and `bundler` module resolution?

`node` (a.k.a. `node10`) is the legacy CommonJS algorithm; it ignores `package.json` `"exports"`. `node16`/`nodenext` honor `"exports"`, `"imports"`, and `"type"`, and require explicit file extensions — matching modern Node. `bundler` mirrors `node16`'s `"exports"`-aware lookup but drops the extension requirement, matching how Vite/esbuild/webpack resolve.

---

## Professional / Deep-Dive Questions

### Q24: Walk through which compiler phase each option category configures.

Parser/binder: `alwaysStrict` (strict-mode parsing), `isolatedModules` (single-file constraints), `jsx`/`experimentalDecorators` (syntax acceptance). Checker: the entire `strict` family, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck`, `lib`. Emitter/transforms: `target`, `downlevelIteration`, `module`, `useDefineForClassFields`, decorator metadata, `importHelpers`, `esModuleInterop`. Printer: `removeComments`, `sourceMap`, `declaration`, `outDir`. Checker-only flags never change emit — two builds differing only there emit identical JS.

### Q25: What does `tsc` emit for `async/await` at `target: "ES5"`?

It cannot use native async, so it lowers each async function into a generator-style state machine run by the `__awaiter` and `__generator` helpers. `await` expressions become labeled `yield` points in a `switch`-based state machine. Template strings also become string concatenation. The result is much larger than the source.

### Q26: Explain `useDefineForClassFields` and a real bug it causes.

It controls whether class fields are emitted as `[[Set]]` assignments (legacy) or `[[Define]]` via `Object.defineProperty` (standard, default for `target ≥ ES2022`). Under `[[Define]]`, a field declared in a subclass *shadows* a getter/setter of the same name on a base class instead of invoking it, and fields are installed before subclass constructor logic. This breaks frameworks (older Angular/MobX patterns, parameter-property setters) that relied on the old `[[Set]]` behavior; the fix is `useDefineForClassFields: false` or marking the field `declare`.

### Q27: What does `emitDecoratorMetadata` actually emit and what consumes it?

With `experimentalDecorators` on, it emits `Reflect.metadata("design:type" | "design:paramtypes" | "design:returntype", ...)` alongside the `__decorate` calls. This design-time type metadata is what NestJS/TypeORM/Angular DI read at runtime to resolve constructor parameter types. It requires a `reflect-metadata` polyfill and forces decorated symbols' types to be reachable at the value level, so only enable it when a framework consumes it.

### Q28: What exactly does `skipLibCheck` skip, and what's the risk?

It skips the **internal consistency check of `.d.ts` files** — verifying that declaration files do not contradict each other (e.g. two `@types` packages declaring incompatible globals). It does **not** skip *using* those declarations; your code is still checked against them. The risk is missing a conflict between dependency type definitions, which is usually the dependency author's bug. The build-time win is typically large.

### Q29: How does `incremental` decide what to rebuild?

It writes `.tsbuildinfo` containing input file version hashes, the reference graph, each file's emitted `.d.ts` signature, and diagnostics. On the next run it rehashes inputs and re-checks only files whose content changed or whose dependencies' `.d.ts` signature changed. A function-body edit that does not alter the public type often invalidates just that one file.

### Q30: Why is `verbatimModuleSyntax` preferred over `importsNotUsedAsValues`/`preserveValueImports`?

The old pair relied on type-directed elision, which was confusing and could disagree with single-file transpilers. `verbatimModuleSyntax` makes the rule purely syntactic: imports/exports without a `type` modifier are always emitted; those with `type` are always erased. It is deterministic, faster to reason about, and matches what bundlers do. The old options are deprecated in favor of it.

### Q31: A `tsc --noEmit` check is green but the production bundle crashes. Name three option-related causes.

1. `const enum` used without `isolatedModules` — the bundler cannot inline it cross-file, so `Color.Green` references an object that was never emitted.
2. A type-only re-export (`export { User } from "./user"`) without `verbatimModuleSyntax`/`export type` — the bundler keeps a runtime import for a type.
3. A `paths` alias with no runtime resolver — Node throws "Cannot find module '@/x'". All three pass type-checking because they are emit/runtime concerns, not type errors.

### Q32: How do `module` and `target` interact when choosing defaults?

If you do not set `module`, TypeScript derives it from `target`: `ES3`/`ES5` defaults to `CommonJS`; newer targets default to an ES module format. Setting `moduleResolution: "nodenext"` pins `module` to `nodenext`. The safest practice is to set `target`, `module`, and `moduleResolution` explicitly so you never depend on these derivations, which have changed across TypeScript versions.

### Q33: What is the difference between `allowSyntheticDefaultImports` and `esModuleInterop`?

`allowSyntheticDefaultImports` is **type-only**: it lets the compiler accept `import x from "cjs"` against a module with no default, with no effect on emit. `esModuleInterop` is **type + emit**: it additionally injects the `__importDefault`/`__importStar` runtime helpers so the default import actually works at runtime, and it implies `allowSyntheticDefaultImports`. You almost always want `esModuleInterop`; `allowSyntheticDefaultImports` alone can make code that type-checks but breaks at runtime.

### Q34: When would you set `useDefineForClassFields: false` deliberately?

When a framework or pattern depends on the legacy `[[Set]]` field semantics: a subclass field that must invoke a base-class setter, parameter properties that decorators inspect, or older Angular/MobX code. Under the standard `[[Define]]` behavior (default at `target ≥ ES2022`), such fields shadow accessors and run before subclass logic, breaking those patterns. The targeted alternative is to mark the specific field `declare` rather than flipping the whole project's semantics.

### Q35: How do you keep `.d.ts` emit fast in a large library?

Three levers: keep public return types annotated (so the checker does not have to infer large types at emit), enable `isolatedDeclarations` (5.5+) which lets `.d.ts` be generated per file without whole-program inference, and split the library into project references with `composite` so each package emits its own declarations incrementally. `declarationMap` adds navigation but not much cost.

---

## Whiteboard Scenarios

### Scenario A: New service, you own the stack

*"Write the `compilerOptions` you would start a new Node 20 microservice with, and justify each line."*

```json
{
  "compilerOptions": {
    "target": "ES2022",          // Node 20 supports it natively — no downlevel bloat
    "module": "NodeNext",        // per-file CJS/ESM from package.json
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,              // baseline safety
    "noUncheckedIndexedAccess": true,   // no out-of-bounds crashes
    "exactOptionalPropertyTypes": true, // absent vs undefined precision
    "noImplicitOverride": true,  // override drift protection
    "esModuleInterop": true,     // clean CJS imports
    "resolveJsonModule": true,   // typed JSON imports
    "skipLibCheck": true,        // fast builds
    "incremental": true,         // fast rebuilds
    "sourceMap": true,           // debuggable stack traces
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

The interviewer is checking whether you can defend *each* flag, not recite a template.

### Scenario B: Migrate a 2,000-file JS codebase

*"You inherit a JavaScript codebase. Outline the option-by-option migration to strict TypeScript."*

Answer the order and the tooling: start `allowJs: true`, `checkJs: false`, `strict: false`. Turn on `checkJs` for low-risk folders. Enable `noImplicitAny`, fix, commit. Stand up a scoped `tsconfig.strict.json` that `extends` the base and `include`s migrated folders only. Enable `strictNullChecks` there (the big one), migrate folder by folder, gate CI on a monotonically increasing strict-passing file count. Finish with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. The point is *monotonic, green-at-every-step* progress, not a big-bang flip.

### Scenario C: The build is too slow

*"CI type-check is 3 minutes and blocks every PR. Walk me through your investigation."*

Run `tsc --extendedDiagnostics` to split parse/bind/check/emit. If check time dominates: `skipLibCheck: true`, then `incremental` with a cached `.tsbuildinfo`. If it is a monorepo: project references with `composite`. If a few files are pathological: `--generateTrace` + `analyze-trace` to find recursive generic hot-spots and bound them. If emit time dominates: offload emit to esbuild/SWC and run `tsc --noEmit` only for checking. Always present before/after numbers.

---

## Rapid-Fire Round

| Question | Answer |
|----------|--------|
| Is `noUncheckedIndexedAccess` part of `strict`? | No |
| Does `composite` force `declaration`? | Yes |
| Does `paths` work at runtime by itself? | No |
| Which flag types `catch (e)` as `unknown`? | `useUnknownInCatchVariables` |
| Default of `strict`? | `false` |
| Does `esModuleInterop` imply `allowSyntheticDefaultImports`? | Yes |
| Flag for importing `.json`? | `resolveJsonModule` |
| Output format vs lookup algorithm? | `module` vs `moduleResolution` |
| Flag to share downlevel helpers? | `importHelpers` (+`tslib`) |
| Flag forbidding `const enum`? | `isolatedModules` |
| `useDefineForClassFields` default for ES2022? | `true` |
| Replacement for `preserveValueImports`? | `verbatimModuleSyntax` |
| Skip checking node_modules types? | `skipLibCheck` |
| Catch OS-specific casing bugs? | `forceConsistentCasingInFileNames` |
| Which strict flag has the biggest impact? | `strictNullChecks` |

---

## Interviewer's Scoring Guide

- **Junior pass:** Knows `target`, `module`, `outDir`, `strict`, `lib`, and that types are erased.
- **Middle pass:** Can name the strict family members and explain `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module` vs `moduleResolution`.
- **Senior pass:** Can design a gradual hardening plan, set up project references, and explain bundler-agreement flags.
- **Professional pass:** Can map options to compiler phases and describe downlevel emit, class-field semantics, and decorator metadata.

---

## Common Follow-Up Traps

Interviewers often probe a confident answer with a follow-up. Be ready for these:

| You said... | Follow-up trap | Correct response |
|-------------|----------------|------------------|
| "`strict` covers everything." | "Does it cover `noUncheckedIndexedAccess`?" | No — that and `exactOptionalPropertyTypes` are opt-in, outside `strict`. |
| "Just use `paths` for aliases." | "Does it work when you `node dist/index.js`?" | No — `paths` is compile-time only; you need a runtime resolver. |
| "Set `lib` to `DOM`." | "What happens to `Promise`?" | Gone — `lib` replaces the default; include an ES version too. |
| "`skipLibCheck` is unsafe." | "What exactly does it skip?" | Only `.d.ts` internal consistency; your code is still checked against the types. |
| "Higher `target` is always better." | "What if you target an old runtime?" | Then you need downleveling; pair with `importHelpers` + `tslib`. |
| "`composite` is just `incremental`." | "What else does it force?" | `declaration: true` and complete `include` coverage. |
| "`esModuleInterop` is type-only." | "Does it change emit?" | Yes — it injects `__importDefault`/`__importStar` at runtime. |

---

## Twenty-Second Summaries (for the lightning round)

- **`strict`:** umbrella over eight safety flags; `strictNullChecks` is the heavy hitter.
- **`target`:** JS version emitted; lower targets trigger downlevel transforms.
- **`module` vs `moduleResolution`:** emit format vs on-disk lookup algorithm.
- **`noUncheckedIndexedAccess`:** `arr[i]` becomes `T | undefined`; opt-in.
- **`isolatedModules` + `verbatimModuleSyntax`:** make `tsc` and bundlers agree.
- **`composite` + project references:** monorepo incremental builds via `.d.ts` boundaries.
- **`skipLibCheck` + `incremental`:** the two cheapest build-speed wins.
- **`importHelpers` + `tslib`:** de-duplicate downlevel helpers.
- **`useDefineForClassFields`:** `[[Define]]` vs `[[Set]]` class-field semantics.
- **`emitDecoratorMetadata`:** runtime `design:*` types for DI frameworks.

---

## Extended Junior Questions

### Q36: What does `moduleResolution: "bundler"` change versus `node16`?

It keeps `node16`'s awareness of `package.json` `"exports"`/`"imports"` but drops the requirement to write file extensions in relative import specifiers. That matches how Vite/esbuild/webpack resolve, so you can write `import "./util"` instead of `import "./util.js"`. Use it when a bundler does the resolution; use `node16`/`nodenext` for plain Node.

### Q37: What is `resolveJsonModule` and what does it imply about emit?

It lets you `import data from "./config.json"` and get a typed object inferred from the JSON shape. At emit time the JSON is treated as a module (bundled or required), so the runtime must be able to load JSON modules — under `NodeNext`, importing JSON requires an import attribute (`with { type: "json" }`) in newer Node.

### Q38: If you omit `target`, what happens?

TypeScript falls back to a conservative default (historically `ES3`/`ES5`), which downlevels aggressively and produces bloated output for modern runtimes. Always set `target` explicitly. Omitting it is a common cause of unexpectedly large emit.

---

## Extended Middle Questions

### Q39: How do `include`, `exclude`, and `files` interact?

`files` is an explicit list; `include`/`exclude` are glob-based. If `files` or `include` is present, only matching files (minus `exclude`) form the program. `exclude` only filters what `include` brought in — it does not stop a file pulled in by an `import`. So excluding a file does not remove it if another included file imports it.

### Q40: Why might `strict` cause new errors after a TypeScript upgrade?

Because `strict` is an umbrella whose membership can grow in a major release. When a new strict flag is added under it, upgrading the compiler turns that flag on for everyone using `strict: true`, surfacing new (legitimate) errors. Teams that need reproducibility enumerate the individual flags instead of relying on the umbrella.

### Q41: What does `noImplicitOverride` require and why is it valuable during refactors?

It requires the `override` keyword on any method that overrides a base-class method. During a refactor that renames or removes a base method, every now-mismatched `override` becomes a compile error, so the refactor cannot silently leave dead "overrides" that never run.

---

## Extended Senior Questions

### Q42: How do you resolve and debug a deep `extends` chain?

Run `tsc --showConfig` to print the fully-merged effective options. Remember the merge rules: `compilerOptions` keys merge (child wins); `include`/`exclude`/`files` are replaced (not merged) by the nearest config that sets them; relative paths resolve relative to the config that declared them; and an array `extends` applies left-to-right with later entries winning.

### Q43: When would you publish your tsconfig as a package?

When multiple repos or packages must share a baseline. Publishing `@acme/tsconfig` with `node`, `library`, and `react` variants lets every project `extends` the right one; bumping the package version rolls out a flag change org-wide. Libraries should pin the TypeScript version; apps can float it.

### Q44: What is the trade-off of `assumeChangesOnlyAffectDirectDependencies`?

It tells watch/incremental builds to re-check only direct importers of a changed file, not the full transitive cone. That dramatically speeds watch rebuilds in huge graphs, at the cost of possibly missing a deep transitive type change until the next full build. Most teams leave it off and rely on CI for the authoritative full check.

---

## Extended Professional Questions

### Q45: How does `declaration` emit synthesize names, and when does it fail?

The declaration emitter prints the public type surface, sometimes needing to name an anonymous inferred type. If that type references a private/un-nameable symbol, emit fails with TS9006 ("requires using private name"). The fix is an explicit public return/type annotation. `isolatedDeclarations` converts this into an up-front rule, enabling fast per-file `.d.ts` generation.

### Q46: Does `removeComments` strip JSDoc from `.d.ts` files?

No. `removeComments` strips comments from emitted `.js` only. JSDoc is preserved in `.d.ts` so consumer tooling and editors can show documentation. This asymmetry is deliberate — runtime JS does not need comments, but published types do.

### Q47: Two builds differ only in `strictNullChecks`. Will their emitted JS differ?

No. `strictNullChecks` is a checker-only flag; it changes diagnostics, not emit. Assuming the stricter build compiles, both produce byte-identical JavaScript. This is true of the entire checker-only family (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, etc.).

### Q48: How would you classify which options are safe to differ between a dev and a CI config?

Three buckets. **Checker-only** flags (the `strict` family, `noUncheckedIndexedAccess`, `skipLibCheck`) can differ freely — emit is identical, so no runtime divergence. **Emit-affecting** flags (`target`, `module`, `useDefineForClassFields`, `importHelpers`, `esModuleInterop`, decorator flags, `jsx`) must match the production build or you get "works in dev, breaks in prod." **Resolution-affecting** flags (`moduleResolution`, `baseUrl`, `paths`, `types`) must match the toolchain that actually loads modules. A CI config can safely be *stricter* (more checker flags) but must keep emit/resolution identical.

### Q49: What does `jsxImportSource` do?

With `jsx: "react-jsx"` (the automatic runtime), `jsxImportSource` chooses which package the `_jsx`/`_jsxs` functions are imported from. Default is `"react"` (`react/jsx-runtime`). Setting `jsxImportSource: "preact"` or `"solid-js"` redirects the auto-import so non-React JSX libraries work without a manual factory import. It is purely an emitter setting.

### Q50: A teammate set `lib: ["DOM"]` and now `Promise` is undefined. Explain and fix.

Setting `lib` *replaces* the target-derived default rather than extending it. By listing only `DOM`, they dropped every ECMAScript lib, so `Promise`, `Map`, and `Array` methods vanish. Fix: include an ES version alongside DOM, e.g. `lib: ["ES2022", "DOM", "DOM.Iterable"]`. This is one of the most common `lib` mistakes.

---

## Take-Home Exercise (often given before an onsite)

*"Here is a `tsconfig.json` from a struggling project. Critique it."*

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "lib": ["DOM"],
    "paths": { "@/*": ["src/*"] }
  }
}
```

A strong critique hits: (1) no `strict` — null bugs slip through; (2) no `target` — conservative default bloats emit; (3) `lib: ["DOM"]` drops ES libs (Promise/Array gone); (4) `module: "ESNext"` with no `moduleResolution` and likely a CommonJS runtime → `Cannot use import statement outside a module`; (5) `paths` with no `baseUrl` and no runtime resolver → fails at `node` runtime; (6) no `skipLibCheck`/`incremental` → slow builds; (7) no `esModuleInterop` → CJS default-import breakage. The interviewer is testing breadth across all three buckets at once.

A corrected version:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "outDir": "dist",
    "rootDir": "src",
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

…plus a note that the `paths` alias still needs a runtime resolver (bundler or `tsconfig-paths`).

---

## Behavioral / Judgment Questions

These probe how you make decisions, not just what you know.

### Q51: Your team wants `strict` but a vendored module produces 200 errors. What do you do?

I would not loosen `strict` globally. Options, in order of preference: (1) keep `strict` on and add a scoped `tsconfig` that excludes the vendored folder from the strict build until it is owned/migrated; (2) wrap the vendored module behind a typed adapter file so the rest of the codebase sees clean types; (3) as a last resort, `// @ts-expect-error` with a tracking comment on the specific lines, never a blanket `any`. The goal is to contain the debt, not spread it.

### Q52: A junior added `"skipLibCheck": false` "to be safe." How do you respond?

I would explain what it actually does — it only re-enables consistency checking *between* `.d.ts` files, which surfaces dependency authors' bugs at a large build-time cost, not bugs in our code. Our code is still checked against those types either way. I would revert to `true` and, if there was a specific dependency type conflict that motivated the change, address that one conflict with a module augmentation or a pinned `@types` version.

### Q53: When is it acceptable to ship `useDefineForClassFields: false`?

When a dependency or framework genuinely relies on the legacy `[[Set]]` semantics — older Angular, certain MobX/decorator patterns, or parameter-property setters. It is a project-wide behavioral switch, so I prefer the narrower fix (`declare` on the specific fields, or assigning in the constructor) and only flip the global flag if the pattern is pervasive and the framework requires it.

### Q54: How do you prevent config drift across 30 microservices?

Publish a versioned `@org/tsconfig` package with `node`/`library` variants; every service `extends` it. Add a CI lint that fails if a service overrides a safety flag (`strict`, `noUncheckedIndexedAccess`) without an approved exemption comment. Bumping the package version rolls flag changes out centrally, and `tsc --showConfig` in CI logs the effective config for auditability.

### Q55: What is your one-sentence rule for choosing `module`/`moduleResolution`?

Use `NodeNext`/`NodeNext` when Node runs the output directly, and `ESNext`/`bundler` when a bundler does — and never rely on the derived defaults, because they have changed across TypeScript versions.

---

## Code-Reading Questions

The interviewer shows code + config and asks "what does the compiler say, and why?"

### Q56: Predict the diagnostic.

```jsonc
// { "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }
```
```typescript
function sum(xs: number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total += xs[i]; // ?
  }
  return total;
}
```

<details>
<summary>Answer</summary>
Error: `xs[i]` is `number | undefined` under `noUncheckedIndexedAccess`, and `total += undefined` is not assignable. Even though the loop bound guarantees `i` is in range, the checker does not prove that. Fix with a local `const v = xs[i]; if (v !== undefined) total += v;`, or use `for (const v of xs)` which yields `number` directly.
</details>

### Q57: Predict the diagnostic.

```jsonc
// { "compilerOptions": { "strict": true, "exactOptionalPropertyTypes": true } }
```
```typescript
interface Props { title?: string }
function render(p: Props) {}
const data: { title: string | undefined } = { title: undefined };
render(data); // ?
```

<details>
<summary>Answer</summary>
Error: `{ title: string | undefined }` is not assignable to `Props` because `Props.title` is *optional* (may be absent) whereas `data.title` is *required and possibly undefined*. Under `exactOptionalPropertyTypes` these are distinct. The fix is to make `data`'s type also optional (`{ title?: string }`) or widen `Props` to `title?: string | undefined`.
</details>

### Q58: Predict the diagnostic.

```jsonc
// { "compilerOptions": { "isolatedModules": true } }
```
```typescript
import { Animal } from "./types";
export { Animal };
```

<details>
<summary>Answer</summary>
Error if `Animal` is a type: re-exporting a type under `isolatedModules` requires `export type { Animal }`. A single-file transpiler cannot tell `Animal` is type-only, so the flag forces the explicit `type` modifier.
</details>

### Q59: Predict the runtime behavior.

```jsonc
// { "compilerOptions": { "target": "ES2022", "strict": true } }
```
```typescript
class A { greeting = "hi"; constructor() { this.log(); } log() { console.log(this.greeting); } }
class B extends A { greeting = "yo"; }
new B();
```

<details>
<summary>Answer</summary>
Logs `undefined`. With `useDefineForClassFields` defaulting to `true` at ES2022, `B`'s `greeting` field is installed *after* `super()` runs — and `super()` (A's constructor) calls `this.log()` before B's field initializer executes. So at the time of the call, `this.greeting` is `undefined` (B's `[[Define]]` field has not been set, and it shadows A's). This is the standard class-fields semantics gotcha.
</details>

### Q60: Predict the diagnostic.

```jsonc
// { "compilerOptions": { "strict": true } }  // no esModuleInterop
```
```typescript
import moment from "moment"; // moment is a CommonJS module
```

<details>
<summary>Answer</summary>
Error: "Module 'moment' can only be default-imported using the 'esModuleInterop' flag" (or it resolves but fails at runtime). Without `esModuleInterop`/`allowSyntheticDefaultImports`, a default import from a CommonJS module with no default export is rejected. Fix by enabling `esModuleInterop: true`.
</details>

---

## Final Preparation Checklist

Before a TypeScript interview that touches configuration, make sure you can do each of these out loud, without notes:

- [ ] List every member of the `strict` umbrella and what it catches.
- [ ] Explain `module` vs `moduleResolution` and pick values for Node vs bundler.
- [ ] Describe what `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` change, and that they are *not* in `strict`.
- [ ] Walk a gradual-strictness migration for a legacy repo in the correct order.
- [ ] Set up project references with `composite` and explain the `.d.ts` boundary.
- [ ] Name the two cheapest build-speed flags (`skipLibCheck`, `incremental`).
- [ ] Explain why `isolatedModules` + `verbatimModuleSyntax` make bundlers and `tsc` agree.
- [ ] Classify any option as checker-only, emit-affecting, or resolution-affecting.
- [ ] Critique a bad `tsconfig.json` across all three buckets in under two minutes.
- [ ] Predict the class-fields `undefined` gotcha under `useDefineForClassFields: true`.

If all ten are second nature, you are ready for senior-level configuration questions. The recurring theme interviewers reward: knowing not just *what* a flag does, but *which phase of the compiler it touches* and *what bug it prevents*.

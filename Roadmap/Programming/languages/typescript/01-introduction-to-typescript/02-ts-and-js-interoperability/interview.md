# TS and JS Interoperability — Interview Questions

> 25+ questions across junior, middle, senior, and professional levels.
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

**Q1: Why is it possible to mix TypeScript and JavaScript in one project at all?**

> Because TypeScript is a *typed superset* of JavaScript and compiles down to plain JavaScript. Every valid JS program is (almost) a valid TS program, and types are erased at emit. That design is what makes gradual, file-by-file adoption possible instead of a full rewrite.

**Q2: What does `allowJs` do?**

> It lets `.js`/`.jsx` files become part of the TypeScript program — TypeScript will follow imports into them, include them in the module graph, and emit them. Without it, `tsc` ignores JS files entirely.

**Q3: What does `checkJs` do, and what does it depend on?**

> `checkJs` makes TypeScript type-check `.js` files using inference and any JSDoc comments. It only makes sense together with `allowJs`, because the JS files must be in the program first. It reports errors but never changes the JS runtime behavior.

**Q4: What is a `.d.ts` file?**

> A declaration file: it contains only type declarations and emits no JavaScript. It is like a "header file" that tells the compiler the shape of some JavaScript code without providing its implementation.

**Q5: What does the `declare` keyword do?**

> It introduces an ambient declaration — it asserts that something exists at runtime and gives its type, without creating any runtime value. It emits nothing. Used for globals, ambient modules, and describing untyped JS.

**Q6: What is `@types/lodash` and does it ship to production?**

> It is a community-maintained declaration package from DefinitelyTyped that adds types to the untyped `lodash` library. It contains only `.d.ts` files, is a dev dependency, is erased at compile time, and never ships to production.

**Q7: What is the difference between `// @ts-ignore` and `// @ts-expect-error`?**

> Both suppress the error on the next line. `@ts-ignore` suppresses silently whether or not there is an error. `@ts-expect-error` additionally errors if the next line has *no* error, so it is self-cleaning and preferred.

**Q8: How do you turn on type-checking for just one `.js` file?**

> Put `// @ts-check` at the very top of the file. It is the per-file equivalent of `checkJs: true`. The opposite is `// @ts-nocheck`.

**Q9: Can a `.d.ts` file contain a function body?**

> No. Declaration files are declarations only. `export declare function add(a: number, b: number): number;` is allowed; `export function add(a, b) { return a + b; }` is not.

**Q10: What error do you get importing an untyped library, and how do you fix it?**

> `TS7016: Could not find a declaration file for module 'x'`. Fix it by installing `@types/x` if it exists, otherwise write a `declare module "x" { ... }` shim (or a bare `declare module "x";` to treat it as `any`).

---

## Middle Interview Questions

**Q11: Walk me through adding TypeScript to an existing JavaScript codebase.**

> Add a `tsconfig.json` with `allowJs: true` so JS keeps compiling. Wire `tsc` (or a bundler) into the build. Convert leaf modules to `.ts` first. Enable `checkJs` or sprinkle `// @ts-check` to surface errors in remaining JS. Then tighten strictness incrementally — `noImplicitAny` first, then full `strict`. Install `@types` for dependencies and shim the rest.

**Q12: What does `esModuleInterop` actually change?**

> It emits runtime helper functions (`__importDefault`, `__importStar`) so that ESM-style default and namespace imports work correctly against CommonJS modules. With it on, `import express from "express"` resolves the default to the whole `module.exports`. It implies `allowSyntheticDefaultImports`.

**Q13: What is the difference between `esModuleInterop` and `allowSyntheticDefaultImports`?**

> `allowSyntheticDefaultImports` is type-check-only: it lets you *write* `import x from "cjs"` without TS complaining, but does not change emit. `esModuleInterop` changes the *emitted runtime helpers* so the import actually works at runtime, and it turns `allowSyntheticDefaultImports` on automatically.

**Q14: How does TypeScript find types for an imported package?**

> It checks the package's `package.json` `types`/`typings` field (or the `types` export condition), then a bundled `index.d.ts`, then a separately installed `@types/<pkg>`, then any local `declare module` shim. If none resolve, the import is `any` (or `TS7016` under `noImplicitAny`).

**Q15: What does `skipLibCheck` skip, and what does it NOT skip?**

> It skips type-checking the *bodies* of all `.d.ts` files (yours and dependencies'). It does NOT skip checking your `.ts`/`.js` source, and it still uses the declarations to type your code. It speeds up builds and avoids conflicts between `@types` versions, at the cost of not catching bugs inside declarations.

**Q16: Give three JSDoc tags and what they type.**

> `@param {number} x` types a parameter; `@returns {boolean}` types the return value; `@typedef {{a: number}} Point` defines a named object type. Others: `@type` for a variable, `@template T` for generics, `@callback` for function types.

**Q17: What is an ambient module declaration and when do you use it?**

> A `declare module "name" { ... }` block (usually in a `.d.ts`) that describes the types of a module the compiler otherwise can't see. You use it to type an untyped third-party library, or with wildcards (`declare module "*.svg"`) to type non-code imports handled by a bundler.

**Q18: Under `nodenext`, why might you import `./helper.js` from a `.ts` file?**

> Because Node-native ESM resolution requires the runtime file extension, and the runtime file is the emitted `.js`. TypeScript maps `./helper.js` to the `helper.ts` source for checking but keeps the `.js` specifier in the emit so Node can resolve it.

**Q19: How do you add a property to `process.env` types safely?**

> Use global augmentation in a `.d.ts`: `declare global { namespace NodeJS { interface ProcessEnv { API_URL: string } } }` with an `export {}` to make the file a module. This merges into the existing `ProcessEnv` interface.

---

## Senior Interview Questions

**Q20: A `@types/*` package and the runtime library disagree. What's happening and how do you handle it?**

> The `@types` version is out of sync with the installed library version, so it declares methods that don't exist (or omits ones that do), or has wrong signatures. Align versions (`npm ls pkg @types/pkg`), pin them, or override with a local `.d.ts` using declaration merging / module augmentation. Long term, prefer libraries that ship their own types.

**Q21: When would you choose `verbatimModuleSyntax` over relying on import elision?**

> When you publish a library or need predictable CJS/ESM emit. `verbatimModuleSyntax` emits imports/exports verbatim, dropping only `import type`/`export type`, which removes the ambiguity of automatic elision and forces explicit type-only imports. It replaces the older `importsNotUsedAsValues`/`preserveValueImports` pair.

**Q22: Explain the runtime difference between `export =` and `export default`.**

> `export = X` models CommonJS `module.exports = X` — a single value is the entire module. `export default` is an ESM named export called `default`. Consuming `export =` the native way is `import X = require("mod")`; consuming it with `import X from "mod"` requires `esModuleInterop`/`allowSyntheticDefaultImports`. Mixing them wrong is the classic interop bug.

**Q23: Your strict TS project depends on a JS-only package with subtly wrong DefinitelyTyped types that mark a nullable field as non-null. What's the risk and the fix?**

> The risk is a real `null`-deref at runtime that the type system claims is impossible — types are promises, not guarantees. Fix by correcting the types via module augmentation or a local `.d.ts`, and by validating the value at the boundary with a runtime schema (Zod/Valibot) for anything security- or correctness-critical.

**Q24: How do you incrementally enable strictness in a mixed JS/TS codebase without blocking the team?**

> Start with `strict: false` but turn on individual flags as the codebase tolerates them: `noImplicitAny`, then `strictNullChecks`, etc. Use `// @ts-check` per file to opt JS files in gradually. Convert leaf modules first. Gate CI on `tsc --noEmit` so new code stays clean while legacy is migrated.

**Q25: What are the failure modes of `skipLibCheck: true` and how do you mitigate them in a library you publish?**

> It can hide internally inconsistent declarations in dependencies and in your own emitted `.d.ts`. For a published library, run a *separate* CI job without `skipLibCheck` (and ideally `tsc` against the emitted `.d.ts`) so consumers don't inherit broken types, while keeping `skipLibCheck` on for the fast inner-loop build.

---

## Professional / Deep-Dive Questions

**Q26: Describe exactly what `esModuleInterop` emits and why consistency across a dependency graph matters.**

> It emits helpers: `__importDefault(mod)` wraps a CJS module so `.default` returns the module itself when it lacks `__esModule`, and `__importStar(mod)` builds a namespace object with a synthetic `default`. Because these change the *value* a default/namespace import yields, a library compiled with interop on and consumed by code compiled with it off (or vice versa) can resolve a default to different values. Hence the docs recommend the whole graph agree, and libraries document their assumption.

**Q27: How does TypeScript decide whether a `.ts` file emits as CJS or ESM under `nodenext`?**

> By Node's own rules, which TS mirrors: the nearest `package.json` `"type"` field (`module` → ESM, `commonjs` or absent → CJS) plus the file extension (`.mts`/`.mjs` always ESM, `.cts`/`.cjs` always CJS). This per-file format determination drives import-extension requirements, default-import behavior, and which top-level features are allowed.

**Q28: You need to ship a TS library consumable from both JS and TS, CJS and ESM. What's your interop strategy?**

> Author in TS with `verbatimModuleSyntax`. Emit dual builds (`.cjs` and `.mjs` or separate `tsconfig`s) and provide a `package.json` `"exports"` map with `import`/`require`/`types` conditions. Emit `.d.ts` (and ideally per-format `.d.cts`/`.d.mts`). Validate the published types with a tool like `@arethetypeswrong/cli` and a no-`skipLibCheck` CI check.

**Q29: How do `typeRoots` and `types` differ, and when do they matter for interop performance?**

> `typeRoots` lists the *folders* scanned for ambient `@types` packages (default `node_modules/@types` up the tree). `types` is an *allow-list* of specific packages to auto-include (e.g. `["node"]`), turning off automatic inclusion of everything else. In large monorepos, narrowing `types` prevents unintended global pollution and speeds checking by not loading every `@types` package.

**Q30: Explain declaration merging in the context of augmenting an untyped or third-party module.**

> TypeScript merges multiple declarations of the same `interface` (and `namespace`) name. For module augmentation, you `declare module "lib" { ... }` inside a module file (with imports/exports present) to *add* members to an existing module's types rather than replace them. This is how you patch a wrong `@types` package or add a plugin's properties to a host library's interface without forking the types.

---

## Rapid-Fire Round

**Q31: Default of `allowJs`?** → `false`.

**Q32: Default of `checkJs`?** → `false`.

**Q33: Does `checkJs` modify your JS at runtime?** → No, it only reports errors.

**Q34: Per-file way to enable JS checking?** → `// @ts-check`.

**Q35: Per-file way to disable checking?** → `// @ts-nocheck`.

**Q36: Which suppression is self-cleaning?** → `// @ts-expect-error`.

**Q37: Where do `@types/*` packages come from?** → DefinitelyTyped.

**Q38: Should `@types/*` be a prod or dev dependency?** → Dev.

**Q39: JSDoc tag to define a named type?** → `@typedef`.

**Q40: JSDoc tag for generics?** → `@template`.

**Q41: What models CommonJS `module.exports = x` in a `.d.ts`?** → `export = x`.

**Q42: Flag that fixes `import express from "express"` against CJS?** → `esModuleInterop`.

**Q43: Flag that speeds builds by skipping `.d.ts` checks?** → `skipLibCheck`.

**Q44: Bare shim that types a module as `any`?** → `declare module "lib";`.

**Q45: Error code for a missing declaration file?** → `TS7016`.

**Q46: Flag replacing `importsNotUsedAsValues`?** → `verbatimModuleSyntax`.

---

## Scenario Questions

**S1: A teammate added `// @ts-ignore` above a line that no longer has an error. Six months later that line breaks but CI stays green. Why, and what should have been used?**

> `@ts-ignore` suppresses *any* error on the next line forever, including new ones, so the new break is hidden. They should have used `@ts-expect-error`, which would have errored as soon as the original problem was fixed (prompting removal) and would not silently swallow the later break.

**S2: After enabling `allowJs`, `tsc` fails with `TS5055: Cannot write file ... because it would overwrite input file`. What's wrong?**

> `allowJs` is emitting JS, but there is no `outDir`, so the compiler would write the output next to the input `.js` and overwrite it. Set a distinct `outDir` (and `rootDir`) so emit lands in a separate folder.

**S3: A default import works locally with your bundler but the library's published types break for a consumer using plain `tsc` with `esModuleInterop:false`. What happened?**

> Your bundler performs interop at runtime, so locally the default import resolves fine. The consumer's `tsc` without `esModuleInterop` does not synthesize a default, so the type-level (and emitted-require) shape mismatches. Fix: don't rely on synthetic defaults in published code, or document/ship dual builds and correct types; the consumer can also enable `esModuleInterop`.

**S4: You install `@types/some-lib`, but TypeScript still says it can't find the declaration. Why might that be?**

> Possibilities: the package name differs from the `@types` name (scoped packages map to `@types/scope__name`); the `@types` package is for a different major version; `types`/`typeRoots` in your config excludes it; or the import specifier doesn't match the declared module name. Check `npm ls`, the DT readme, and your `types`/`typeRoots` settings.

**S5: In a checked `.js` file, `document.getElementById("x").value` errors because the element type is `HTMLElement | null`. How do you fix it with JSDoc only?**

> Use a JSDoc cast: `const el = /** @type {HTMLInputElement} */ (document.getElementById("x"));` then access `el.value`. You assert the specific element type without converting the file to TypeScript — and ideally still null-check at runtime.

**S6: A monorepo build is slow and occasionally errors with conflicting `@types/node` versions. What's going on and what are two fixes?**

> Two different `@types/node` versions are hoisted into the dependency tree (or duplicated per package), so the compiler loads conflicting global declarations. Fix 1: enable `skipLibCheck` so the conflicting `.d.ts` bodies aren't checked. Fix 2: deduplicate/pin a single `@types/node` version across the workspace (npm/yarn/pnpm resolutions or `overrides`), and narrow `types` to the packages each project actually needs.

**S7: You convert a JSDoc-typed `.js` file to `.ts` and suddenly get errors that weren't there before. Why?**

> JS checking is intentionally looser than TS checking (the handbook documents this). When you convert, full TS strictness applies — implicit `any`, property declarations, and stricter inference now surface real issues that the JS-mode leniency tolerated. The errors were latent; the conversion exposed them. Fix them incrementally, leaf-first.

**S8: A `.d.ts` you wrote uses `export default` but consumers using `import x = require(...)` get the wrong value. What's the mismatch?**

> `export default` is an ESM concept; `import = require` expects a CJS `export =` single-value shape. The two model different runtime structures. Decide which the runtime actually is: if the JS does `module.exports = X`, declare `export = X`; if it does `export default X` (ESM), keep `export default`. Don't mix the declaration form with the wrong consumption syntax.

**S9: After turning on `verbatimModuleSyntax`, the build fails on imports that used to work. Why, and is that good?**

> `verbatimModuleSyntax` forbids ambiguous elision: a value-position import of something used only as a type must become `import type`, and you can't re-export a type with a plain `export`. The failures are the compiler forcing you to make value-vs-type intent explicit. It's good — it removes the guesswork that caused inconsistent CJS/ESM emit.

**S10: A teammate proposes deleting all `@types/*` packages to "speed up the build." Good idea?**

> No — `@types/*` are how untyped libraries get types; deleting them turns those imports into `any` (or `TS7016` errors under `noImplicitAny`), losing safety. The right speed levers are `skipLibCheck`, a narrowed `types` list, and `incremental` builds — none of which sacrifice type information the way deleting `@types` would.

---

## Code-Reading Round

**C1: What does this report under `// @ts-check`?**

```typescript
// @ts-check
/** @param {number[]} xs */
function total(xs) {
  return xs.reduce((a, b) => a + b, 0);
}
total("1,2,3");
```

> A type error: `Argument of type 'string' is not assignable to parameter of type 'number[]'`. The JSDoc `@param {number[]}` is enforced because of `// @ts-check`.

**C2: Does this emit any JavaScript?**

```typescript
declare const FEATURE_FLAG: boolean;
declare function track(name: string): void;
```

> No. `declare` produces no runtime code; both lines are erased at emit. If `FEATURE_FLAG`/`track` aren't actually defined at runtime, using them throws a `ReferenceError`.

**C3: With `esModuleInterop:true`, what is `fs` here?**

```typescript
import fs from "node:fs";
fs.readFileSync("x");
```

> `fs` is the whole `module.exports` object of the `fs` CommonJS module, made available as a synthetic default by the interop helper. `fs.readFileSync` works because the default *is* the module namespace.

**C4: What's wrong with this `.d.ts`?**

```typescript
// shim.d.ts
declare module "thing" {
  export const x = 42;
}
```

> `export const x = 42` includes an initializer (a value), which a declaration context doesn't allow — it should be a type-only declaration: `export const x: number;`. Declaration files describe shapes; they don't assign runtime values.

**C5: Which import is erased and which is kept under `verbatimModuleSyntax`?**

```typescript
import type { A } from "./a";
import { b } from "./b";
```

> `import type { A }` is always erased (type-only). `import { b }` is kept verbatim as a runtime import because `b` is a value import. This predictability is the point of `verbatimModuleSyntax`.

**C6: What is the type of `mod` here, and why is that dangerous?**

```typescript
// types/legacy.d.ts
declare module "legacy";

// app.ts
import mod from "legacy";
mod.anything().you().want();
```

> `mod` is `any`, because a bare `declare module "legacy";` types the entire module as `any`. It is dangerous because every access through it is unchecked — typos, wrong arguments, and non-existent methods all compile and only fail at runtime. Prefer a real shim that types the surface you use.

**C7: Will this compile under `noImplicitAny`, and what does it return?**

```typescript
// util.js (checkJs off, allowJs on)
function pick(obj, key) {
  return obj[key];
}
module.exports = { pick };
```

> Yes, it compiles. With `checkJs` off, the `.js` file participates (because `allowJs` is on) but is not type-checked, so the implicit `any` on parameters is not reported. A consumer importing `pick` gets the inferred CJS export shape, with `pick` typed loosely. Turning on `checkJs`/`// @ts-check` would surface the implicit `any`.

---

## Whiteboard / Explain-It Questions

**E1: Draw the order in which TypeScript looks for types when you `import x from "some-lib"`.**

> 1) the package's `package.json` `types`/`typings` field or `exports.types` condition; 2) a bundled `index.d.ts` / sibling `.d.ts`; 3) an installed `@types/some-lib`; 4) a local `declare module "some-lib"` shim. If all fail → implicit `any`, or `TS7016` under `noImplicitAny`.

**E2: Explain, in one sentence each, the four "directive" comments.**

> `// @ts-check` enables checking for one JS file; `// @ts-nocheck` disables checking for one file; `// @ts-ignore` suppresses any error on the next line; `// @ts-expect-error` suppresses the next line's error and errors if there is none.

**E3: A junior asks "why don't types protect me at runtime?" — answer it.**

> Because types are *erased* during compilation — the emitted JavaScript contains no type information. Types catch mistakes at *compile* time, but a wrong `.d.ts`, an `any`, or untrusted external data can still produce a runtime value that violates the declared type. That's why you validate untyped boundaries at runtime.

**E4: When is writing a `.d.ts` better than converting the `.js` to `.ts`?**

> When you cannot or should not modify the source — third-party libraries in `node_modules`, generated code, or a large legacy file you want typed *from the outside* without touching its logic. A `.d.ts` describes the existing JS; conversion rewrites it.

**E5: Explain the difference between `module` and `moduleResolution` and why they must agree.**

> `module` controls the *emit* format (what import/export syntax the output uses — `commonjs`, `esnext`, `nodenext`). `moduleResolution` controls *how the compiler finds* a module from its specifier (`node10`, `node16`, `nodenext`, `bundler`). They must be coherent because resolving a specifier the Node-ESM way but emitting CJS (or vice versa) produces code Node can't run or types that don't match runtime. Typical coherent pairs: `nodenext`/`nodenext`, or `esnext`/`bundler`.

**E6: Walk through what happens when a CJS module is default-imported into ESM with and without `esModuleInterop`.**

> Without interop: ESM has no real `default` on the CJS object, so `import x from "cjs"` errors (`TS1259`) or, if forced, `x` is `undefined` at runtime. With interop: the compiler emits an `__importDefault` helper that returns the whole `module.exports` as the default when the module lacks `__esModule`, so `x` is the CJS export object and behaves as expected.

---

## Trade-off & Judgement Questions

**T1: When would you NOT enable `skipLibCheck`?**

> In a library you publish: you want CI to validate your own emitted `.d.ts` so consumers don't inherit broken types. Keep `skipLibCheck` for the fast inner-loop build, but run one CI job with `skipLibCheck:false` (ideally against the packed types) to catch declaration bugs.

**T2: Is it ever right to use `// @ts-ignore` instead of `// @ts-expect-error`?**

> Rarely. `@ts-ignore` is justified only when the error is *intermittent* — e.g. it appears in some environments/configs but not others, so `@ts-expect-error` would itself error in the configs without the underlying problem. Even then, document it heavily; in almost all single-config codebases, `@ts-expect-error` is strictly better.

**T3: You're starting a greenfield project. Should you bother with any interop flags?**

> Mostly no — start in pure TypeScript with `strict` on. You'll still set `esModuleInterop` (for clean CJS imports of Node/npm packages) and `skipLibCheck` (for build speed), but you can skip `allowJs`/`checkJs`/JSDoc entirely. Interop tooling shines in *migration* and *consuming untyped libraries*, not greenfield authoring.

**T4: A library you depend on ships its own types AND there's a `@types/x` package. Which wins, and what should you do?**

> The library's bundled types win (resolved before `@types`), so the `@types/x` package is redundant and possibly stale. Uninstall `@types/x` to avoid confusion and version drift. If the bundled types are wrong, patch them via module augmentation rather than reinstalling the `@types` package.

---

## Summary of Key Distinctions

| Pair | Difference |
|------|-----------|
| `allowJs` vs `checkJs` | Admits JS into the program vs type-checks that JS |
| `@ts-ignore` vs `@ts-expect-error` | Silent forever vs self-cleaning |
| `esModuleInterop` vs `allowSyntheticDefaultImports` | Changes emit + types vs type-only |
| `export =` vs `export default` | CJS single value vs ESM `default` export |
| `.d.ts` vs converting to `.ts` | Describe JS from outside vs rewrite it |
| `module` vs `moduleResolution` | Emit format vs specifier resolution |
| `types` vs `typeRoots` | Allow-list of packages vs folders to scan |
| `skipLibCheck` on app vs library | Speed win vs risk shipping bad `.d.ts` |

---

## Deeper Follow-Ups

**D1: How does declaration merging let you fix a wrong third-party type without forking?**

> TypeScript merges multiple `interface` (and `namespace`) declarations of the same name. To patch a library, you create a `.d.ts` that *imports* the module (marking it an augmentation) and re-`declare module "lib"` adding or refining members on its existing interfaces. The compiler merges your declarations with the upstream ones, so you override only what's wrong while keeping the rest — no fork, no patched `node_modules`.

**D2: What is the difference between an ambient module *declaration* and a module *augmentation*, and how does TypeScript tell them apart?**

> Both use `declare module "name"`. If the containing file has no top-level `import`/`export` (it's a global script), the block is a full ambient *declaration* and *replaces* the module's types. If the file is a module (has an `import`/`export`), the block is an *augmentation* that *merges* into the existing types. The presence of an `import "name";` (or any top-level import/export) is what flips it from replace to merge.

**D3: Why might `import * as X from "cjs"` be non-callable even though the CJS module is a function?**

> Under `esModuleInterop`, a namespace import produces an immutable namespace *object* (per the ES spec), not the original `module.exports` function. The function lives on the synthetic `default` member instead. So `X()` is illegal, but `import X from "cjs"; X()` works because the default import *is* the callable export.

**D4: When converting JSDoc to TS, what's a good ordering and why?**

> Convert *leaf* modules first (files nothing imports types from, or only depend on already-typed code). This minimizes cascading errors: a converted file's stricter types can surface errors in its dependents, so doing leaves first keeps each step's blast radius small. Hot, frequently-edited files come next for the biggest DX payoff.

**D5: A consumer reports your package's default import is `undefined` at runtime. Diagnose.**

> Likely an `export =`/`export default`/interop mismatch. If your runtime does `module.exports = X` but your `.d.ts` says `export default X`, an ESM consumer's default resolves wrong without interop helpers. Verify the actual runtime shape, declare it correctly (`export =` for CJS single value), test with both `import` and `require`, and run `@arethetypeswrong/cli` to confirm the published shape matches the declarations.

---

## More Junior Questions

**JQ1: What file extension does a declaration file use?**

> `.d.ts`. It contains only type declarations and emits no JavaScript.

**JQ2: If you rename `app.js` to `app.ts`, will it usually still compile?**

> Yes — because TypeScript is a superset of JavaScript, most valid JS is valid TS. You may see new errors only once you enable strict checks; the file itself stays runnable.

**JQ3: What command installs the community types for `express`?**

> `npm install --save-dev @types/express`.

**JQ4: Does `// @ts-nocheck` work in `.ts` files too?**

> Yes. `// @ts-nocheck` disables checking for the file whether it's `.ts` or `.js`. `// @ts-check` is the one that's specifically about turning checking *on* for `.js`.

**JQ5: What's the simplest way to silence "Could not find a declaration file for module 'x'"?**

> Add a one-line `declare module "x";` in a `.d.ts` on your include path. It types the module as `any` — a quick unblock, to be replaced with real types later.

---

## More Middle Questions

**MQ1: What does `@type {import("./models").User}` do in JSDoc?**

> It references a type declared in another module from within a JSDoc comment in a `.js` file, without a runtime import. TS 5.5+ also offers the `@import` tag for the same purpose.

**MQ2: Why is `checkJs` "looser" than checking a `.ts` file?**

> The handbook documents JS mode as intentionally more permissive: property declarations are inferred from constructor assignments, functions can have arbitrary properties, CommonJS export forms are recognized, and some strictness is relaxed — so idiomatic untyped JS passes without forcing TS syntax.

**MQ3: How do you cast in a `.js` file using JSDoc?**

> Wrap the expression in parentheses preceded by a `@type` comment: `const el = /** @type {HTMLInputElement} */ (document.getElementById("x"));`. The parentheses are required.

**MQ4: What's the risk of `skipLibCheck` for an application (not a library)?**

> A genuinely broken `.d.ts` in a dependency won't be reported. For apps this is usually acceptable; for libraries it risks shipping bad types.

---

## Mock Interview Transcript (Senior)

> A short illustrative exchange to model how to *reason aloud*.

**Interviewer:** "We have a 500-file React app in plain JS. Leadership wants TypeScript but we can't stop feature work. Plan?"

**Candidate:** "I'd make adoption additive so the app keeps shipping. First, add a `tsconfig.json` with `allowJs:true`, `checkJs:false`, `strict:false`, `skipLibCheck:true`, and wire `tsc --noEmit` into CI as a non-blocking report. Nothing breaks yet — JS still compiles. Then I'd install `@types/react`, `@types/node`, and types for our dependencies, shimming the few without `@types`. Next, file-by-file I'd add `// @ts-check` plus JSDoc to the most error-prone modules, starting with leaves. Once a cluster is clean, I convert those to `.ts`. I'd flip on `noImplicitAny`, then `strictNullChecks`, then full `strict`, gating CI on each as the codebase tolerates it. Throughout, I'd ban bare `@ts-ignore` via eslint and require reasons on `@ts-expect-error`, and validate untyped boundaries (API responses) with a schema library. The metric I'd report is percentage of `.ts` files and number of remaining suppressions, trending down."

**Interviewer:** "What breaks first when you turn on `strict`?"

**Candidate:** "Usually `strictNullChecks` — code that assumed values were always present now sees `T | null | undefined`, especially DOM lookups and optional props. I'd enable it last and fix per-module, using `@ts-expect-error` with reasons only as a temporary bridge."

---

## Final Rapid-Fire

**F1: Tag to define a function type in JSDoc?** → `@callback`.

**F2: Tag to apply `satisfies` in JSDoc?** → `@satisfies` (TS 4.9+).

**F3: Error when a relative import lacks `.js` under `nodenext`?** → `TS2835`.

**F4: Error when `@ts-expect-error` has no error to suppress?** → `TS2578`.

**F5: Flag that emits imports/exports verbatim?** → `verbatimModuleSyntax`.

**F6: Where must `// @ts-check` appear?** → At the very top of the file, before any code.

---

## Common Misconception Checks

These are framed as "true or false" so an interviewer can probe quickly.

**M1: "Installing `@types/lodash` adds runtime code to my bundle."**

> False. `@types/*` packages contain only `.d.ts` files. They are erased at compile time and never ship to production. The feeling that they "add code" comes from installing them via npm like real dependencies.

**M2: "`checkJs` rewrites or transforms my JavaScript."**

> False. `checkJs` only reports diagnostics. It never changes JS semantics. Even when `allowJs` emits output, the JavaScript behavior is unchanged — type-checking and emit are separate concerns.

**M3: "`declare const X` creates the variable `X` at runtime."**

> False. `declare` is erased and emits nothing. If `X` isn't actually defined by some other runtime code, using it throws `ReferenceError`.

**M4: "A `.d.ts` can contain a small helper function implementation."**

> False. Declaration files are declarations only. A function with a body in a `.d.ts` is `TS1183` ("an implementation cannot be declared in ambient contexts").

**M5: "`esModuleInterop` only affects type-checking."**

> False. It changes *emit*: it adds `__importDefault`/`__importStar` runtime helpers. `allowSyntheticDefaultImports` is the type-only one.

**M6: "`exclude` guarantees a file is never compiled."**

> False (and a classic interop gotcha during migration). `exclude` filters the initial file discovery; an excluded file imported by an included one is still pulled in through the module graph.

---

## How to Prepare

To be ready for an interop interview, be able to:

1. **Explain the superset/erasure model** — why mixing works and why types don't protect runtime.
2. **Configure a mixed project from scratch** — `allowJs`, `checkJs`, `esModuleInterop`, `skipLibCheck`, coherent `module`/`moduleResolution`.
3. **Type an untyped library three ways** — `@types`, a real `.d.ts`/`declare module`, and a bare any-shim, knowing the trade-offs.
4. **Write JSDoc types** — `@param`, `@returns`, `@typedef`, `@callback`, `@template`, and the parenthesized `@type` cast.
5. **Diagnose interop errors by code** — `TS7016`, `TS1259`, `TS5055`, `TS2835`, `TS2578`, `TS2669`.
6. **Describe CJS/ESM interop** — `export =` vs `export default`, default/namespace imports, dynamic `import()` from CJS, dual-package publishing.
7. **Reason about a migration plan** — additive adoption, leaf-first conversion, incremental strictness, suppression hygiene, boundary validation.

Practice by explaining each out loud, then by actually wiring a small mixed repo and reproducing every error code above.

---

## One-Line Takeaways

- **Interop exists** because TypeScript is a superset of JavaScript and erases types at emit.
- **`allowJs`** admits JS; **`checkJs`** (or `// @ts-check`) type-checks it.
- **`.d.ts`** describes JS shapes; **`declare`** asserts runtime existence without emitting.
- **`@types/*`** (from DefinitelyTyped) are dev-only, erased, community type packages.
- **`@ts-expect-error`** beats **`@ts-ignore`** because it is self-cleaning.
- **`esModuleInterop`** changes emit so default imports of CJS work; **`allowSyntheticDefaultImports`** is type-only.
- **`skipLibCheck`** trades `.d.ts` validation for build speed — safe for apps, risky for published libraries.
- **Types are promises, not guarantees** — validate untrusted, untyped boundaries at runtime.

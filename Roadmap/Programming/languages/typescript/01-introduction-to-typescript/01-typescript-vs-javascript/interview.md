# TypeScript vs JavaScript — Interview Questions

> 25+ questions across Junior, Middle, Senior, and Professional levels.
> Each answer is concise but complete enough to satisfy a real interviewer.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Conceptual Clarifications](#conceptual-clarifications)
6. [Scenario / Discussion Questions](#scenario--discussion-questions)
7. [Rapid-Fire Round](#rapid-fire-round)
8. [Whiteboard / Code-Reading Questions](#whiteboard--code-reading-questions)
9. [Common Wrong Answers (and Why)](#common-wrong-answers-and-why)

---

## Junior Questions

### Q1: What does "TypeScript is a superset of JavaScript" mean?

It means every valid JavaScript program is also a valid TypeScript program. You can rename a `.js` file to `.ts` and it generally compiles. TypeScript *adds* features (types, interfaces, generics, enums) on top of JavaScript without removing or changing any existing JavaScript syntax. The practical consequence is that adoption can be gradual — you don't rewrite, you annotate file by file.

### Q2: What is the difference between static and dynamic typing?

**Dynamic typing** (plain JavaScript) means a variable's type is whatever value it currently holds, and type mistakes are only discovered when the code runs. **Static typing** (TypeScript) means types are checked at compile time, before the program runs — so a type mismatch shows up as an editor error or a `tsc` failure, often seconds after you type it, rather than as a runtime crash in production.

### Q3: When are TypeScript type errors caught — at compile time or runtime?

At **compile time**. The TypeScript compiler (`tsc`) or your editor's language service analyzes the code statically and reports type errors before anything executes. This is the core value proposition over plain JavaScript, which only surfaces type errors at runtime.

### Q4: Do TypeScript types exist at runtime?

**No.** Types are *erased* during compilation. Interfaces, type aliases, type annotations, and generic parameters produce no JavaScript output. At runtime your program is plain JavaScript with no type information, which is why you cannot do `if (x instanceof MyInterface)` — the interface simply does not exist when the program runs.

### Q5: Does TypeScript make my application run faster or slower?

Neither — it has **zero runtime impact**. Because types are erased, the emitted JavaScript is essentially what a JavaScript author would have written by hand. The only "cost" is the build step during development, which affects compile time, not runtime performance.

### Q6: What does TypeScript add that JavaScript doesn't have?

Static type annotations, `interface` and `type` aliases, generics, enums, `as`/`satisfies` assertions, and access modifiers on class fields. Beyond syntax, it adds vastly better **tooling**: autocomplete (IntelliSense), inline error reporting, safe rename-refactoring across a whole codebase, and jump-to-definition powered by the type information.

### Q7: What is type inference? Give an example.

Type inference is TypeScript automatically determining a type without an explicit annotation. For example, `let count = 5` is inferred as `number`, so `count = "ten"` is an error. You don't have to write `let count: number = 5`. The idiom is: annotate function boundaries, let inference handle locals.

### Q8: What is the difference between compiling and transpiling here?

In TypeScript's case the terms are used interchangeably. The compiler `tsc` does two things during emit: (1) strips the types, and (2) optionally **downlevels** modern JavaScript syntax to an older `target` (e.g. ES5). Because the output language is also JavaScript (just an older or stripped version), people call it "transpilation." There is no machine code involved.

### Q9: When would you choose plain JavaScript over TypeScript?

For tiny one-off scripts, quick throwaway prototypes, simple automation, or contexts where adding a build step is not worth the friction (e.g. a 20-line glue script). For anything with multiple contributors, a long lifespan, or non-trivial data shapes, TypeScript pays off quickly.

### Q9b: What file extension does TypeScript use, and what does `tsc` produce?

TypeScript source uses `.ts` (or `.tsx` for files with JSX). The compiler `tsc` reads those and produces `.js` files (plus optional `.d.ts` declaration files and `.js.map` source maps). The `.ts` files never run directly in a browser or Node — they must be compiled (or executed via a loader like `ts-node`/`tsx` that compiles on the fly).

### Q9c: If I already know JavaScript, how much of TypeScript do I already know?

Roughly all of the language *behavior* — variables, functions, objects, arrays, classes, async/await, the standard library, the event loop, closures, and prototypes are pure JavaScript and unchanged. What's new is purely additive: the syntax for **types** (annotations, interfaces, generics, enums) and the discipline of thinking about data shapes. That's why teams can adopt it incrementally without retraining from scratch.

---

## Middle Questions

### Q10: Explain type erasure and three of its consequences.

Type erasure means all type-only syntax is removed during compilation, leaving plain JavaScript. Consequences: (1) **zero runtime overhead** — no type metadata to process; (2) **no runtime type reflection** — you can't inspect a generic `T` or check `instanceof` against an interface; (3) **types are not validation** — a value asserted as `User` from `JSON.parse` is not actually checked at runtime, so external data still needs runtime guards.

### Q11: What is structural typing, and how does it differ from nominal typing?

Structural typing (what TypeScript uses) determines compatibility by **shape**: a value is assignable to a type if it has at least the required members, regardless of its declared name or any `implements` clause. Nominal typing (Java, C#) requires an explicit declaration that a class implements an interface. In TS, a plain object literal `{ name: "x" }` satisfies `interface Named { name: string }` with no declaration linking them.

### Q12: Why is `any` dangerous, and what should you use instead?

`any` opts out of type checking entirely: every property access, call, and assignment is allowed, so real bugs slip through and `any` propagates to derived values. Prefer `unknown` for genuinely unknown data — it's the safe top type that forces you to narrow (via `typeof`, `in`, or a type guard) before use. Also enable `noImplicitAny` to forbid accidental `any`.

### Q13: What's the difference between `unknown` and `any`?

Both can hold any value. The difference is on the **read** side: with `any`, you can do anything to the value with no checks. With `unknown`, you can assign anything *to* it, but you cannot *use* it (call it, access properties) until you narrow it to a specific type. `unknown` keeps type safety; `any` discards it.

### Q14: Does a program that type-checks always run without errors?

No. TypeScript checks the **code you wrote**, not the **data you receive at runtime**. A program can fully type-check and still crash on malformed JSON, an unexpected API response, or user input, because those values are asserted (typed) rather than validated. You need runtime validation (manual guards, or a library like Zod) at trust boundaries.

### Q15: What does it mean that TypeScript's type system is "intentionally unsound"?

The team deliberately chose productivity over provable correctness. Some operations are allowed even though they can be wrong at runtime: array indexing returns `T` not `T | undefined` (without `noUncheckedIndexedAccess`), type assertions (`as`) bypass checks, and `any` infects everything. A fully sound system would reject too much idiomatic JavaScript, so TypeScript catches the *common* mistakes while staying ergonomic.

### Q16: What's an excess property check, and when does it fire?

When you assign an **object literal directly** to a typed target, TypeScript flags properties not in the target type (to catch typos): `const p: Point = { x: 1, y: 2, z: 3 }` errors on `z`. But assign via an intermediate variable and the structural rule applies — extra properties are allowed. The literal-only check is a special-case safety net layered on top of structural typing.

### Q17: Why can't you use `instanceof` with an interface?

`instanceof` checks the prototype chain against a runtime **constructor/class**. An interface has no runtime existence — it's erased — so there is no value to check against. The compiler errors: "X only refers to a type, but is being used as a value." For runtime type discrimination, use a discriminated union with a `kind` field, or use a `class` (which does emit a constructor).

### Q18: How do you discriminate between members of a union at runtime if types are erased?

You keep a **runtime value** that carries the discriminant — typically a literal `kind`/`type` field — and switch on it. The type system narrows the union based on that runtime check (a discriminated union):

```typescript
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "square"; s: number };

function area(s: Shape): number {
  return s.kind === "circle" ? Math.PI * s.r ** 2 : s.s ** 2;
}
```

The `kind` string is real JavaScript data, so it survives erasure.

### Q18b: What is the difference between `interface` and `type`, and does it matter for the JS↔TS relationship?

Both describe shapes and both are **fully erased** — neither emits runtime JavaScript. Differences: `interface` supports declaration merging (two `interface Box {}` declarations combine) and is conventionally used for object/class contracts; `type` can express unions, intersections, tuples, mapped types, and conditional types that `interface` cannot. For the JS↔TS relationship the key point is that *both vanish at runtime*, so neither can be used with `instanceof` or inspected at runtime. Choose `interface` for extensible object shapes, `type` for unions and computed types.

### Q18c: Does TypeScript change how `==`, `0.1 + 0.2`, or `typeof null` behave?

No. TypeScript adds *no* new runtime semantics. `0.1 + 0.2` is still `0.30000000000000004`, `typeof null` is still `"object"`, `[] == ![]` is still `true`, and coercion rules are unchanged. TypeScript may *warn* you about some suspicious comparisons at compile time, but it never alters the runtime result — the emitted JavaScript runs on the exact same engines with the exact same quirks. TypeScript is a checker and translator, not a new language runtime.

### Q18d: Why does `JSON.parse` return `any`, and why is that a problem?

`JSON.parse` is typed to return `any` because the compiler genuinely cannot know the shape of arbitrary JSON text at compile time. The problem is that `any` then flows into your code with zero checking — `JSON.parse(raw).user.name` compiles even if `user` is missing, and crashes at runtime. The fix is to immediately treat the result as `unknown` (or run it through a schema validator) and narrow before use, converting the boundary from "trust" to "verify."

---

## Senior Questions

### Q19: How would you migrate a large JavaScript codebase to TypeScript incrementally?

Enable `allowJs` so `.js` and `.ts` coexist, add `checkJs`/JSDoc types where cheap, and convert files leaf-first (modules with no dependents). Start with `strict: false`, then ratchet flags on — `noImplicitAny` first, `strictNullChecks` last (it produces the most errors). Use a separate `tsconfig.strict.json` that `include`s only migrated folders, and gate CI on a monotonically increasing count of strict-passing files. Avoid wholesale `any` / `as` — they create debt that's hard to repay.

### Q20: A teammate says "if it compiles, ship it — types guarantee correctness." How do you respond?

Types guarantee that the **code is internally consistent** with the types you declared — they catch a large class of errors (typos, wrong shapes, null misuse). They do **not** guarantee: correct business logic, valid runtime data, or that your `as` assertions were truthful. External boundaries (HTTP, DB, files, user input) must be validated at runtime with guards or a schema library, because the declared types there are assumptions, not proofs.

### Q21: What runtime cost, if any, does using generics extensively add?

None. Generics are a pure compile-time feature — type parameters are erased entirely. `function identity<T>(x: T): T` compiles to `function identity(x) { return x; }`. There is no monomorphization (unlike C++ templates or Rust generics) and no runtime type passing (unlike Java's bounded erasure with bridge methods in some cases). The generic system exists only to type-check call sites.

### Q22: Compare TypeScript's relationship to JavaScript with how a language like Dart or Kotlin relates to its runtime.

TypeScript is a **transparent superset**: it compiles to readable JavaScript, types erase fully, and there's no separate runtime — it runs on the exact same JS engines. Kotlin/Dart compile to a target (JVM bytecode / native / their own JS output) and ship their own runtime semantics and standard library. TypeScript deliberately imposes **no runtime, no new semantics, no standard library of its own** — `0.1 + 0.2`, the event loop, prototypes, and `Array.prototype.map` are all just JavaScript.

### Q23: When does adding TypeScript NOT pay off, from an engineering-economics view?

When the build/tooling overhead exceeds the bug-prevention value: throwaway scripts, very small stable codebases that rarely change, environments where you can't add a build step, or teams with zero TS experience under extreme deadline pressure (the learning curve tax hits first). Also, if a codebase is drowning in `any`, you pay the cost (build step, ceremony) without the benefit (real type safety) — that's the worst of both worlds.

### Q24: Explain why `tsc` emits JavaScript even when there are type errors, and when you'd change that.

By design, type checking and emit are **decoupled** — type errors are diagnostics, not hard stops, so you can run partially-typed code during development (e.g. mid-migration). For CI and production builds you typically set `noEmitOnError: true` so a type error blocks output, or run `tsc --noEmit` purely as a checker while a bundler (esbuild/SWC) does the actual transpilation.

### Q25: What are the trade-offs of `class` vs `interface` for modeling data, given erasure?

An `interface` is purely a compile-time contract — zero runtime footprint, supports declaration merging, ideal for describing the shape of plain objects and external data. A `class` emits a real constructor and prototype, supports `instanceof`, can carry methods and `private` state, but has runtime cost and forces a `new`. For data transfer objects, prefer `interface`/`type`; reach for `class` when you need runtime identity, `instanceof` checks, or encapsulated behavior.

### Q25b: How do you simulate nominal typing in TypeScript, and when is it worth it?

Use **branded** (a.k.a. opaque/tagged) types: intersect the base type with a phantom marker, e.g. `type UserId = string & { readonly __brand: "UserId" }`. The brand exists only at compile time (erased to a plain string at runtime), so two branded strings are mutually incompatible despite identical runtime shape. It's worth it when structurally-identical values mean different things and mixing them is dangerous — IDs of different entities, units of measure, validated-vs-raw strings (e.g. `SanitizedHtml`). The cost is a small constructor/cast at creation points; the payoff is the compiler catching mixups structural typing would miss.

### Q25c: A library you depend on has no TypeScript types. What are your options?

Three options, in order of preference: (1) install community types from DefinitelyTyped — `npm i -D @types/the-lib` — which ships `.d.ts` files separate from the runtime code; (2) if none exist, write a minimal local declaration file (`the-lib.d.ts`) with `declare module "the-lib"` typing only the parts you use; (3) as a last resort, type the import as `any`/`unknown` and narrow at usage. This works because TypeScript separates *types* (`.d.ts`) from *runtime code* (`.js`) — you can add types to plain JS packages without touching their runtime.

### Q25d: Explain why TypeScript can give plain-JavaScript users IntelliSense.

VS Code's JavaScript support is powered by the TypeScript language service. Even in a `.js` file with no annotations, the service infers types from usage, JSDoc, and `.d.ts` files shipped by dependencies, then provides autocomplete, error squiggles, and refactoring. This is the JS↔TS relationship working in reverse: TypeScript's analysis benefits JavaScript authors who never write a single type annotation, because the type *system* is decoupled from the type *syntax*.

---

## Professional / Deep-Dive Questions

### Q26: How do single-file transpilers (esbuild, SWC) differ from `tsc`, and what flags keep them safe?

Single-file transpilers strip types **per file** without whole-program type information, so they can't resolve constructs that need cross-file knowledge (`const enum` inlining, type-only re-export elision). Enable `isolatedModules` to reject those constructs and `verbatimModuleSyntax` to make import/export elision purely syntactic (`import type` is erased, plain imports are kept). With those flags, `tsc` (for type-checking) and the fast transpiler (for emit) agree on output.

### Q27: A type asserts a value is `User`, but production throws "cannot read property of undefined." Walk through the root cause.

The value came from a boundary (API/DB/JSON), where the `User` type was an **unverified assumption** — likely via `as User` or an untyped `JSON.parse`. Since types erase, nothing checked the actual shape at runtime; the field was missing and resolved to `undefined`. Root cause: treating a compile-time type as runtime validation. Fix: parse with a schema (Zod/Valibot) that both validates and produces the type, so the type guarantee is *earned* at runtime.

### Q28: Why does the team keep the type system structural and erasable instead of adding nominal types and runtime reflection?

Two design goals: *"use a consistent, fully erasable, structural type system"* and *"impose no runtime overhead."* Erasability guarantees zero-cost output and clean interop with the JS ecosystem (the emitted code is just JS). Structural typing matches how JavaScript objects are actually created — ad hoc bags of properties — so idiomatic JS isn't rejected. Adding runtime reflection would break erasability and impose overhead; nominal-by-default would reject common JS patterns. They offer opt-ins (branded types for nominal-ish behavior) instead of changing defaults.

### Q29: How would you give a TypeScript-typed library to consumers who write plain JavaScript?

Ship compiled `.js` plus generated `.d.ts` declaration files (`"declaration": true`). The `.d.ts` files carry the type information separately from the runtime code; JS consumers get full IntelliSense and type-checking (if they use an editor with the TS language service or enable `checkJs`), while still importing plain JavaScript at runtime. Point `package.json` `types`/`exports` at the `.d.ts`. This is exactly how DefinitelyTyped (`@types/*`) types untyped npm packages.

### Q30: Describe a scenario where structural typing causes a subtle, real bug.

Two unrelated concepts share a shape — e.g. `interface Meters { value: number }` and `interface Feet { value: number }`. Structurally they're identical, so a function expecting `Meters` silently accepts `Feet`, mixing units. The compiler can't catch it because by shape they're the same type. The fix is **branding** (nominal simulation): `type Meters = number & { __brand: "meters" }`, which makes the two incompatible despite identical runtime representation.

### Q31: Walk me through what `tsc` actually does, phase by phase.

Four phases. (1) **Parse**: the scanner/parser reads `.ts` source — whose grammar is JavaScript's grammar plus type syntax — into an AST. (2) **Bind**: names are resolved to symbols and scopes (same scoping as JS). (3) **Check**: the type checker verifies assignability and reports diagnostics — this is the only phase plain JavaScript lacks. (4) **Emit**: the emitter strips all type syntax and downlevels modern JS to the configured `target`, producing `.js` (plus optional `.d.ts` and source maps). Crucially, Check and Emit are independent, which is why type errors don't stop emit by default.

### Q32: Why did Microsoft design types to be fully erasable rather than reified?

Two stated design goals: *"use a consistent, fully erasable, structural type system"* and *"impose no runtime overhead."* Erasability guarantees the output is just JavaScript — perfect interop with the entire JS ecosystem, zero-cost runtime, and no new VM. Reified types (kept at runtime, like some Java/C# generics) would add overhead and break the clean superset relationship. The trade-off is that you can't reflect on types at runtime, which is why runtime validation libraries exist. It's a deliberate choice favoring ecosystem compatibility and zero cost over runtime introspection.

### Q33: How would you explain TypeScript's value to a skeptical senior JavaScript engineer?

I'd frame it as three concrete wins without changing their workflow much. (1) **Refactoring safety**: rename a field and every usage updates or errors — no more grep-and-pray across thousands of files. (2) **Self-documenting boundaries**: function signatures and data shapes become machine-checked documentation that can't go stale. (3) **A whole bug class eliminated**: `undefined is not a function`, typos in property names, and wrong-argument calls become compile errors. I'd stress it's gradual (adopt file by file), erasable (zero runtime cost, ship the same JS), and that they keep writing JavaScript — they just get a checker on top.

### Q34: What's the relationship between TypeScript versions and ECMAScript versions?

They're independent but interacting. ECMAScript (the JavaScript standard) defines runtime features; TypeScript both *consumes* them (via `lib`/`target` for which built-ins and syntax are available) and *adds type syntax* that ECMAScript does not have. TypeScript can target old ES versions (downleveling modern syntax) while letting you write modern code, and it often supports stage-3 TC39 proposals early (optional chaining, nullish coalescing, decorators). The type layer is purely TypeScript's; everything that runs is ECMAScript.

---

## Conceptual Clarifications

Quick, precise distinctions interviewers love to probe.

### Compile time vs runtime

- **Compile time**: when `tsc`/the editor analyzes your code. Types exist here. Errors appear here.
- **Runtime**: when the emitted JavaScript executes. Types are gone here. Only values exist.
- Every TS-vs-JS confusion is usually a mix-up of these two timelines.

### Type vs value

- A **type** (`interface`, `type`, annotation, generic param) is compile-time only — erased.
- A **value** (variable, function, object, `enum`, `class`) exists at runtime.
- `instanceof`, `typeof`, iteration, and reflection only work on *values*.

### Checking vs validation

- **Checking** (TypeScript): verifies your *code* against declared types, at compile time.
- **Validation** (Zod, manual guards): verifies your *data* at runtime.
- TypeScript does the first; you must do the second at trust boundaries.

### Stripping vs downleveling

- **Stripping**: removing type syntax. Always happens during emit.
- **Downleveling**: rewriting modern JS to an older `target`. Depends on the `target` option.
- Both occur in the Emit phase but answer different questions (types? vs JS version?).

### Superset vs subset

- TypeScript is a **superset** of JavaScript: every JS program is a TS program (syntactically).
- The reverse is false — TS is **not** a subset; type syntax is not valid JavaScript.
- The arrow only points down: TS compiles *to* JS, never the other way.

---

## Scenario / Discussion Questions

These are open-ended; an interviewer is probing your judgment, not a single fact.

### S1: Your team's TypeScript project is full of `any`. What's the impact and how do you fix it?

**Impact:** You're paying TypeScript's cost (build step, syntax overhead, type ceremony) while getting almost none of the benefit — `any` disables checking and propagates, so bugs flow through unchecked. It's the worst of both worlds.

**Fix:** Enable `noImplicitAny` to forbid accidental `any`, then add a lint rule (`@typescript-eslint/no-explicit-any`) to flag explicit ones. Triage: convert `any` at boundaries (function params, API responses) first, since those gate the most code. Replace external-data `any` with `unknown` + validation. Track the `any` count as a metric that must trend down, not up.

### S2: A junior asks "why did my code crash in production if TypeScript said it was fine?" How do you explain it?

I'd explain the compile-time / runtime split: TypeScript checks the *code you wrote* against the *types you declared*, before running. But types are **erased** — they don't exist at runtime — and the data your code receives (API responses, user input, JSON) is *asserted* to match a type, not *verified*. If the real data doesn't match (a missing field, a `null`), nothing catches it at runtime. The fix is runtime validation at the boundary. "If it compiles" guarantees internal consistency, not correct data.

### S3: A PR adds `// @ts-ignore` above a failing line to make CI pass. How do you respond in review?

`@ts-ignore` silences the *next* line's errors — including future, unrelated ones — so it hides real bugs and rots over time. I'd ask: what's the actual error? Usually it's a real type mismatch that should be fixed, or a genuine library typing gap. If it's a library gap, prefer `@ts-expect-error` (which errors if the line *stops* being an error, so it self-cleans) with a comment linking the issue. Blanket `@ts-ignore` is technical debt that defeats the point of using TypeScript.

### S4: When would you argue *against* migrating an existing JS project to TypeScript?

When the migration cost exceeds the benefit: a small, stable codebase that rarely changes; a tight deadline with a team that has zero TS experience (the learning curve hits productivity first); or a project that's about to be retired. Also if the codebase is mostly glue/scripts where data shapes are trivial. I'd quantify it: estimate bug-prevention value (how many shape/null bugs ship now) versus migration + ongoing build cost. TypeScript is a tool, not a religion.

### S5: How do you explain to a manager that "TypeScript doesn't make the app faster"?

I separate two timelines. *Build time*: TypeScript adds a compile step, so development builds take longer. *Runtime*: types are erased — the shipped JavaScript is identical to hand-written JS, so end users see zero performance difference. The real ROI isn't speed; it's fewer production bugs, faster onboarding (types document the code), and safe large-scale refactoring. I'd frame it as a maintenance and reliability investment, not a performance one.

---

## Rapid-Fire Round

| # | Question | Answer |
|---|----------|--------|
| 1 | Is all JS valid TS? | Yes (syntactically) |
| 2 | Is all TS valid JS? | No (types aren't JS syntax) |
| 3 | When are TS types checked? | Compile time |
| 4 | Do types exist at runtime? | No — erased |
| 5 | Runtime cost of types? | Zero |
| 6 | Safe alternative to `any`? | `unknown` |
| 7 | Nominal or structural typing? | Structural |
| 8 | Can you `instanceof` an interface? | No |
| 9 | Does `enum` emit JS? | Yes (non-const) |
| 10 | Does `interface` emit JS? | No |
| 11 | What strips types? | The emitter in `tsc` |
| 12 | Flag to block emit on error? | `noEmitOnError` |
| 13 | Flag to forbid implicit `any`? | `noImplicitAny` |
| 14 | Does `as` check at runtime? | No |
| 15 | Generics cost at runtime? | None — erased |
| 16 | Are types runtime validation? | No |
| 17 | Tool to validate at runtime? | Zod / Valibot / io-ts |
| 18 | `target` controls what? | Emitted JS language level |
| 19 | Who created TypeScript? | Microsoft (Anders Hejlsberg) |
| 20 | Is the type system sound? | No — intentionally |
| 21 | Year TypeScript was first released? | 2012 |
| 22 | Extension for TS with JSX? | `.tsx` |
| 23 | What does `.d.ts` hold? | Type declarations, no runtime code |
| 24 | Where do `@types/*` packages come from? | DefinitelyTyped |
| 25 | Does `const enum` emit a runtime object? | No — inlined |
| 26 | What does `satisfies` do? | Check without widening |
| 27 | Does TS change `0.1 + 0.2`? | No — same JS result |
| 28 | Flag for `T \| undefined` on index access? | `noUncheckedIndexedAccess` |
| 29 | Can JSDoc types check a `.js` file? | Yes — with `checkJs` |
| 30 | Better than `@ts-ignore`? | `@ts-expect-error` |

---

## Whiteboard / Code-Reading Questions

### W1: What does this print, and why?

```typescript
interface Animal { species: string; }
const cat: Animal = { species: "cat" };
console.log(typeof cat);
```

<details>
<summary>Answer</summary>

Prints `object`. `typeof` reports the **runtime** JavaScript type. The interface `Animal` is erased, so at runtime `cat` is just a plain object. There is no way for `typeof` to ever return `"Animal"`.

</details>

### W2: Will this compile? What happens at runtime?

```typescript
function double(x: number): number { return x * 2; }
const input: any = "5";
console.log(double(input));
```

<details>
<summary>Answer</summary>

It **compiles** — `any` is assignable to `number`, so the type checker raises no error. At runtime `"5" * 2` evaluates in JavaScript to `10` (string coercion), which is misleading; with `"abc"` it would be `NaN`. This shows how `any` lets type-unsafe values flow through and how erasure means no runtime guard catches it.

</details>

### W3: Why does the second assignment error but not the first?

```typescript
interface Point { x: number; y: number; }
const tmp = { x: 1, y: 2, z: 3 };
const a: Point = tmp;                  // OK
const b: Point = { x: 1, y: 2, z: 3 }; // Error
```

<details>
<summary>Answer</summary>

`a` is assigned from a variable, so the **structural** rule applies — `tmp` has at least `x` and `y`, extra `z` is fine. `b` is a **direct object literal**, which triggers the **excess property check** (a typo-catching safety net): `z` is not in `Point`, so it errors. Same shapes, different rule based on literal-vs-variable.

</details>

### W4: Fix this so the runtime data is actually safe.

```typescript
interface Config { port: number; }
function load(raw: string): Config {
  return JSON.parse(raw) as Config; // unsafe
}
```

<details>
<summary>Answer</summary>

The `as Config` is an unchecked assertion — erased at runtime, it validates nothing. Validate explicitly:

```typescript
function load(raw: string): Config {
  const data: unknown = JSON.parse(raw);
  if (
    typeof data === "object" && data !== null &&
    "port" in data && typeof (data as Record<string, unknown>).port === "number"
  ) {
    return data as Config;
  }
  throw new Error("Invalid config: 'port' must be a number");
}
```

Or use a schema library (`z.object({ port: z.number() }).parse(JSON.parse(raw))`).

</details>

### W5: Why is the unit bug not caught?

```typescript
interface Meters { value: number; }
interface Feet { value: number; }
function climb(height: Meters) { /* ... */ }
const f: Feet = { value: 100 };
climb(f); // accepted!
```

<details>
<summary>Answer</summary>

Structural typing: `Meters` and `Feet` have identical shapes (`{ value: number }`), so they're interchangeable to the compiler. To make them distinct, brand them:

```typescript
type Meters = number & { readonly __unit: "m" };
type Feet = number & { readonly __unit: "ft" };
```

Now `climb(f)` errors because the brands differ, even though both are `number` at runtime.

</details>

### W6: Will this compile under `strict`? What's the lesson?

```typescript
function parseAge(input: string): number {
  return parseInt(input);
}
const age = parseAge("not a number");
console.log(age + 1);
```

<details>
<summary>Answer</summary>

It **compiles** with no error — the types are all consistent (`string` in, `number` out, `number + number`). But at runtime `parseInt("not a number")` returns `NaN`, so `age + 1` is `NaN`. The lesson: TypeScript verifies the *types* line up, not that the *logic* or *runtime values* are correct. `parseInt` is genuinely typed to return `number`; it just returns `NaN` (which is a `number`) for bad input. Validate the result if it matters.

</details>

### W7: Why does this `as` "work" and why is it dangerous?

```typescript
const value: unknown = "hello";
const num = value as number;
console.log(num.toFixed(2)); // 💥 num.toFixed is not a function
```

<details>
<summary>Answer</summary>

`as number` is a compile-time assertion — it's erased, so it performs no runtime conversion or check. The compiler now *believes* `num` is a `number` and allows `.toFixed`, but at runtime `num` is still the string `"hello"`, which has no `toFixed`, so it throws. Lesson: `as` lies to the compiler without touching the runtime value. Only assert when you can prove the assertion is true (ideally via prior narrowing).

</details>

### W8: What does the emitted JavaScript look like for this file?

```typescript
interface Pet { name: string; }
type Mood = "happy" | "sad";

function describe(pet: Pet, mood: Mood): string {
  return `${pet.name} is ${mood}`;
}

const p = { name: "Rex" } as Pet;
describe(p, "happy");
```

<details>
<summary>Answer</summary>

The `interface Pet`, `type Mood`, both annotations, and the `as Pet` all vanish. The emitted JS is just:

```javascript
"use strict";
function describe(pet, mood) {
  return `${pet.name} is ${mood}`;
}
const p = { name: "Rex" };
describe(p, "happy");
```

Lesson: everything type-only is erased; the runtime code is exactly what a JavaScript author would write by hand — proving zero runtime overhead.

</details>

### W9: Why does this fail to narrow, and how do you fix it?

```typescript
function len(x: unknown): number {
  return x.length; // Error: 'x' is of type 'unknown'.
}
```

<details>
<summary>Answer</summary>

`unknown` cannot be used until narrowed — you must prove what `x` is at runtime before accessing `.length`. Fix:

```typescript
function len(x: unknown): number {
  if (typeof x === "string" || Array.isArray(x)) return x.length;
  return 0;
}
```

This is the whole point of `unknown` over `any`: it forces you to handle the "what is this actually?" question at compile time, since the type is erased and won't protect you at runtime.

</details>

---

## Common Wrong Answers (and Why)

| Wrong answer | Why it's wrong | Correct framing |
|--------------|----------------|-----------------|
| "TypeScript is a different language from JavaScript." | It's a *superset* — all JS is valid TS; same runtime, same semantics. | TS = JS + erasable types. |
| "TypeScript makes apps run faster." | Types are erased; runtime is identical to plain JS. | The win is build-time safety, not runtime speed. |
| "If it compiles, it can't crash." | Types are erased; external data is asserted, not validated. | Compile-time consistency ≠ runtime data safety. |
| "Use `any` to fix type errors quickly." | `any` disables checks and propagates, hiding bugs. | Use `unknown` and narrow, or type it properly. |
| "Interfaces exist at runtime, so I can `instanceof` them." | Interfaces are fully erased — no runtime value. | Use discriminated unions or classes. |
| "TypeScript uses nominal typing like Java." | It's structural — shape over name, no `implements` needed. | Compatibility is by members; brand for nominal. |
| "`tsc` won't emit JS if there are type errors." | By default it emits anyway (exits non-zero). | Set `noEmitOnError` to couple check and emit. |
| "Generics have a runtime cost like C++ templates." | Type parameters are erased; no monomorphization. | Generics are compile-time only, zero cost. |

**Interviewer tip:** The fastest way to show seniority on this topic is to consistently separate two axes — *compile time vs runtime* and *type vs value*. Almost every TS-vs-JS question reduces to one of those distinctions.

---

## Interview Preparation Checklist

Before a TypeScript interview that touches the TS↔JS relationship, make sure you can do each of these out loud, unprompted:

### Explain (30 seconds each)
- [ ] What "superset" means and why adoption is gradual.
- [ ] Static vs dynamic typing, with a concrete before/after.
- [ ] Type erasure and three of its consequences (zero cost, no reflection, no validation).
- [ ] Structural typing, and how it differs from nominal.
- [ ] Why TypeScript adds no runtime overhead.
- [ ] Why the type system is intentionally unsound.

### Write on a whiteboard (no IDE)
- [ ] A function migrated from untyped JS to typed TS.
- [ ] A discriminated union with an exhaustive `switch`.
- [ ] A user-defined type guard (`x is T`).
- [ ] A branded type for nominal-style distinction.
- [ ] Runtime validation that earns a type assertion.

### Defend a position
- [ ] When TypeScript is worth it — and when plain JS is the right call.
- [ ] Why `any` is a smell and what to use instead.
- [ ] Why "it compiles" does not mean "it's correct."

### Red flags to never say
- [ ] "TypeScript makes it faster at runtime." (It doesn't.)
- [ ] "Types validate my API data." (They don't — that's runtime validation.)
- [ ] "I'll just `any` it." (Defeats the purpose.)
- [ ] "I can `instanceof` an interface." (Erased — impossible.)

**Final framing for any answer:** TypeScript is JavaScript plus a compile-time type checker that disappears at runtime. Anchor every answer to that one sentence and you'll stay correct.

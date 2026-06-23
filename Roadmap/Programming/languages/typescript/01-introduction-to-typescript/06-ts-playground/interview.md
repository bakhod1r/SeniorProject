# TS Playground — Interview Questions

> 20+ questions across Junior, Middle, Senior, and Professional levels. Many are conceptual: they use the Playground as a lens to test your understanding of how TypeScript *behaves*, not just where the buttons are.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Scenario Questions](#scenario-questions)

---

## Junior Questions

### Q1: What is the TypeScript Playground and where do you find it?

> The official, free, browser-based TypeScript editor at **typescriptlang.org/play**. You write TypeScript on the left and see the compiled JavaScript, type errors, and `console.log` output on the right. It runs the real TypeScript compiler in your browser, so its results match `tsc`. It needs no installation, npm, or `tsconfig.json`.

### Q2: What does each output tab show?

> - **`.JS`** — the JavaScript your TypeScript compiled into.
> - **`.D.TS`** — the generated declaration file (types only, no implementation).
> - **Errors** — every type error the compiler found.
> - **Logs** — `console.*` output, shown after you press **Run**.
> - **Plugins** — extra tools like the AST viewer.

### Q3: Does the Playground stop your code from running when there are type errors?

> No. By default the emitted JavaScript runs even with type errors, because TypeScript types are erased before execution. This mirrors `tsc` without `noEmitOnError`. The Errors tab warns you, but **Run** still executes the JS.

```typescript
// This has a type error, yet it logs "five1" when you press Run:
let count: number = "five"; // Error: Type 'string' is not assignable to type 'number'
console.log(count + 1);     // runs anyway -> "five1"
```

> The type error is a *warning about* a likely runtime bug, not a blocker. Recognizing this distinguishes type-checking (compile time) from execution (runtime).

### Q4: How do you change the JavaScript version the Playground emits?

> Set the **`target`** compiler option in the config menu. For example, `target: ES5` downlevels arrow functions and classes; `target: ESNext` keeps modern syntax. The `.JS` tab updates to reflect the choice.

```typescript
// Paste this and flip `target` between ES5 and ESNext to see the .JS change:
const greet = (name: string) => `Hi ${name}`;
class Box {
  constructor(public value: number) {}
}
```

> At `ES5` the arrow function becomes a regular `function` and the class becomes prototype assignments; at `ESNext` both stay modern. This makes "what does `target` do?" concrete in seconds.

### Q5: How do you share your Playground code with someone?

> Copy the page URL or use the **Share** button. The entire state — your code, compiler options, and selected TS version — is encoded in the URL. Nothing is uploaded to a server; the link itself carries the data. The recipient opens the link and sees exactly what you see.

### Q6: Why can't you `import` a package like `lodash` and run it?

> The Playground has no `node_modules` and no real file system. It is a single-file sandbox. Type-only imports of some popular packages work via Automatic Type Acquisition, but you cannot install or *run* arbitrary npm packages. For that, use StackBlitz, CodeSandbox, or a local setup.

---

## Middle Questions

### Q7: How do you find the exact inferred type of a complex expression in the Playground?

> Hover the identifier for a quick tooltip. For complex types that the tooltip truncates, two tricks help: (1) assign the value to a `const _check: never = value` — the resulting error message prints the full type; (2) use a Twoslash `// ^?` query, which renders the type inline via the same `getQuickInfoAtPosition` API.

### Q8: A bug appears in your project but not in your Playground repro. Why?

> Almost always a mismatch in **compiler settings** or **TS version**. Your project may run `strict`, `noUncheckedIndexedAccess`, or a different `target`/`lib`, and may pin a different TypeScript version. Set the same flags and select the same version in the Playground before concluding anything.

### Q9: What makes a good minimal reproduction?

> It is **minimal** (smallest code that shows the behavior), **self-contained** (no external imports; helpers inlined), uses the **correct compiler settings**, is **version-pinned**, and has a **comment marking the line that matters**. The recipient should be able to open the link and immediately see and verify the behavior.

### Q10: How can you use the Playground to understand what a TypeScript feature does at runtime?

> Read the **`.JS` tab**. For enums, you see they compile to real runtime objects with reverse mappings; for `async`/`await` at `target: ES5`, you see a generator-based state machine; for decorators, you see helper calls. The `.JS` tab makes "what does this actually do?" a one-glance answer.

### Q11: What is the `.D.TS` tab useful for in real work?

> Auditing your **public API surface**. Whatever you export, the `.D.TS` tab shows exactly what consumers will see. It is the fastest way to check that you are not leaking internal types and that your exported signatures are correct, before publishing a library.

```typescript
export function createId(): string {
  return Math.random().toString(36).slice(2);
}
type Internal = { _cache: Map<string, number> }; // not exported

// .D.TS shows: export declare function createId(): string;
// `Internal` is absent — confirming it does not leak.
```

> If a refactor accidentally `export`s `Internal`, it appears in the `.D.TS` immediately, catching a would-be breaking change before publish.

### Q12: What is Twoslash and why would you use it over a plain Playground link?

> Twoslash is a markup/tooling layer (`@typescript/twoslash`) that runs the compiler over a sample and renders inferred types inline (`// ^?`), asserts specific error codes (`// @errors:`), and supports multi-file setups (`// @filename:`). Unlike a plain link, Twoslash examples are **compiler-verified at build time**, so documentation cannot silently rot when TypeScript changes.

---

## Senior Questions

### Q13: How would you use the Playground to evaluate a TypeScript version upgrade?

> Collect representative type patterns from the codebase, create one Playground per pattern pinned to the current version with the team's strict flags, then duplicate each pinned to the target version. Diff the Errors tab and hovered types between versions. Record every difference — including error-message quality changes — in the upgrade ticket with both links. This converts "the upgrade feels risky" into concrete, clickable evidence.

### Q14: Why are Playground links better than screenshots for onboarding and teaching?

> A link is **runnable** (the learner does, not just reads), **editable** ("now you try" is one keystroke away), and **version-pinned** (it behaves the same next quarter). A screenshot is static, can go stale, and cannot be experimented with. A link also carries the exact strict settings your team uses.

### Q15: Before filing a TypeScript bug, what should you verify in the Playground?

> Reproduce it minimally, **pin the version**, and also check it on **Nightly**. If Nightly already fixes it, your report becomes "when does the fix ship?" instead of a duplicate. Add Expected vs Actual comments on the exact line, and state the minimal flags required. This is what gets issues accepted instead of bounced.

### Q16: How do you keep a team's shared examples trustworthy over time?

> Govern them: always pin the TS version and strict flags, store canonical URLs in the repo (not chat), prefer Twoslash-checked docs over screenshots, and re-verify the example gallery on every TS upgrade. Ungoverned links silently change behavior after a release and confuse future readers.

### Q17: When should you choose StackBlitz/CodeSandbox or local `tsc` over the Playground?

> Use **StackBlitz/CodeSandbox** when the example needs real npm packages or multiple files. Use **local `tsc`** when you need Node APIs, a real build, the file system, or your exact installed `@types` versions. Use the **Playground** for single-file language/type questions, cross-version checks, and quick shareable repros.

### Q18: Why might the Playground give a misleading answer about a library's types?

> Its **bundled `@types` versions may differ** from your project's installed versions (acquired via ATA from a CDN). For language-level questions this is fine, but for precise library-type behavior you should verify locally with your exact installed `@types`.

---

## Professional / Deep-Dive Questions

### Q19: Where does the Playground actually run the TypeScript compiler, and why does that matter?

> **In your browser tab.** It downloads the real `typescript.js` bundle for the selected version and runs the genuine compiler client-side — there is no server-side type-checking. This matters because it guarantees the Playground cannot disagree with `tsc` of that version: the UI is just a presentation layer over the real compiler API.

### Q20: What replaces the file system, and what are the consequences?

> An **in-memory virtual file system** (`@typescript/vfs`). It holds your file, the built-in lib `.d.ts` files (so global types like `Array`/`document` resolve), and any acquired `@types`. The consequence is no `node_modules`, no Node `fs`, and no real packages at runtime — these are direct results of "the only files that exist are in this map."

### Q21: Why can you type-check an import of `react` but not run it?

> **Automatic Type Acquisition** fetches only the `.d.ts` files into the VFS — never the executable package code. So the checker resolves the import (type-checking succeeds), but at **Run** time the package's code is absent, so using it throws. Type-yes, run-no.

### Q22: What powers the hover tooltips, squiggles, and autocomplete?

> The TypeScript **language service** — the same incremental, editor-oriented API VS Code uses. Hover is `getQuickInfoAtPosition`, squiggles are `getSemanticDiagnostics` + `getSyntacticDiagnostics`, and autocomplete is `getCompletionsAtPosition`. That is why the Playground's editing experience is identical to VS Code's.

### Q23: How does switching the version work internally, and what is Nightly?

> Switching loads a *different* `typescript.js` bundle (and matching lib `.d.ts` files) from a CDN, re-creates the language service, and re-checks your unchanged code. **Nightly** points at the latest development build from the main branch — equivalent to installing `typescript@next` — so you can test against unreleased behavior.

### Q24: Why is the Playground a faithful gauge of type-checking cost?

> Because it runs the genuine checker, expensive operations cost the same as on disk. A deeply recursive conditional or mapped type that lags in the Playground will lag in your editor and in CI. So if a type instantiation is slow in the Playground, that is a real signal to simplify it.

### Q25: How is the Playground's state shared without a server?

> Compiler options and version go into the **query string**; the source code is **compressed (LZ-based) into the URL hash** (`#code/...`). The hash is never sent to the server, so code stays client-side. For very large snippets that exceed URL limits, shortlink/Gist-based sharing is used.

---

## Rapid-Fire Round

### Q26: Type-checking vs Run — which is automatic?

> Type-checking is automatic (live); Run is manual (press the button).

### Q27: Which tab shows logged values — `.JS` or Logs?

> **Logs**. The `.JS` tab shows the compiled *code*, not its output.

### Q28: What does removing `DOM` from `lib` break?

> Browser globals like `document` and `window` become "Cannot find name" errors.

### Q29: Which compiler option makes `arr[i]` return `T | undefined`?

> `noUncheckedIndexedAccess`.

### Q30: What single strict sub-option causes "possibly null" errors?

> `strictNullChecks`.

### Q31: Can you build a multi-file React app in the Playground?

> No — single file, no runtime packages. Use StackBlitz/CodeSandbox.

### Q32: What does the AST viewer render?

> The parser's `SourceFile` tree (`SyntaxKind` nodes), useful for tooling and codemods.

---

## Scenario Questions

### Q33: A colleague opens your shared link and sees no error, but you do. Walk through your debugging.

> 1. Confirm the link encodes the flags that trigger the error (the URL carries options, but an *old* link may predate your current flags). 2. Check that you both have the same TS version selected (`ts=` param). 3. Re-generate the link from your current session with the version pinned. 4. Send the fresh link and point at the exact line. The root cause is nearly always settings or version drift.

### Q34: You need to prove a generic type is too slow before approving its use codebase-wide. How?

> Paste the generic and apply it to a realistically large type in the Playground. If the editor lags and re-checking stalls, that is a faithful signal — the Playground runs the real checker, so its slowness predicts editor and CI slowness. Capture a simpler equivalent type that checks fast and compare; share both links in the review.

### Q35: You are writing the team handbook and want examples that never go stale. What do you use and why?

> **Twoslash** in the docs build. Inferred types render via `// ^?`, expected errors are asserted via `// @errors:`, and the whole thing is compiled by the real TypeScript compiler in CI. If a future TS release changes behavior, the asserted example fails the docs build, forcing an update — the docs cannot silently drift out of sync with the compiler.

### Q36: A new TypeScript feature is "coming soon" and your code depends on it. How do you de-risk early?

> Select **Nightly** in the version dropdown to run against the unreleased build. Test your patterns; if you hit a bug, file a minimal repro (with the Nightly link) before the release ships, while it is still cheap to fix upstream. This is forward-looking verification only the version dropdown enables.

### Q37: Explain to a junior why `typeof user === "User"` never works, using the Playground.

> Paste an interface and a value, then look at the `.JS` tab: the interface is completely gone in the output. Types are erased at compile time, so there is no `"User"` to compare against at runtime — `typeof user` is `"object"`. The `.JS` tab makes erasure visible, which is the single most important TypeScript mental model.

### Q38: A type instantiation feels slow in your editor. How can the Playground help you confirm and fix it?

> Paste the type and apply it to a realistically large input in the Playground. Because the Playground runs the genuine checker, its slowness faithfully predicts your editor's and CI's. Then try a bounded-recursion version and compare responsiveness live.

```typescript
// Suspect: unbounded recursion
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

// Fix: bound the depth so instantiation count is capped
type Prev = [never, 0, 1, 2, 3];
type DeepReadonlyD<T, D extends number = 3> = D extends 0
  ? T
  : { readonly [K in keyof T]: T[K] extends object ? DeepReadonlyD<T[K], Prev[D]> : T[K] };
```

> If the bounded version checks faster in the Playground, it will check faster everywhere.

### Q39: How would you prove to a junior that the `interface` is gone at runtime?

> Show them the `.JS` tab for a snippet that declares an interface. The interface produces *no* JavaScript at all — it is purely a compile-time construct.

```typescript
interface User {
  name: string;
}
const u: User = { name: "Ada" };
console.log(typeof u); // "object" — there is no "User" anywhere in the .JS
```

> This single demonstration teaches type erasure better than any paragraph.

### Q40: What is the difference between the language service and the batch compiler, and which does the Playground use for editing?

> The **batch compiler** (`ts.createProgram`) does a one-shot build, like `tsc`. The **language service** (`ts.createLanguageService`) is the incremental, editor-oriented API powering hover, autocomplete, and live diagnostics. The Playground uses the **language service** for the interactive experience — the same one VS Code uses — which is why editing feels identical to your editor. It uses the emit path to populate the `.JS` and `.D.TS` tabs.

### Q41: Why might a deeply recursive type produce "Type instantiation is excessively deep and possibly infinite" in the Playground?

> TypeScript caps recursion depth to protect the checker from runaway instantiation. A type that recurses without a depth bound can exceed this limit. The fix is to bound recursion with a depth counter or restructure the type. The Playground surfaces this error live, letting you iterate on a terminating version quickly.

```typescript
// Bound recursion to terminate:
type Prev = [never, 0, 1, 2, 3];
type Flatten<T, D extends number = 3> = D extends 0
  ? T
  : T extends (infer U)[]
    ? Flatten<U, Prev[D]>
    : T;
```

---

## Behavioral Deep-Dive Q&A (Demonstrated in the Playground)

These questions test TypeScript *behavior* you can verify live in the Playground. A great answer names the behavior AND how you would confirm it.

### Q42: What does `as const` do, and how do you confirm it in the Playground?

> `as const` makes a literal deeply readonly and narrows it to its literal type. Confirm by hovering the value.

```typescript
const a = { mode: "dark" };
//    ^? const a: { mode: string }
const b = { mode: "dark" } as const;
//    ^? const b: { readonly mode: "dark" }
```

> Without `as const`, `mode` is widened to `string`; with it, `mode` is the literal `"dark"` and the object is `readonly`.

### Q43: Why does `satisfies` differ from a type annotation, and how do you see it?

> A type annotation widens the value to the annotated type; `satisfies` checks the value against the type but keeps the *narrow* inferred type. Hover both to see the difference.

```typescript
const colorsA: Record<string, string> = { primary: "#f00" };
//    accessing colorsA.primary -> string (widened)

const colorsB = { primary: "#f00" } satisfies Record<string, string>;
//    accessing colorsB.primary -> still the literal-friendly narrow type
```

### Q44: How do you demonstrate discriminated-union narrowing?

> Use a `switch` on the discriminant and hover inside each branch.

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2; // s narrowed to the circle member here
    case "square":
      return s.side ** 2; // s narrowed to the square member here
  }
}
```

> Hovering `s` inside each `case` confirms the narrowing — a perfect Playground teaching moment.

### Q45: How would you show that `unknown` is safer than `any`?

> Paste both and watch the Errors tab: `unknown` forbids operations until narrowed; `any` allows anything.

```typescript
function withAny(x: any) {
  return x.foo.bar; // no error — unsafe
}
function withUnknown(x: unknown) {
  return x.foo.bar; // Error: 'x' is of type 'unknown'
}
```

> The Errors tab makes the safety difference visible and undeniable.

### Q46: How do you demonstrate that excess property checks only fire on object literals?

```typescript
interface Options {
  width: number;
}
const direct: Options = { width: 10, height: 20 }; // Error: excess 'height'

const obj = { width: 10, height: 20 };
const indirect: Options = obj; // OK — excess check is bypassed via a variable
```

> Pasting this shows why a fresh object literal is checked more strictly than a pre-existing variable — a frequent source of confusion that the Playground clarifies instantly.

### Q47: How do you observe contextual typing in the Playground?

```typescript
const nums: number[] = [1, 2, 3];
nums.map((n) => n * 2);
//        ^? (parameter) n: number  — inferred from the array's element type
```

> Hovering `n` confirms TypeScript inferred its type from the expected `number[]`, even though you never annotated it.

### Q49: How do you demonstrate that `enum` has a runtime cost but a union type does not?

```typescript
enum Direction {
  Up,
  Down,
}
// The .JS tab shows a real runtime object with reverse mappings.

type DirectionUnion = "Up" | "Down";
// The .JS tab shows NOTHING for the union — it is erased.
```

> Open the `.JS` tab: the `enum` emits a runtime object, while the union emits nothing. This explains why unions (or `const enum`) are preferred when you want zero runtime footprint.

### Q50: How would you confirm whether a `readonly` array prevents mutation at compile time?

```typescript
const nums: readonly number[] = [1, 2, 3];
nums.push(4);  // Error: Property 'push' does not exist on 'readonly number[]'
nums[0] = 9;   // Error: Index signature is readonly
```

> Pasting this shows the Errors tab flagging both mutations — a quick way to teach immutability at the type level. (Note: it is compile-time only; the runtime array is still a normal array.)

---

## Common Wrong Answers (and the Right Ones)

Interviewers often listen for these misconceptions:

| Wrong answer | Why it's wrong | Right answer |
|--------------|----------------|--------------|
| "The Playground simulates TypeScript" | It runs the genuine compiler in the browser | It runs the real `typescript.js` for the selected version |
| "Type errors stop my code running" | Types are erased; JS emits anyway | Run executes the emitted JS regardless (no `noEmitOnError`) |
| "The `.JS` tab shows my output" | That is the compiled code | Output is in the **Logs** tab after Run |
| "I can install lodash" | No `node_modules` | Inline it, or use StackBlitz/CodeSandbox |
| "ATA means I can run React" | ATA fetches types only | Type-check yes, run no |
| "Settings are local to me" | They are encoded in the URL | Shared links carry options + version |

```typescript
// A favorite trap: "this won't run because of the error."
const total: number = "oops"; // type error
console.log(total + 1);        // still runs -> "oops1"
```

> Knowing it runs (and *why*) signals you understand erasure and the type-check-vs-run split.

---

## Behavioral Edge-Case Questions

### Q51: Why might `JSON.parse` results need narrowing, and how do you show it?

```typescript
const data = JSON.parse('{"name":"Ada"}');
//    ^? const data: any  — JSON.parse returns any
data.anything.goes; // no error because of any — a hidden risk
```

> Hover `data` to reveal `any`. The lesson: `JSON.parse` returns `any`, so results should be validated/narrowed (e.g. with a type guard or a schema) before use. The Playground makes the `any` visible.

### Q52: How would you prove that optional properties differ from `| undefined` under `exactOptionalPropertyTypes`?

```typescript
// With exactOptionalPropertyTypes ON:
interface Settings {
  theme?: string; // optional: may be absent
}
const s: Settings = { theme: undefined };
//                    ^^^^^ Error under exactOptionalPropertyTypes
```

> Toggle the flag in the config menu to show the error appear: an *absent* property is not the same as one explicitly set to `undefined`. This is a subtle behavior best demonstrated live.

### Q48: How do you show the difference between `interface` merging and `type` aliases?

```typescript
interface Box {
  width: number;
}
interface Box {
  height: number; // declaration merging — both members now exist
}
const b: Box = { width: 1, height: 2 }; // OK

type Cup = { width: number };
// type Cup = { height: number }; // Error: Duplicate identifier 'Cup'
```

> Paste this to demonstrate that interfaces merge across declarations while type aliases do not.

---

## Whiteboard / Live-Coding Prompts

Interviewers may ask you to *use* the Playground on a shared screen. Practice these:

1. **"Show me type erasure."** Declare an interface + value, open the `.JS` tab, point at the absent interface.
2. **"Make this fail under strict, then fix it."** Toggle `strict`, add a null guard.
3. **"Reveal this inferred type."** Use hover, then the assign-to-`never` trick for the full type.
4. **"Compare emit across targets."** Flip `target` and narrate the `.JS` differences.
5. **"Reproduce this bug minimally."** Paste, minimize, pin version, mark the line, copy URL.

> Narrating *which tab you are reading and why* during these prompts signals deep familiarity.

---

## Interview Tips

- When asked "how would you check X?", a strong answer is often "reproduce it in the Playground, pinned to version Y, with flags Z" — it shows you reach for evidence.
- Mention the **real-compiler-in-browser** fact; it signals you understand the tool deeply, not just its UI.
- Distinguish **type-checking (automatic)** from **running (manual)** — a common confusion that interviewers probe.
- Know the **limitations** (single file, no npm runtime, no Node globals) and the **alternatives** (StackBlitz, CodeSandbox, local `tsc`).
- For senior roles, emphasize **governance**: pinned versions, repo-stored links, Twoslash-checked docs, and upgrade audits.

---

## Mock Interview Walkthrough

**Interviewer:** "Walk me through how you'd settle a debate about whether a type is too expensive."

**Strong candidate answer:**

> "I'd open the Playground, paste the type, and apply it to a realistic input. Since the Playground runs the genuine checker, lag here predicts lag in the editor and CI. I'd watch how fast squiggles update as I type."

```typescript
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
type Big = DeepReadonly<Record<string, Record<string, Record<string, number>>>>;
```

> "Then I'd try a depth-bounded version and A/B the responsiveness."

```typescript
type Prev = [never, 0, 1, 2, 3];
type DeepReadonlyD<T, D extends number = 3> = D extends 0
  ? T
  : { readonly [K in keyof T]: T[K] extends object ? DeepReadonlyD<T[K], Prev[D]> : T[K] };
```

> "If the bounded version is faster, I'd confirm locally with `tsc --generateTrace` and share both pinned Playground links in the review so the team can see the evidence."

**Why this scores well:** It names the key fact (real compiler in browser → faithful gauge), shows a concrete fix (bounded recursion), and closes the loop with evidence and shareable links — exactly the senior workflow.

---

## Final Self-Check

Before an interview, confirm you can do each of these *live* in the Playground in under a minute:

- [ ] Show type erasure via the `.JS` tab.
- [ ] Toggle `strict` and explain `strictNullChecks`.
- [ ] Reveal a full inferred type (hover + `never` trick).
- [ ] Audit a public API via the `.D.TS` tab.
- [ ] Pin a version and explain Nightly.
- [ ] Produce a minimal, shareable repro with a marker comment.
- [ ] Explain why an ATA import type-checks but won't run.

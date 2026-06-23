# TS Playground — Optimization Guide

> Ten-plus exercises for optimizing how you *use* the TypeScript Playground — making sessions faster, repros sharper, examples more reliable, and type-checking cheaper. Each exercise states a problem, a before/after, and the expected improvement. "Optimize" here means: faster feedback, clearer communication, and lower type-checking cost (which the Playground faithfully reflects).

## Table of Contents

1. [Optimization 1: Minimize the Snippet for Faster Feedback](#optimization-1-minimize-the-snippet-for-faster-feedback)
2. [Optimization 2: Tame Expensive Recursive Types](#optimization-2-tame-expensive-recursive-types)
3. [Optimization 3: Replace Truncated Hovers with Precise Reveals](#optimization-3-replace-truncated-hovers-with-precise-reveals)
4. [Optimization 4: Pin the Version and Flags in Shared Links](#optimization-4-pin-the-version-and-flags-in-shared-links)
5. [Optimization 5: Use Twoslash Instead of Screenshots](#optimization-5-use-twoslash-instead-of-screenshots)
6. [Optimization 6: Match Project Settings Once, Reuse Forever](#optimization-6-match-project-settings-once-reuse-forever)
7. [Optimization 7: Reduce Union Explosion](#optimization-7-reduce-union-explosion)
8. [Optimization 8: Prefer `interface` over Large `type` for Objects](#optimization-8-prefer-interface-over-large-type-for-objects)
9. [Optimization 9: Cache Generic Instantiations via Named Aliases](#optimization-9-cache-generic-instantiations-via-named-aliases)
10. [Optimization 10: Inline Instead of ATA for Runnable Demos](#optimization-10-inline-instead-of-ata-for-runnable-demos)
11. [Optimization 11: Use the Right Tool, Not the Playground](#optimization-11-use-the-right-tool-not-the-playground)
12. [Optimization 12: Bound Recursion Depth in Type-Level Code](#optimization-12-bound-recursion-depth-in-type-level-code)
13. [Optimization Summary Table](#optimization-summary-table)

---

## Optimization 1: Minimize the Snippet for Faster Feedback

**Problem:** A 400-line paste makes the Playground re-type-check on every keystroke, introducing lag.

```typescript
// BEFORE — huge paste, the live checker stalls on each edit
// (imagine 400 lines of unrelated app code here)
type Unrelated1 = { /* ... */ };
type Unrelated2 = { /* ... */ };
// ...
function theOnlyPartThatMatters(x: number) {
  return x.toUpperCase(); // <- the actual question, buried
}
```

```typescript
// AFTER — only the code that demonstrates the behavior
function theOnlyPartThatMatters(x: number) {
  return x.toUpperCase(); // Error: number has no toUpperCase
}
```

**Expected improvement:** Instant live feedback and a far clearer signal. A 10-line snippet re-checks in milliseconds; a 400-line one can lag noticeably.

---

## Optimization 2: Tame Expensive Recursive Types

**Problem:** A `DeepPartial` applied to a large nested type makes the Playground (and your editor) lag, because the checker instantiates the type many times.

```typescript
// BEFORE — unbounded recursion over a big shape
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

type Huge = Record<string, Record<string, Record<string, number>>>;
type Slow = DeepPartial<Huge>; // many instantiations
```

```typescript
// AFTER — bound the recursion depth
type Prev = [never, 0, 1, 2, 3, 4, 5];
type DeepPartial<T, Depth extends number = 4> = Depth extends 0
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K], Prev[Depth]> }
    : T;

type Fast = DeepPartial<Record<string, Record<string, number>>>;
```

**Expected improvement:** Bounded depth caps the instantiation count, so the Playground stays responsive — and the same fix speeds up your real editor and CI.

---

## Optimization 3: Replace Truncated Hovers with Precise Reveals

**Problem:** Hovering a complex inferred type shows `{ ... }` truncation, so you cannot see the real shape.

```typescript
// BEFORE — hover shows a truncated type
const data = [1, 2, 3].reduce(
  (acc, n) => ({ ...acc, [`k${n}`]: n }),
  {} as Record<string, number>,
);
// hover `data` -> Record<string, number> ... (sometimes abbreviated)
```

```typescript
// AFTER — force a full, readable type
const data = [1, 2, 3].reduce(
  (acc, n) => ({ ...acc, [`k${n}`]: n }),
  {} as Record<string, number>,
);
const _reveal: never = data; // the error prints the COMPLETE type
```

**Expected improvement:** You read the exact type from the error message instead of guessing past a truncation — faster, accurate diagnosis.

---

## Optimization 4: Pin the Version and Flags in Shared Links

**Problem:** Shared links behave differently for recipients because the version/flags were not set, wasting back-and-forth.

```typescript
// BEFORE — link created with default settings; recipient sees different results
const value: string | null = null;
value.length; // may or may not error depending on the recipient's defaults
```

```typescript
// AFTER — set strict + pin the version BEFORE copying the URL
// Config: strict = true; Version dropdown: 5.4.0
const value: string | null = null;
value.length; // reliably errors for everyone who opens the link
```

**Expected improvement:** Zero "works for me" round-trips. The URL encodes the exact settings, so everyone reproduces identically.

---

## Optimization 5: Use Twoslash Instead of Screenshots

**Problem:** Documentation uses screenshots of the Playground; they go stale when TypeScript changes and cannot be copied.

```typescript
// BEFORE — a screenshot of this in the docs (rots silently, not copyable)
const total = 1 + 2; // type: number
```

```typescript
// AFTER — Twoslash renders verified types and asserts errors at build time
const total = 1 + 2;
//    ^? const total: number

// @errors: 2322
const bad: number = "x"; // asserted to error; doc build fails if it stops erroring
```

**Expected improvement:** Examples are copyable, render real inferred types, and CANNOT silently drift — a future TS change that breaks the example fails the docs build instead.

---

## Optimization 6: Match Project Settings Once, Reuse Forever

**Problem:** You re-configure the Playground from scratch for every repro, and sometimes forget a flag, producing misleading results.

```typescript
// BEFORE — ad hoc settings each time; easy to forget noUncheckedIndexedAccess
const arr = [1, 2, 3];
const first = arr[0];
first.toFixed(); // no error unless the flag is on — easy to miss
```

```typescript
// AFTER — save a canonical "team settings" Playground link in the repo
// (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, target, lib)
// Start every repro by opening that link, then editing the code.
const arr = [1, 2, 3];
const first = arr[0]; // number | undefined, reliably
first?.toFixed();
```

**Expected improvement:** Every repro inherits the correct settings automatically; no more "forgot a flag" misdiagnoses.

---

## Optimization 7: Reduce Union Explosion

**Problem:** A union with hundreds of members is re-resolved on every assignment, slowing the checker in the Playground (and your editor).

```typescript
// BEFORE — a giant literal union resolved repeatedly
type Hex = `#${string}`;
type ManyColors =
  | "aliceblue" | "antiquewhite" | "aqua" /* ...100+ more... */ | "yellowgreen";

function setColor(c: ManyColors | Hex) {}
```

```typescript
// AFTER — collapse to a structural type when the exact members are not needed
type Hex = `#${string}`;
type Color = Hex | (string & {}); // accept named colors as strings, keep hints

function setColor(c: Color) {}
```

**Expected improvement:** Fewer union members to resolve per check; faster type-checking. (Use the explicit union only where you truly need autocomplete of every name.)

---

## Optimization 8: Prefer `interface` over Large `type` for Objects

**Problem:** Large object `type` aliases can be slower for the checker than equivalent `interface` declarations and produce noisier error messages.

```typescript
// BEFORE — large type alias
type Config = {
  server: { host: string; port: number };
  db: { url: string; poolSize: number };
  flags: { debug: boolean; verbose: boolean };
};
```

```typescript
// AFTER — interface (often faster to check, mergeable, cleaner errors)
interface Config {
  server: { host: string; port: number };
  db: { url: string; poolSize: number };
  flags: { debug: boolean; verbose: boolean };
}
```

**Expected improvement:** Comparable or better check time and clearer diagnostics in the Errors tab. Verify the difference live by toggling between them on a large shape.

---

## Optimization 9: Cache Generic Instantiations via Named Aliases

**Problem:** Inlining a large generic instantiation in a return position forces the checker to recompute it; naming it lets the checker reuse the result.

```typescript
// BEFORE — inline instantiation recomputed at each use
function parse<T>(input: T): { [K in keyof T]: T[K] extends string ? number : T[K] } {
  return input as any;
}
```

```typescript
// AFTER — named alias the checker can cache
type Parsed<T> = { [K in keyof T]: T[K] extends string ? number : T[K] };

function parse<T>(input: T): Parsed<T> {
  return input as unknown as Parsed<T>;
}
```

**Expected improvement:** The named alias is resolved once and reused, reducing redundant instantiation work — observable as snappier checking on heavy generics.

---

## Optimization 10: Inline Instead of ATA for Runnable Demos

**Problem:** A demo relies on a type-only ATA import, so it type-checks but throws at **Run** because the runtime code is absent — defeating a "runnable example."

```typescript
// BEFORE — looks runnable, but Run throws: z is not defined
import { z } from "zod";
const schema = z.string();
console.log(schema.parse("hi"));
```

```typescript
// AFTER — inline the tiny behavior so the demo actually runs
function parseString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Not a string");
  return value;
}
console.log(parseString("hi")); // runs and logs "hi"
```

**Expected improvement:** The example both type-checks AND runs, so a learner pressing Run sees real output instead of a runtime error.

---

## Optimization 11: Use the Right Tool, Not the Playground

**Problem:** You spend ten minutes fighting the Playground's no-package limit for something that needs real npm packages or multiple files.

```typescript
// BEFORE — trying to force a multi-file, package-heavy app into the Playground
import express from "express"; // fails
// ...attempting routes, middleware, etc.
```

```typescript
// AFTER — recognize the constraint and switch tools
// - Real packages / multi-file  -> StackBlitz or CodeSandbox
// - Node APIs / real build       -> local tsc + editor
// - Single-file type question    -> stay in the Playground
const decision = "match the tool to the constraint";
```

**Expected improvement:** Minutes saved by not fighting an inherent limitation; the Playground stays for what it is best at (single-file type/behavior questions).

---

## Optimization 12: Bound Recursion Depth in Type-Level Code

**Problem:** A recursive utility type hits TypeScript's instantiation-depth limit or simply checks slowly in the Playground.

```typescript
// BEFORE — unbounded path-building type can explode or hit depth limits
type Paths<T> = T extends object
  ? { [K in keyof T & string]: K | `${K}.${Paths<T[K]> & string}` }[keyof T & string]
  : never;
```

```typescript
// AFTER — cap depth with a counter so it terminates quickly
type Prev = [never, 0, 1, 2, 3];
type Paths<T, D extends number = 3> = D extends 0
  ? never
  : T extends object
    ? {
        [K in keyof T & string]:
          | K
          | `${K}.${Paths<T[K], Prev[D]> & string}`;
      }[keyof T & string]
    : never;
```

**Expected improvement:** The type terminates at a bounded depth, avoiding "Type instantiation is excessively deep" and keeping the Playground responsive — confirm by watching the Errors tab clear and feedback speed up.

---

## Optimization 13: Trim Setup Noise with Twoslash `// ---cut---`

**Problem:** A documentation example needs setup code (imports, type declarations) that clutters the rendered snippet and distracts from the point.

```typescript
// BEFORE — readers see boilerplate they do not care about
interface User {
  id: string;
  name: string;
  email: string;
}
declare function fetchUser(id: string): Promise<User>;

const user = await fetchUser("1");
user.name.toUpperCase(); // <- the only line that matters
```

```typescript
// AFTER — hide the setup above the cut; only the relevant code renders
interface User {
  id: string;
  name: string;
  email: string;
}
declare function fetchUser(id: string): Promise<User>;
// ---cut---
const user = await fetchUser("1");
user.name.toUpperCase(); // the rendered example starts here
```

**Expected improvement:** The published example is focused and short, while the compiler still type-checks the full program — the best of both.

---

## Optimization 14: Avoid `any` That Disables the Checker

**Problem:** A single `any` propagates and silences errors throughout a snippet, making the Playground unable to help you.

```typescript
// BEFORE — any disables checking; the Playground can't catch the real bug
function parse(input: any) {
  return input.data.items.map((x: any) => x.value);
}
const result = parse("not json"); // no error, crashes at Run
```

```typescript
// AFTER — use unknown and narrow; the Playground guides you to safety
function parse(input: unknown): number[] {
  if (
    typeof input === "object" &&
    input !== null &&
    "items" in input &&
    Array.isArray((input as { items: unknown }).items)
  ) {
    return (input as { items: { value: number }[] }).items.map((x) => x.value);
  }
  throw new Error("Invalid input");
}
```

**Expected improvement:** The Errors tab regains its power to catch mistakes; the demo reflects safe real-world code rather than an `any`-shaped hole.

---

## Optimization 15: Pick the Lightest `lib` That Demonstrates the Point

**Problem:** Loading a broad `lib` set pulls in large declaration files (DOM, all ES libs), slightly slowing initial type-checking for a snippet that does not need them.

```typescript
// BEFORE — full DOM + every ES lib loaded for a pure-logic snippet
function sum(a: number, b: number) {
  return a + b;
}
```

```typescript
// AFTER — for a pure-logic demo, a leaner lib (no DOM) checks marginally faster
// Config: lib = ["ES2022"] (drop DOM when document/window are unused)
function sum(a: number, b: number) {
  return a + b;
}
```

**Expected improvement:** Slightly faster checking and fewer irrelevant globals in autocomplete; keep DOM only when the demo actually uses browser APIs.

---

## Optimization Summary Table

| # | Technique | Effort | Impact | What it improves |
|---|-----------|--------|--------|------------------|
| 1 | Minimize the snippet | Very Low | High | Live feedback speed, clarity |
| 2 | Bound recursive types | Medium | High | Type-check cost |
| 3 | Reveal types via `never` | Very Low | Medium | Diagnosis accuracy |
| 4 | Pin version + flags in links | Very Low | High | Repro reliability |
| 5 | Twoslash over screenshots | Low | High | Doc correctness/durability |
| 6 | Canonical settings link | Low | High | Consistency, fewer mistakes |
| 7 | Reduce union explosion | Medium | Medium–High | Type-check cost |
| 8 | `interface` over big `type` | Low | Medium | Check speed, error clarity |
| 9 | Name generic instantiations | Low | Medium | Instantiation caching |
| 10 | Inline instead of ATA | Low | Medium | Runnable demos |
| 11 | Right tool for the job | Low | High | Time saved |
| 12 | Bound recursion depth | Medium | High | Avoids depth limit, speed |
| 13 | Twoslash `---cut---` | Very Low | Medium | Doc focus + full type-check |
| 14 | Replace `any` with `unknown` | Low | Medium–High | Checker effectiveness |
| 15 | Lightest sufficient `lib` | Very Low | Low–Medium | Initial check speed |

### How to Measure "Faster" in the Playground

The Playground has no built-in profiler, but you can gauge improvements:

- **Perceived responsiveness:** type a character and watch how quickly squiggles/Errors update. Heavy types add visible lag.
- **Depth errors:** "Type instantiation is excessively deep" appearing/clearing is a binary signal that a recursion bound worked.
- **Editor parity:** because the Playground runs the real checker, a change that feels faster here will measure faster under `tsc --generateTrace` locally.

```typescript
// Quick A/B: paste the heavy type, note the lag; paste the bounded version,
// note the improvement. The genuine checker makes this a faithful comparison.
type Prev = [never, 0, 1, 2, 3];
type BoundedReadonly<T, D extends number = 3> = D extends 0
  ? T
  : { readonly [K in keyof T]: T[K] extends object ? BoundedReadonly<T[K], Prev[D]> : T[K] };
```

> **Key takeaway:** Optimizing Playground usage is mostly about three things — **smaller snippets** (faster feedback), **pinned settings/versions** (reliable, shareable repros), and **cheaper types** (the Playground is a faithful gauge, so fixing slowness here fixes it everywhere). When a need exceeds the single-file, no-package model, the best optimization is switching to StackBlitz, CodeSandbox, or local `tsc`.

---

## Bonus: A Before/After Workflow Checklist

Apply this checklist whenever you create a Playground link meant to be shared or kept:

```typescript
// BEFORE sharing, ask:
// 1. Is the snippet minimal? (delete unrelated code)
// 2. Are the strict flags set to match the target environment?
// 3. Is the TS version pinned?
// 4. Is the line that matters marked with a comment?
// 5. Does it type-check (and run, if it claims to be runnable)?
// 6. If it uses a recursive/conditional type, is the depth bounded?
const ready = "all six checks passed";
```

| Step | Before | After |
|------|--------|-------|
| Snippet size | 300 lines | 12 lines |
| Strict flags | default | explicitly set |
| Version | unpinned | pinned (e.g. 5.4.0) |
| Marker comment | none | `// <- the point` |
| Runnable claim | throws at Run | actually runs |
| Recursive type | unbounded | depth-capped |

---

## Bonus: Optimizing the Teaching Experience

When the Playground is used to teach, "optimize" means maximizing the learner's insight per second.

```typescript
// BEFORE — one giant example trying to teach five concepts at once
// (narrowing + generics + mapped types + conditional types + JSX) — overwhelming.

// AFTER — five tiny, single-concept Playgrounds, each pinned and runnable.
type OneConceptPerLink = "narrowing"; // one idea, one link, one hover to inspect
```

**Expected improvement:** Each link teaches exactly one idea the learner can run, edit, and break — far higher retention than a monolithic example. This mirrors how the official Examples gallery is organized.

---

## Bonus: Reducing Cognitive Load with Named Intermediate Types

**Problem:** A single deeply nested type expression is hard to read and slow to check.

```typescript
// BEFORE — one unreadable, expensive expression
function build<T>(x: T): { [K in keyof T]: T[K] extends string ? `${T[K]}!` : T[K] } {
  return x as any;
}
```

```typescript
// AFTER — named steps: readable AND the checker can cache each alias
type Exclaim<V> = V extends string ? `${V}!` : V;
type Built<T> = { [K in keyof T]: Exclaim<T[K]> };

function build<T>(x: T): Built<T> {
  return x as unknown as Built<T>;
}
```

**Expected improvement:** Clearer code, better error messages in the Errors tab, and cacheable instantiations — readability and performance improve together.

---

## Bonus: Optimizing for Reliable Reproductions

A reproduction is "optimized" when a maintainer can confirm it in one click with zero questions.

```typescript
// BEFORE — vague, settings-dependent, version-ambiguous
function f(x) {
  return x.y;
}
```

```typescript
// AFTER — pinned, flagged, marked, self-contained
// @strict: true   (set in the config menu; version pinned in the dropdown)
function getY(obj: { y: number } | null): number {
  return obj.y; // <- claim: should error under strict because obj may be null
}
```

| Quality | Before | After |
|---------|--------|-------|
| Self-contained | depends on context | fully inline |
| Settings stated | implicit | strict set + pinned version |
| Claim marked | none | comment on the exact line |
| Maintainer effort | high (ask questions) | one click to confirm |

**Expected improvement:** Faster triage and a higher acceptance rate for upstream issues — the maintainer reproduces immediately instead of asking for clarification.

> Together with the earlier exercises, this completes the optimization mindset: every shared Playground should be minimal, pinned, flagged, marked, and (if it claims to run) actually runnable.

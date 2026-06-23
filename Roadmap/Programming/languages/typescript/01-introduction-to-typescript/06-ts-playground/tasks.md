# TS Playground — Practical Tasks

> Hands-on exercises you perform **in the TypeScript Playground** ([typescriptlang.org/play](https://www.typescriptlang.org/play)). Each task lists a goal, starter code to paste, the steps to perform in the UI, and acceptance criteria. Work through them in order.

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: First Compile and Run

**Type:** Playground walkthrough

**Goal:** Experience the full edit → compile → run loop and learn which tab shows what.

**Starter code (paste into the editor):**

```typescript
function greet(name: string): string {
  return `Hello, ${name}!`;
}

console.log(greet("Ada"));
```

**Steps:**
1. Paste the code. Look at the `.JS` tab — note the type annotation `: string` is gone.
2. Press **Run**. Look at the **Logs** tab.
3. Change `greet("Ada")` to `greet(42)`. Watch the **Errors** tab.
4. Press **Run** again and confirm the code still executes despite the error.

**Acceptance criteria:**
- [ ] You located the compiled output in the `.JS` tab.
- [ ] The Logs tab showed `"Hello, Ada!"`.
- [ ] You saw the type error for `greet(42)` AND saw it still run.

---

### Task 2: See What `target` Does

**Type:** Compiler-option exploration

**Goal:** Understand the `target` option by watching the `.JS` tab transform.

**Starter code:**

```typescript
const greet = (name: string) => `Hi ${name}`;

class Animal {
  constructor(public name: string) {}
  speak() {
    return `${this.name} makes a sound`;
  }
}

console.log(new Animal("Rex").speak());
```

**Steps:**
1. Set `target` to `ESNext` in the config menu. Note the clean, modern `.JS`.
2. Set `target` to `ES5`. Watch the arrow function become a `function` and the class become a prototype-based construction.
3. Compare the two outputs.

**Acceptance criteria:**
- [ ] You changed `target` via the UI (not by editing code).
- [ ] You can describe one concrete difference between the `ES5` and `ESNext` output.

---

### Task 3: Toggle `strict` and Observe

**Type:** Compiler-option exploration

**Goal:** Feel what strict mode (specifically `strictNullChecks`) does.

**Starter code:**

```typescript
function printLength(value: string | null) {
  return value.length;
}
```

**Steps:**
1. Turn `strict` **off** — note there is no error.
2. Turn `strict` **on** — note the "possibly null" error appears.
3. Fix it by adding a null check:

```typescript
function printLength(value: string | null) {
  if (value === null) return 0;
  return value.length; // narrowed to string
}
```

**Acceptance criteria:**
- [ ] You saw the error appear/disappear as you toggled `strict`.
- [ ] Your fixed version has no errors under `strict`.

---

### Task 4: Read a Declaration File

**Type:** `.D.TS` exploration

**Goal:** Understand what the `.D.TS` tab shows.

**Starter code:**

```typescript
export function add(a: number, b: number): number {
  return a + b;
}

export interface Point {
  x: number;
  y: number;
}

function internalHelper() {
  return 42;
}
```

**Steps:**
1. Open the `.D.TS` tab.
2. Note that `add` and `Point` appear, but `internalHelper` does **not** (it is not exported).
3. Note the function body is stripped — only the signature remains.

**Acceptance criteria:**
- [ ] You can explain why `internalHelper` is absent from the `.D.TS`.
- [ ] You can explain why `add` has no body in the `.D.TS`.

---

### Task 5: Share a Link

**Type:** Sharing workflow

**Goal:** Practice creating and using a share URL.

**Steps:**
1. Write any small snippet.
2. Set `strict: true`.
3. Copy the page URL.
4. Open it in a private/incognito window — confirm the code AND the `strict` setting carried over.

**Acceptance criteria:**
- [ ] The incognito window shows identical code.
- [ ] The `strict` setting was preserved (settings travel in the URL).

---

## Middle Tasks

### Task 6: Build a Minimal Reproduction

**Type:** Repro skill

**Goal:** Practice shrinking a problem to its essence.

**Starter code (a "buggy" snippet):**

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function unwrap<T>(r: Result<T>): T {
  return r.value; // error: 'value' missing in the ok:false branch
}
```

**Steps:**
1. Confirm the error in the Errors tab.
2. Fix it by narrowing on `r.ok`:

```typescript
function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value; // narrowed to the ok:true branch
}
```

3. Copy the URL of the *fixed* version with a comment marking the key line.

**Acceptance criteria:**
- [ ] You identified the missing narrowing as the cause.
- [ ] The fixed version type-checks under `strict`.
- [ ] You produced a shareable URL with a marker comment.

---

### Task 7: Inspect a Hard-to-See Inferred Type

**Type:** Type inspection

**Goal:** Use the assign-to-`never` trick to read a full inferred type.

**Starter code:**

```typescript
const data = [1, 2, 3].reduce(
  (acc, n) => ({ ...acc, [`key${n}`]: n }),
  {} as Record<string, number>,
);

// Reveal the full type by forcing an error:
const _reveal: never = data;
```

**Steps:**
1. Hover `data` first; note any truncation.
2. Read the error on `_reveal` — it prints the full type.

**Acceptance criteria:**
- [ ] You used the `never` trick to read a complete type from an error message.

---

### Task 8: Read Emitted JS for `async`/`await`

**Type:** Feature understanding

**Goal:** See how async is downleveled.

**Starter code:**

```typescript
async function load(): Promise<number> {
  const value = await Promise.resolve(41);
  return value + 1;
}

load().then((n) => console.log(n));
```

**Steps:**
1. Set `target: ESNext` — note native `async`/`await` in the `.JS`.
2. Set `target: ES5` — note the `__awaiter`/`__generator` state machine.
3. Run and confirm Logs shows `42` either way.

**Acceptance criteria:**
- [ ] You observed the difference in emitted JS between targets.
- [ ] The runtime behavior was identical (`42`).

---

### Task 9: Use a Type-Only Package Import

**Type:** ATA exploration

**Goal:** Type-check against a bundled package's types.

**Starter code:**

```typescript
import type { CSSProperties } from "react";

const style: CSSProperties = {
  color: "rebeccapurple",
  fontSize: 16,
};

// Hover `style` to confirm the React type resolved.
```

**Steps:**
1. Confirm it type-checks (types acquired via ATA).
2. Try adding an invalid property (`color: 123`) and watch the error.

**Acceptance criteria:**
- [ ] The type-only import resolved.
- [ ] An invalid value produced a type error.

---

### Task 10: Enable and Read the AST Viewer

**Type:** Tooling exploration

**Goal:** Connect source code to its AST.

**Starter code:**

```typescript
const sum = 1 + 2;
```

**Steps:**
1. Enable the **AST Viewer** in the Plugins settings.
2. Click on `1 + 2` in your source and watch the matching `BinaryExpression` highlight.
3. Expand the tree to find the two `NumericLiteral` nodes and the `PlusToken`.

**Acceptance criteria:**
- [ ] You located the `BinaryExpression` node for `1 + 2`.
- [ ] You can name two child node kinds it contains.

---

## Senior Tasks

### Task 11: Cross-Version Behavior Check

**Type:** Version evaluation

**Goal:** Determine whether a pattern behaves the same across two TS versions.

**Starter code:**

```typescript
const config = {
  mode: "dark",
} as const satisfies { mode: string };
```

**Steps:**
1. Select a TS version **before** 4.9 — note the `satisfies` syntax error.
2. Select 4.9+ — note it works.
3. Document the exact version where behavior changed.

**Acceptance criteria:**
- [ ] You identified the version boundary for `satisfies`.
- [ ] You produced two pinned links (one per version) for comparison.

---

### Task 12: Audit a Library's Public Surface

**Type:** API audit

**Goal:** Verify a library does not leak internal types.

**Starter code:**

```typescript
type InternalConfig = { _secret: string }; // should NOT leak

export class Client {
  private config: InternalConfig = { _secret: "x" };
  send(message: string): void {
    console.log(message, this.config._secret);
  }
}
```

**Steps:**
1. Open the `.D.TS` tab.
2. Confirm `InternalConfig` is **not** exported and `send` is.
3. Now `export` the type accidentally and watch it appear in the `.D.TS`.

**Acceptance criteria:**
- [ ] You verified the public surface in the `.D.TS` tab.
- [ ] You demonstrated how an accidental `export` leaks a type.

---

### Task 13: Author a Twoslash Example

**Type:** Documentation

**Goal:** Write a compiler-verified documentation snippet.

**Starter code (Twoslash markup):**

```typescript
// @errors: 2345
declare function setAge(age: number): void;

setAge("old");
//     ^^^^^ asserted error 2345

const result = setAge.length;
//    ^? const result: number
```

**Steps:**
1. Understand what `// @errors: 2345` asserts.
2. Understand what `// ^?` renders.
3. Change the code so the asserted error no longer fires — note that this would fail a Twoslash docs build.

**Acceptance criteria:**
- [ ] You can explain why a drifting example fails a Twoslash build.
- [ ] You used both `@errors` and `^?` correctly.

---

## Questions

Answer these about the Playground (no code required):

1. Why does the Playground run your code even when there are type errors?
2. Where, physically, does the TypeScript compiler run when you use the Playground?
3. What two URL parts carry your code vs your compiler options?
4. Why can you type-check a `react` import but not render React?
5. When would you choose StackBlitz over the Playground?

<details>
<summary>Answers</summary>

1. Types are erased before execution; emit happens regardless (no `noEmitOnError` by default).
2. In your browser tab — it loads the real `typescript.js` bundle client-side.
3. The hash (`#code/...`) carries compressed code; the query string carries options + version.
4. Automatic Type Acquisition fetches only `.d.ts` files, not executable package code.
5. When you need real npm packages, multiple files, or a runnable project.

</details>

---

## Mini Projects

### Mini Project 1: A Personal Concept Gallery

**Goal:** Build your own curated set of Playground links, one per TypeScript concept you have learned (erasure, narrowing, generics, mapped types, conditional types).

**Requirements:**
- Each link is pinned to one TS version.
- Each uses `strict: true`.
- Each has a comment naming the concept.
- Save the links in a markdown file with one-line descriptions.

**Deliverable:** A `playgrounds.md` index with at least 5 pinned, runnable links.

---

### Mini Project 2: Target Comparison Report

**Goal:** Produce a short report showing how `target` affects emitted JS.

**Requirements:**
- Pick three features: arrow functions, classes, `async`/`await`.
- For each, capture the `.JS` output at `ES5` and at `ESNext`.
- Write one sentence per feature explaining the difference.

**Deliverable:** A markdown report with before/after JS for three features.

---

### Mini Project 3: A Bug-Report-Ready Repro

**Goal:** Practice producing an upstream-quality reproduction.

**Requirements:**
- Pick any confusing TypeScript behavior (real or invented for practice).
- Minimize it to the smallest triggering snippet.
- Pin the version, set only the required flags, and also note the Nightly result.
- Write a two-line "Expected vs Actual."

**Deliverable:** A Playground link plus the Expected/Actual text, formatted as a GitHub issue body.

---

## Challenge

### Challenge: The Five-Version Bisection

**Goal:** Demonstrate mastery of cross-version evaluation.

**Task:**
1. Choose a TypeScript feature whose behavior or syntax changed across releases (examples: `satisfies`, `const` type parameters, `using` declarations, `Array.prototype.at`).
2. Use the version dropdown to **bisect** the release where it changed.
3. Create a comparison table with at least three versions: one before, one at, and one after the change.
4. For each version, capture: does it compile? what is the error (if any)? what does the `.JS` emit?
5. Write a short paragraph an engineering team could use to decide a minimum-supported TS version.

**Stretch:**
- Also test the feature on **Nightly** and note any forthcoming changes.
- Produce one pinned Playground link per version in your table.

**Acceptance criteria:**
- [ ] You correctly identified the version boundary by bisection.
- [ ] Your table covers before/at/after with compile result, error, and emit.
- [ ] You produced pinned links for each version.
- [ ] Your recommendation paragraph is actionable (states a concrete minimum version).

---

### Bonus Task A: Reproduce Excess Property Checks

**Type:** Behavior exploration

**Goal:** See why object literals are checked more strictly than variables.

**Starter code:**

```typescript
interface Options {
  width: number;
}

const direct: Options = { width: 10, height: 20 }; // excess property error
const obj = { width: 10, height: 20 };
const indirect: Options = obj; // no error — checked via a variable
```

**Steps:**
1. Confirm `direct` errors and `indirect` does not.
2. Explain why in one sentence.

**Acceptance criteria:**
- [ ] You can explain that excess property checks apply to fresh object literals, not variables.

---

### Bonus Task B: Confirm `as const` Behavior

**Type:** Behavior exploration

**Goal:** Observe literal narrowing and readonly-ness.

**Starter code:**

```typescript
const a = { mode: "dark" };
const b = { mode: "dark" } as const;
```

**Steps:**
1. Hover `a.mode` — note it is `string`.
2. Hover `b.mode` — note it is the literal `"dark"` and the object is `readonly`.

**Acceptance criteria:**
- [ ] You observed widening on `a` and literal/readonly narrowing on `b`.

---

## Submission Checklist

- [ ] Completed all Junior tasks and can explain each tab.
- [ ] Completed all Middle tasks, including a minimal repro and a Twoslash example.
- [ ] Completed all Senior tasks, including a cross-version check and an API audit.
- [ ] Answered the Questions section.
- [ ] Built at least one Mini Project.
- [ ] Attempted the Challenge bisection.
- [ ] Completed the two Bonus tasks (excess property checks, `as const`).

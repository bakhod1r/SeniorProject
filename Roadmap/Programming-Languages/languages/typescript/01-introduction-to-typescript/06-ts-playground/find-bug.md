# TS Playground — Find the Bug

> **Practice finding and fixing bugs by pasting each snippet into the [TypeScript Playground](https://www.typescriptlang.org/play) and using its tabs to diagnose the problem.**
> Many of these bugs are about *using the Playground itself* (wrong settings, wrong expectations, wrong version) as much as about TypeScript code. Paste each snippet, set the indicated compiler options, and find the issue before reading the solution.

---

## How to Use

1. Open the Playground and paste the buggy snippet.
2. Set any compiler options the exercise mentions.
3. Read the **Errors** tab, the `.JS` tab, and the **Logs** tab as clues.
4. Find the bug yourself before expanding the solution.
5. Understand **why** it happens, not just the fix.

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — wrong tab, wrong expectation, simple type error |
| 🟡 | **Medium** — subtle settings mismatch, narrowing, emit surprises |
| 🔴 | **Hard** — version-specific behavior, ATA limits, runtime vs type-check confusion |

---

## Bug 1: "Nothing Logs" 🟢

**What the code should do:** Print the doubled numbers.

```typescript
const numbers = [1, 2, 3];
const doubled = numbers.map((n) => n * 2);
```

**Expected:** Logs tab shows `[2, 4, 6]`.
**Actual:** Logs tab is empty.

<details>
<summary>💡 Hint</summary>

There is no type error and the `.JS` tab looks fine. What action populates the Logs tab?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The code never calls `console.log`, and you may not have pressed **Run**.
**Why it happens:** Type-checking is automatic, but execution (and therefore logging) requires pressing **Run** AND actually logging something. Beginners look at the Logs tab expecting output from a computation that was never printed.

</details>

<details>
<summary>✅ Fixed Code</summary>

```typescript
const numbers = [1, 2, 3];
const doubled = numbers.map((n) => n * 2);
console.log(doubled); // then press Run
```

</details>

---

## Bug 2: Reading the Wrong Tab 🟢

**What the developer believed:** "The Playground isn't running my code — the right panel just shows my source again."

```typescript
console.log("hello");
```

<details>
<summary>💡 Hint</summary>

Which tab were they looking at? `.JS` vs **Logs**?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** They were looking at the **`.JS` tab**, which shows the compiled *code* (`console.log("hello");`), and mistook it for output.
**Why it happens:** The `.JS` tab shows source-like JavaScript; the **Logs** tab shows the *result* of running. Confusing the two is one of the most common beginner mistakes.

</details>

<details>
<summary>✅ Fix</summary>

Press **Run** and look at the **Logs** tab, which shows `"hello"`.

</details>

---

## Bug 3: The Error That Won't Reproduce 🟡

**What the code should do:** Trigger a "possibly null" error like it does in the developer's project.

```typescript
function firstChar(value: string | null) {
  return value[0]; // expected: error, but none appears
}
```

<details>
<summary>💡 Hint</summary>

What compiler option governs null safety? Is it on in this Playground?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `strict` (specifically `strictNullChecks`) is **off** in this Playground session, so `value` is treated as if it cannot be null.
**Why it happens:** The Playground's settings did not match the developer's project, which runs `strict`. A repro that does not match the project's flags is misleading.

</details>

<details>
<summary>✅ Fix</summary>

Turn on `strict` in the config menu. The error appears: `'value' is possibly 'null'`. Then fix:

```typescript
function firstChar(value: string | null) {
  if (value === null) return undefined;
  return value[0];
}
```

</details>

---

## Bug 4: Importing an npm Package 🟢

**What the code should do:** Use lodash to chunk an array.

```typescript
import { chunk } from "lodash";

console.log(chunk([1, 2, 3, 4], 2));
```

<details>
<summary>💡 Hint</summary>

Does the Playground have `node_modules`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The Playground cannot install or run npm packages; there is no `node_modules`.
**Why it happens:** It is a single-file, no-package sandbox. Even if types were acquired, the *runtime* code for lodash is never loaded.

</details>

<details>
<summary>✅ Fixed Code</summary>

```typescript
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

console.log(chunk([1, 2, 3, 4], 2));
```

</details>

---

## Bug 5: Type-Checks but Crashes at Run 🔴

**What the code should do:** Validate a string with zod.

```typescript
import { z } from "zod";

const schema = z.string();
console.log(schema.parse("hello"));
```

<details>
<summary>💡 Hint</summary>

The Errors tab may be clean. What happens when you press **Run**?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The types for zod may resolve via Automatic Type Acquisition, so type-checking *passes*, but at **Run** time `z` is undefined — the runtime code was never loaded.
**Why it happens:** ATA fetches only `.d.ts` files, not executable package code. Type-yes, run-no. This is one of the most confusing Playground behaviors.

</details>

<details>
<summary>✅ Fix</summary>

For a runnable example, inline the validation or move to StackBlitz/CodeSandbox. For a type-only demo, keep it but do not press Run expecting it to execute the package.

```typescript
function parseString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Not a string");
  return value;
}

console.log(parseString("hello"));
```

</details>

---

## Bug 6: Node Global at Runtime 🔴

**What the code should do:** Print the current environment.

```typescript
console.log(process.env.NODE_ENV ?? "development");
```

<details>
<summary>💡 Hint</summary>

Where does **Run** execute — Node or a browser sandbox?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `process` does not exist in the Playground's runtime; **Run** executes in a browser sandbox, not Node.
**Why it happens:** The Playground has no Node environment. `process`, `require`, `Buffer`, and `fs` are all unavailable at runtime.

</details>

<details>
<summary>✅ Fix</summary>

```typescript
// Simulate the value instead of reading a Node global:
const NODE_ENV = "development";
console.log(NODE_ENV);
```

For real Node globals, use StackBlitz (Node container) or run locally.

</details>

---

## Bug 7: Lost Narrowing After `await` 🟡

**What the code should do:** Use `value` as a string after the null guard.

```typescript
async function demo(value: string | null) {
  if (value === null) return;
  await Promise.resolve();
  return value.toUpperCase();
}
```

<details>
<summary>💡 Hint</summary>

Is `value` still narrowed to `string` after the `await`? Hover it. Set `strict: true`.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug (subtle):** Many developers *expect* narrowing to be invalidated across `await` (because something could reassign), but for a parameter that is never reassigned, narrowing actually holds. The real "bug" here is an incorrect mental model — and the Playground is the perfect place to verify the truth by hovering `value` after the `await`.
**Why it happens:** Narrowing rules depend on whether the variable can be reassigned in the closure scope. The Playground lets you *confirm* the actual behavior instead of guessing.

</details>

<details>
<summary>✅ Resolution</summary>

Hover `value` after the `await` to see its actual type for your TS version. If you want to be defensive regardless:

```typescript
async function demo(value: string | null) {
  if (value === null) return;
  const v = value; // capture the narrowed value
  await Promise.resolve();
  return v.toUpperCase();
}
```

</details>

---

## Bug 8: Version-Specific Syntax 🔴

**What the code should do:** Use the `satisfies` operator.

```typescript
const palette = {
  primary: "#ff0000",
  secondary: "#00ff00",
} satisfies Record<string, string>;
```

<details>
<summary>💡 Hint</summary>

Check the version dropdown. When was `satisfies` introduced?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** On a TS version before 4.9, `satisfies` is a **syntax error**.
**Why it happens:** Language features are version-gated. A repro on an old version fails for reasons unrelated to the code's logic.

</details>

<details>
<summary>✅ Fix</summary>

Select TypeScript 4.9 or later in the version dropdown. The code then type-checks. Pin the version in any shared link so others reproduce correctly.

</details>

---

## Bug 9: The Shared Link Shows No Error 🟡

**What happened:** A developer shared a link to demonstrate an error, but the recipient saw none.

```typescript
const arr = [1, 2, 3];
const x = arr[10];
x.toFixed(2); // expected: "possibly undefined" error
```

<details>
<summary>💡 Hint</summary>

Which compiler option makes `arr[10]` return `number | undefined`? Was it set in the shared link?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `noUncheckedIndexedAccess` was not enabled, so `arr[10]` is typed as `number` (not `number | undefined`) and no error appears.
**Why it happens:** The shared link did not encode the required flag. Settings travel in the URL, so the link must be generated *after* the flag is set.

</details>

<details>
<summary>✅ Fix</summary>

Enable `noUncheckedIndexedAccess`, then re-copy the URL. Now `x` is `number | undefined` and `x.toFixed(2)` errors with "possibly undefined." Re-share the fresh link.

</details>

---

## Bug 10: Misreading the `.D.TS` Tab 🟡

**What the developer believed:** "My private helper is leaking — it's in the `.D.TS`!"

```typescript
export function publicApi(): number {
  return helper();
}

export function helper(): number {
  return 42;
}
```

<details>
<summary>💡 Hint</summary>

Is `helper` actually private? Look at its `export` keyword.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `helper` is `export`ed, so it correctly appears in the `.D.TS`. The developer *intended* it to be private but forgot to make it so.
**Why it happens:** The `.D.TS` tab is accurate — it reflects exactly what is exported. The bug is in the code's export surface, not the Playground.

</details>

<details>
<summary>✅ Fixed Code</summary>

```typescript
export function publicApi(): number {
  return helper();
}

// No `export` — now absent from the .D.TS
function helper(): number {
  return 42;
}
```

</details>

---

## Bug 11: Expecting Errors to Block Run 🟢

**What the developer believed:** "There's a type error, so my code won't run — that's why my logic is wrong."

```typescript
let count: number = "five";
console.log(count + 1);
```

<details>
<summary>💡 Hint</summary>

Press **Run**. Does it execute despite the error? What gets logged?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug (mental model):** The developer assumed the type error stops execution. It does not — the code runs and logs `"five1"` (string concatenation), which reveals the *real* runtime bug.
**Why it happens:** Types are erased; the Playground runs the emitted JS regardless of type errors (no `noEmitOnError`). The type error is a *warning about* the runtime bug, not a blocker.

</details>

<details>
<summary>✅ Fixed Code</summary>

```typescript
let count: number = 5;
console.log(count + 1); // 6
```

</details>

---

## Bug 12: Wrong `target` Hides a Feature 🟡

**What the code should do:** Use `Array.prototype.at`.

```typescript
const last = [1, 2, 3].at(-1);
console.log(last);
```

<details>
<summary>💡 Hint</summary>

`at` is defined in a specific `lib`. Is your `target`/`lib` recent enough?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** With an older `lib` (driven by an old `target`), `Array.prototype.at` is unknown: "Property 'at' does not exist."
**Why it happens:** Built-in API availability depends on the `lib` setting. A too-old `target`/`lib` hides modern methods even though the runtime might support them.

</details>

<details>
<summary>✅ Fix</summary>

Set `target` to `ES2022` (or add `ES2022` to `lib`) so `Array.prototype.at` is recognized. Match your project's `lib` to avoid "fixing" non-bugs.

</details>

---

## Bug 13: JSX Without `.tsx` 🟡

**What the code should do:** Render a JSX element.

```typescript
const element = <div className="box">Hello</div>;
```

<details>
<summary>💡 Hint</summary>

JSX requires a TSX context and a `jsx` option. Is this file in `.tsx` mode?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** JSX syntax in a plain `.ts` context (without the `jsx` option / TSX mode) is a parse error.
**Why it happens:** The Playground must be in `.tsx` mode and have a `jsx` compiler option set for JSX to parse and emit correctly.

</details>

<details>
<summary>✅ Fix</summary>

Switch the file to `.tsx` (the Playground supports this) and set `jsx` to `react-jsx` (or `preserve`). Then watch the `.JS` tab show the emitted `_jsx`/`createElement` calls.

</details>

---

## Summary of Lessons

| Bug | Core lesson |
|-----|-------------|
| 1, 2, 11 | Type-check is automatic; Run is manual; read the right tab |
| 3, 9, 12 | Settings must match the environment you are debugging |
| 4, 5, 6 | No npm runtime, no Node globals — type-check ≠ run |
| 7 | Use the Playground to verify mental models, not assume |
| 8 | Pin the version; features are version-gated |
| 10 | The `.D.TS` tab is accurate — fix the export surface, not the tool |
| 13 | JSX needs `.tsx` mode and a `jsx` option |

> **Key takeaway:** Most "Playground bugs" are really *expectation* bugs — wrong tab, wrong settings, wrong version, or assuming type-check equals run. Master the settings and the type-check-vs-run distinction and these disappear.

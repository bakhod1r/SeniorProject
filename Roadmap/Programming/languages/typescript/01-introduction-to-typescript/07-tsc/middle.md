# tsc (the TypeScript Compiler) — Middle Level

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Why & When](#why--when)
3. [Watch Mode in Depth](#watch-mode-in-depth)
4. [`--noEmit` and the Type-Check / Emit Split](#--noemit-and-the-type-check--emit-split)
5. [Reading tsc Error Messages](#reading-tsc-error-messages)
6. [Error Codes (TSxxxx) Catalog](#error-codes-tsxxxx-catalog)
7. [Exit Codes for CI](#exit-codes-for-ci)
8. [Selecting a Config: `-p` / `--project`](#selecting-a-config--p----project)
9. [Common Flags You Will Actually Use](#common-flags-you-will-actually-use)
10. [`--pretty` and Output Formatting](#--pretty-and-output-formatting)
11. [Inspecting What tsc Sees: `--listFiles` and `--showConfig`](#inspecting-what-tsc-sees---listfiles-and---showconfig)
12. [Type Checking as a CI Gate](#type-checking-as-a-ci-gate)
13. [Coding Patterns](#coding-patterns)
14. [Error Handling Walkthroughs](#error-handling-walkthroughs)
15. [Best Practices](#best-practices)
16. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
17. [Common Mistakes](#common-mistakes)
18. [Tricky Points](#tricky-points)
19. [Test](#test)
20. [Cheat Sheet](#cheat-sheet)
21. [Middle Checklist](#middle-checklist)
22. [Summary](#summary)
23. [Further Reading](#further-reading)

---

## Prerequisites

- Comfortable compiling a project with bare `tsc` and a `tsconfig.json`.
- Knows what `outDir`, `target`, `module`, and `strict` do.
- Has run `tsc --noEmit` at least once.
- Builds real projects (Node CLI, React app, or a library).
- Understands npm scripts and how CI pipelines run shell commands.

---

## Why & When

> Focus: "Why?" and "When?"

At the junior level you learned *what* `tsc` does. At the middle level the question becomes *why* you choose a particular mode and *when* each one matters in a real workflow.

The central idea: **`tsc` has two responsibilities — type checking and emitting — and in production you usually want to control them independently.**

- A **bundler-first project** (Vite, Next.js, esbuild) lets the bundler emit JavaScript, because it is 10–100× faster at transpiling. `tsc` is reduced to a pure *type checker* via `--noEmit`.
- A **plain Node library** often uses `tsc` for *both* jobs because it also needs `.d.ts` files, which bundlers historically do not produce well.
- **CI** almost always runs `tsc --noEmit` as a gate, regardless of how the actual build is done, because the bundler does **not** type-check.

That last point surprises people: **esbuild, swc, and Babel strip types but never check them.** If `tsc` is not in your pipeline, nothing is checking your types. Your "build" can succeed while your code is full of type errors.

---

## Watch Mode in Depth

Watch mode (`--watch` / `-w`) keeps `tsc` resident in memory and recompiles incrementally when files change. The key advantage is that it **reuses the previous program state**: the scanner, parser, and type checker do not start from zero on each change — only the affected files are re-checked.

```bash
tsc --watch
```

Sample session:

```
[10:00:00 AM] Starting compilation in watch mode...
[10:00:02 AM] Found 0 errors. Watching for file changes.

[10:00:18 AM] File change detected. Starting incremental compilation...
[10:00:18 AM] Found 1 error. Watching for file changes.

src/user.ts:12:3 - error TS2322: Type 'number' is not assignable to type 'string'.
```

### Tuning the watcher

Large repos on certain file systems benefit from configuring *how* `tsc` watches.

```json
// tsconfig.json
{
  "watchOptions": {
    "watchFile": "useFsEvents",
    "watchDirectory": "useFsEvents",
    "fallbackPolling": "dynamicPriority",
    "synchronousWatchDirectory": true,
    "excludeDirectories": ["**/node_modules", "dist"]
  }
}
```

| Option | Purpose |
|--------|---------|
| `watchFile` | Strategy for watching individual files (`useFsEvents`, `priorityPollingInterval`, etc.) |
| `watchDirectory` | Strategy for watching directories |
| `fallbackPolling` | What to do when native FS events are unavailable |
| `excludeDirectories` | Skip watching huge folders like `node_modules` |

### Watch + noEmit

You can combine watch with type-check-only mode for a fast local "is my code correct?" loop without ever writing files:

```bash
tsc --noEmit --watch
```

This is the ideal companion to `vite dev` (which handles emit/HMR) so you get continuous type feedback in a second terminal.

---

## `--noEmit` and the Type-Check / Emit Split

`--noEmit` runs the full pipeline through the type checker but **stops before the emitter**. No `.js`, `.d.ts`, or `.map` files are written.

```bash
tsc --noEmit
# Found 0 errors.   (no files created)
```

Related emit-controlling flags worth knowing:

| Flag | Effect |
|------|--------|
| `--noEmit` | Type-check only; write nothing |
| `--noEmitOnError` | Emit normally, but write nothing if any error occurred |
| `--emitDeclarationOnly` | Emit only `.d.ts` files, no `.js` |
| `--declaration` | Emit `.d.ts` alongside `.js` |
| `--noCheck` | (TS 5.6+) Emit *without* full type checking — speed over safety |

### When to use which

```bash
# CI type gate — never need output
tsc --noEmit

# Production build that must not ship broken JS
tsc --noEmitOnError

# Library: ship types only, let a bundler do JS
tsc --emitDeclarationOnly --declaration
```

The mental model: **`--noEmit` answers "is it correct?"; a real build answers "give me the output."** Keep them as separate commands so a type failure can block a merge independently of how you build.

---

## Reading tsc Error Messages

A `tsc` diagnostic has a consistent anatomy. Learning to read it quickly is a core middle-level skill.

```
src/order.ts:14:22 - error TS2345: Argument of type 'string' is not
  assignable to parameter of type 'number'.

14   processPayment(order.id);
                    ~~~~~~~~
```

Breaking it down:

| Part | Value | Meaning |
|------|-------|---------|
| File | `src/order.ts` | Where the error is |
| Position | `14:22` | Line 14, column 22 |
| Severity | `error` | `error` or `message`/`suggestion` |
| Code | `TS2345` | The stable error code (searchable) |
| Message | `Argument of type ...` | The human-readable explanation |
| Caret line | `~~~~~~~~` | Points at the exact offending span |

### Following the "chain" in complex errors

For object and generic mismatches, `tsc` prints a *nested* explanation that drills from the outer type to the precise incompatible leaf:

```
src/api.ts:30:3 - error TS2322: Type '{ id: number; name: string; }'
  is not assignable to type 'User'.
    Types of property 'id' are incompatible.
      Type 'number' is not assignable to type 'string'.
```

Read it **top to bottom**: the outer types don't match → because property `id` differs → because `number` ≠ `string`. The deepest line is usually the real fix point.

### Related-information arrows

Some errors include a second location with extra context:

```
src/handler.ts:8:5 - error TS2554: Expected 2 arguments, but got 1.

8     send(payload);
      ~~~~~~~~~~~~~

  src/transport.ts:3:23
    3 export function send(payload: Buffer, retries: number): void {
                            ~~~~~~~~~~~~~~~
    An argument for 'retries' was not provided.
```

The indented block points to the *declaration* so you can see what the function actually expects.

---

## Error Codes (TSxxxx) Catalog

Every diagnostic carries a stable `TSxxxx` code. These are great to memorize for the most common ones and to search online for the rest.

| Code | Meaning | Typical cause |
|------|---------|---------------|
| `TS2304` | Cannot find name 'X' | Typo or missing import |
| `TS2307` | Cannot find module 'X' | Missing dependency or wrong path |
| `TS2322` | Type 'A' is not assignable to type 'B' | Wrong value assigned |
| `TS2345` | Argument of type 'A' not assignable to 'B' | Wrong function argument |
| `TS2339` | Property 'X' does not exist on type 'Y' | Accessing a missing field |
| `TS2531` | Object is possibly 'null' | Missing null check (strictNullChecks) |
| `TS2532` | Object is possibly 'undefined' | Missing undefined check |
| `TS2554` | Expected N arguments, but got M | Wrong arity |
| `TS2769` | No overload matches this call | Wrong overload usage |
| `TS7006` | Parameter 'x' implicitly has an 'any' type | Missing annotation under noImplicitAny |
| `TS6133` | 'x' is declared but its value is never read | Unused variable (noUnusedLocals) |
| `TS18003` | No inputs were found in config file | Empty `include`/`files` |
| `TS5023` | Unknown compiler option 'X' | Typo in tsconfig |
| `TS5083` | Cannot read file 'tsconfig.json' | Wrong `-p` path |

```bash
# Searching the code is the fastest way to understand an unfamiliar error
# e.g., "TypeScript TS2769 no overload matches this call"
```

---

## Exit Codes for CI

`tsc` communicates success/failure to scripts via the process **exit code**, not the printed text.

| Exit code | Meaning |
|-----------|---------|
| `0` | Success — no errors |
| `1` | Generic failure (e.g., crash, internal error in some cases) |
| `2` | Type errors / diagnostics were reported |
| `3` | Project reference config error / invalid `--build` graph |

```bash
tsc --noEmit
echo $?
# 0  -> clean
# 2  -> there were type errors
```

In a CI step, a non-zero exit code automatically fails the job. **Never** mask it:

```bash
# WRONG — always "passes", defeating the gate
tsc --noEmit || true

# RIGHT — let the non-zero code fail the job
tsc --noEmit
```

---

## Selecting a Config: `-p` / `--project`

`-p` (or `--project`) points `tsc` at a specific config file or a directory containing one. This is how you maintain multiple configs (app vs. tests vs. build).

```bash
tsc -p tsconfig.json            # explicit
tsc -p tsconfig.build.json      # a separate build config
tsc --project ./config          # directory containing tsconfig.json
```

A common layout:

```json
// tsconfig.json  — editor/dev (loose, includes tests)
{
  "compilerOptions": { "noEmit": true, "strict": true },
  "include": ["src", "tests"]
}
```

```json
// tsconfig.build.json — production emit (no tests)
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist" },
  "include": ["src"]
}
```

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm run build       # tsc -p tsconfig.build.json
```

> You cannot pass file arguments together with `-p`. `tsc src/index.ts -p tsconfig.json` is an error.

---

## Common Flags You Will Actually Use

```bash
# Output location and structure
tsc --outDir dist --rootDir src

# JS language level and module format
tsc --target es2022 --module nodenext

# Safety
tsc --strict --noUncheckedIndexedAccess

# Library output
tsc --declaration --declarationMap --sourceMap

# Refuse to emit on error
tsc --noEmitOnError

# Skip checking node_modules .d.ts (faster)
tsc --skipLibCheck
```

| Flag | What it does | When to use |
|------|--------------|-------------|
| `--outDir` | Where to put `.js` | Always (keep `dist` separate) |
| `--rootDir` | Base for input structure | When `outDir` mirrors a subfolder |
| `--target` | JS version to emit | Match your runtime |
| `--module` | Module system | `nodenext` for Node, `esnext` for bundlers |
| `--strict` | All strict checks | Always |
| `--declaration` | Emit `.d.ts` | Libraries |
| `--sourceMap` | Emit `.map` | Debugging |
| `--skipLibCheck` | Don't check lib `.d.ts` | Speed |
| `--incremental` | Cache to `.tsbuildinfo` | Faster rebuilds |

> Flags on the command line **override** the same setting in `tsconfig.json` for that run. This is handy for one-off overrides without editing the config.

---

## `--pretty` and Output Formatting

`tsc` formats errors with colors and the caret/underline display by default when writing to a TTY. You can force it on or off.

```bash
# Force the human-friendly colored/underlined output
tsc --pretty

# Force plain output (no colors, no caret line) — better for log files / CI parsing
tsc --pretty false
```

Plain output looks like:

```
src/order.ts(14,22): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

The `file(line,col): error TSxxxx:` format is machine-friendly and is what many CI annotators and editors parse.

```bash
# Often used in CI so logs are clean and greppable
tsc --noEmit --pretty false
```

---

## Inspecting What tsc Sees: `--listFiles` and `--showConfig`

When the compiler behaves unexpectedly, these two flags reveal what `tsc` actually thinks it should do.

### `--showConfig`

Prints the **fully resolved** config — after `extends` chains are merged and defaults are applied. Invaluable for debugging "why is this option set?".

```bash
tsc --showConfig
```

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "strict": true,
    "outDir": "./dist"
  },
  "files": [
    "./src/index.ts",
    "./src/user.ts"
  ]
}
```

### `--listFiles` and `--explainFiles`

`--listFiles` prints **every file** included in the compilation — including all the `.d.ts` files pulled from `node_modules` and `lib`. If your build is slow or includes too much, this shows why.

```bash
tsc --noEmit --listFiles
# /project/node_modules/typescript/lib/lib.es2022.d.ts
# /project/node_modules/@types/node/index.d.ts
# /project/src/index.ts
# ...
```

`--explainFiles` (TS 4.2+) goes further: for each file it explains *why* it was included.

```bash
tsc --noEmit --explainFiles
# src/index.ts
#   Matched by include pattern 'src' in 'tsconfig.json'
# node_modules/@types/node/index.d.ts
#   Entry point for implicit type library 'node'
```

---

## Type Checking as a CI Gate

The canonical pipeline: bundler builds, `tsc` checks. Here is a complete GitHub Actions example.

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Type check
        run: npx tsc --noEmit --pretty false
```

Notes:
- `npm ci` installs the **locked** `typescript` version, so CI matches local.
- `--noEmit` because CI does not need output; it only needs the verdict.
- `--pretty false` keeps the log clean and machine-parseable.
- A type error makes `tsc` exit `2`, which fails the job automatically.

For monorepos, swap in build mode:

```yaml
      - run: npx tsc --build --pretty false
```

---

## Coding Patterns

### Pattern 1: Two configs, two scripts

```json
// package.json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc --noEmit --watch"
  }
}
```

### Pattern 2: Pre-commit type check

```bash
# .husky/pre-commit
npx tsc --noEmit || {
  echo "Type check failed — commit aborted."
  exit 1
}
```

### Pattern 3: Parallel check + bundle in build

```json
{
  "scripts": {
    "build": "npm-run-all --parallel build:types build:js",
    "build:types": "tsc --emitDeclarationOnly --declaration",
    "build:js": "esbuild src/index.ts --bundle --outfile=dist/index.js"
  }
}
```

---

## Error Handling Walkthroughs

### Walkthrough 1: TS2532 "Object is possibly 'undefined'"

```typescript
function firstChar(s?: string) {
  return s[0]; // TS2532: Object is possibly 'undefined'.
}
```

**Fix:** narrow before use.

```typescript
function firstChar(s?: string) {
  if (s === undefined) return "";
  return s[0];
}
```

### Walkthrough 2: TS2307 "Cannot find module"

```
src/db.ts:1:19 - error TS2307: Cannot find module 'pg' or its
  corresponding type declarations.
```

**Fix:** install the package and its types.

```bash
npm install pg
npm install --save-dev @types/pg
```

### Walkthrough 3: TS7006 implicit any

```typescript
function handler(req, res) { /* TS7006 on req and res */ }
```

**Fix:** annotate, or import the framework types.

```typescript
import type { Request, Response } from "express";
function handler(req: Request, res: Response) { /* ... */ }
```

---

## Best Practices

- **Run `tsc --noEmit` in CI on every PR.** It is the only real type gate.
- **Use `--pretty false` in CI logs** for clean, parseable output.
- **Keep a separate `tsconfig.build.json`** so dev configs (with tests) don't leak into production output.
- **Pin and `npm ci` the compiler** so CI and local agree.
- **Prefer flags in `tsconfig.json`; reserve CLI flags for overrides.**
- **Use `--showConfig` whenever an option "isn't taking effect."**

---

## Edge Cases & Pitfalls

### Pitfall 1: Bundler builds but never type-checks

```bash
vite build   # succeeds even with type errors!
```

**Fix:** add `tsc --noEmit` as a separate, mandatory step.

### Pitfall 2: `|| true` hides failures

```bash
tsc --noEmit || true   # gate is now useless
```

**Fix:** remove the fallback; let the exit code propagate.

### Pitfall 3: Wrong config silently used

```bash
tsc src/index.ts   # ignores tsconfig.json entirely
```

**Fix:** use bare `tsc` or `tsc -p`.

### Pitfall 4: `skipLibCheck` masks a real dependency type bug

`skipLibCheck: true` speeds builds but can hide an incompatibility between two `@types` packages. Occasionally run without it to verify.

---

## Common Mistakes

### Mistake 1: Thinking the bundler checks types

```bash
# esbuild/swc/babel only STRIP types; they never check them
esbuild src/index.ts --outfile=out.js   # no type errors ever reported
```

### Mistake 2: Forgetting `--noEmit` leaves stray `.js` in CI

```bash
tsc            # writes files into the runner; usually pointless in a check job
tsc --noEmit   # correct for a pure check
```

### Mistake 3: Mixing `-p` and file arguments

```bash
tsc -p tsconfig.json src/extra.ts   # error
```

---

## Tricky Points

### Tricky Point 1: CLI flags override config per-run

```bash
# tsconfig has "target": "es5", but this run uses es2022
tsc --target es2022
```

The override is **not** persisted — the next bare `tsc` goes back to `es5`.

### Tricky Point 2: `--pretty false` changes the message format, not the content

The error code and text are identical; only colors and the caret/underline display differ. CI parsers prefer the non-pretty `file(line,col):` form.

### Tricky Point 3: Exit code 2 vs 1

A reported type error is exit `2`. Exit `1` usually means something else went wrong (a crash, an invalid invocation). Distinguish them when debugging flaky CI.

---

## Test

### Multiple Choice

**1. Which command is the correct CI type gate?**

- A) `vite build`
- B) `esbuild src --bundle`
- C) `tsc --noEmit`
- D) `tsc --noEmit || true`

<details>
<summary>Answer</summary>
**C)** — only `tsc` checks types, and `--noEmit` avoids writing files. Option D masks failures.
</details>

### True or False

**2. esbuild reports TypeScript type errors during `build`.**

<details>
<summary>Answer</summary>
**False** — esbuild (and swc, Babel) strip types but never type-check. You need `tsc` for that.
</details>

### What's the Output?

**3. What exit code follows a type error?**

```bash
echo 'const x: number = "a";' > t.ts
tsc --noEmit t.ts
echo $?
```

<details>
<summary>Answer</summary>
`2` — type diagnostics were reported.
</details>

**4. Which flag shows every file tsc included, with reasons?**

<details>
<summary>Answer</summary>
`--explainFiles` (or `--listFiles` for just the list).
</details>

**5. What does `--showConfig` print?**

<details>
<summary>Answer</summary>
The fully resolved config after `extends` merging and defaults — useful to debug surprising option values.
</details>

---

## Cheat Sheet

| Goal | Command |
|------|---------|
| Type-check only | `tsc --noEmit` |
| Watch + check only | `tsc --noEmit --watch` |
| Use specific config | `tsc -p tsconfig.build.json` |
| Clean CI output | `tsc --noEmit --pretty false` |
| Refuse emit on error | `tsc --noEmitOnError` |
| Show resolved config | `tsc --showConfig` |
| List included files | `tsc --listFiles` |
| Explain file inclusion | `tsc --explainFiles` |
| Declarations only | `tsc --emitDeclarationOnly --declaration` |
| Check exit code | `tsc --noEmit; echo $?` |

---

## Middle Checklist

- [ ] CI runs `tsc --noEmit` as a required check.
- [ ] No `|| true` masking the compiler's exit code.
- [ ] Separate dev vs. build configs where needed.
- [ ] Bundler-first projects keep `tsc` as the dedicated type checker.
- [ ] You can read a nested `TS2322` error to its root cause.
- [ ] You know `2` = type errors, `0` = clean.

---

## Summary

- The middle-level mindset: **decouple type checking from emit** and control each on purpose.
- Bundlers do not type-check — `tsc --noEmit` is the real gate.
- Watch mode reuses program state for fast incremental feedback.
- Learn to read nested error chains and the common `TSxxxx` codes.
- Exit codes (`0`/`2`) are what CI reads; never mask them.
- `--showConfig`, `--listFiles`, `--explainFiles`, and `--pretty false` are your debugging/CI toolkit.

**Next step:** Senior-level build mode (`--build`), project references at scale, incremental builds, and build-performance diagnostics.

---

## Further Reading

- **Official docs:** [Compiler Options](https://www.typescriptlang.org/docs/handbook/compiler-options.html)
- **Official docs:** [Configuring Watch](https://www.typescriptlang.org/docs/handbook/configuring-watch.html)
- **Reference:** [TSConfig Reference](https://www.typescriptlang.org/tsconfig)
- **GitHub:** [TypeScript diagnostic messages](https://github.com/microsoft/TypeScript/blob/main/src/compiler/diagnosticMessages.json)

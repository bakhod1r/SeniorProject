# Automated Large-Scale Refactoring — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Automated Large-Scale Refactoring**
> **Covers (collectively):** Codemods & AST transforms · Type-aware rewrites · Pattern tools (Comby, Semgrep, gofmt -r) · Idempotency & verification · Landing huge mechanical diffs

---

This file is **critical-reading practice for codemods**. Each snippet below is a transform — a `sed` script, a Semgrep rule, a jscodeshift program, a ts-morph migration — that *looks* like it does the job and would pass a casual demo on one clean file. Your task is to find the flaw that makes it **unsafe at scale**: the case where it corrupts a string, double-applies, breaks on nested syntax, ignores a shadow, or rewrites the wrong thing because it isn't type-aware.

> **What you're training:** the reviewer's instinct that a mechanical transform run on 10,000 files will hit *every* edge case that exists in those files, not just the happy one. A codemod that's right 99% of the time is wrong on 100 files. Read the transform, then read it again imagining the nastiest input in the repo.

> **How to use this file:** read each snippet, write down *what input breaks it and how*, then expand the answer.

---

## Table of Contents

1. [The `sed` rename that ate a comment](#snippet-1--the-sed-rename-that-ate-a-comment)
2. [The wrapper that wraps itself](#snippet-2--the-wrapper-that-wraps-itself)
3. [The regex that can't count parentheses](#snippet-3--the-regex-that-cant-count-parentheses)
4. [The rename that ignored the shadow](#snippet-4--the-rename-that-ignored-the-shadow)
5. [The `.map` that wasn't an array](#snippet-5--the-map-that-wasnt-an-array)
6. [The import the codemod added twice](#snippet-6--the-import-the-codemod-added-twice)
7. [The nondeterministic diff](#snippet-7--the-nondeterministic-diff)

---

## Snippet 1 — The `sed` rename that ate a comment

```bash
# Migrating the method getUser() -> fetchUser() across a JS service.
sed -i 's/getUser(/fetchUser(/g' src/**/*.js
```

```js
// src/api.js — some of what this hits
const u = db.getUser(id);                       // intended target → db.fetchUser(id)

// getUser() is deprecated; prefer the cache    // a doc comment
log("getUser() returned null for " + id);       // a string literal
session.getUser();                              // a DIFFERENT object's getUser()
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**`sed` matches text, not code — it corrupts the comment, the string literal, and an unrelated receiver's method.**

After the run:
- `// getUser() is deprecated` → `// fetchUser() is deprecated` — the comment now documents a method that didn't exist when it was written; its meaning is rewritten.
- `log("getUser() returned null...")` → `log("fetchUser() returned null...")` — a **user-facing log string** silently changed. If anything greps logs or matches on that text, it breaks.
- `session.getUser()` → `session.fetchUser()` — `session` is a *different type* that happens to also have `getUser()`. You did not mean to rename it, and now it calls a method that may not exist → runtime error.

**Why it's the canonical regex-on-code failure:** `getUser(` is just six characters to `sed`. It has no idea which occurrences are calls on the receiver you care about, which are inside strings/comments, or which belong to another type. It also *misses* a multi-line call (`db\n  .getUser(id)`), leaving a straggler.

**Safe fix — a type-aware rename (ts-morph), or at minimum a structural tool:**

```ts
// rename only db.getUser via the type checker
import { Project } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json" });
// find the getUser method on the DB type and rename it; references follow the binding
project.getSourceFileOrThrow("src/db.ts")
  .getClassOrThrow("Database")
  .getInstanceMethodOrThrow("getUser")
  .rename("fetchUser");
project.saveSync();
```

This renames *only* calls that resolve to `Database.getUser`, leaves `session.getUser` and every string/comment alone, and follows multi-line and imported call sites. If you don't have types, Comby (`db.getUser(:[args])` → `db.fetchUser(:[args])`) at least respects strings, comments, and nesting — but still can't distinguish two `db`s of different types.
</details>

---

## Snippet 2 — The wrapper that wraps itself

```js
// jscodeshift: wrap every readFile(...) call in instrument(...) for tracing.
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.CallExpression, { callee: { name: "readFile" } })
    .replaceWith((path) =>
      j.callExpression(j.identifier("instrument"), [path.node])
    )
    .toSource();
};
```

```js
// Run once:  readFile("/x")          -> instrument(readFile("/x"))
// Run twice: instrument(readFile("/x")) -> instrument(instrument(readFile("/x")))  ??
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**It is not idempotent — a second run double-wraps every call.**

The transform matches `readFile(...)` and wraps it. After the first run the call is `instrument(readFile("/x"))` — the inner `readFile(...)` *still matches the finder*, so a second run produces `instrument(instrument(readFile("/x")))`. And it *will* run twice: on a rebased branch, a re-merged revert, a CI "re-apply to confirm clean" check, or someone re-running the command. The result is silent corruption of files that were already correct — the most dangerous kind, because the diff looks plausible.

**Safe fix — guard on the output shape: skip a `readFile` call whose parent is already `instrument(...)`:**

```js
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.CallExpression, { callee: { name: "readFile" } })
    .filter((path) => {
      const parent = path.parent.node;            // the enclosing node
      return !(
        parent.type === "CallExpression" &&
        parent.callee.name === "instrument"
      );                                          // already wrapped → skip
    })
    .replaceWith((path) =>
      j.callExpression(j.identifier("instrument"), [path.node])
    )
    .toSource();
};
```

Now the matcher rejects the post-transform shape, so the output (`instrument(readFile(...))`) is a fixed point: a second run changes nothing. **Prove it** with a double-run-empty-diff test:

```bash
jscodeshift -t wrap.js src/ && git add -A
jscodeshift -t wrap.js src/
git diff --quiet && echo "idempotent" || echo "BUG: double-applied"
```

Idempotency is the property you must design in deliberately — "match the before, never the after."
</details>

---

## Snippet 3 — The regex that can't count parentheses

```bash
# Convert assert(cond, msg) -> assert(cond, msg, {fatal: true}) in a Go test helper.
# (Author chose sed because "the AST tool was overkill for one extra arg.")
sed -i -E 's/assert\(([^,]+), ([^)]+)\)/assert(\1, \2, FatalOpt)/g' *_test.go
```

```go
// some matches in the wild
assert(ok, "must be true")                       // simple → fine
assert(equalish(a, b), "mismatch")               // arg has its own parens + comma
assert(want, fmt.Sprintf("got %d (n=%d)", x, n)) // nested call, commas, parens
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**The regex has no idea where the call's arguments end — `[^,]+` and `[^)]+` break the moment an argument contains a comma or a parenthesis.**

- `assert(equalish(a, b), "mismatch")`: the first capture `([^,]+)` stops at the comma inside `equalish(a, b)`, grabbing only `equalish(a`. The result is mangled: `assert(equalish(a, b, "mismatch"), FatalOpt)` or similar nonsense — the parentheses no longer balance and it won't compile (best case) or compiles into wrong code (worse case).
- `assert(want, fmt.Sprintf("got %d (n=%d)", x, n))`: the `[^)]+` for the second arg stops at the **first** `)` — the one inside the format string's `(n=%d)` — truncating the argument mid-expression.

A regex cannot match **balanced delimiters**; that's a fundamental limitation (it's not a regular language). Real code has nested calls, multi-arg expressions, parens in strings — so a `(...)` -matching regex is wrong on any non-trivial argument.

**Safe fix — Comby, whose holes bind to balanced spans:**

```bash
comby 'assert(:[cond], :[msg])' 'assert(:[cond], :[msg], FatalOpt)' .go -in-place
```

`:[cond]` correctly captures `equalish(a, b)` as one balanced span (Comby knows the inner `)` closes `equalish(`), and `:[msg]` captures the whole `fmt.Sprintf(...)` including its parens and commas. Comby also won't fire inside strings/comments. For Go specifically you could also use a `go/ast` program, but Comby is the one-line, balanced-aware tool that does exactly what the broken `sed` *meant* to do.
</details>

---

## Snippet 4 — The rename that ignored the shadow

```js
// jscodeshift: the global helper format() was renamed to formatValue().
// Rename all calls to format().
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.CallExpression, { callee: { name: "format" } })
    .forEach((path) => { path.node.callee.name = "formatValue"; })
    .toSource();
};
```

```js
import { format } from "./helpers";

export function report(rows) {
  return rows.map((r) => format(r));        // the global helper → formatValue(r)
}

export function custom(rows, format) {       // PARAMETER named format — shadows the import
  return rows.map((r) => format(r));        // calls the LOCAL param, NOT the helper!
}
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**It renames by *name*, ignoring scope — so it wrongly rewrites a call to a local variable that *shadows* the helper.**

In `custom`, the parameter is also named `format`. Inside that function, `format(r)` calls the **parameter**, not the imported helper. The transform sees the identifier `format` and blindly renames it to `formatValue`, producing `formatValue(r)` — which now refers to a name that doesn't exist in that scope (or, worse, to a *different* `formatValue` if one exists). The call's meaning changed completely.

The syntactic finder `{ callee: { name: "format" } }` matches the *spelling*. It does not resolve which **binding** that identifier refers to — the imported helper or the local parameter. Shadowing is exactly where spelling and binding diverge.

**Safe fix — resolve the symbol (type-/scope-aware rename):**

```ts
// ts-morph: rename the imported binding; the language service respects scope.
import { Project } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const helpers = project.getSourceFileOrThrow("src/helpers.ts");
helpers.getFunctionOrThrow("format").rename("formatValue");
project.saveSync();
```

ts-morph's `rename` uses the TypeScript language service's find-all-references, which is **scope-aware**: it renames the helper and the call inside `report` (which resolves to the import) but leaves the `format(r)` in `custom` untouched, because that resolves to the shadowing parameter. The lesson: any rename across a codebase that has shadows, locals, or re-exports must resolve bindings, not match identifiers. Overloads have the same trap — two methods spelled `f` with different signatures are different symbols, and only a semantic tool tells them apart.
</details>

---

## Snippet 5 — The `.map` that wasn't an array

```ts
// jscodeshift-style: a perf migration replaces array .map(fn) with mapFast(arr, fn).
// "All our hot loops use .map; let's swap them."
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.CallExpression, {
      callee: { type: "MemberExpression", property: { name: "map" } },
    })
    .replaceWith((path) => {
      const recv = path.node.callee.object;          // the thing before .map
      const fn = path.node.arguments[0];
      return j.callExpression(j.identifier("mapFast"), [recv, fn]);
    })
    .toSource();
};
```

```ts
const a = items.map((x) => x * 2);            // Array.map → intended target

const m = new Map<string, number>();
const v = m.map;                              // (hypothetical) — different type entirely

userScores.map((s) => s.id);                  // is userScores an Array? a custom collection?
new Set([1, 2]).values();                     // unrelated, but illustrates: .map exists on many types
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**It's not type-aware — it rewrites every `.map(...)` regardless of the receiver's type, but `map` exists on many types (`Array`, RxJS `Observable`, Immutable.js collections, custom classes, a `Map`-like wrapper), and `mapFast` is only correct for arrays.**

`{ property: { name: "map" } }` matches the *member name* `map` on *any* object. So:
- `observable.map((x) => ...)` (RxJS) gets rewritten to `mapFast(observable, fn)` — a **completely different operation**; `mapFast` expects an array and will throw or silently misbehave on an Observable.
- A custom collection's `.map` with different semantics (lazy, returning a view) is replaced by the eager array version — a behavior change that compiles fine and surfaces as a subtle bug.
- A property access spelled `.map` that isn't even a call may be mis-handled.

This is the textbook **"not type-aware → rewrites the wrong `map`"** failure. The receiver's *type* determines whether `.map` is `Array.prototype.map`; a syntactic finder can't ask that question.

**Safe fix — gate on the resolved receiver type with ts-morph:**

```ts
import { Project, SyntaxKind, Node } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sf of project.getSourceFiles()) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== "map") continue;

    const recvType = callee.getExpression().getType();
    if (!recvType.isArray()) continue;             // <-- the type gate

    const recv = callee.getExpression().getText();
    const fn = call.getArguments()[0].getText();
    call.replaceWithText(`mapFast(${recv}, ${fn})`);
  }
}
project.saveSync();
```

`recvType.isArray()` asks the **type checker** whether the receiver is actually an array, so only `Array.prototype.map` calls are rewritten; the Observable's `.map`, the custom collection's `.map`, and any non-array `map` are left alone. When the *correctness predicate is semantic* ("is this an array?"), only a type-aware tool can be made correct — no syntactic pattern, however clever, can substitute for resolving the type.
</details>

---

## Snippet 6 — The import the codemod added twice

```js
// jscodeshift: ensure every file that uses logger imports it.
// Add `import { logger } from "./log";` to the top of each matching file.
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const usesLogger = root.find(j.Identifier, { name: "logger" }).size() > 0;
  if (usesLogger) {
    const imp = j.importDeclaration(
      [j.importSpecifier(j.identifier("logger"))],
      j.literal("./log")
    );
    root.get().node.program.body.unshift(imp);   // prepend the import
  }
  return root.toSource();
};
```

```js
// A file that ALREADY imports logger:
import { logger } from "./log";
logger.info("hi");

// After running the codemod once:
import { logger } from "./log";
import { logger } from "./log";   // ?? duplicate
logger.info("hi");
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**It's not idempotent and doesn't check for an existing import — it adds a duplicate `import { logger }` to files that already have one.**

The condition is just "does the identifier `logger` appear?" — which is true for files that *already* import it (the import itself contains the identifier, and so does every use). So the codemod prepends a second, identical import. Run it again and you get three. The duplicate import is a syntax error in strict ESM or a lint failure at best; at worst a bundler dedups it and hides the bug until it doesn't.

This is the **double-apply** failure again, in import-management clothing: the transform matches a state (`uses logger`) that is *also true after* it has run, so it never reaches a fixed point.

**Safe fix — check for an existing import first; match the "missing" state, not the "uses" state:**

```js
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const usesLogger = root.find(j.Identifier, { name: "logger" }).size() > 0;

  const alreadyImported =
    root
      .find(j.ImportDeclaration, { source: { value: "./log" } })
      .find(j.ImportSpecifier, { imported: { name: "logger" } })
      .size() > 0;

  if (usesLogger && !alreadyImported) {            // <-- the guard
    const imp = j.importDeclaration(
      [j.importSpecifier(j.identifier("logger"))],
      j.literal("./log")
    );
    root.get().node.program.body.unshift(imp);
  }
  return root.toSource();
};
```

Now the transform only acts when `logger` is used **and not already imported**, so its output (an import present) makes the condition false on the next run — idempotent. Generalize this: any codemod that *adds* something (an import, a decorator, an argument, a header) must first check whether that something is already there. "Add X" without "unless X exists" is non-idempotent by construction.
</details>

---

## Snippet 7 — The nondeterministic diff

```go
// A Go codemod that adds a build tag to every file in a set of packages.
// It collects target files in a map, then rewrites each.
func run(targets map[string]*ast.File) {
	for path, file := range targets {        // <-- iterating a map
		addBuildTag(file)
		writeFile(path, file)
	}
	// Imports across files are deduped into a shared set, emitted at the end:
	emitImports(sharedImportSet)             // sharedImportSet is a map[string]bool
}
```

```text
$ go run codemod.go && git diff > run1.diff
$ git checkout . && go run codemod.go && git diff > run2.diff
$ diff run1.diff run2.diff
# ... the diffs differ between runs, even though the input is identical ...
```

> What input breaks this transform, and how?

<details>
<summary>Answer</summary>

**It's nondeterministic — it iterates Go maps, whose iteration order is randomized by design, so the output (file processing order and emitted import order) changes from run to run.**

Two sources here:
1. `for path, file := range targets` — Go deliberately randomizes `map` iteration order. If processing order affects output (e.g. shared state, or just the order edits are applied to overlapping regions), the result varies. Even when it doesn't change file *contents*, it can change the order of operations in logs/reports.
2. `sharedImportSet` is a `map[string]bool`; `emitImports` ranges over it, so the emitted import block is in a **random order** each run — `run1` has `import ("a"; "b")`, `run2` has `import ("b"; "a")`.

Nondeterminism is poison at scale: the "re-apply and expect an empty diff" CI check becomes flaky, reviewers can't trust that what they reviewed is what lands, and build caches break. It also makes the *idempotency* test unreliable — a second run produces a *different reordering*, which looks like the codemod "did something" when it merely shuffled.

**Safe fix — impose a deterministic order: sort everything before iterating.**

```go
func run(targets map[string]*ast.File) {
	paths := make([]string, 0, len(targets))
	for p := range targets {
		paths = append(paths, p)
	}
	sort.Strings(paths)                      // deterministic file order
	for _, path := range paths {
		addBuildTag(targets[path])
		writeFile(path, targets[path])
	}

	imports := make([]string, 0, len(sharedImportSet))
	for imp := range sharedImportSet {
		imports = append(imports, imp)
	}
	sort.Strings(imports)                    // deterministic import order
	emitImports(imports)
}
```

Now every run produces byte-identical output. The general rule: **any time a codemod iterates an unordered collection (Go `map`, a `set`, JS object keys) and the order can affect output, sort first.** Combine determinism with idempotency and you get the two properties that make a mass diff reviewable and CI-checkable: same input → same output, and re-applying → no change. (Run the formatter as a final, pinned, separate pass so it doesn't reintroduce ordering drift.)
</details>

---

## Summary — the recurring failure modes

| # | Snippet | Root failure | The class of bug |
|---|---|---|---|
| 1 | `sed` rename | Text match hits strings/comments/wrong receiver | **Not structural** — regex on code |
| 2 | self-wrapping wrapper | Matches its own output | **Not idempotent** — double-applies |
| 3 | paren-counting regex | Can't match balanced delimiters | **Not structural** — breaks on nesting |
| 4 | shadowed rename | Renames by spelling, not binding | **Not scope/type-aware** — ignores shadows/overloads |
| 5 | wrong `.map` | Rewrites `map` on any type | **Not type-aware** — wrong receiver type |
| 6 | duplicate import | "Add X" without "unless X exists" | **Not idempotent** — double-applies |
| 7 | shuffled output | Iterates an unordered map | **Not deterministic** — order varies |

Three rules cover all seven:

1. **Edit structure, not text** — use an AST/CST/type-aware tool (or at least Comby) so you never touch strings, comments, or the wrong scope/type.
2. **Be idempotent** — match the "before" state only; never the "after." Prove it with a double-run-empty-diff test.
3. **Be deterministic** — sort every unordered collection; pull out timestamps/randomness; run the formatter as a separate pinned pass.

A codemod that violates any one of these *will* corrupt files at scale, because at scale every edge case is present in *some* file.

---

## Related Topics

- [Anti-Patterns at Scale — overview](../README.md) — the at-scale context for these failures.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the architecture-level view of mass change.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — targeting codemods where they pay off.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — CI checks that catch the residuals these buggy codemods leave behind.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — when a change is too semantic to mechanize safely.
- Level files: [`senior.md`](senior.md) — the principles these bugs violate, explained in depth.

# Automated Large-Scale Refactoring — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Automated Large-Scale Refactoring**
> **Covers (collectively):** Codemods & AST transforms · Type-aware rewrites · Pattern tools (Comby, Semgrep, gofmt -r) · Idempotency & verification · Landing huge mechanical diffs

---

These are **hands-on, write-the-transform** exercises. Each gives you a problem statement, starter code or a target pattern, acceptance criteria, and a collapsible solution with an explanation. The point is to *author the codemod* — write the `gofmt -r` rule, the Comby pattern, the ts-morph transform — and to make it **idempotent and safe**, not just "works once on the demo file."

> **How to use this file.** Try each transform in your editor against the sample *and* against the "must-not-change" inputs before opening the solution. A transform that passes the happy path but corrupts a string literal is not done. The explanation under each solution is where the reasoning lives.

---

## Table of Contents

| # | Exercise | Tool | Skill | Difficulty |
|---|---|---|---|---|
| 1 | [A `gofmt -r` rewrite rule](#exercise-1--a-gofmt--r-rewrite-rule) | `gofmt -r` | Expression rewrite | ★ easy |
| 2 | [Reorder `assert.Equal` args with Comby](#exercise-2--reorder-assertequal-args-with-comby) | Comby | Structural rewrite | ★★ medium |
| 3 | [Rename a method on one type (ts-morph)](#exercise-3--rename-a-method-on-one-type-ts-morph) | ts-morph | Type-aware rename | ★★★ hard |
| 4 | [Make a transform idempotent](#exercise-4--make-a-transform-idempotent) | ts-morph | Idempotency | ★★ medium |
| 5 | [A Semgrep autofix with metavariables](#exercise-5--a-semgrep-autofix-with-metavariables) | Semgrep | Pattern + fix | ★★ medium |
| 6 | [A residual-pattern detector for CI](#exercise-6--a-residual-pattern-detector-for-ci) | grep/Semgrep | Verification | ★★ medium |

---

## Exercise 1 — A `gofmt -r` rewrite rule

**Tool:** `gofmt -r` · **Difficulty:** ★ easy

A codebase is littered with the verbose, redundant slice form `s[low:len(s)]`, which means exactly the same as `s[low:]`. Write a single `gofmt -r` rule that rewrites every occurrence across the tree, and explain why this is safe to run with regex-like syntax but *isn't* regex.

```go
// Before — sample.go
package buf

func tail(s []byte, n int) []byte {
	return s[n:len(s)]            // → should become s[n:]
}

func drop(xs []int) []int {
	return xs[1:len(xs)]          // → xs[1:]
}

// must NOT change:
var doc = "use s[n:len(s)] for the full tail"  // a string literal
// note: data[i:len(data)] is the idiom        // a comment
```

**Acceptance criteria**
- `s[n:len(s)]` and `xs[1:len(xs)]` are rewritten to `s[n:]` and `xs[1:]`.
- The string literal and the comment mentioning the pattern are **untouched**.
- The rule is one `gofmt -r` invocation; `-w` writes in place.

**Hint:** `gofmt -r` wildcards are single lowercase letters that bind to arbitrary expressions. The same wildcard used twice must match the *same* expression for the rule to fire.

<details>
<summary>Solution</summary>

```bash
gofmt -r 'a[b:len(a)] -> a[b:]' -w ./...
```

Result:

```go
func tail(s []byte, n int) []byte {
	return s[n:]
}

func drop(xs []int) []int {
	return xs[1:]
}

var doc = "use s[n:len(s)] for the full tail"   // unchanged
// note: data[i:len(data)] is the idiom         // unchanged
```

**Explanation.** `a` and `b` are wildcards. Critically, `a` appears **twice** in the pattern — `a[b:len(a)]` — so the rule only matches when the slice receiver and the argument to `len` are the *same expression*. `s[n:len(s)]` matches (`a=s`, `b=n`); something like `s[n:len(t)]` would *not*, because `a` can't bind to both `s` and `t`. That's the correctness guard, and it's why this can't be a careless regex.

It's safe on the string and comment because `gofmt -r` operates on the **Go AST**: the string literal `"use s[n:len(s)]..."` is a single `BasicLit` node, not a slice expression, and comments aren't expressions at all. A text tool (`sed 's/\[\(.*\):len(.*)\]/[\1:]/'`) would happily mangle both. `gofmt -r` is "regex-shaped syntax over the parse tree," which is the entire point — pattern convenience with parser safety.

**Limit to remember:** `gofmt -r` matches a single expression/statement and has no conditional logic or type knowledge. The moment you need "only when `a` is a `[]byte`" or a multi-statement edit, you graduate to a `go/ast` + `go/types` program.
</details>

---

## Exercise 2 — Reorder `assert.Equal` args with Comby

**Tool:** Comby · **Difficulty:** ★★ medium

A test suite mixes two argument orders for an equality assertion. The project standard is `assert.Equal(t, expected, actual)`, but hundreds of tests were written as `assert.Equal(t, actual, expected)` — and worse, a legacy helper `assertEq(got, want)` exists that you want to migrate to the standard call with the order swapped: `assertEq(got, want)` → `assert.Equal(t, want, got)`.

Write a Comby pattern for the `assertEq` migration. The challenge: arguments can themselves be **nested function calls** with their own commas, so a naive `,`-split breaks.

```go
// Before — sample_test.go
func TestSum(t *testing.T) {
	assertEq(Sum(2, 3), 5)                       // got=Sum(2,3), want=5
	assertEq(compute(a, b, c), expected(x, y))   // both args are calls with commas
}

// must NOT change — a string that mentions the call:
var note = "call assertEq(got, want) like this"
```

**Acceptance criteria**
- `assertEq(got, want)` becomes `assert.Equal(t, want, got)` — note the **swap**.
- Nested calls inside each argument are preserved exactly, commas and all.
- The string literal mentioning `assertEq(got, want)` is **not** rewritten.

**Hint:** Comby holes `:[name]` bind to **balanced** spans, so `:[got]` will correctly capture `compute(a, b, c)` as one argument despite its internal commas. Run with `comby -in-place` and a Go matcher.

<details>
<summary>Solution</summary>

```bash
comby 'assertEq(:[got], :[want])' 'assert.Equal(t, :[want], :[got])' .go -in-place
```

Result:

```go
func TestSum(t *testing.T) {
	assert.Equal(t, 5, Sum(2, 3))
	assert.Equal(t, expected(x, y), compute(a, b, c))
}

var note = "call assertEq(got, want) like this"   // unchanged
```

**Explanation.** The two holes `:[got]` and `:[want]` each bind to a **balanced-delimiter span**. When Comby scans `assertEq(compute(a, b, c), expected(x, y))`, it knows the first `)` after `c` closes `compute(`, not `assertEq(`, so `:[got]` captures the whole `compute(a, b, c)` and `:[want]` captures `expected(x, y)`. A regex with `(.*?),(.*)` would split at the *first* comma — inside `compute` — and produce garbage. This balanced-span awareness is exactly what separates Comby from `sed`.

The string literal survives because Comby's Go matcher recognizes lexical regions: it does not match its pattern *inside* string literals or comments. So `"call assertEq(got, want) like this"` is skipped even though the text matches, because Comby knows it's a string, not code.

**Idempotency note.** This rule *is* idempotent by construction: its output is `assert.Equal(...)`, which does not match the input pattern `assertEq(...)`. A second run matches nothing. Always sanity-check this — re-run and confirm an empty diff:

```bash
comby 'assertEq(:[got], :[want])' 'assert.Equal(t, :[want], :[got])' .go -in-place
git diff --quiet && echo "idempotent: clean second run"
```

**Caveat — Comby is syntactic.** It can't tell *which* `assertEq` you mean if two packages define different `assertEq` helpers. If that ambiguity exists in your repo, scope the run to the right directory or move to a type-aware Go tool.
</details>

---

## Exercise 3 — Rename a method on one type (ts-morph)

**Tool:** ts-morph (TypeScript) · **Difficulty:** ★★★ hard

`LegacyClient.send()` is being renamed to `LegacyClient.dispatch()`. The trap: several **other** classes also have a `send()` method (`Mailer.send()`, `Socket.send()`), and a syntactic find-replace on `.send(` would corrupt all of them. Write a type-aware ts-morph transform that renames `send` to `dispatch` **only** on `LegacyClient` and its references across the project.

```ts
// Before — sample.ts
import { LegacyClient } from "./legacy";
import { Mailer } from "./mail";

const c = new LegacyClient();
c.send({ id: 1 });          // → c.dispatch({ id: 1 })

const m = new Mailer();
m.send("hi");               // must NOT change — different type

function relay(client: LegacyClient, mail: Mailer) {
  client.send({ id: 2 });   // → client.dispatch(...)
  mail.send("yo");          // must NOT change
}
```

**Acceptance criteria**
- The `send` method declaration on `LegacyClient` and every call resolving to it are renamed to `dispatch`.
- `Mailer.send` and `Socket.send` call sites are untouched.
- Renames follow imports/aliases across files (use the language service, not text).

**Hint:** Find the `MethodDeclaration` named `send` inside the `LegacyClient` class, then call `.rename("dispatch")` on it. ts-morph's `rename` uses the TypeScript language service's find-all-references — the same engine as the IDE — so it follows the *binding*, not the spelling.

<details>
<summary>Solution</summary>

```ts
// rename-send.ts — run with: npx ts-node rename-send.ts
import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const legacy = project.getSourceFileOrThrow("src/legacy.ts");
const cls = legacy.getClassOrThrow("LegacyClient");
const method = cls.getInstanceMethodOrThrow("send");

// Renames the declaration AND every reference the type checker resolves to it.
method.rename("dispatch");

project.saveSync();
```

Result:

```ts
const c = new LegacyClient();
c.dispatch({ id: 1 });        // renamed

const m = new Mailer();
m.send("hi");                 // untouched — resolves to Mailer.send

function relay(client: LegacyClient, mail: Mailer) {
  client.dispatch({ id: 2 }); // renamed
  mail.send("yo");            // untouched
}
```

**Explanation.** `method.rename()` delegates to the TypeScript **language service**, which performs a semantic find-all-references on the `send` *symbol* declared in `LegacyClient`. It rewrites only call sites whose `.send` resolves — through the type checker — to *that* declaration. `m.send` and `mail.send` resolve to `Mailer.send`, a different symbol, so they're left alone. This is the property a syntactic tool can't give you: identical spelling (`.send(`), different meaning, correctly distinguished.

It also follows imports and aliases. If another file did `import { LegacyClient as LC }` and called `lc.send()`, the rename would still catch it, because resolution is by binding, not by name.

**Why not jscodeshift here?** jscodeshift is syntactic — `find(CallExpression, { callee: { property: { name: "send" } } })` matches *all* `.send()` calls regardless of receiver type, then you'd have to reimplement type resolution yourself. ts-morph wraps the real checker, so the type-aware part is free.

**Verification after running:**
```bash
npx tsc --noEmit        # still type-checks
npm test                # behavior preserved
```
</details>

---

## Exercise 4 — Make a transform idempotent

**Tool:** ts-morph · **Difficulty:** ★★ medium

Here is a transform that wraps every call to `fetchData(...)` in `withRetry(...)`. It works on a clean codebase — but running it twice produces `withRetry(withRetry(fetchData(...)))`. Fix it so a second run is a no-op.

```ts
// Buggy transform — wrap-retry.ts
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sf of project.getSourceFiles()) {
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getText() !== "fetchData") return;
    call.replaceWithText(`withRetry(${call.getText()})`);   // <-- not idempotent
  });
}
project.saveSync();
```

```ts
// Sample — sample.ts
const a = fetchData("/a");                 // 1st run → withRetry(fetchData("/a"))
const b = withRetry(fetchData("/b"));      // already wrapped — must stay as-is
```

**Acceptance criteria**
- First run wraps the unwrapped `fetchData` call.
- The already-wrapped call (`withRetry(fetchData("/b"))`) is **not** double-wrapped.
- Running the fixed transform **twice** yields an empty diff on the second run.

**Hint:** The transform must match the "before" state only. Skip a `fetchData` call whose immediate parent is already a `withRetry(...)` call. Match the input, not the output.

<details>
<summary>Solution</summary>

```ts
// wrap-retry.ts — idempotent
import { Project, SyntaxKind, CallExpression } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const alreadyWrapped = (call: CallExpression): boolean => {
  const parent = call.getParentIfKind(SyntaxKind.CallExpression);
  return parent?.getExpression().getText() === "withRetry";
};

for (const sf of project.getSourceFiles()) {
  // Collect first, then edit — mutating during traversal invalidates positions.
  const targets = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => c.getExpression().getText() === "fetchData")
    .filter((c) => !alreadyWrapped(c));          // <-- the idempotency guard

  for (const call of targets) {
    call.replaceWithText(`withRetry(${call.getText()})`);
  }
}
project.saveSync();
```

Result after one run (and unchanged after a second):

```ts
const a = withRetry(fetchData("/a"));      // wrapped once
const b = withRetry(fetchData("/b"));      // left alone — was already wrapped
```

**Explanation.** The fix is the `alreadyWrapped` guard: a `fetchData` call whose parent call expression is `withRetry(...)` is already migrated, so we skip it. Now the transform matches **only the unwrapped state**, and its output (`withRetry(fetchData(...))`) is *not* an unwrapped state — so the matcher finds nothing on a second pass. That's the formal property `T(T(x)) == T(x)`.

Two secondary fixes in the same rewrite:
1. **Collect-then-edit.** The buggy version mutated the tree *during* `forEachDescendant`, which invalidates node positions mid-traversal. Gathering targets first, then editing, avoids skipped or double-visited nodes.
2. **The idempotency test is the spec.** The acceptance criterion "twice → empty diff" should be an actual test:

```bash
npx ts-node wrap-retry.ts && git add -A
npx ts-node wrap-retry.ts
git diff --quiet && echo "IDEMPOTENT" || echo "BUG: second run changed files"
```

**The general principle.** Non-idempotent codemods are the #1 source of silent corruption at scale, because you *will* re-run them — on a rebased branch, a reverted merge, or a CI re-apply check. Always design the matcher to reject the post-transform shape, and prove it with a double-run test.
</details>

---

## Exercise 5 — A Semgrep autofix with metavariables

**Tool:** Semgrep · **Difficulty:** ★★ medium

Your Python codebase uses the insecure `yaml.load(s)` (which can execute arbitrary objects) and should use `yaml.safe_load(s)`. Write a Semgrep rule that **detects** the unsafe call and **auto-fixes** it. Capture the argument with a metavariable so any argument expression is preserved.

```python
# Before — sample.py
import yaml
cfg = yaml.load(open("c.yml"))          # → yaml.safe_load(open("c.yml"))
data = yaml.load(raw, Loader=yaml.Loader)  # discuss in solution

# must NOT change:
# yaml.load is unsafe                    # a comment
note = "we used to call yaml.load"       # a string
```

**Acceptance criteria**
- `yaml.load(x)` is rewritten to `yaml.safe_load(x)`, preserving the argument `x`.
- The comment and string mentioning `yaml.load` are untouched.
- Run with `semgrep --config rule.yaml --autofix`.

**Hint:** Semgrep patterns are written in the target language with `$X` metavariables; the `fix:` key is a template that substitutes them back.

<details>
<summary>Solution</summary>

```yaml
# rule.yaml
rules:
  - id: yaml-load-unsafe
    languages: [python]
    severity: WARNING
    message: yaml.load is unsafe; use yaml.safe_load
    pattern: yaml.load($X)
    fix: yaml.safe_load($X)
```

```bash
semgrep --config rule.yaml --autofix sample.py
```

Result:

```python
cfg = yaml.safe_load(open("c.yml"))      # fixed, argument preserved
data = yaml.load(raw, Loader=yaml.Loader)  # NOT matched — see below

# yaml.load is unsafe                    # comment unchanged
note = "we used to call yaml.load"       # string unchanged
```

**Explanation.** The pattern `yaml.load($X)` matches a call with **exactly one positional argument**, binding it to `$X`; the `fix:` template substitutes `$X` into `yaml.safe_load($X)`. Because Semgrep parses Python (it doesn't text-match), the comment and string literal mentioning `yaml.load` are correctly ignored — they aren't call expressions.

The second line, `yaml.load(raw, Loader=yaml.Loader)`, **does not match** because the pattern specifies one argument, not two. This is a feature *and* a gap: it means you won't blindly rewrite a call that passes an explicit `Loader` (which may be intentional), but it also means the two-argument unsafe case slips through. To catch it you'd add a second pattern (`yaml.load($X, Loader=$L)`) with its own `fix:`, or use `pattern-either`. This is the classic "non-matching files" problem: after autofix, **scan for residual `yaml.load(` occurrences** to find the variants your pattern missed (see Exercise 6).

**Strength of Semgrep here:** detection and fix live in one rule, so you can run it as a *blocking CI lint* that both flags and offers the fix — preventing the unsafe call from ever reappearing after the migration.
</details>

---

## Exercise 6 — A residual-pattern detector for CI

**Tool:** grep / Semgrep · **Difficulty:** ★★ medium

You've run a codemod to migrate `assertEq(...)` to `assert.Equal(...)` (Exercise 2). "The codemod ran" is *not* "the migration is done" — variants the pattern couldn't match, plus new code, can still introduce the old form. Write a CI check that **fails the build** if any `assertEq(` call remains, and explain how to avoid false positives from strings/comments.

**Acceptance criteria**
- The check exits non-zero (fails CI) when a real `assertEq(` call exists in source.
- It does **not** fail on `assertEq` appearing only in a comment or string (bonus: explain the trade-off).
- It's runnable in a CI step.

<details>
<summary>Solution</summary>

**Cheap first pass — `grep` as a gate:**

```bash
# fail-on-residual.sh
if grep -rn --include='*.go' -e 'assertEq(' .; then
  echo "ERROR: legacy assertEq( call remains — migrate to assert.Equal" >&2
  exit 1
fi
echo "OK: no residual assertEq calls"
```

This is a *text* match, so it will also flag `assertEq(` inside a comment or string — a false positive. For a true-by-construction gate that ignores lexical regions, use Semgrep (which parses the code):

```yaml
# no-legacy-asserteq.yaml
rules:
  - id: no-legacy-asserteq
    languages: [go]
    severity: ERROR
    message: "Use assert.Equal(t, want, got), not assertEq()."
    pattern: assertEq(...)
```

```bash
semgrep --config no-legacy-asserteq.yaml --error .   # non-zero on any match
```

**Explanation.** This is the **fitness function** that closes the migration loop. A codemod handles the bulk; this detector finds the long tail (variant spellings, dynamically-built calls the codemod couldn't see) *and* prevents regressions — once it's a required CI check, no new `assertEq(` can land, so the old convention can't creep back while you finish mopping up.

The grep-vs-Semgrep trade-off mirrors the whole topic: `grep` is instant and zero-setup but matches text, so it false-positives on strings/comments; the Semgrep `pattern: assertEq(...)` parses Go and matches only *actual call expressions* (the `...` matches any arguments), so it ignores the same identifier in a comment or string. For a *blocking* gate you want the parser-based check to avoid annoying false failures; for a quick local "did I miss any?" the grep is fine.

**Where this fits:** install it the moment the codemod lands, scoped to fail on *new* occurrences. It's the difference between a migration that's "mostly done" (and silently rots back to two conventions) and one that's *enforced* done.
</details>

---

## Summary

- **`gofmt -r`** rewrites single Go expressions with wildcard patterns on the AST — safe against strings/comments, but no logic or types (Exercise 1). Reusing a wildcard (`a[b:len(a)]`) is how you constrain a match.
- **Comby** does structural match/replace with balanced-span holes (`:[x]`), so it handles nested calls and respects lexical regions — far safer than regex, far cheaper than a full codemod (Exercise 2).
- **ts-morph** wraps the TypeScript checker, so a rename targets *one type's* method by resolving the symbol — the case syntactic tools get wrong (Exercise 3).
- **Idempotency** is non-negotiable: match the "before" state only, skip already-migrated sites, and prove it with a double-run-empty-diff test (Exercise 4).
- **Semgrep autofix** unifies detect-and-fix in one rule with `$X` metavariables — and its single-arg pattern reminds you that *non-matching variants* still need a residual scan (Exercise 5).
- **The migration isn't done when the codemod runs** — a **CI detector** for the old pattern (parser-based to avoid string/comment false positives) finds the long tail and prevents regression (Exercise 6).

---

## Related Topics

- [Anti-Patterns at Scale — overview](../README.md) — where these transforms fit in the at-scale toolkit.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the architecture-level view of mass change.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — choosing *which* code is worth a codemod.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — turning Exercise 6's detector into a permanent guardrail.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — when the change is too semantic to mechanize.
- Level files: [`senior.md`](senior.md) — the principles behind these exercises.

# Codemods & AST Transforms — Find the Bug

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

Six broken codemods. Each compiles and runs — it just does the *wrong thing*, the way real codemods fail in production: misses a variant, isn't idempotent, drops comments, or over-matches. For each: spot the bug, explain the failure, fix it. Diagnosis first, then the fix.

---

## Bug 1 — Over-matches: renames the wrong thing

```js
// Goal: rename calls to the function `parse(...)` → `parseStrict(...)`.
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.Identifier, { name: "parse" })   // <-- ?
    .forEach((p) => { p.node.name = "parseStrict"; })
    .toSource();
};
```

<details><summary>Diagnosis & fix</summary>

**Bug: matches *every* identifier named `parse`, not just function calls.** It will rename `JSON.parse` → `JSON.parseStrict`, a variable `const parse = ...`, an object key `{ parse: fn }`, and the property in `obj.parse` — none of which are the standalone `parse()` call we meant. This is the single most common codemod bug: matching too low (`Identifier`) instead of the structural node that carries the meaning (`CallExpression`).

**Fix — match the call, with an `Identifier` callee:**

```js
return j(fileInfo.source)
  .find(j.CallExpression, { callee: { type: "Identifier", name: "parse" } })
  .forEach((p) => { p.node.callee.name = "parseStrict"; })
  .toSource();
```

Now `JSON.parse(...)` (a `MemberExpression` callee) and the variable/key are all excluded. Anchor on the node type that *is* the thing you mean.
</details>

---

## Bug 2 — Not idempotent: double-wraps on rerun

```js
// Goal: wrap fetch(x) in withTimeout(fetch(x)).
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.CallExpression, { callee: { name: "fetch" } })
    .replaceWith((p) =>
      j.callExpression(j.identifier("withTimeout"), [p.node])
    )
    .toSource();
};
```

<details><summary>Diagnosis & fix</summary>

**Bug: no idempotency guard.** Run 1: `fetch(x)` → `withTimeout(fetch(x))`. Run 2: the inner `fetch(x)` still matches → `withTimeout(withTimeout(fetch(x)))`. Every rerun adds a layer. In CI (where codemods run per-push) this corrupts the codebase silently.

**Fix — skip a `fetch` already inside `withTimeout`:**

```js
.find(j.CallExpression, { callee: { name: "fetch" } })
.filter((p) => {
  let cur = p.parent;
  while (cur) {
    if (cur.node.type === "CallExpression" && cur.node.callee.name === "withTimeout") {
      return false;       // already wrapped
    }
    cur = cur.parent;
  }
  return true;
})
.replaceWith((p) => j.callExpression(j.identifier("withTimeout"), [p.node]))
```

The matcher must never match its own output. Always add an idempotency fixture: rerun on the transformed code, assert empty diff.
</details>

---

## Bug 3 — Drops comments: lossy printer

```python
# Goal: rename get_user(...) -> fetch_user(...), preserving comments.
import ast

src = open("svc.py").read()
tree = ast.parse(src)                       # <-- ?
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "get_user":
        node.func.id = "fetch_user"
open("svc.py", "w").write(ast.unparse(tree))  # <-- ?
```

<details><summary>Diagnosis & fix</summary>

**Bug: uses Python's stdlib `ast`, which is lossy.** `ast.parse` discards comments and exact formatting; `ast.unparse` reprints the whole file in its own canonical style. Result: **every comment in the file is deleted** and **every line shows as changed** in the diff — making the change unreviewable and destroying your colleagues' comments. The rename logic is fine; the *tooling choice* is the bug.

**Fix — use LibCST, which is a Concrete Syntax Tree (lossless):**

```python
import libcst as cst

class Rename(cst.CSTTransformer):
    def leave_Call(self, original, updated):
        f = updated.func
        if isinstance(f, cst.Name) and f.value == "get_user":
            return updated.with_changes(func=cst.Name("fetch_user"))
        return updated

src = open("svc.py").read()
new = cst.parse_module(src).visit(Rename())
open("svc.py", "w").write(new.code)   # round-trips byte-for-byte except the rename
```

Rule: if humans review the output, never use a lossy AST library (`ast`, plain Babel reprint) to write source back. Use a CST/lossless tool.
</details>

---

## Bug 4 — Misses a syntactic variant: only one operand order

```js
// Goal: rewrite `x === null` and `null === x` to isNil(x).
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.BinaryExpression, { operator: "===", right: { type: "NullLiteral" } }) // <-- ?
    .replaceWith((p) => j.callExpression(j.identifier("isNil"), [p.node.left]))
    .toSource();
};
```

<details><summary>Diagnosis & fix</summary>

**Bug: only matches `x === null`, misses `null === x`.** The filter hard-codes `null` on the *right*. The (admittedly less common, but real) `null === x` form has `null` on the left and is silently left un-migrated — the worst failure mode because it looks like the codemod succeeded. A long tail of un-migrated sites ships.

**Fix — match either order, then pick the non-null operand:**

```js
.find(j.BinaryExpression, { operator: "===" })
.filter((p) =>
  p.node.left.type === "NullLiteral" || p.node.right.type === "NullLiteral"
)
.replaceWith((p) => {
  const other = p.node.left.type === "NullLiteral" ? p.node.right : p.node.left;
  return j.callExpression(j.identifier("isNil"), [other]);
})
```

Whenever a pattern is symmetric (binary operators, comparisons, `a.b` vs `b.a`), enumerate *both* orders, and add a fixture for each.
</details>

---

## Bug 5 — Over-matches: ignores context

```js
// Goal: rename the object KEY `id` -> `userId`, but ONLY inside objects passed to track().
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  return j(fileInfo.source)
    .find(j.ObjectProperty, { key: { name: "id" } })   // <-- ?
    .forEach((p) => { p.node.key.name = "userId"; })
    .toSource();
};
```

<details><summary>Diagnosis & fix</summary>

**Bug: renames `id` in *every* object literal in the file**, not just those passed to `track(...)`. The matcher has no context anchor, so it rewrites `{ id }` in API payloads, config objects, React props — everywhere — corrupting unrelated code. Missing context is the over-match counterpart to Bug 1.

**Fix — anchor on the enclosing `track(...)` call, then drill in:**

```js
.find(j.CallExpression, { callee: { name: "track" } })
.forEach((call) => {
  call.node.arguments
    .filter((a) => a.type === "ObjectExpression")
    .forEach((obj) =>
      obj.properties.forEach((prop) => {
        if (
          prop.type === "ObjectProperty" &&
          prop.key.type === "Identifier" &&
          prop.key.name === "id"
        ) {
          prop.key.name = "userId";
        }
      })
    );
})
```

When the rule says "X, but only inside Y," match Y first and descend. Anchoring on context is how you stop a transform from bleeding into unrelated code.
</details>

---

## Bug 6 — Type-blind over-match (OpenRewrite)

```java
// Goal: replace ONLY com.acme.LegacyClock.now() with Instant.now().
// There's also java.time.Clock.now() in the codebase that must NOT change.
public TreeVisitor<?, ExecutionContext> getVisitor() {
    MethodMatcher matcher = new MethodMatcher("*..* now()");   // <-- ?
    return new JavaIsoVisitor<ExecutionContext>() {
        @Override
        public J.MethodInvocation visitMethodInvocation(J.MethodInvocation mi, ExecutionContext ctx) {
            mi = super.visitMethodInvocation(mi, ctx);
            if (matcher.matches(mi)) {
                return JavaTemplate.builder("Instant.now()").build()
                    .apply(getCursor(), mi.getCoordinates().replace());
            }
            return mi;
        }
    };
}
```

<details><summary>Diagnosis & fix</summary>

**Bug: the `MethodMatcher` pattern `*..* now()` matches `now()` on *any* type** — including `java.time.Clock.now()`, `LocalDate.now()`, `System.nanoTime`-style calls, and anything else named `now`. The whole point of OpenRewrite's type-attributed tree is type-*qualified* matching, and this throws it away with a wildcard, becoming as blunt as a regex. The unrelated `Clock.now()` gets clobbered.

**Fix — fully qualify the matcher to the one type/method you mean:**

```java
MethodMatcher matcher = new MethodMatcher("com.acme.LegacyClock now()");
```

Now it matches *only* `LegacyClock.now()` and never `java.time.Clock.now()`, because the receiver type must resolve to `com.acme.LegacyClock`. The lesson: type-aware tools are only safe if you actually *use* the type qualification — a wildcard `*..*` discards your one advantage over regex.
</details>

---

### The four failure modes, summarized

| Bug | Failure mode | Detection |
|---|---|---|
| 1, 5, 6 | **Over-match** (matched too low / no context / wildcard type) | diff touches files/lines you didn't intend; file count too high |
| 2 | **Not idempotent** | rerun produces a non-empty diff |
| 3 | **Lossy printer** (dropped comments, reformatted everything) | comments gone, whole file shows as changed |
| 4 | **Missed variant** (one operand order) | file count too low; un-migrated sites survive |

Every one of these is caught by the [middle.md](middle.md) discipline: dry-run, scoped-diff review, idempotency fixture, and fixtures for each variant + a "must-not-change" case.

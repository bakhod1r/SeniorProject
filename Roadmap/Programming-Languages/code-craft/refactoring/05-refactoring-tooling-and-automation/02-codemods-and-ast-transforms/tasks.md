# Codemods & AST Transforms — Tasks

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

Eight exercises. Each gives a transform to implement; write the codemod, run it dry, review the diff. Worked solutions follow each task — try it before peeking. Solutions use jscodeshift (JS/TS), LibCST (Python), and OpenRewrite (Java) as appropriate.

---

## Task 1 — Rename a function call (jscodeshift)

**Goal.** Across `src/`, rename every *call* to the standalone function `formatDate(...)` to `formatDateTime(...)`. Do **not** touch `obj.formatDate()`, a variable named `formatDate`, the string `"formatDate"`, or comments.

<details><summary>Solution</summary>

```js
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root
    .find(j.CallExpression, { callee: { type: "Identifier", name: "formatDate" } })
    .forEach((path) => {
      path.node.callee.name = "formatDateTime";
    });

  return root.toSource();
};
```

The `callee: { type: "Identifier", ... }` constraint is what excludes `obj.formatDate()` — that callee is a `MemberExpression`, not an `Identifier`. Strings and comments are excluded for free: they aren't `CallExpression` nodes. Run `jscodeshift -t mod.js src/ --dry --print`, confirm the file count, then apply and `git diff`.
</details>

---

## Task 2 — Make it idempotent and handle a variant (jscodeshift)

**Goal.** Wrap every call to `getConfig()` in `cached(() => getConfig())`. Running the codemod twice must not double-wrap.

<details><summary>Solution</summary>

```js
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  root
    .find(j.CallExpression, { callee: { type: "Identifier", name: "getConfig" } })
    .filter((path) => {
      // IDEMPOTENCY GUARD: skip if already inside cached(() => ...)
      let p = path.parent;
      while (p) {
        if (p.node.type === "CallExpression" && p.node.callee.name === "cached") {
          return false;
        }
        p = p.parent;
      }
      return true;
    })
    .replaceWith((path) =>
      j.callExpression(j.identifier("cached"), [
        j.arrowFunctionExpression([], path.node),
      ])
    );

  return root.toSource();
};
```

Test idempotency explicitly: apply once, commit, run again — the second `git diff` must be empty. The walk-up filter is what guarantees it: after run 1 every `getConfig()` is inside a `cached(...)`, so the filter returns `false`.
</details>

---

## Task 3 — Remove a deprecated second argument (jscodeshift)

**Goal.** `track(event, legacyOptions)` → `track(event)`. Handle the already-1-arg form (idempotent), and *flag* (don't transform) any call using spread args.

<details><summary>Solution</summary>

```js
module.exports = function (fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const flagged = [];

  root
    .find(j.CallExpression, { callee: { type: "Identifier", name: "track" } })
    .forEach((path) => {
      const args = path.node.arguments;
      if (args.length < 2) return;                       // already migrated
      if (args.some((a) => a.type === "SpreadElement")) {
        flagged.push(fileInfo.path);                     // can't be safe → flag
        return;
      }
      path.node.arguments = [args[0]];                   // drop 2nd arg
    });

  if (flagged.length) {
    console.warn(`MANUAL REVIEW (spread args): ${fileInfo.path}`);
  }
  return root.toSource();
};
```

The `length < 2` guard does double duty: idempotency *and* skipping the already-correct form. Spreads are reported, never guessed.
</details>

---

## Task 4 — Rename a method call, type-aware (ts-morph)

**Goal.** Rename `.save()` to `.persist()` **only** when the receiver's type is `Repository`. Leave every other `.save()` (on `Image`, `Document`, etc.) alone.

<details><summary>Solution</summary>

```ts
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sf of project.getSourceFiles("src/**/*.ts")) {
  sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();
    if (!expr.asKind(SyntaxKind.PropertyAccessExpression)) return;
    const prop = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (prop.getName() !== "save") return;

    const recvType = prop.getExpression().getType();
    if (recvType.getSymbol()?.getName() === "Repository") {
      prop.getNameNode().replace("persist");
    }
  });
}
project.saveSync();
```

This is impossible with a name-only matcher — the disambiguation is the *type* of the receiver, which only the type checker knows. Cost: ts-morph type-checks the whole project, so it's slower and needs a compiling codebase.
</details>

---

## Task 5 — Rename a Python function call, preserving comments (LibCST)

**Goal.** `get_user(...)` → `fetch_user(...)`, bare-name calls only, comments and formatting preserved exactly.

<details><summary>Solution</summary>

```python
import libcst as cst

class RenameGetUser(cst.CSTTransformer):
    def leave_Call(self, original_node, updated_node):
        func = updated_node.func
        if isinstance(func, cst.Name) and func.value == "get_user":
            return updated_node.with_changes(func=cst.Name("fetch_user"))
        return updated_node

src = open("service.py").read()
new = cst.parse_module(src).visit(RenameGetUser())
open("service.py", "w").write(new.code)
```

`isinstance(func, cst.Name)` restricts to `get_user(...)`, excluding `obj.get_user(...)` (that `func` is an `Attribute`). Because LibCST is a CST, the trailing comment on a call line and all whitespace round-trip byte-for-byte.
</details>

---

## Task 6 — Modernize a Python idiom (LibCST)

**Goal.** Replace `dict()` (empty call) with the literal `{}`, and `list()` with `[]`. Idempotent (literals must not re-trigger).

<details><summary>Solution</summary>

```python
import libcst as cst

class Modernize(cst.CSTTransformer):
    def leave_Call(self, original_node, updated_node):
        func = updated_node.func
        if isinstance(func, cst.Name) and not updated_node.args:
            if func.value == "dict":
                return cst.Dict(elements=[])     # {}
            if func.value == "list":
                return cst.List(elements=[])     # []
        return updated_node
```

`not updated_node.args` ensures only the *empty* calls convert (`dict(a=1)` stays). Idempotency is automatic: `{}` is a `Dict` node, not a `Call`, so `leave_Call` never sees it on a rerun.
</details>

---

## Task 7 — Replace a deprecated API method, type-qualified (OpenRewrite)

**Goal.** Replace `StringUtils.isBlank(s)` (Apache Commons) with the JDK-native `s.isBlank()`. Match must be type-qualified so a same-named method on another class is never touched.

<details><summary>Solution</summary>

```java
public class UseStringIsBlank extends Recipe {
    @Override public String getDisplayName() { return "Use String.isBlank()"; }
    @Override public String getDescription() { return "Replace StringUtils.isBlank(s) with s.isBlank()."; }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        MethodMatcher matcher =
            new MethodMatcher("org.apache.commons.lang3.StringUtils isBlank(String)");

        return new JavaIsoVisitor<ExecutionContext>() {
            @Override
            public J.MethodInvocation visitMethodInvocation(J.MethodInvocation mi, ExecutionContext ctx) {
                mi = super.visitMethodInvocation(mi, ctx);
                if (matcher.matches(mi)) {
                    Expression arg = mi.getArguments().get(0);
                    return JavaTemplate.builder("#{any(String)}.isBlank()")
                        .build()
                        .apply(getCursor(), mi.getCoordinates().replace(), arg);
                }
                return mi;
            }
        };
    }
}
```

The fully-qualified `MethodMatcher` string is the safety guarantee — it matches *that* method on *that* class, never a coincidentally-named `isBlank` elsewhere. Run `mvn rewrite:dryRun` to inspect the patch, then `mvn rewrite:run`.
</details>

---

## Task 8 — Compose a multi-step migration (OpenRewrite)

**Goal.** Migrate a logging call: rewrite `System.out.println(x)` → `log.info(x)`, *and* add the `log` field and its import where missing — as one composed recipe.

<details><summary>Solution (shape)</summary>

```java
public class MigrateSysoutToLogger extends Recipe {
    @Override public String getDisplayName() { return "System.out.println → logger"; }
    @Override public String getDescription() { return "Replace println with log.info and ensure logger field/import."; }

    @Override
    public List<Recipe> getRecipeList() {
        return List.of(
            new ReplacePrintlnWithLogInfo(),   // your custom visitor (like Task 7)
            new AddLoggerField(),              // adds `private static final Logger log = ...`
            new AddImport<>("org.slf4j.Logger", null, false)  // OpenRewrite ships AddImport
        );
    }
}
```

Composition is the right structure here: the steps share one parse of each file, run atomically, and reuse OpenRewrite's built-in `AddImport` rather than hand-rolling import insertion. Each sub-recipe stays independently idempotent — `AddImport` no-ops if the import already exists, so reruns are safe.
</details>

---

### Self-check for every task

After writing any codemod, confirm:

1. **Dry-run file count** matches your expectation (not 0, not "everything").
2. **Diff is scoped** — only intended lines moved; no reformatting noise (lossless printer working).
3. **Idempotent** — apply, commit, rerun; second diff is empty.
4. **Fixtures** cover: happy path, a "must-not-change" look-alike (string/comment/different scope), and the idempotency case.

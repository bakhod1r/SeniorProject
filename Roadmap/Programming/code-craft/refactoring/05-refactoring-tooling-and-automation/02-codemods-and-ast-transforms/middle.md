# Codemods & AST Transforms — Middle

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

[junior.md](junior.md) gave you the pipeline — parse, match, transform, print — and one worked jscodeshift example. This page widens the lens:

- the **tool landscape** per language, with real, idiomatic snippets you can run;
- **CST vs AST** and why comment preservation decides whether your diffs are reviewable;
- making a codemod **idempotent** on purpose, not by luck;
- the **dry-run / diff** workflow as a discipline;
- **testing the codemod itself** — because a codemod is code, and untested code that edits all your other code is a liability.

---

## 1. The tool landscape

Every mainstream language has codemod tooling. They differ in API ergonomics and in how losslessly they print, but they all implement the same parse/match/transform/print pipeline. Here are the ones worth knowing, grouped by language, with the idioms that matter.

### JavaScript / TypeScript

**jscodeshift** (covered in junior) — the runner. jQuery-style collection API, recast-based lossless printing, parallel file processing built in. Best for *bulk* transforms across a tree.

**ts-morph** — a higher-level wrapper over the TypeScript compiler API. You get a real `Project`, real type information, and an object model (`SourceFile`, `ClassDeclaration`, `MethodDeclaration`) instead of raw AST nodes. Best when your transform needs to *understand types*, not just shapes.

```ts
// ts-morph: make every public method that returns a Promise also `async`
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sourceFile of project.getSourceFiles("src/**/*.ts")) {
  sourceFile.getClasses().forEach((cls) => {
    cls.getMethods().forEach((method) => {
      const returnType = method.getReturnType();
      // TYPE-AWARE match: only methods whose return type is a Promise
      if (returnType.getSymbol()?.getName() === "Promise" && !method.isAsync()) {
        method.setIsAsync(true);
      }
    });
  });
}

project.saveSync(); // prints all modified files, preserving formatting + comments
```

That `returnType.getSymbol()?.getName() === "Promise"` check is impossible in jscodeshift's pure-syntax matcher — it requires the *type checker*. That's the ts-morph trade: more power, slower (it type-checks the whole project), heavier setup.

**Babel plugins** — Babel is a compiler, and a Babel plugin is a visitor that runs *during compilation*. You can repurpose it as a codemod, but Babel is **lossy by default** — it reformats the whole file. Use it for build-time transforms (JSX → JS, syntax down-leveling), not for human-reviewable source edits, unless you pair it with recast.

```js
// A Babel plugin (visitor form) — note the same Visitor shape as jscodeshift
module.exports = function () {
  return {
    visitor: {
      CallExpression(path) {
        if (
          path.node.callee.type === "MemberExpression" &&
          path.node.callee.object.name === "console" &&
          path.node.callee.property.name === "log"
        ) {
          path.node.callee.object.name = "logger";
          path.node.callee.property.name = "info";
        }
      },
    },
  };
};
```

> **When NOT to use Babel for a codemod:** if a human will review the resulting diff, don't — Babel reprints the entire file and your diff becomes "every line changed." Use jscodeshift/recast or ts-morph, which only touch what you changed.

### Python

**LibCST** (Meta/Instagram) — a **Concrete** Syntax Tree library. Unlike Python's built-in `ast` module (which is lossy — it discards comments and formatting and can't round-trip), LibCST preserves *every* byte: comments, whitespace, trailing commas. That's exactly what you want for a reviewable codemod. You write a `CSTTransformer` with `leave_*` methods (the visitor leaving a node) and return the replacement.

```python
# LibCST: rename calls to the function `get_user(...)` → `fetch_user(...)`
# but only the FUNCTION call, not attribute access or strings.
import libcst as cst

class RenameGetUser(cst.CSTTransformer):
    def leave_Call(
        self, original_node: cst.Call, updated_node: cst.Call
    ) -> cst.BaseExpression:
        func = updated_node.func
        # MATCH: a bare-name call `get_user(...)`, not `obj.get_user(...)`
        if isinstance(func, cst.Name) and func.value == "get_user":
            # TRANSFORM: replace just the name, keep args/whitespace/comments
            return updated_node.with_changes(func=cst.Name("fetch_user"))
        return updated_node

source = open("service.py").read()
tree = cst.parse_module(source)            # PARSE → CST
new_tree = tree.visit(RenameGetUser())     # MATCH + TRANSFORM
open("service.py", "w").write(new_tree.code)  # PRINT (lossless: .code round-trips)
```

The CST guarantee is concrete: `cst.parse_module(src).code == src` for *any* `src`. Parse and print with no transform, and you get back the byte-identical original. That is the property that makes LibCST diffs trustworthy.

**Bowler** (built on top of LibCST) gives a fluent, jscodeshift-like query API for Python:

```python
from bowler import Query

(
    Query("src/")
    .select_function("get_user")
    .rename("fetch_user")
    .idempotent()   # Bowler can mark transforms idempotent
    .diff()         # dry-run: show the diff instead of writing
)
```

> **When NOT to use Python's stdlib `ast`:** if you intend to write the result back to disk for humans. `ast.unparse()` reformats everything and drops all comments — your diff is unreviewable and your colleagues' comments vanish. Reach for LibCST whenever the output is source code people will read.

### Java

**OpenRewrite** — the heavyweight of the ecosystem. It parses Java into a **Lossless Semantic Tree (LST)** — a type-attributed, format-preserving tree — and applies **recipes** (composable, reusable transforms). Recipes ship in catalogs (migrate JUnit 4 → 5, Spring Boot 2 → 3, find-and-fix CVEs) and run via Maven/Gradle.

```java
// An OpenRewrite recipe: replace every `new ArrayList<>()` assigned to a
// List field with `List.of()` where the list is never mutated... (simplified:
// here we just swap the deprecated StringUtils.isEmpty for the new API).
public class UseStringIsBlank extends Recipe {
    @Override public String getDisplayName() { return "Use String.isBlank()"; }
    @Override public String getDescription() { return "Replace StringUtils.isBlank(s) with s.isBlank()."; }

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        // A MethodMatcher is OpenRewrite's precise, type-aware matcher.
        MethodMatcher matcher =
            new MethodMatcher("org.apache.commons.lang3.StringUtils isBlank(String)");

        return new JavaIsoVisitor<ExecutionContext>() {
            @Override
            public J.MethodInvocation visitMethodInvocation(
                    J.MethodInvocation mi, ExecutionContext ctx) {
                mi = super.visitMethodInvocation(mi, ctx);
                if (matcher.matches(mi)) {
                    Expression arg = mi.getArguments().get(0);
                    // TRANSFORM via a template that re-types automatically
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

The `MethodMatcher` string `"org.apache.commons.lang3.StringUtils isBlank(String)"` is **fully type-qualified** — it matches *that* method on *that* class with *that* signature, never a same-named method elsewhere. That precision comes from OpenRewrite having full type attribution in its tree. This is the gold standard for safe, large-scale Java migration.

Run it:

```bash
mvn org.openrewrite.maven:rewrite-maven-plugin:dryRun \
    -Drewrite.activeRecipes=com.example.UseStringIsBlank   # dry-run, emits a patch file
mvn rewrite:run -Drewrite.activeRecipes=com.example.UseStringIsBlank  # apply
```

### Go

- **`gofmt -r 'pattern -> replacement'`** — built into Go, does simple syntactic rewrites with wildcards. Great for trivial mechanical swaps: `gofmt -r 'a[b:len(a)] -> a[b:]'`.
- **`go fix`** — applies the toolchain's bundled migrations (e.g. API renames across Go versions).
- **`dave/dst`** (Decorated Syntax Tree) — Go's `go/ast` is *lossy*: it stores comments in a separate list keyed by byte offsets, so any structural edit scrambles comment placement. `dst` attaches comments and formatting directly to nodes, so transforms keep comments where they belong. Use `dst` whenever your Go codemod reorders, inserts, or deletes nodes.

### Language-agnostic

**Comby** — matches and rewrites using *structural* patterns with holes (`:[var]`), respecting balanced brackets, strings, and comments — without a full language parser. It's the sweet spot between regex and AST: smarter than regex (it won't match inside strings/comments, it balances brackets), lighter than a codemod (no language-specific tooling).

```bash
# Comby: rewrite `foo.then(x => bar(x))` → `await bar(foo)`  (illustrative)
comby 'old_api(:[args])' 'new_api(:[args])' .js
```

> **When NOT to use Comby:** when correctness needs *semantics* — scope, types, "is this the same `getUser`?" Comby is structural but not semantic; it doesn't know types or scope. For type-aware or scope-aware transforms, use ts-morph / OpenRewrite / LibCST.

### Picking a tool, quickly

| Need | Reach for |
|---|---|
| JS/TS bulk syntactic rewrite, reviewable diff | **jscodeshift** |
| JS/TS transform that needs *types* | **ts-morph** |
| Python, comment-preserving | **LibCST** (or **Bowler** for fluent API) |
| Java, type-aware, big migrations, ready-made recipes | **OpenRewrite** |
| Go with comment preservation | **dave/dst** (`gofmt -r` for trivial cases) |
| Cross-language, structural-not-semantic | **Comby** |

---

## 2. CST vs AST: why comment preservation decides reviewability

This is the distinction that separates a codemod people *trust* from one they don't.

- An **AST** is *abstract*: it keeps meaning and discards "insignificant" syntax — whitespace, often comments, sometimes redundant parentheses. Two source files that differ only in formatting produce the *same* AST. Great for analysis; bad for round-tripping, because the formatting you dropped can't be reconstructed.
- A **CST** (Concrete Syntax Tree) keeps *everything* — every comment, every space, every trailing comma. `print(parse(src)) == src` exactly. LibCST and OpenRewrite's LST are concrete/lossless. jscodeshift gets the same effect via **recast**, which keeps the original tokens for unchanged nodes and only reprints what you mutated.

Why does this matter so much? **The diff.**

```diff
# AST-based, LOSSY printer (e.g. Babel reprint, Python ast.unparse):
- def get_user(id):       # look up the user
-     return db.query(id)
+ def fetch_user(id):
+     return db.query(id)
```

Two problems above: the **comment vanished**, and *every* line shows as changed even though you only renamed one identifier. A reviewer can't tell your one intended change from the printer's reformatting noise. They have to read the entire diff with suspicion. Multiply by 200 files and review becomes impossible — so people rubber-stamp it, and bugs slip through.

```diff
# CST/lossless printer (LibCST, recast, OpenRewrite):
- def get_user(id):       # look up the user
+ def fetch_user(id):     # look up the user
      return db.query(id)
```

The comment survives. Only the renamed token moved. The reviewer sees *exactly* the change and nothing else, and can approve with confidence. **A lossless printer is not a nicety — it's what makes a large codemod reviewable, and a codemod that can't be reviewed can't be merged.**

> **When NOT to care about losslessness:** if the output is a build artifact a machine consumes (transpiled bundle, generated code that's git-ignored), reformatting is fine — use the fast/lossy path. Losslessness is for source code humans review.

---

## 3. Idempotency, on purpose

[junior.md §7](junior.md) introduced the goal: run twice, second run is a no-op. Here's how you *engineer* it.

**The rule:** the matcher must not match its own output. Encode the "already done" state into the match condition.

```ts
// jscodeshift: wrap fetch(url) in withRetry(...), idempotently.
root
  .find(j.CallExpression, { callee: { name: "fetch" } })
  .filter((path) => {
    // GUARD: skip if this fetch is already inside a withRetry(...) call.
    let p = path.parent;
    while (p) {
      if (
        p.node.type === "CallExpression" &&
        p.node.callee.name === "withRetry"
      ) return false;          // already wrapped → don't match
      p = p.parent;
    }
    return true;
  })
  .forEach((path) => {
    path.replace(
      j.callExpression(j.identifier("withRetry"), [
        j.arrowFunctionExpression([], path.node),
      ])
    );
  });
```

Run 1 wraps every bare `fetch`. Run 2: every `fetch` is now inside a `withRetry`, the filter returns `false`, zero matches, zero edits. Idempotent.

Common idempotency guards:

- **"Already transformed" check** — does the target already have the new shape? (above)
- **Import dedup** — adding an import? First check it isn't already imported, or you'll stack duplicate import lines on rerun.
- **Marker-free design** — prefer guards that read the *real* end state over leaving a `// codemod-applied` comment marker; markers are noise and can be edited away.

---

## 4. The dry-run / diff workflow as discipline

The professional loop is the same in every tool — only the flag names change:

```bash
# jscodeshift
jscodeshift -t mod.js src/ --dry --print        # 1. dry-run, show output
jscodeshift -t mod.js src/                        # 2. apply
git diff                                           # 3. review every hunk
git diff --stat                                    # 4. sanity-check the blast radius

# LibCST / Bowler
.diff()                                            # dry-run prints unified diff

# OpenRewrite
mvn rewrite:dryRun                                 # writes a .patch you inspect
mvn rewrite:run                                    # apply
```

Three checks before you trust a run:

1. **File count sane?** If you expected ~15 files and it touched 0 or 400, the matcher is wrong — fix before applying.
2. **Diff scoped?** Every hunk should be a change you intended. Surprise reformatting = lossy printer or over-broad transform.
3. **Idempotent?** Apply once, commit, run again on the same tree. Second run should produce an empty diff. If it doesn't, your matcher matches its own output — fix it.

---

## 5. Test the codemod itself

A codemod is code, and it's *high-leverage* code — one bug multiplies across your whole repo. So you test it like any other code, with **fixture pairs**: an `input` source and the `expected` output. Run the transform on the input, assert it equals expected.

jscodeshift ships a test helper for exactly this:

```js
// __tests__/console-to-logger.test.js
const { defineTest } = require("jscodeshift/dist/testUtils");

// Looks for __testfixtures__/basic.input.js and basic.output.js,
// runs the transform on input, asserts the result equals output.
defineTest(__dirname, "console-to-logger", null, "basic");
```

```js
// __testfixtures__/basic.input.js
console.log("hi", x);
console.error("nope");      // must NOT change
const s = "console.log";    // must NOT change
// console.log in a comment  // must NOT change
```

```js
// __testfixtures__/basic.output.js
logger.info("hi", x);
console.error("nope");
const s = "console.log";
// console.log in a comment
```

LibCST has the equivalent via `CodemodTest`:

```python
from libcst.codemod import CodemodTest
from my_codemods import RenameGetUserCommand

class TestRename(CodemodTest):
    TRANSFORM = RenameGetUserCommand

    def test_renames_call(self):
        before = "x = get_user(1)  # fetch it"
        after  = "x = fetch_user(1)  # fetch it"
        self.assertCodemod(before, after)
```

**What to put in your fixtures — every syntactic variant and every thing that must NOT change:**

- the happy path (the obvious case);
- variants that should *also* transform (multi-line, with trailing comments, nested);
- look-alikes that must be *left alone* (the same word in a string, a comment, a different scope);
- the **idempotency case**: feed the already-transformed output back in and assert it's unchanged.

A codemod without tests is a loaded gun pointed at your repo. Twenty lines of fixtures is the cheapest insurance you'll ever buy. We expand robustness (handling *all* the variants you'll forget) in [senior.md](senior.md).

---

## Next

- **[senior.md](senior.md)** — matching complex patterns, handling every syntactic variant, type-aware transforms, composing/sequencing codemods, and build-vs-reuse.
- **[professional.md](professional.md)** — codemods in CI, performance on huge repos, reviewing generated diffs, and the OpenRewrite recipe ecosystem.
- The Visitor pattern underpins every `leave_Call` / `visitMethodInvocation` method here: [../../../design-patterns/03-behavioral/10-visitor/junior.md](../../../design-patterns/03-behavioral/10-visitor/junior.md).
- Classic codemod-friendly refactorings live in [Simplifying Method Calls](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md).

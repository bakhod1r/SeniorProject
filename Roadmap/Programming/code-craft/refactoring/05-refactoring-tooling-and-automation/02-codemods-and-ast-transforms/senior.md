# Codemods & AST Transforms — Senior

> **Source:** Facebook jscodeshift; OpenRewrite docs; Instagram/Meta LibCST

[middle.md](middle.md) covered the tool landscape, losslessness, idempotency, and testing. At the senior level the hard part is no longer "how do I rename a call." It's **completeness and safety**: matching genuinely complex patterns, handling every syntactic variant your codebase will throw at you, using *type* information when shape isn't enough, composing several transforms into one coherent migration, and knowing when to build a custom recipe versus reuse an existing one.

The recurring theme: **a codemod is only as good as the cases it doesn't miss and doesn't break.**

---

## 1. Matching complex patterns

Simple matchers select by node type plus a couple of properties. Real migrations need to match *relationships* — a node in a particular context, a call whose argument has a certain shape, a method on a class that extends a certain base.

### Match by context, not just by node

"Rename `id` → `userId`" is meaningless without context — you'd rename every `id` in the codebase. The real rule is "rename the `id` property *of objects passed to `track(...)`*." That's a contextual match:

```ts
// jscodeshift: rename the `id` key only inside object literals passed to track()
root
  .find(j.CallExpression, { callee: { name: "track" } })
  .forEach((call) => {
    call.node.arguments.forEach((arg) => {
      if (arg.type !== "ObjectExpression") return;
      arg.properties.forEach((prop) => {
        if (
          prop.type === "ObjectProperty" &&
          prop.key.type === "Identifier" &&
          prop.key.name === "id"
        ) {
          prop.key.name = "userId";
        }
      });
    });
  });
```

The match is anchored to `track(...)` first, then drills into its arguments. Anchoring on the enclosing context is how you keep a transform from over-matching — the single most common cause of a codemod going wrong (see [find-bug.md](find-bug.md)).

### Match by structural shape with captures

When the transform is "any binary `a === b` where one side is `null`, rewrite to `isNil(a)`," you match on operator and operand shape:

```ts
root
  .find(j.BinaryExpression, { operator: "===" })
  .filter((p) =>
    p.node.left.type === "NullLiteral" || p.node.right.type === "NullLiteral"
  )
  .replaceWith((p) => {
    const other = p.node.left.type === "NullLiteral" ? p.node.right : p.node.left;
    return j.callExpression(j.identifier("isNil"), [other]);
  });
```

Note you handle *both* operand orders (`x === null` and `null === x`). Forgetting one order is a classic missed variant.

---

## 2. Handling syntactic variants

The same semantic thing can be written many ways. A robust codemod handles *all* of them, or it silently leaves a long tail of un-migrated sites — the worst failure mode, because it looks like success.

Take "we removed the `options` second argument from `fetchUser(id, options)`." The call appears as:

```js
fetchUser(id)                       // already 1-arg — leave alone (idempotent!)
fetchUser(id, opts)                 // strip 2nd arg
fetchUser(id, { cache: true })      // strip 2nd arg (object literal)
fetchUser(id, ...rest)              // spread — CANNOT safely strip; flag for human
fetchUser(...args)                  // spread of everything — can't tell arg count; flag
obj.fetchUser(id, opts)             // method form — same callee name, different shape
fetchUser(id, opts,)               // trailing comma
fetchUser(
  id,
  opts,                             // multi-line + comment
)
```

A senior codemod enumerates these deliberately:

```ts
root
  .find(j.CallExpression)
  .filter((p) => calleeNameIs(p.node.callee, "fetchUser"))  // handle both `f()` and `o.f()`
  .forEach((p) => {
    const args = p.node.arguments;
    if (args.length < 2) return;                       // already migrated → idempotent
    if (args.some((a) => a.type === "SpreadElement")) {
      report(p, "spread args — manual review needed"); // can't be safe → flag, don't guess
      return;
    }
    p.node.arguments = [args[0]];                       // drop the 2nd arg
  });
```

Three senior moves in that snippet:

1. **`calleeNameIs` normalizes the callee** so `fetchUser(...)` and `obj.fetchUser(...)` are both considered (or deliberately *not* — your choice, made explicitly).
2. **The `length < 2` guard makes it idempotent** *and* skips the already-correct form.
3. **Spreads are flagged, not guessed.** When the transform *can't* be made safe for a variant, the codemod reports it for human handling instead of producing wrong code. A codemod that does 95% automatically and *lists* the 5% it can't is far more valuable than one that silently mangles the 5%.

> **When NOT to enumerate every variant yourself:** if the variant space is large and the language is well-served (Java, modern TS), prefer a type-aware tool (OpenRewrite's `MethodMatcher`, ts-morph) that resolves the call *semantically* — it handles the variants for you because it matches on the resolved symbol, not the surface syntax. Hand-enumerating variants is a JS/jscodeshift reality, not a virtue.

---

## 3. Type-aware transforms

Pure-syntax matching hits a wall whenever the rule depends on *types* or *which declaration a name refers to*. "Rename every call to *this specific* `save()` method (the one on `Repository`), not the dozens of unrelated `save()` methods" cannot be done by name alone — you need the type checker.

**ts-morph** gives you the checker:

```ts
import { Project } from "ts-morph";
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

for (const sf of project.getSourceFiles()) {
  sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();           // the `repo.save` part
    if (expr.getKindName() !== "PropertyAccessExpression") return;
    const prop = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (prop.getName() !== "save") return;

    // TYPE-AWARE: resolve what `repo` actually IS.
    const objType = prop.getExpression().getType();
    if (objType.getSymbol()?.getName() === "Repository") {
      prop.getNameNode().replace("persist");     // rename only Repository.save
    }
  });
}
project.saveSync();
```

**OpenRewrite** bakes this in — its `MethodMatcher` is type-qualified by construction:

```java
// Matches ONLY com.example.Repository#save(Object), never any other save().
new MethodMatcher("com.example.Repository save(java.lang.Object)");
```

The cost of type awareness is real: ts-morph and OpenRewrite must *type-check the whole project*, which is slow and requires a buildable, dependency-resolved codebase. A jscodeshift syntactic transform runs on each file in isolation, in milliseconds, no build needed.

> **When NOT to go type-aware:** if a *syntactic* match is unambiguous enough (the method name is unique, the import is distinctive), don't pay for full type resolution — it's slower, fussier, and needs a compiling project. Reserve type-aware tooling for genuinely ambiguous renames where shape can't disambiguate.

---

## 4. Composing and sequencing codemods

A real migration is rarely one transform. "Migrate from `moment` to `date-fns`" is: rewrite each `moment()` call → the equivalent `date-fns` function, update imports, remove the now-unused `moment` import, and reformat. You have two ways to combine steps.

**Sequence (pipeline of separate codemods).** Run mod A, then mod B on A's output. Each is independently testable and rerunnable. Order matters — and **every step must stay idempotent**, because in a sequence a step may see input that's already partly transformed.

```bash
jscodeshift -t 1-rewrite-calls.js src/
jscodeshift -t 2-fix-imports.js  src/
jscodeshift -t 3-remove-unused.js src/
```

**Compose (one codemod, multiple passes internally).** OpenRewrite is built for this — a recipe is a *list* of sub-recipes that run as a unit, sharing parsed trees (so you parse once, not N times):

```java
public class MomentToDateFns extends Recipe {
    @Override public List<Recipe> getRecipeList() {
        return List.of(
            new RewriteMomentCalls(),
            new AddDateFnsImports(),
            new RemoveUnusedImport("moment")   // OpenRewrite ships this one
        );
    }
}
```

Composition wins for big migrations: one parse, shared type information, atomic apply, and you reuse battle-tested sub-recipes (like `RemoveUnusedImport`) instead of rewriting them. Sequencing wins for ad-hoc, one-off chains where you want each step's diff separately reviewable.

A subtle rule for sequences: **make each step a fixed point.** If step 2 isn't idempotent and step 1's output happens to contain a shape step 2 already handled, you double-apply. Test each step against its own output (the idempotency fixture from [middle.md](middle.md)).

---

## 5. Build a custom recipe, or reuse an existing one?

Before writing anything, check whether the transform already exists. The ecosystems are large:

- **OpenRewrite** has catalogs for JUnit 4→5, Spring Boot upgrades, Jakarta EE namespace migration, Mockito, Lombok removal, CVE remediation, and hundreds more. If you're doing a *framework version migration in Java*, someone has almost certainly written the recipe.
- **jscodeshift** has community codemods for React (class → hooks, lifecycle renames), and many libraries ship their own (`react-codemod`, `next-codemod`, MUI, Jest). Major breaking releases of popular libraries usually come with a codemod.
- **LibCST** ships `libcst.codemod` utilities; many Python tools (e.g. `pyupgrade`-style) cover common modernizations.

Decision framework:

| Situation | Choice |
|---|---|
| Framework/library upgrade with a published codemod | **Reuse it** — it's tested against the real corpus, you won't beat it |
| Your transform is *your* domain (internal API rename, company convention) | **Build custom** — no one else has it |
| Existing recipe is 90% right | **Compose**: run the existing one, then a small custom step for the gap |
| One-off, small, needs judgment | **Don't codemod** — IDE or by hand (see junior §8) |

The senior instinct is *reuse-first*: a published codemod has been run across thousands of repos and has absorbed the variant edge cases you haven't thought of yet. Building from scratch means rediscovering all of them in your own production code.

> **When NOT to build a custom recipe:** when a maintained, tested one exists. Your hand-rolled JUnit 4→5 codemod will miss cases the OpenRewrite recipe — run against the entire OSS Java ecosystem — already handles. Reuse, contribute fixes upstream if needed, and spend your effort on the truly bespoke part.

---

## Next

- **[professional.md](professional.md)** — running codemods in CI, performance and parallelism on monorepos, reviewing machine-generated diffs at scale, and maintaining codemods as living tools.
- The "drop/flag a variant the codemod can't safely handle" instinct connects to [Refactoring to Patterns — Creational](../../03-refactoring-to-patterns/02-creational/junior.md) when a transform shifts construction logic.
- Type-aware traversal is the Visitor pattern with a symbol table: [../../../design-patterns/03-behavioral/10-visitor/junior.md](../../../design-patterns/03-behavioral/10-visitor/junior.md).

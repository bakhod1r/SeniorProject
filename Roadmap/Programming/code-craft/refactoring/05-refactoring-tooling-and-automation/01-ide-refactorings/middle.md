# IDE & Automated Refactorings — Middle

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

You know what the buttons do. The middle-level skill is *mapping the automated catalog onto the named refactorings from the literature*, knowing where the per-language guarantees differ, and running the small-steps workflow so fluently that refactoring becomes background activity while you're really thinking about design.

---

## 1. The automated catalog ↔ Fowler's catalog

Every IDE refactoring is a mechanized version of a named refactoring. Knowing the mapping lets you read Fowler's catalog and immediately ask "does my IDE automate this?"

| IDE refactoring | Fowler name(s) | Technique page |
|---|---|---|
| Rename | Rename Variable / Rename Field / Rename Method | [composing-methods](../../02-refactoring-techniques/01-composing-methods/middle.md), [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Extract Method/Function | Extract Function | [composing-methods](../../02-refactoring-techniques/01-composing-methods/middle.md) |
| Extract Variable | Extract Variable | [composing-methods](../../02-refactoring-techniques/01-composing-methods/middle.md) |
| Inline Method / Inline Variable | Inline Function / Inline Variable | [composing-methods](../../02-refactoring-techniques/01-composing-methods/middle.md) |
| Change Signature | Change Function Declaration, Add/Remove Parameter, Reorder Parameters | [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Introduce Parameter | Parameterize Function | [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Introduce Parameter Object | Introduce Parameter Object | [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Move Method / Move Field | Move Function / Move Field | [moving-features](../../02-refactoring-techniques/02-moving-features/middle.md) |
| Move Class | Move Class | [moving-features](../../02-refactoring-techniques/02-moving-features/middle.md) |
| Encapsulate Field | Encapsulate Variable / Encapsulate Field | [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Extract Interface / Superclass | Extract Interface, Extract Superclass | [dealing-with-generalization](../../02-refactoring-techniques/06-dealing-with-generalization/middle.md) |
| Pull Up / Push Down (Field/Method) | Pull Up Field/Method, Push Down Field/Method | [dealing-with-generalization](../../02-refactoring-techniques/06-dealing-with-generalization/middle.md) |
| Replace Constructor with Factory Method | Replace Constructor with Factory Function | [simplifying-method-calls](../../02-refactoring-techniques/05-simplifying-method-calls/middle.md) |
| Replace Inheritance with Delegation | Replace Subclass with Delegate | [dealing-with-generalization](../../02-refactoring-techniques/06-dealing-with-generalization/middle.md) |

Two observations:

- **The automated subset is the *mechanical* subset.** Refactorings that are pure tree-surgery — Rename, Extract, Move, Pull Up — automate cleanly. Refactorings that require *judgment about meaning* (Replace Conditional with Polymorphism, Separate Query from Modifier) are only partly automatable; the IDE gives you the scaffolding (extract the method, create the subclass) and you supply the design.
- **Composability is the real power.** Big restructurings are sequences of small automated steps. "Move this behavior into a new class" = Extract Method → Move Method → maybe Extract Class → Rename. You never hand-edit; you chain guarantees.

## 2. A worked composition: extracting a class via four automated steps

Suppose `Order` has accumulated phone-number logic that belongs in its own type.

```java
// BEFORE
class Order {
    private String customerName;
    private String areaCode;
    private String number;

    String telephoneNumber() { return "(" + areaCode + ") " + number; }
}
```

Target: a `TelephoneNumber` value object. The fully automated path:

1. **Extract Class** (IntelliJ: *Extract Delegate*) on `areaCode`, `number`, `telephoneNumber()` → creates `TelephoneNumber` and a `phone` field on `Order`, rewiring access.
2. **Rename** the moved getter to `toString()` if appropriate (`⇧F6`).
3. **Inline** any now-trivial delegating accessors on `Order` (`⌘⌥N`).
4. **Move** any remaining phone-related helper from `Order` to `TelephoneNumber` (`F6`).

```java
// AFTER
class Order {
    private String customerName;
    private TelephoneNumber phone;
    String telephoneNumber() { return phone.toString(); }
}
class TelephoneNumber {
    private String areaCode;
    private String number;
    @Override public String toString() { return "(" + areaCode + ") " + number; }
}
```

Each step compiled and passed tests on its own. If step 3 had broken something, you'd know instantly and `Ctrl+Z` once.

> **When NOT to:** don't run the whole chain blind. After each automated step, *look* at the result and run tests. Extract Delegate in particular makes a lot of choices (which members move, how the field is named) — review its preview.

## 3. Per-language guarantees differ — a lot

The IDE's confidence is exactly as strong as the language's type information.

| Language tier | Rename safety | Extract Method | Change Signature | Why |
|---|---|---|---|---|
| **Statically typed, nominally resolved** (Java, C#, Kotlin, TypeScript, Rust, Go) | Strong | Strong | Strong | Every reference resolves to a unique declaration; the compiler's symbol table *is* the refactoring index |
| **Gradually typed** (TypeScript with `any`, Python with type hints) | Strong where typed, weak where `any`/untyped | Good | Good where typed | `any` erases the link; an untyped `obj.foo()` can't be proven to be *your* `foo` |
| **Dynamically typed** (Python, Ruby, JavaScript) | Best-effort / heuristic | Good (local data-flow only) | Risky | No static guarantee that two `pay()` calls hit the same method; the tool guesses from imports, call shape, and project heuristics |

A concrete consequence: in Java, Rename `Account.calc` to `total` is *provably* complete. In dynamically-typed Python, the language server sees `x.calc()` and cannot *prove* `x` is an `Account` — it might be a duck-typed stand-in. PyCharm does an impressive heuristic job, but it will sometimes rename a same-named method on an unrelated class, or miss a call on a variable it couldn't infer. The fix is the same as for any unsafe edit: tests, and a preview review.

TypeScript sits in between and rewards you for typing: the more `any` you have, the more your "automated" rename degrades toward find-and-replace.

> **When NOT to:** in a dynamic language, never treat a multi-file Rename as "done" because it didn't error. Run the suite. The tool's silence is not the compiler's guarantee.

## 4. The small-steps workflow

The discipline that separates fluent refactorers from people who "do a big refactor" over an afternoon and break the build:

1. **Make the change safe to make.** Tests green? If not, add characterization tests first ([`../03-automated-safety-nets/middle.md`](../03-automated-safety-nets/middle.md)).
2. **Pick the smallest next automated step** that moves toward the target shape.
3. **Apply it via keyboard.** No manual editing if an automated refactoring exists.
4. **Run the relevant tests** (a focused subset, not the whole suite, if the suite is slow).
5. **Commit** at green checkpoints. Small commits = easy bisect, easy revert.
6. Repeat until you reach the target shape.

The payoff is *interruptibility*: you can stop at any green checkpoint and ship, or hand off. Compare to a 400-line working-copy change that's half-done and won't compile — that has to be finished or thrown away.

A practical tell: if you find yourself manually retyping the same identifier in three places, *stop* — you skipped a Rename. If you're hand-fixing call sites after adding a parameter, you skipped Change Signature. The presence of repetitive manual edits is a signal you bypassed an automated refactoring.

## 5. Verifying with tests — what "verify" means at this level

"Run the tests" is necessary but blunt. Sharper verification:

- **Coverage of the touched region.** A green suite proves nothing about behavior the suite never exercises. Before a risky refactor, check that the lines you're about to move are actually covered. If not, add a test for them first.
- **Watch for *new* warnings, not just errors.** A semantics-changing refactor (an Inline that creates duplicate side effects, a Change Signature that shifts overload resolution) may compile and pass thin tests while changing behavior in an untested branch.
- **Use the preview as a review surface.** For Rename/Move/Change Signature across many files, the preview *is* a diff. Skim it the way you'd skim a PR. The "dynamic references / occurrences in strings & comments" section is where to slow down.
- **Diff the bytecode/output when paranoid.** For a pure rename or extract that *must* be behavior-preserving in a critical path, comparing compiled output (or a golden test of program output) before/after is the strongest possible check. This is the idea behind automated safety nets — [`../03-automated-safety-nets/middle.md`](../03-automated-safety-nets/middle.md).

## 6. When the automated path stops

You'll hit a wall when the change crosses what the type-checker can see:

- A field that's also a JSON key, a DB column, a Spring bean id, or appears in a JSX template.
- A method invoked reflectively or wired by a framework.
- A pattern repeated across hundreds of files in a way no single IDE refactoring expresses (e.g. "rewrite every `new Date()` to `Clock.now()`").

At that wall you switch tools, not abandon rigor:

- **Pattern across many files, same language** → write a **codemod**: [`../02-codemods-and-ast-transforms/middle.md`](../02-codemods-and-ast-transforms/middle.md).
- **Across repos / a true migration** → [`../04-large-scale-automated-migrations/middle.md`](../04-large-scale-automated-migrations/middle.md).
- **Crosses into config/SQL/templates** → manual edit guarded by characterization tests: [`../03-automated-safety-nets/middle.md`](../03-automated-safety-nets/middle.md).

> **When NOT to:** don't reach for a codemod the moment one IDE refactoring is awkward. Codemods cost authoring + review time. They earn their keep at scale or across boundaries — not for a 6-call-site change one Rename handles.

## 7. Next

- **[senior.md](senior.md)** — language-server internals: how Rename resolves references, why dynamic languages are weaker, and designing code the tools can analyze.
- **[professional.md](professional.md)** — IntelliJ vs ReSharper vs LSP in practice, refactoring safety in CI, and where automated refactorings break in real systems (reflection/DI/SQL/templates).
- Practice: [tasks.md](tasks.md) · [optimize.md](optimize.md) · [find-bug.md](find-bug.md)

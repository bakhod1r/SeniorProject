# IDE & Automated Refactorings — Interview

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

Conceptual Q&A. Model answers are deliberately concise and senior — say the *mechanism*, then the *limit*.

---

**Q1. Why is an automated Rename safe where a find-and-replace of the same identifier is not?**

Rename operates on the **semantic model**, not on text. The IDE parses the code into an AST, binds each name occurrence to its declaration, and rewrites exactly the occurrences whose binding points at the symbol you're renaming — across all files, skipping look-alikes. Find-and-replace sees only characters: it can't distinguish `Customer.name` from `Server.name`, from `name` inside `hostname`, from `"name"` in a string literal, from a comment. So Rename updates the *right* references and nothing else, while find-and-replace over- or under-replaces. The catch: Rename only sees references the binding can resolve — names hiding in strings/reflection/config are invisible to it.

---

**Q2. What exactly makes the guarantee possible, and when does it stop holding?**

It holds when the **binding is total and exact** — every reference resolves to a unique declaration. That's automatic in statically, nominally typed languages because the compiler already resolved everything to type-check. It stops holding when binding is incomplete: dynamically-typed receivers (`handler.execute()` where `handler`'s type is unknown), `any` in TypeScript, or references that live outside the language entirely (SQL, templates, DI config, reflection strings). There the engine either gives up or guesses heuristically, and "no error" no longer means "provably correct."

---

**Q3. When can Extract Method change semantics?**

Pure Extract Method shouldn't — but edge cases bite. (1) If the block reads variables that are reassigned later, the extracted method must take them as parameters and return updated values; getting the data flow wrong changes results. (2) Closure/capture differences across languages can alter whether a captured variable is shared or copied. (3) In a class with subclasses, extracting then making the new method overridable can introduce a polymorphic hook that didn't exist. Good engines refuse the ambiguous cases (e.g. two locals written and used afterward — no single return). The discipline: run tests that exercise the branches, not just the happy path.

---

**Q4. IDE refactoring vs codemod — when each?**

An **IDE refactoring** is interactive, one-shot, AST-based, and bounded to references the engine resolves — ideal for a single rename/extract/move within one language where the engine has a binding. A **codemod** is a *scripted* AST transformation you author, run in bulk, and review as code — ideal when (a) the pattern spans hundreds of files, (b) it's a shape no built-in refactoring expresses (`new Date()` → `clock.now()`), or (c) it must touch a language/boundary the IDE doesn't understand. Rule of thumb: reach for a codemod when the change is *repetitive at scale* or *crosses a boundary*; otherwise the IDE is faster and safer. See [`../02-codemods-and-ast-transforms/interview.md`](../02-codemods-and-ast-transforms/interview.md).

---

**Q5. Why are automated refactorings weaker in Python/Ruby/JavaScript than in Java/Kotlin?**

Because Rename needs to know which declaration a call refers to, and that requires the receiver's type — which a dynamic language often can't determine statically. `x.pay()` could hit any class with a `pay` method. The engine falls back on heuristics (import graph, local inference, type hints, name uniqueness), which produce both missed references and wrongly-included ones. So in dynamic languages a multi-file rename is a *probability*, not a *proof*, and you must verify with the test suite. Adding type hints / reducing `any` directly upgrades the tooling's accuracy.

---

**Q6. Your IDE renamed a Spring service class and the app won't start. What happened and how do you prevent it?**

The class was referenced by a string the IDE couldn't see — a bean id in XML, a `@Qualifier("oldName")`, or a `Class.forName` somewhere — and that string went stale, so the DI container fails to resolve the bean at startup. The IDE refactoring was correct *for the code references* and blind to the *string references*. Prevention: before renaming framework-wired types, grep for the old name as a string; prefer decoupling the external name from the symbol (`@Service("explicitId")` or `@Component` with a stable name); and rely on an **integration test that boots the context** in CI, since unit tests won't catch it.

---

**Q7. How does Change Signature avoid breaking callers, and where can it still go wrong?**

It updates every resolved call site atomically — reorders/renames/inserts arguments, and lets you supply a default for a new parameter so existing calls compile. It can still go wrong by (a) **overload resolution**: adding a parameter may make a call bind to a *different* overload that now matches better — compiles, dispatches elsewhere; (b) **invisible callers**: reflective invocations or framework-bound methods aren't updated; (c) semantic defaults: the default you inject may be wrong for some callers, silently changing behavior. Verify with tests covering the affected overloads.

---

**Q8. What is "refactor in tiny steps, run tests after each," and why not one big edit?**

It's applying the smallest automated refactoring that advances toward the target shape, then running tests, then committing at green — repeating. The benefit is *localization and reversibility*: if step 7 breaks something you know it was step 7 and `Ctrl+Z` once, versus bisecting a 400-line tangled edit. It also keeps the working copy shippable at every checkpoint. A single big edit is harder to review, harder to revert, and more likely to combine a mechanical change with an accidental behavioral one.

---

**Q9. Why does the Rename preview list comment/string occurrences separately?**

Because those occurrences are *not in the binding*. The engine can prove that resolved code references mean your symbol; it cannot prove that the word `name` in a comment or `"name"` in a string refers to it. So it offers them as an opt-in textual match — sometimes you do want them (a log message, a doc), sometimes you must not (a UI label, a wire key). Forcing the choice keeps the safe set provable and the unsafe set explicit.

---

**Q10. When should you NOT use an automated refactoring, and what do you use instead?**

When the change crosses a boundary the engine doesn't model — a name that's also a DB column, wire field, route, template binding, bean id, or reflective string. Then the IDE refactoring is at best step one. Use a **codemod** targeted at the right language for the boundary part ([`../02-codemods-and-ast-transforms/interview.md`](../02-codemods-and-ast-transforms/interview.md)), or do it manually under **characterization tests** ([`../03-automated-safety-nets/interview.md`](../03-automated-safety-nets/interview.md)). For a project-/repo-wide sweep, escalate to large-scale migration tooling ([`../04-large-scale-automated-migrations/interview.md`](../04-large-scale-automated-migrations/interview.md)).

---

**Q11. How do you design code so automated refactorings keep working as the system grows?**

Keep the binding total: prefer static/polymorphic dispatch over name-string reflection; keep contracts in types or decouple external names via annotations (`@Column`, `@JsonProperty`) so the symbol is free to rename; minimize `any`/untyped surfaces in frequently-changed code; and fence unavoidable reflection (plugin loading, serialization) behind a thin, well-tested boundary. A well-typed, statically-dispatched codebase is a *refactorable* one — typing is a tooling-capability decision, not just a runtime-safety one.

---

**Q12. Encapsulate Field rewrote all my accesses but serialization broke. Why?**

Encapsulate Field changes direct field access to getter/setter calls — purely for *code* references. But if a framework serializes by **field reflection** or by a field-name convention, routing through accessors (or the act of making the field private) can change what gets serialized, or the serializer may now pick up the getter as a different property. The code references were handled; the serialization contract — invisible to the refactoring — was not. Guard with a golden serialization test and check the framework's access strategy before encapsulating serialized fields.

---

**Q13. Inline Variable seems trivially safe. Give a case where it isn't.**

When the variable holds a value with **side effects or cost** and is used more than once: `r = charge(); use(r); use(r);` inlined becomes `use(charge()); use(charge());` — now `charge()` runs twice, doubling side effects and cost. Also, inlining can change *evaluation order* relative to surrounding expressions. The IDE may warn for impure expressions, but it can't always prove purity, so confirm the expression is idempotent before inlining a multiply-used variable.

---

**Q14. A teammate says "automated refactoring means I don't need tests." Respond.**

Wrong in two ways. First, the guarantee is *bounded* to references the engine resolves — dynamic dispatch, reflection, config, SQL, and templates fall outside it, and those are exactly where silent breakage lives; only tests (especially integration tests) catch them. Second, even within scope there are semantics-changing edge cases (overload shift, inline side-effects, overridable extraction). The tool handles the *mechanical* edit reliably; tests *verify the behavior held*. They're complementary: semantic tool + fast tests is what makes confident refactoring possible. Neither alone is sufficient.

---

**Q15. Find-Usages says zero, but you suspect the method is used. What now?**

Find-Usages shares Rename's binding, so "zero usages" means "zero *resolvable* usages" — the method may still be called reflectively, from another language, via a framework, from a string-built name, or from a module the analyzer didn't index. Before deleting: grep for the method name as a *string* across the whole repo (and config/templates/SQL), check for reflection and DI wiring, and run the integration suite. Treat "zero usages" on a public/framework-exposed method as a hypothesis to verify, not a fact.

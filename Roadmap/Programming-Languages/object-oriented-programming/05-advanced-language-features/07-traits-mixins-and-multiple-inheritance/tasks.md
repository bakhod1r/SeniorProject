# Traits, Mixins and Multiple Inheritance — Tasks

Hands-on exercises graded easy → hard. Each has explicit acceptance criteria. The two anchor skills this topic demands: **implement a mixin-style capability in Java the right way**, and **read/compute a method resolution order by hand** so cross-language code never surprises you. Several tasks ask you to run `javap` or a one-file Python/Scala script — do them; the muscle memory is the point.

---

## Easy

### Task 1 — Implement a stateless mixin (trait) in Java

Write an interface `Comparable`-style mixin `Ranked` with one abstract hook `int rank()` and two derived defaults: `default boolean outranks(Ranked o)` and `default int rankGap(Ranked o)`. Implement it on a `record Player(String name, int rank)`.

**Acceptance:**
- [ ] `Ranked` has exactly **one** abstract method and **no** fields.
- [ ] Both default methods are derived *only* from `rank()` (no state).
- [ ] `new Player("A", 10).outranks(new Player("B", 5))` returns `true` (higher rank number = higher, your call — document it).
- [ ] You can articulate *why* this is a formal *trait*, not a mixin (stateless, explicit-conflict, flattening).

### Task 2 — Trigger and resolve the diamond

Create two unrelated interfaces `Json` and `Xml`, each with `default String render()`. Implement both on a class `Document` and make it compile.

**Acceptance:**
- [ ] You observed the *"inherits unrelated defaults"* compile error first (paste it).
- [ ] `Document.render()` resolves the conflict with `Json.super.render()` or `Xml.super.render()`.
- [ ] You added a one-line comment explaining *why* the chosen path wins.

### Task 3 — Prove "classes win"

Write a class `Base` with `public String tag()` and an interface `Tagged` with `default String tag()`. Make `Child extends Base implements Tagged` and predict, then verify, what `new Child().tag()` returns.

**Acceptance:**
- [ ] You predicted the class version **before** running.
- [ ] You verified it returns the class's value (the default is dead code here).
- [ ] You can cite the rule ("classes win", JLS §8.4.8).

---

## Medium

### Task 4 — Read a Python MRO and predict the output

Write this and **predict the printed list before running**:

```python
class A:
    def m(self): return ["A"]
class B(A):
    def m(self): return ["B"] + super().m()
class C(A):
    def m(self): return ["C"] + super().m()
class D(B, C): pass

print(D.__mro__)
print(D().m())
```

**Acceptance:**
- [ ] You wrote down `D.__mro__` and `D().m()` *before* running.
- [ ] You computed the MRO `[D, B, C, A, object]` by hand with the C3 merge (show the merge steps).
- [ ] You can explain *why* `B`'s `super()` calls `C`, not `A`.
- [ ] Output matches your prediction: `['B', 'C', 'A']`.

### Task 5 — Make C3 fail on purpose

Construct a class hierarchy in Python that raises `TypeError: Cannot create a consistent method resolution order`.

**Acceptance:**
- [ ] The error fires at **class-definition** time, not at call time.
- [ ] You can state the contradictory ordering constraint in one sentence (e.g. "X wants A-before-B, Y wants B-before-A").
- [ ] You explain why Java structurally *cannot* hit this failure (no cross-interface linearization).

### Task 6 — Translate a Scala stackable trait into Java decorators

Given this Scala-style stack (validate then log then run), reproduce the *same* observable order in Java **without** simulating linearization:

```scala
class S extends BaseService with Logging with Validating   // order: validate(); log(); run()
```

Build Java `Greeter`-style decorators (`Validating`, `Logging`) wrapping a core `Service`, composed so the order is explicit at construction.

**Acceptance:**
- [ ] No `X.super.m()` chains used to fake a linearization.
- [ ] The execution order is visible in the *construction expression* (`new Logging(new Validating(core))` or equivalent).
- [ ] Reordering the wrappers changes the order — and that change is *visible in code*, not hidden in a linearization table.

### Task 7 — `javap` the dispatch difference

Compile the mixin version (`Order implements Timestamped`, from [optimize.md](optimize.md)) and a composition version (`Order` delegating to a `Timestamps` field). Disassemble both `age()` call sites.

**Acceptance:**
- [ ] `javap -c` shows `invokeinterface` for the mixin call and `invokevirtual`/`invokevirtual` for the delegation path.
- [ ] You can explain why the difference is usually erased by JIT inlining at a monomorphic call site.
- [ ] You note the one case it isn't erased (megamorphic site, inline-cache thrash).

---

## Hard

### Task 8 — Build a `@Mixin`-style capability with state, the right way

You need a reusable *retry* capability: a method `withRetry(Supplier<T>)` that retries N times with backoff. It needs **state** (attempt count config, backoff policy). Implement it so that (a) it's reusable across unrelated classes, (b) each class can configure it, (c) it's mockable in tests.

**Acceptance:**
- [ ] You did **not** put the state on an interface (you know §9.3 makes interface state a shared global).
- [ ] The capability is a composed collaborator (`RetryPolicy`) held as a field and delegated to.
- [ ] Two classes can hold *differently-configured* `RetryPolicy` instances.
- [ ] A test substitutes a `RetryPolicy` that records calls without sleeping.
- [ ] You wrote one paragraph: "why composition beat the mixin here" referencing state + test seam.

### Task 9 — Compute a Scala linearization and verify against the JVM

For `class C extends A with B with D` (where `B extends A`, `D extends A`), compute the linearization by hand using the right-most-wins dedup rule, then verify by running the Scala and printing a `super`-chained method's output. (Use `scala-cli` or any Scala REPL.)

**Acceptance:**
- [ ] You wrote the linearization `L(C)` showing the concatenation + dedup steps.
- [ ] You predicted the output of a `super`-chained method before running.
- [ ] Runtime output matches.
- [ ] You can state how Java would force you to write that order explicitly.

### Task 10 — Diagnose and fix a "stateful mixin" in real code

Take the `Cacheable` interface from [optimize.md](optimize.md) §8 (the shared-`CACHE`-on-interface bug). Write a test that *proves* the cache leaks across two unrelated implementor classes, then refactor to composition and show the test now passes.

**Acceptance:**
- [ ] A failing test demonstrates `ClassA` and `ClassB` sharing one cache (one's entry visible to the other).
- [ ] You explain why: the interface field is `public static final` (§9.3), so there is exactly one instance program-wide.
- [ ] After refactoring to a per-instance `Cache` collaborator, the leak test confirms isolation.
- [ ] You leave a comment naming the smell ("stateful mixin → composition") for the next reader.

### Task 11 — Cross-language MRO matrix

Take the *same* diamond (`Base` ← `Polite`, `Loud` → `Person`, each overriding `greet` and calling up) and implement it in **Java, Python, and one of Scala/Ruby**. Tabulate, for each, the resolved output and what `super`/`X.super` means.

**Acceptance:**
- [ ] Java version forces an explicit override (no auto-resolution) — you choose and document the order.
- [ ] Python/Scala/Ruby versions show the *automatic* linearized order, and you note the order is *reversible by reordering parents*.
- [ ] Your table has a column "what `super` resolves to" with the correct answer per language (next-in-MRO / next-in-linearization / next-in-ancestor-chain / named-direct-superinterface).
- [ ] One-paragraph conclusion: which model you'd want for a 50-person codebase and why.

---

## Stretch

### Task 12 — Implement trait *exclusion* manually in Java

The Schärli trait calculus has an *exclusion* operator (compose a trait but drop one of its methods). Java has no such operator. Simulate it: compose two behavior interfaces where you want all of `A`'s methods but only *some* of `B`'s, by overriding the unwanted `B` defaults to delegate elsewhere or throw `UnsupportedOperationException` with a clear message.

**Acceptance:**
- [ ] The class exposes `A`'s behavior intact.
- [ ] The excluded `B` method is explicitly neutralized (not silently inherited).
- [ ] You write two sentences on why Java forcing this to be *explicit* is safer than a language that would silently linearize `B`'s method in.

---

**How to grade yourself:** the easy tasks build the Java muscle (mixin done right, diamond resolved, classes-win). The medium tasks build the *cross-language reading* muscle (compute an MRO, translate linearization to explicit Java). The hard tasks build *judgement* — recognizing when a "trait" needs state and must become composition, and articulating the trade-off out loud. If you can do Task 8 and Task 11 cleanly, you understand this topic at the level that matters in design review.

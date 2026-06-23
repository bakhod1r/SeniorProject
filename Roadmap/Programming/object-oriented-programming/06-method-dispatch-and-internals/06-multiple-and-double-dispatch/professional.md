# Multiple & Double Dispatch — Professional

> The team and review lens: the vocabulary to name these issues in a PR, the static-analysis tooling that catches the overloading trap and stale switches, the refactoring playbook for moving between virtual methods / Visitor / pattern switch, and the judgement calls about when any of this is worth it.

---

## 1. Review vocabulary — name it precisely

Sloppy review comments ("this is confusing") get ignored. Precise ones drive change. Use these terms:

| Say this                                                | Instead of            |
| ------------------------------------------------------- | --------------------- |
| "This relies on **static overload resolution** — the runtime type of `s` is ignored; the `Shape` overload always wins." | "this picks the wrong method" |
| "This is **single dispatch**; you need the second type, so use a pattern switch or Visitor." | "add an instanceof" |
| "This Visitor is the wrong dual for the **expression problem** here — types change more than operations." | "I don't like Visitor" |
| "This `accept` site is **megamorphic**; it won't inline." | "this is slow" |
| "The switch isn't **exhaustive** over the sealed type; seal it and drop the `default` so the compiler guards future additions." | "add a default" |
| "`equals` here is asymmetric — broken **double-dispatch** across the hierarchy." | "equals looks off" |

The single most valuable review catch in this area: **an overloaded method where the author clearly expected dynamic behavior.** It is silent, compiles cleanly, and passes happy-path tests.

---

## 2. The overloading trap in code review — how to spot it

Pattern to flag on sight:

```java
void handle(Event e) {
    process(e);                 // e is statically `Event`
}
void process(ClickEvent c) { ... }
void process(KeyEvent k)   { ... }
void process(Event e)      { ... }   // <-- this ALWAYS wins inside handle()
```

The tell: **overloads whose parameters are subtypes of each other, called through a supertype variable.** The author wanted dispatch on the runtime event type; they got the base overload every time. Reproduce the proof in the PR:

```
$ javap -c Foo | grep process
   invokevirtual #N // Method process:(LEvent;)V    <-- frozen at compile time
```

The fix is to make the second dispatch real: a pattern switch on `e`, or push `process` onto the event type as a virtual method, or a Visitor.

---

## 3. Tooling that catches these issues

| Tool                        | What it catches                                                            |
| --------------------------- | -------------------------------------------------------------------------- |
| **error-prone** `OverloadedMethodsAreNotPolymorphic` / `OverloadedUnary...` checks; `DangerousLiteralNull` | overloads ambiguous on `null`; some "you meant override" cases |
| **error-prone** `MissingOverride` | a method that overrides without `@Override` — guards against accidental overload-instead-of-override |
| **`javac -Xlint:overrides`** + `@Override` everywhere | the override-vs-overload confusion at compile time |
| **`javac` exhaustiveness** (Java 21) | a pattern switch over a sealed type that misses a case — *compile error*, no tool needed |
| **IntelliJ / SonarLint** `S6916`, "switch on sealed type should be exhaustive" | `default` branches that hide missing cases |
| **SpotBugs** `EQ_*` family | broken `equals` symmetry — the double-dispatch-over-hierarchy bug |
| **PMD** `AvoidUncheckedExceptionsInSignatures`, `CyclomaticComplexity` | giant `instanceof` chains that should be switches |
| **ArchUnit**                | enforce "no `instanceof` in package `domain.visitor`", or "all `Shape` subtypes are sealed/permitted" |

A concrete ArchUnit rule to keep a pattern-switch model honest — forbid new `instanceof` chains creeping in beside the sealed switch:

```java
@ArchTest
static final ArchRule shapes_are_sealed =
    classes().that().implement(Shape.class)
        .should().beRecords()                 // records: final, no rogue subclassing
        .because("Shape is a sealed model; subtypes must be final records");
```

And an error-prone-style guard you can encode as a custom check or review checklist item: *"any method group of 2+ overloads where one parameter type is a subtype of another must have a comment justifying static resolution, or be refactored."*

---

## 4. Refactoring playbook

### 4.1 `instanceof` chain → pattern switch (Java 21)

Before:

```java
double area(Shape s) {
    if (s instanceof Circle c) return Math.PI * c.r() * c.r();
    else if (s instanceof Square sq) return sq.side() * sq.side();
    throw new IllegalStateException("unknown " + s);
}
```

After — seal the hierarchy first, then switch; the `throw` disappears because the switch is provably exhaustive:

```java
sealed interface Shape permits Circle, Square {}
double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square sq -> sq.side() * sq.side();
    };
}
```

Payoff: adding a `Triangle` to `permits` now turns *every* non-exhaustive switch into a compile error — the compiler becomes your "find all the call sites" tool.

### 4.2 Visitor → pattern switch

If you own all the visitors and the element set is closed, a Visitor is usually pure ceremony post-Java-21. Collapse each `Visitor` implementation into a method with a switch; delete `accept` and the `Visitor` interface. Watch for: visitors that carried *state* across `visitXxx` calls — that state becomes local variables or a fold, often clearer.

### 4.3 Pattern switch → Visitor

Go the *other* way only when operations must be added by code that cannot edit your switches — e.g., a published plugin API. Then Visitor's "add an operation = add a class" is the right cheap axis, and you accept that adding an element is a breaking change (version it).

### 4.4 Symmetric matrix → handler map

For collision-style symmetric dispatch, replace N² mirror methods with a `Map<Pair<Class,Class>, Handler>` plus a symmetry fallback (senior.md §4). It localizes the matrix and the symmetry rule to one place.

---

## 5. Designing a Visitor others will extend

If you ship a Visitor as API, the element set is now part of your binary contract. Mitigations:

- **Provide a default-method base** (`AbstractVisitor` or default methods on the interface) so adding a `visitXxx` doesn't break every downstream visitor — they inherit a no-op or a "visitDefault" delegate.

```java
interface Visitor<R> {
    R visitDefault(Shape s);
    default R visitCircle(Circle c) { return visitDefault(c); }
    default R visitSquare(Square s) { return visitDefault(s); }
}
```

  Now a new `visitTriangle` with a `default` body that calls `visitDefault` is *source- and binary-compatible*. This is the single most important professional technique for a public Visitor.

- **Consider Acyclic Visitor** (middle.md §8) if visitors are genuinely partial.
- **Document the dispatch contract**: that `accept` must call exactly the most-specific `visitXxx`, and that visitors must be stateless or document their statefulness for reuse.

---

## 6. Testing the dispatch, not just the result

Dispatch bugs hide behind correct happy-path output. Test the *selection*, not only the value:

- **Parameterized test across every subtype**, asserting the right branch ran (e.g., each visitor method increments a distinct counter, or the switch returns a type-tagged result).
- **A "new subtype" canary test**: a test that fails to compile (or a reflection test that fails at runtime) when a subtype is added without updating a non-sealed switch. For sealed switches the compiler is the canary; for `instanceof` chains and handler maps you must write this test yourself.
- **`equals`/`hashCode` symmetry + reflexivity tests** (use Guava's `EqualsTester`) for any hierarchy doing double-dispatch equality.

```java
new EqualsTester()
    .addEqualityGroup(new Cash(100), new Cash(100))
    .addEqualityGroup(new Card("x"))
    .testEquals();   // catches asymmetric double-dispatch equals
```

---

## 7. When it matters vs when it doesn't

**It matters when:**

- The element hierarchy is closed and you are choosing the *encoding* for a model that many operations will traverse (AST, IR, domain events). Wrong choice = recompilation pain for years.
- You see overloads-as-pseudo-dispatch in hot, correctness-critical code (event routers, message handlers). Silent mis-dispatch ships bugs.
- `equals`/`Comparable` cross a subclassable hierarchy — symmetry breaks corrupt collections.

**It doesn't matter when:**

- The operation belongs on the type and the type set is closed — just use a plain virtual method. Don't introduce Visitor.
- There are two arms and they'll never grow — a two-branch `instanceof` is fine and clearer than a sealed-switch refactor.
- Performance is not on the path — the megamorphic-Visitor concern is real only in hot loops over heterogeneous data; profile before optimizing.

The professional failure mode is *both* directions: junior teams ship the overloading trap; senior teams over-apply Visitor where a virtual method or a five-line switch would do. Match the tool to the expected change axis and the type-set openness — nothing more.

---

## 8. What's next

| Topic                                   | File              |
| --------------------------------------- | ----------------- |
| Canonical citations                      | `specification.md` |
| Overload/Visitor bug hunt                | `find-bug.md`      |
| JMH benchmarks                           | `optimize.md`      |
| Hands-on `javap` + dispatcher build      | `tasks.md`         |

See [../../02-more-about-oop/09-method-overloading-overriding/](../../02-more-about-oop/09-method-overloading-overriding/) for overload/override review heuristics, and [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/) for sealing strategy.

---

**Memorize this:** in review, the highest-value catch is *overloads masquerading as dynamic dispatch* — prove it with `javap` and refactor to a pattern switch or a virtual method. Seal your model so the compiler guards future type additions. Ship public Visitors with `default`-method bodies delegating to `visitDefault` so adding a case stays binary-compatible. Choose the encoding by the change axis you expect to grow — and don't reach for Visitor when single dispatch already suffices.

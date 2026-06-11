# Traits, Mixins and Multiple Inheritance — Professional

> **What?** The team-and-review lens: how to name, spot, and govern multiple-behavior-inheritance issues in a Java codebase (and in polyglot teams that touch Scala/Python/Kotlin). What to flag in review, which tools enforce the rules, and the refactoring playbook for turning an abused "interface-as-mixin" into something maintainable.
> **How?** A vocabulary section, a set of review smells with the fix, ArchUnit/static-analysis rules you can actually commit, and a migration recipe from default-method-mixin to composition.

This file assumes the design judgement from [senior.md](senior.md): behavior is shareable, state is not; default methods are safe for derivation, risky for coordination.

---

## 1. Review vocabulary — say the precise thing

Vague review comments ("this inheritance is confusing") don't drive change. Use the terms that name the exact problem:

| Say this                                  | When you see                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| "This is a **stateful mixin** — extract a collaborator" | a default method that fakes state via a static map keyed by `this` |
| "Unresolved **default conflict** — make the choice explicit" | a class overriding a method only to call one `X.super.m()` with no comment on why |
| "This default is **coordination, not derivation**" | a default method that calls 3+ other interface methods to run a protocol |
| "**Interface-as-mixin abuse** — this interface has no abstract methods" | an interface that is *only* default methods, used to inject behavior |
| "**Linearization-dependent** — won't survive the port to Java/Kotlin" | Scala/Python code relying on `super` chaining through mixin order |
| "**Type vs behavior** confusion — you want composition" | `implements` used purely to reuse a method, with no is-a relationship |

The single most useful distinction in review is **type inheritance vs. behavior inheritance**. If a class implements an interface *only* to borrow its default methods — and would never be passed where that interface is expected — the inheritance is behavior-reuse masquerading as subtyping, and composition is almost always cleaner.

---

## 2. Eight review smells and their fixes

**Smell 1 — the all-defaults interface used as a behavior injector.**

```java
interface AuditMixin {
    default void audit(String e) { AuditLog.record(this.getClass(), e); }   // no abstract method
}
class OrderService implements AuditMixin { /* ... */ }
```

*Why it smells:* `AuditMixin` is not a type anyone programs against; `OrderService` "is" not an `AuditMixin`. This is a mixin pretending to be an interface. *Fix:* inject an `Auditor` collaborator and call `auditor.record(...)`. The capability becomes a field you can mock, swap, and configure.

**Smell 2 — state smuggled into a default via a static side table.**

```java
interface Cached {
    Map<Object, Object> CACHE = new ConcurrentHashMap<>();   // "constant" that is really shared mutable state
    default Object cached(Object k, Supplier<Object> s) { return CACHE.computeIfAbsent(k, x -> s.get()); }
}
```

*Why it smells:* the interface field is `static final` (interfaces force it) so the cache is **shared across every implementor of `Cached`** — a global, not per-instance, masquerading as instance state. *Fix:* composition — a `Cache` field per object.

**Smell 3 — overriding a conflict without documenting the choice.**

```java
@Override public String render() { return Html.super.render(); }   // why Html and not Pdf?
```

*Fix:* a one-line comment stating *why* this path was chosen, or better, rename so the choice is structural. An unexplained `X.super.m()` is a landmine for the next maintainer.

**Smell 4 — a default method that drives a multi-method protocol (coordination).**

```java
interface Lifecycle {
    void open(); void process(); void close();
    default void run() { open(); process(); close(); }   // assumes a contract across 3 methods
}
```

*Why it smells:* `run()` encodes an invariant (open-before-process-before-close, close-always) that every implementor must honor but that the interface cannot enforce. Override `process()` to throw and `close()` silently never runs. *Fix:* a concrete template (abstract class) or — better — a `try`/`finally` in a non-default orchestrator, or a sealed hierarchy so implementors are known and reviewable.

**Smell 5 — `implements` for code reuse with no is-a.** A `ReportGenerator implements DateUtils` to get `default LocalDate today()`. *Fix:* a static utility or an injected clock; `ReportGenerator` is not a `DateUtils`.

**Smell 6 — diamond left to the "more specific wins" rule by accident.** Two interfaces in a hierarchy both define `m()`, and the code silently inherits the sub-interface's version. It compiles, but no one decided that. *Fix:* make it explicit with an override, or document that the specificity is intentional.

**Smell 7 — porting Scala/Python linearization 1:1 into Java.** A reviewer sees `Loud.super.greet()` chained to mimic a Scala `super` chain. *Fix:* model stackable behavior as explicit decorators (see [middle.md](middle.md) §8), not as a hand-simulated linearization.

**Smell 8 — a default method overriding behavior an implementor relies on its superclass for.** Remember Rule 1 (classes win): a default will *not* override a class method, so a default written to "provide" behavior is silently dead for any implementor that inherits the same method from a superclass. *Fix:* know the rule; don't write defaults that you expect to win over class methods.

---

## 3. ArchUnit rules you can commit

ArchUnit lets you encode "interfaces are types, not behavior dumps" as a test:

```java
// Flag interfaces that are pure behavior injectors: all-default, no abstract method.
@ArchTest
static final ArchRule interfaces_should_not_be_pure_mixins =
    classes().that().areInterfaces()
        .and().haveNameMatching(".*Mixin")          // or scope to a package
        .should(new ArchCondition<JavaClass>("declare at least one abstract method") {
            public void check(JavaClass c, ConditionEvents ev) {
                boolean hasAbstract = c.getMethods().stream()
                    .anyMatch(m -> m.getModifiers().contains(JavaModifier.ABSTRACT));
                if (!hasAbstract)
                    ev.add(SimpleConditionEvent.violated(c,
                        c.getName() + " is an all-default interface (behavior injector); prefer composition"));
            }
        });
```

```java
// Forbid mutable static state on interfaces (Smell 2): no non-immutable interface fields.
@ArchTest
static final ArchRule interfaces_must_not_hold_mutable_state =
    fields().that().areDeclaredInClassesThat().areInterfaces()
        .should().haveRawType(String.class).orShould().beFinal()   // tune to your immutables
        .as("interface fields must be immutable constants, not shared mutable state");
```

ArchUnit can't see "this default is coordination not derivation" — that's a human call — but it *can* mechanically catch the all-default-interface and the mutable-interface-field smells, which are the two that scale badly.

---

## 4. Static analysis and compiler flags

- **`javac -Xlint`** does not warn on default conflicts (they're hard compile errors, which is the point), but **`-Xlint:overrides`** and `@Override` discipline catch a default silently *not* overriding what you thought.
- **Error Prone** has checks around interface methods and `@Override` correctness; pair with `@CheckReturnValue` on default methods that return values meant to be used.
- **SpotBugs** flags some interface-field-as-state patterns (mutable static).
- **PMD**'s `ExcessiveImports`/design rules can surface a class implementing a long list of behavior-only interfaces.
- **Checkstyle** can enforce a naming convention (`*Mixin`, `*Trait`) so reviewers and ArchUnit can scope rules to deliberate mixins and treat anything else as a real type.
- For **polyglot teams**, document the porting hazard: Scala `trait` with state and Python MI do **not** translate to Java interfaces without moving state to fields and order to explicit code.

The honest position: tooling catches the *structural* smells (all-default interfaces, mutable interface fields). The *semantic* smells (coordination defaults, fragile-base coupling) need a human reviewer who knows the [senior.md](senior.md) heuristic.

---

## 5. The migration playbook: mixin-interface → composition

When a default-method "mixin" has grown state or coordination, migrate it to a collaborator. The expand-contract steps:

1. **Introduce the collaborator.** Create a concrete class holding the capability's state and behavior (e.g. `Auditor`, `Cache`, `RetryPolicy`).
2. **Add a field + accessor** to each implementor, defaulting to a sensible instance. Keep the old interface temporarily.
3. **Redirect the default methods** to delegate to the field (`default void audit(String e) { auditor().record(e); }`). Behavior is unchanged; you've added a seam.
4. **Migrate callers** to use the collaborator directly where it reads better.
5. **Delete the interface** once nothing depends on it as a *type* (verify with "find usages" that no code passes implementors *as* the interface).

The key checkpoint is step 5: only remove the interface if it was never genuinely a subtype contract. If some code *does* program against it as a type, keep the interface for type, but still move the state/behavior into the collaborator — type and behavior were conflated and should be split.

---

## 6. When MI-of-behavior is *fine* and should not be touched

Review fatigue cuts both ways. Do **not** flag:

- A small interface with one abstract hook and one or two derived defaults (`Sized` → `isEmpty`). This is the textbook-correct use; it's a *trait* in the good sense.
- JDK-style library evolution: a default added to a published interface to avoid breaking implementors. That's exactly what defaults are for.
- A sealed interface with defaults shared by a known, closed set of records. Closure bounds the fragile-base risk; this is a clean ADT-with-shared-behavior pattern (see [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)).

The rule of thumb for reviewers: **stateless + derivation + a real is-a relationship = leave it alone. Stateful or coordination or reuse-without-is-a = push toward composition.**

---

## 7. Review checklist

- [ ] Does each implemented interface represent a real **is-a** (type), or just borrowed behavior? Behavior-only → composition.
- [ ] Any **all-default interface** used purely to inject methods? Flag as mixin abuse.
- [ ] Any **interface field** holding (effectively) shared mutable state? It's a global; extract it.
- [ ] Is a default doing **derivation** (fine) or **coordination across other methods** (risky)?
- [ ] Is every `X.super.m()` conflict resolution **documented or structurally obvious**?
- [ ] Are we **porting linearization** (Scala/Python `super` chains) into Java 1:1? Use explicit decorators instead.
- [ ] ArchUnit rules in place for all-default interfaces and mutable interface fields?

---

## 8. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Canonical sources: JLS, Schärli 2003, Scala spec, C3 paper     | `specification.md` |
| Diamond/linearization-surprise bugs                            | `find-bug.md`      |
| Mixin-by-interface vs delegation: measured cost                | `optimize.md`      |
| Implement a Java mixin; compute an MRO                         | `tasks.md`         |
| Interview Q&A                                                  | `interview.md`     |

---

**Memorize this:** in review, separate **type** inheritance from **behavior** inheritance — if a class implements an interface only to borrow methods and is never used *as* that interface, it's mixin abuse and composition is cleaner. The two mechanically-detectable smells (ArchUnit-able) are *all-default interfaces used as injectors* and *interface fields holding shared mutable state*; the two human-judgement smells are *coordination defaults* and *undocumented `X.super.m()` choices*. Leave alone the good case — stateless derivation over a real is-a, especially on sealed hierarchies. Migrate the bad case to a collaborator via expand-contract, and never port Scala/Python linearization into Java one-to-one; model stackable behavior as explicit decorators.

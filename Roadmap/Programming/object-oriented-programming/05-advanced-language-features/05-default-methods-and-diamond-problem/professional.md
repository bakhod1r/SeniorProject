# Default Methods and the Diamond Problem — Professional

> **What?** Driving the *responsible use* of default methods across a team: the vocabulary you use in code review when a teammate reaches for `default` too eagerly, ArchUnit rules that pin down library-evolution discipline, deprecation cycles for default-method changes, and mentoring patterns that keep "defaults aren't a free lunch" alive across an organisation.
> **How?** Default methods are a *library* feature first and an *application* feature second. Most application code should rarely declare new ones. In review, name the cost; in tooling, encode the discipline; in deprecation, never delete a default — replace it.

---

## 1. Code-review vocabulary

Three short phrases unlock most default-method discussions. Each names a specific cost the author may not have considered.

> **"Defaults aren't a free lunch."** When a teammate adds a `default` to make a method "optional", the cost is an LSP violation baked into the interface. Name it: *every implementor inherits a contract they may not honour, and every caller against the interface now needs to know which implementors actually implement it.* The fix is split the interface, not add the default.

> **"This default is FBCP-shaped."** When a default calls other defaults (or other abstract methods in a sequence), point at the *Fragile Base Class Problem* in interface form. Every implementor silently inherits the call graph; any future refactor of the bodies ripples through implementors you don't own. Suggest documenting the call graph with `@implSpec` or — better — flattening it.

> **"This default would be shadowed by a record."** When a default's name is `name`, `id`, `value`, `type`, `count`, `key`, or any other plausible record component, call it out. Records implementing your interface will silently shadow the default via component accessors (Rule 1, "classes win"). The fix is a distinctive name (`displayName`, `primaryKey`).

A worked review example:

```java
// PR diff under review:
public interface Auditable {
    Instant createdAt();
    default boolean isStale() {                // (*)
        return Duration.between(createdAt(), Instant.now()).toDays() > 30;
    }
    default void touch() { audit().write(this); }      // (**)
    default Auditor audit() { return Auditor.global(); }
}
```

> **Reviewer:** Two concerns. (`*`) — `isStale` reads `Instant.now()` directly, making it untestable without clock manipulation. Take a `Clock` parameter, or move staleness checking to a service. (`**`) — `touch` introduces a *global singleton* hidden in a default. Implementors inherit it without knowing they took on a dependency on `Auditor.global()`. Move auditing to a collaborator the implementor owns, or make `Auditor` an abstract method the implementor must supply.

That review is short, names two distinct smells, and proposes a concrete next step. It avoids "this violates SOLID" hand-waving.

---

## 2. Library evolution discipline

Most application teams should *almost never* introduce default methods. The legitimate use cases are narrow:

- You own a *library* with external implementors. You need to add a method without forcing them to upgrade.
- You own a *sealed interface* with a known closed set of implementors. The default removes boilerplate.
- You provide a *functional interface combinator* (`Predicate.and`, `Comparator.thenComparing`) — small derived helpers on a SAM.

Outside those, a default is usually a worse version of something else: a class method, a composition, a separate sub-interface, or a utility static. The team rule should be roughly:

> *We don't declare new `default` methods on application interfaces. Defaults belong to library interfaces or to functional-interface combinators. Every new default needs a one-paragraph justification in the PR.*

The discipline is similar to how mature teams treat checked exceptions or `protected` fields — features that are not banned but require a written reason. It keeps default-method debt off the application's interface surface.

---

## 3. ArchUnit rules for default-method discipline

ArchUnit can enforce several constraints mechanically. Encode them as `@ArchTest` classes in your build so future PRs trip the rules without a human reviewer needing to be present.

```java
@ArchTest
static final ArchRule no_application_defaults =
    methods()
        .that().areDeclaredInClassesThat().areInterfaces()
        .and().areDeclaredInClassesThat().resideInAPackage("..application..")
        .and().haveModifier(DEFAULT)
        .should().beAnnotatedWith(JustifiedDefault.class);
// Forces every default in application code to carry a justification annotation.

@ArchTest
static final ArchRule defaults_must_not_throw_UOE =
    noMethods()
        .that().areDeclaredInClassesThat().areInterfaces()
        .and().haveModifier(DEFAULT)
        .should(haveBodyThrowing(UnsupportedOperationException.class));
// Defaults pretending to be "optional" abstracts are banned.

@ArchTest
static final ArchRule no_interface_static_state =
    noFields()
        .that().areDeclaredInClassesThat().areInterfaces()
        .should().haveModifier(STATIC).andShould().notHaveModifier(FINAL);
// Catches "static mutable holders" smuggled into interfaces.
```

These rules don't catch every smell — they catch the *mechanical* ones, freeing humans to look at the harder cases (default call graphs, FBCP-shape, record shadowing). Pair ArchUnit with code review the way you pair Checkstyle with PR feedback: each does part of the work.

---

## 4. Mentoring "defaults aren't a free lunch"

A junior or middle developer who has just discovered default methods will reach for them constantly. The mentoring move is the same as for any over-applied feature: anchor each `default` to a *concrete cost* the team has felt.

> **Mentor:** Remember last sprint when `OrderRepository.getOrCompute` started behaving differently after we refactored it? That was because the default was calling another default we didn't realise was overridable. We had to add `@implSpec` to document the call graph and revert the refactor. That's why we don't reach for defaults inside our own codebase — only at library boundaries.

The mentor isn't saying "defaults are bad". They're attaching the cost to a real incident the team remembers. That's how the discipline survives across team turnover — anchored to specific war stories, not to abstract advice.

A useful diagnostic question for design reviews:

> *"If we remove this default and require implementors to write it themselves, what do we lose?"*

If the honest answer is "they'd have to repeat 3 lines", you don't need a default — you need a static helper or a class. If the answer is "every existing implementor would break at recompile", the default is genuinely earning its keep.

---

## 5. Defaults across team boundaries

The hazard of default methods scales with the *distance* between the interface author and the implementor. Within one repo with one team, default-method changes are caught by tests. Across two teams in one org, they need release notes. Across an org boundary (you ship to external consumers), they need a formal deprecation cycle.

| Distance                   | Default-method change discipline                                    |
| -------------------------- | ------------------------------------------------------------------- |
| Same package, same team    | Run the test suite; if green, ship.                                 |
| Different package, same team | Run the test suite + look at every implementor in `git grep`.     |
| Different team, same org   | Run the test suite + announce in your team's release notes.         |
| External consumers         | Deprecation cycle (section 6); add `@implSpec` to document call graph. |

The principle: **the further your interface travels, the more conservative every default change must be.** Library authors should imagine every implementor as a stranger who will read the release notes once a year. Application authors can be looser — but only within the smallest team boundary.

---

## 6. Deprecation cycle for default-method changes

Removing or changing a default is a *breaking change*. The senior workflow uses a three-step deprecation cycle, borrowed from JDK practice:

```java
// v1.0 — original default
public interface Cache<K, V> {
    default V getOrCompute(K key, Function<K, V> f) { /* body */ }
}

// v1.1 — add the new method, deprecate the old
public interface Cache<K, V> {
    /** @deprecated Use {@link #computeIfAbsent(Object, Function)}. */
    @Deprecated(since = "1.1", forRemoval = false)
    default V getOrCompute(K key, Function<K, V> f) {
        return computeIfAbsent(key, f);
    }
    default V computeIfAbsent(K key, Function<K, V> f) { /* body */ }
}

// v2.0 — mark the old for removal
public interface Cache<K, V> {
    /** @deprecated Removed in 3.0. Use {@link #computeIfAbsent}. */
    @Deprecated(since = "1.1", forRemoval = true)
    default V getOrCompute(K key, Function<K, V> f) {
        return computeIfAbsent(key, f);
    }
}

// v3.0 — finally remove. This is a major version bump.
public interface Cache<K, V> {
    default V computeIfAbsent(K key, Function<K, V> f) { /* body */ }
}
```

The discipline:

1. *Never delete a default* in a minor release. Mark it `@Deprecated(forRemoval = true)` for at least one major version before removal.
2. *Never reshape a default's behaviour* without versioning. Change in v2.0 with release notes, not in v1.1 silently.
3. *Always keep the deprecated default forwarding to the replacement.* Implementors who haven't migrated should still get correct behaviour.

This is the JDK's discipline. `Iterator.remove`, `Date.toString`, `Object.finalize` — every one was deprecated for years before any real removal, and the replacements coexisted with the originals throughout.

---

## 7. Code-review checklist for default methods

A practical checklist to paste into your team's PR template:

- [ ] **Is this default unavoidable?** Could it be a static helper, a sub-interface, or a class method instead?
- [ ] **Does it throw `UnsupportedOperationException`?** If yes, split the interface; don't fake optional methods with defaults.
- [ ] **Does it have a generic name (`name`, `id`, `value`, `type`)?** Records may silently shadow it. Pick a distinctive name.
- [ ] **Does it call another default?** Document with `@implSpec`; consider flattening.
- [ ] **Does it use `Instant.now()`, `System.currentTimeMillis()`, or a global singleton?** Inject the dependency through an abstract method instead.
- [ ] **Is it on a sealed interface?** Good — you know every implementor.
- [ ] **Is it on a published library interface?** Document the binary-compat implications in release notes.
- [ ] **Would removing it require a major-version bump?** If yes, the deprecation cycle starts now (section 6).
- [ ] **Are there tests for every implementor against this default?** A shared contract test catches LSP violations.

The checklist is short by design. The point is not to mechanically tick every box but to make sure the author *considered* each cost.

---

## 8. Anti-patterns juniors and middle devs will introduce

**Default as escape hatch from "implement everything".** A junior wraps a method in `default { throw new UnsupportedOperationException(); }` so a partial implementor compiles. They have invented Bug 4 of `find-bug.md` (`SOLID/01-solid-principles`) inside an interface. Reject the PR; split the interface.

**Default as "framework hook".** A middle dev writes a `default void before() { }` so subclasses *may* hook in. They've reinvented the template method pattern in interface form, with all of its FBCP fragility. Prefer composition: collaborator with a `before` callback, or domain events.

**Default that calls `getClass()`.** A default that special-cases its own implementor types ("if `this instanceof X`...") is a switch over class types pretending to be polymorphism. Move the special case into the implementor or use `sealed` types with pattern matching ([../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)).

**Default that captures `this` in a lambda.** Surprisingly subtle: every lambda inside a default method captures `this` (the implementor). The lambda is stored, the implementor is held alive by the lambda — a memory leak waiting to happen if the lambda outlives a natural caller's lifetime. Make captured state explicit through parameters.

**Default that reads system properties or env vars.** Now every implementor inherits a dependency on the environment. Tests need to set env vars to exercise the default. Move config to a collaborator the implementor injects.

---

## 9. When to call a "remove the defaults" refactoring sprint

The signals that your team has accumulated default-method debt:

1. **An interface has more defaults than abstracts.** It wants to be a class.
2. **A "small refactor" to a default body broke an external consumer.** FBCP fired.
3. **Implementors mostly override the defaults anyway.** The defaults aren't doing their job.
4. **Three or more defaults call each other.** The call graph is now public API and no-one documented it.
5. **A record component silently shadowed a default**, surfacing as a wrong-value bug in production.

Scope the sprint narrowly: "We will move `OrderEvents` from default-laden interface to event-bus + abstract handler" is a sprint. "Clean up all defaults" is not.

> **Lead to team:** This sprint we touch only `domain/audit/*`. The exit criteria: `Auditable` has zero defaults, `AuditService` is the only place behaviour lives, every existing implementor has a constructor-injected `AuditService`, and the public API still presents `audit()` as a method call with the same signature.

The work is similar to the strangler-fig refactor used for SOLID legacy (`SOLID/01-solid-principles/professional.md`): carve a port, route callers through it, retire the old default, repeat.

---

## 10. Quick rules

- [ ] In review, **name the cost** (LSP, FBCP, record shadowing). "Don't use defaults" is not feedback.
- [ ] Wire ArchUnit rules that ban `UnsupportedOperationException` defaults and unmarked application-package defaults.
- [ ] Teams should justify *every* new default with a one-paragraph PR note. Default-by-default is rejection-by-default.
- [ ] Deprecation cycle: add new method + deprecate old (v1.x), `forRemoval = true` (v2.0), remove (v3.0).
- [ ] Defaults that call defaults need `@implSpec` documenting the call graph.
- [ ] Records shadow defaults that share their component names — pick distinctive names.
- [ ] Library distance widens the discipline: same package = test it; external consumers = release notes + deprecation.
- [ ] If the interface has more defaults than abstracts, it wants to be a class. Refactor.
- [ ] Mentor default-method discipline with *war stories*, not abstract rules.
- [ ] Sealed interfaces tame default-method risk — prefer them for closed implementor sets.

---

## 11. What's next

| Topic                                                                        | File              |
| ---------------------------------------------------------------------------- | ----------------- |
| JLS §9.4.3 / §8.4.8 / §9.4.1, JEP 126, JEP 213                               | `specification.md` |
| Ten broken default-method snippets — silent runtime symptoms                 | `find-bug.md`      |
| Bytecode for defaults, `invokeinterface`, JIT inlining                       | `optimize.md`      |
| Hands-on refactors                                                           | `tasks.md`         |
| Interview Q&A                                                                | `interview.md`     |

---

**Memorize this:** default methods are a *library* feature with *team* discipline. In review, name the cost (LSP, FBCP, record shadowing). In tooling, encode the bans (UOE-throwing defaults, unannotated application-package defaults). In deprecation, never delete — replace and forward across at least one major version. The further your interface travels, the more conservative every change must be.

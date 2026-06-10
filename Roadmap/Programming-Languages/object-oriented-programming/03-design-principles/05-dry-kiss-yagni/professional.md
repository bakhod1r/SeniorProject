# DRY, KISS, YAGNI — Professional

> **What?** Driving the three slogans across a team: the precise vocabulary you use in review ("Rule of Three", "wrong abstraction", "Lava Layer", "premature interface"), the static checks that catch the obvious over-engineering, mentoring without dogma, when to call a *de-engineering* sprint, and the cultural norms that keep designs small but not fragile.
> **How?** Treat the three as a *vocabulary*, not commandments. In review, name the specific anti-pattern, point to the cost, propose the smallest move (delete the speculation, inline the wrong abstraction, write the third occurrence inline until you see it again).

---

## 1. Code-review vocabulary

Four short phrases cover most reviews. Memorise them and use them precisely.

> **Reviewer:** This violates Rule of Three. You've extracted `formatMoney` to a shared utility after the second occurrence; the two callers might diverge tomorrow. Inline both copies; extract when the third caller arrives, with the right shape informed by all three.

> **Reviewer:** This is YAGNI speculation. The `PaymentProvider` registry has one entry, the factory has one product, and no test exercises a second case. Replace with a direct dependency on `StripeProvider`; refactor to a registry when the second provider lands.

> **Reviewer:** This is the wrong abstraction (Sandi Metz). The shared `processOrder` method has six boolean flags, each one a divergence between callers. Un-extract: give each caller its own method, let them diverge cleanly.

> **Reviewer:** This is fake KISS. "Just pass an `Object` and use `instanceof`" is short on lines but expensive cognitively. Use the simplest *typed* shape that fits — a sealed interface, or a record per case.

Each comment names the *specific* failure mode and ends with a concrete next step. "Too complex" without specifics is noise.

---

## 2. Static analysis: what tooling can catch

Several over-engineering patterns are catchable mechanically.

**SonarQube:**

- `java:S110` — *Inheritance trees deeper than N*. Often a sign of speculative inheritance.
- `java:S1610` — *Abstract class with no abstract methods*. A base class for "future polymorphism" that never came.
- `java:S2326` — *Unused type parameters*. Generic plumbing that was never used.
- `java:S2293` — *Diamond operator preference*. Reduces noise without losing safety.
- `java:S1118` — *Utility classes should not have public constructors*. Catches "general-purpose" classes that should be `final` and have private constructors.

**ArchUnit** for codebase-wide rules:

```java
@ArchTest
static final ArchRule no_interfaces_with_one_impl =
    classes().that().areInterfaces()
             .should().beImplementedByClassesThat(haveAtLeastNImplementations(2));
// (Pseudocode — write a custom condition; the point is: an interface with one impl is a YAGNI signal)

@ArchTest
static final ArchRule no_abstract_factories_with_one_product =
    noClasses().that().haveSimpleNameEndingWith("Factory")
               .and().areFinal()
               .should().produceClassesThat()
               .haveAtMostNImplementations(1);
```

The harder cases — apparent vs meaning duplication, "right complexity" — require human review. Mechanical checks free reviewers for the judgement calls.

---

## 3. Mentoring without dogma

A junior who has just discovered DRY will extract every two-line "duplicate"; a junior who has just discovered KISS will under-engineer; a junior who has just discovered YAGNI will refuse to ship anything beyond a function definition. Mentor by *anchoring each rule to a felt pain*.

> **Mentor:** Remember when we extracted `validateEmail` six months ago, and the order team needed `+` aliases but the customer team didn't? We added a boolean. Then a flag. Then a flag-management class. That's the wrong abstraction. The lesson is to wait — Rule of Three — and to extract only when the shared *meaning* is real, not the shape.

> **Junior:** Should I add an interface for the SMS sender?
> **Mentor:** Is there a second implementation today? Will tests need to swap it? If both no, just write `final class SmsSender`. When a test or a second impl arrives, *then* introduce the interface — informed by what they actually need.

The mentor's three checks:
1. What's the *third occurrence* of this pattern? (If only one or two, leave duplicated.)
2. Would *removing* this piece break a current test? (If no, YAGNI.)
3. What *named simplicity* are you optimizing for? (Algorithmic? Operational? UX?)

---

## 4. Anti-patterns juniors will introduce

These show up reliably in codebases where the slogans were learned before they were felt.

**The premature plugin registry.**

```java
private final Map<String, OrderHook> hooks = new ConcurrentHashMap<>();
public void register(String name, OrderHook h) { hooks.put(name, h); }
```

`grep` for `register("` returns one test. The plugin system has no plugins. Delete the registry; call the (one) hook directly.

**The over-deduplicated validator.**

```java
public abstract class BaseEntityValidator<T> {
    protected void validateNotNull(T entity, String field) { ... }
    protected void validateNotBlank(T entity, String field) { ... }
    protected void validateMaxLength(T entity, String field, int max) { ... }
    protected abstract void validateBusinessRules(T entity);
}
```

The base class has six methods that every subclass inherits but only some use. Inheritance for shared utility code; classic [fragile base class problem](../06-fragile-base-class-problem/). Replace with composition: a `final class FieldValidator` injected into each domain validator.

**The "configurable" config loader.**

```java
public class ConfigLoader {
    public Config load(String source, Format format, Charset charset, 
                       boolean validate, boolean cache, Class<?> target) { ... }
}
```

A method that takes a parameter for every possible variation. Real callers pass the same combination every time. Replace with specific methods (`loadYaml(Path)`, `loadJson(InputStream)`); the configurability was speculation.

**The God-level abstraction.**

```java
public interface Processor<T, R, C extends ProcessorConfig<T>> { R process(T t, C config); }
```

Three generic parameters and a configuration class. The concrete implementation is `OrderConfirmationProcessor implements Processor<Order, Receipt, OrderConfirmationConfig>`. The abstraction adds parameterization the codebase never uses. Replace with `final class OrderConfirmationProcessor { Receipt process(Order o); }`.

---

## 5. When to call a *de-engineering* sprint

Most de-engineering happens in PR-sized increments. Occasionally you call a dedicated sprint to remove accumulated over-engineering. The signals:

1. **The codebase has many "Factory", "Provider", "Strategy" classes with one implementation each.** Each is YAGNI accumulation.
2. **Most "interface/impl" pairs (`IFoo`/`Foo`) have one impl and no test substitution.** Performative DIP.
3. **A new dev's first PR removes a layer because they "couldn't figure out how the data flows".** The complexity isn't paying off.
4. **`grep` shows abstract base classes inherited by exactly one concrete class.** Speculative inheritance.

Scope the sprint. *Bad:* "Simplify the codebase." *Good:* "In the `order.*` package, delete every interface with one implementation (verified by ArchUnit's custom condition), inline every factory with one product, replace every `BaseValidator` subclass with composition. Existing tests pass; no public API changes."

> **Lead to team:** This sprint we delete, not add. Exit criteria: 30+ classes removed, no interface in `order.*` has only one implementation, ArchUnit's "no premature abstraction" rule passes. The features we ship next sprint will be cheaper because of it.

---

## 6. Cultural norms that keep the trio honest

Some norms are policy, not technique. Push these through your team's working agreement:

**"No new interfaces without two implementations."** Either there are two impls today, or there's a documented test-substitution need (infrastructure boundary). Otherwise, the class is `final` until a real second case arrives.

**"Inline the second copy of a piece of code. Extract on the third."** This is the Rule of Three made into policy. It survives because it's mechanical.

**"Speculation goes in a comment, not in code."** When someone says "we'll need a registry for this later", capture it as `// TODO: registry when we have a second case`. The code stays minimal; the speculation is visible to future readers.

**"Delete dead code aggressively."** Code that no test exercises and no production path reaches is *worse* than no code: it confuses readers and rots silently. `coverage` reports + manual review surface it.

**"Refactor before the second feature, not after."** When a new requirement doesn't fit, refactor first. No layering.

---

## 7. The "complexity budget" framing

A useful conversation pattern: every component has a *complexity budget*. KISS says spend it where it pays back; YAGNI says don't pre-spend it; DRY says spend it on real shared knowledge.

```
- Authentication: high budget. Security, audit, multi-factor, session — all earn their complexity.
- Payment: high budget. Idempotency, retry, audit — required by the domain.
- Date formatting: low budget. One method on one class; no factory, no strategy.
- Logging: medium budget. Structured fields, correlation IDs, levels — but no custom logging framework.
```

The framing lets a team have *concrete* conversations: "the date formatter is over budget — strip the strategy pattern".

---

## 8. The "delete this in 6 months" decoration

For genuinely-speculative code that you can't strip yet (e.g., a configurable behaviour the product team promised "soon"), tag it explicitly:

```java
// SPECULATIVE: 2026-Q3 promised a per-region pricing override.
// If this comment is still here in 2026-Q4, delete this method.
public void overridePriceFor(Region region, Money price) { /* ... */ }
```

The comment is *load-bearing*. Future readers know it's tentative. CI can grep for `// SPECULATIVE` and remind the team. Some teams use `@Deprecated(since = "2026-09", forRemoval = true)` annotations for the same effect.

The point isn't to allow speculation — it's to make speculation *expire*.

---

## 9. Migrating a legacy over-engineered codebase

Most over-engineered codebases came from a single Architect Who Loved Patterns. The migration:

1. **Inventory the patterns.** Use Sonar/ArchUnit to count interfaces with one impl, factories with one product, etc.
2. **Pick one pattern to remove per PR.** Each PR is reviewable and reversible.
3. **Start with the safest** — single-impl interfaces. Delete the interface, mark the impl `final`, update consumers.
4. **Tests stay green throughout.** No test should break — over-engineered patterns rarely add behaviour; they add structure.
5. **`git log` shows the journey.** Each removal is a labelled commit (`refactor: remove premature OrderHandler interface — single impl since 2022`).
6. **Stop when the codebase reads naturally.** Not every pattern is wrong; the goal is removing the *speculation*, not all abstractions.

The de-engineering takes one or two sprints. The payoff is permanent: future maintenance is cheaper.

---

## 10. Quick rules

- [ ] In review, name the specific anti-pattern (premature interface, wrong abstraction, fake KISS).
- [ ] Wire Sonar/ArchUnit for single-impl interfaces, abstract-class-with-no-abstract-methods, unused generics.
- [ ] Rule of Three is *policy*: extract only after the third occurrence.
- [ ] No new interface without two impls or a clear test-substitution need.
- [ ] Speculation goes in `// SPECULATIVE:` comments with an expiry date, not in code.
- [ ] Delete dead code aggressively; coverage gaps are signals.
- [ ] Refactor before the next feature lands, not after — no layering.
- [ ] De-engineering sprints have scoped exit criteria (N classes removed, ArchUnit rule passes).
- [ ] Complexity budgets make the conversation concrete.
- [ ] Across service boundaries: prefer duplication over a shared library.

---

## 11. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| The three rules in plain English with one example           | `junior.md`        |
| Worked refactors — extract real duplication, strip speculation | `middle.md`     |
| Wrong abstraction, exception cases, scale conflicts         | `senior.md`        |
| JLS/JEP support that makes the rules cheap                  | `specification.md` |
| Spotting hidden over-engineering                            | `find-bug.md`      |
| Performance trade-offs                                      | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** DRY, KISS, YAGNI together form a *vocabulary* for talking about over-engineering. Your job as a senior is to make review *short* by naming the specific anti-pattern, to push enforcement into ArchUnit/Sonar where mechanical, to mentor with felt pains (the "wrong abstraction" everyone regrets), and to drive de-engineering as deliberately as you drive new features. The codebase that ships cheapest in year 3 is the codebase that didn't over-engineer in year 1.

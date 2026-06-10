# DRY, KISS, YAGNI — Interview Q&A

20 questions covering definitions, trade-offs, snippet critiques, and senior-level judgement.

---

## Q1. Define DRY, KISS, and YAGNI in one sentence each.

**DRY** (*Don't Repeat Yourself*, Hunt & Thomas, 1999): every piece of *knowledge* should have a single, unambiguous representation in the system. **KISS** (Kelly Johnson, ~1960): prefer the simplest design that solves today's problem. **YAGNI** (Kent Beck, 1999): don't build for a future that hasn't arrived. The three together form a vocabulary for *minimum-viable design*: KISS asks what's needed today, YAGNI strips speculation, DRY consolidates real shared knowledge.

**Trap:** Saying DRY is about "code that looks similar". DRY is about *knowledge*, not syntactic shape. Two methods with identical bodies serving different stakeholders are *not* duplication.

---

## Q2. Apply the three rules in order — why does order matter?

Order: KISS first, YAGNI second, DRY third. KISS first because you need to know what the minimum-viable code is *before* you can strip speculation. YAGNI second because the minimum is the baseline against which "speculation" is defined. DRY last because extracting shared abstractions only makes sense after the code is otherwise minimal — premature DRY produces *the wrong abstraction* over speculative shapes.

Applying DRY first leads to "shared abstractions" that codify guesses. Applying YAGNI without KISS first produces minimal-but-bad code (skips real requirements like logging). The order matters.

**Follow-up:** "What if the three conflict?" — say which kind of simplicity matters in *this* context (algorithmic, operational, UX) and balance accordingly.

---

## Q3. What is "the wrong abstraction", and how do you avoid it?

Sandi Metz: *"duplication is far cheaper than the wrong abstraction"*. The wrong abstraction is a DRY extraction made before the shared *meaning* was clear — usually after only two callers, before the third would have revealed how they actually differ. Symptoms: the shared method grows boolean parameters (one per divergence between callers), conditionals branch by caller, the method's commit history shows different authors fixing different concerns, and new callers join the abstraction by accident.

Avoid by: applying the Rule of Three (wait for the third occurrence), naming the *piece of knowledge* before extracting, and being willing to un-extract when the abstraction stops fitting.

**Trap:** "Refactor every duplicate immediately." Almost always premature; coincidental shape gets merged with meaning shape.

---

## Q4. Critique this snippet.

```java
public final class OrderHandler {
    private final Map<String, OrderHook> hooks = new ConcurrentHashMap<>();
    public void registerHook(String name, OrderHook h) { hooks.put(name, h); }
    public void handle(Order o) {
        hooks.values().forEach(h -> h.fire(o));
        save(o);
    }
}
// In wiring: handler.registerHook("audit", new AuditHook()); — only one hook
```

Classic YAGNI violation: a plugin registry with one plugin. Costs: the registration is a hidden failure mode (forget to register → silent zero-hook behaviour), the registry adds complexity for no benefit, tests must wire the hook. Fix: inject `AuditHook` directly via the constructor. When a second hook arrives, refactor — informed by what *it* needs (sequential, parallel, conditional).

**Follow-up:** "What if 'the team plans' to add more hooks?" — write the second hook when it arrives. Plans for hooks aren't hooks; speculation isn't requirement.

---

## Q5. When does DRY produce coupling instead of cohesion?

When the "shared" code lives at a service or module boundary and is consumed by multiple teams. Each team becomes coupled to *the same release cadence*; a bug fix requires coordinating releases. Across microservices, a shared library can become the single hardest piece to change. The senior heuristic: *across service or team boundaries, prefer modest duplication over a shared library*. DRY is a within-module property; across modules, autonomy is more valuable.

**Trap:** Centralizing "common validation" across all services into one library — then needing every service to redeploy when validation rules change.

---

## Q6. What's the difference between "simple" and "minimal"?

*Minimal* means the smallest possible line count or fewest features. *Simple* means *fit-for-purpose with the smallest design that handles real requirements*. Minimal code skips real requirements (no logging, no validation, no error handling) and calls it "simple". Simple code handles every actual requirement at the *appropriate* design level — and no more. KISS aims for simple, not minimal.

```java
// "Minimal" — broken
void process(Order o) { repo.save(o); }

// "Simple" — fit for purpose
void process(Order o) {
    Objects.requireNonNull(o);
    log.info("processing {}", o.id());
    repo.save(o);
    metrics.increment("orders.processed");
}
```

The second is "simple": every line earns its keep; no speculation; real requirements covered.

---

## Q7. When does YAGNI legitimately not apply?

Three cases. **Security**: a system handling user data needs validation, authn, parameterized queries from day one. **Operational reversibility**: hard-to-undo decisions (schemas, public APIs, on-disk formats) deserve up-front design. **Compounding performance**: O(N²) algorithms that work for N=1000 will catastrophically fail at N=1M; pick the right algorithm now. The shared property: the cost of *not having* the feature is much higher than the cost of building it. YAGNI strips speculation, not real requirements.

**Trap:** "YAGNI for security." Almost always wrong — security is a current requirement, not a future feature.

---

## Q8. Critique this snippet from a DRY perspective.

```java
public class OrderValidator {
    public void validate(Order o) {
        if (o.email() == null || !o.email().contains("@")) throw new InvalidEmailException();
        // ...
    }
}
public class CustomerValidator {
    public void validate(Customer c) {
        if (c.email() == null || !c.email().contains("@")) throw new InvalidEmailException();
        // ...
    }
}
```

It depends. *If* the two email rules are guaranteed identical forever (one piece of meaning shared by two carriers), DRY says extract `EmailValidator.isValid(email)`. *If* the two rules will diverge — order accepts `+` aliases, customer doesn't — DRY-extracting now is the wrong abstraction. The honest move: leave duplicated until the third validator confirms the rule is universal, *and* verify the rule is genuinely the same in domain terms.

**Follow-up:** "How would you know which case this is?" — talk to the product/marketing team. If they call it "one email rule for all signups", DRY. If they call it "specific rules per stakeholder", keep separate.

---

## Q9. What is "fake KISS"?

Code that's short in line count but cognitively expensive. Examples: `Object` parameters with `instanceof` cascades; one giant `if/else` instead of a `switch`; `Map<String, Object>` configs replacing typed records; "smart" one-liners using reflection. KISS aims for *cognitive* simplicity — the reader should understand intent quickly. Fewer lines doesn't always mean simpler. *Fit-for-purpose typed structures* are KISS; *primitive constructs that abdicate type safety* are fake.

**Follow-up:** "How do you spot fake KISS in review?" — look for `Object` types, casts, reflection, and method bodies whose intent isn't obvious without context.

---

## Q10. Critique this snippet.

```java
public abstract class BaseValidator<T> {
    protected void notNull(Object o, String name) {
        if (o == null) throw new IllegalArgumentException(name + " required");
    }
    public abstract void validate(T entity);
}

public class OrderValidator extends BaseValidator<Order> {
    public void validate(Order o) {
        notNull(o.customer(), "customer");
        // ...
    }
}
```

Fake DRY via inheritance. The shared `notNull` is one line; the base class introduces coupling (every subclass inherits the helper's evolution, the base now owns part of every subclass's contract). When `notNull`'s signature or message format changes, every subclass changes. Fix: `Objects.requireNonNull` (the JDK's real DRY, owned by Oracle, stable). The subclasses no longer extend any base class.

**Follow-up:** "Why not use composition?" — for one-line helpers, composition is overkill too. `Objects.requireNonNull` is the standard library's solution.

---

## Q11. What is the Rule of Three?

A simple heuristic: don't extract a shared abstraction until you have *three* occurrences. One is "just code", two might be coincidence, three is a pattern. The rule survives because:
1. With three concrete cases you can see how callers *actually* differ; the abstraction's shape is informed.
2. Two-case DRY extractions frequently produce the wrong abstraction (Sandi Metz).
3. The cost of duplicating one extra time is small; the cost of un-extracting a bad abstraction is high.

**Trap:** Extracting after two cases "because it's so similar". Wait. Two looks like duplication; three is duplication.

---

## Q12. When can a design pattern violate YAGNI?

When applied without a current need. Common offenders: Strategy with one strategy; Factory with one product; Visitor with one visitor; Observer with one observer. Each pattern exists to handle a *real* variation; without the second variant, the pattern is structural overhead. The senior call: write the pattern when the second case demands it, informed by both cases. Patterns are *responses to forces*, not goals.

**Trap:** Writing a *Strategy* during initial design "for flexibility". Strategy without strategies is just a wrapper.

---

## Q13. How do you de-engineer a legacy codebase?

By removing speculation, layer by layer, with measurable exit criteria. The recipe: (1) inventory the patterns (count single-impl interfaces, single-product factories, abstract bases with no abstract methods) — Sonar/ArchUnit do this; (2) pick one pattern category per PR; (3) start with the safest (single-impl interfaces — delete the interface, mark the impl `final`); (4) tests stay green throughout, since the speculation rarely added behaviour; (5) stop when the codebase reads naturally — don't remove every pattern, just the speculative ones.

**Follow-up:** "How long does this take?" — typically one to two sprints for a mid-sized service. Payoff is permanent: future maintenance is cheaper.

---

## Q14. What is the "Lava Layer" anti-pattern?

Mike Hadlow: when a team applies YAGNI strictly, new requirements that don't fit the current shape are *patched around* rather than driving a refactor. Successive sprints add layers; the codebase becomes a geological cross-section of patches. The senior corrective: when a new requirement doesn't fit, refactor first. Don't add the third layer. YAGNI strips speculation; it doesn't excuse refactoring debt.

**Trap:** Confusing layering with versioning. Multiple API versions are sometimes necessary; multiple workaround layers for the same logical operation are Lava Layer.

---

## Q15. Critique this snippet for KISS and YAGNI.

```java
public class Pipeline<T, R, C extends PipelineConfig<T>, M extends Metadata<T, R>> {
    public R execute(T input, C config, M meta) { /* ... */ }
}
```

Two violations. KISS: four generic parameters and an associated type-bound dance make the signature unreadable; new developers spend a day decoding it before writing business logic. YAGNI: speculative parameterization that no real caller exploits (the codebase has one concrete pipeline). Fix: a `final class OrderPipeline` with concrete types. When a second pipeline appears, *that's* the time to consider whether they share enough to justify generics — almost always they don't.

**Follow-up:** "What if it's a library?" — same answer. Make the concrete shape first; introduce generics when you see two callers genuinely needing them.

---

## Q16. How does Java's `record` support DRY?

A record collapses the boilerplate of a value class to one line. The *piece of knowledge* "an X has these components" lives in one place; the compiler generates fields, constructor, accessors, `equals`, `hashCode`, `toString`. Real DRY at the language level: changing the components is one edit; every derived behaviour updates atomically. Records are the JLS's blessing for value composition (§8.10).

**Follow-up:** "When wouldn't you use a record?" — when the type needs mutation; when it needs to participate in an inheritance hierarchy (records are implicitly `final`); when accessors must do something non-trivial (rare).

---

## Q17. What's the right amount of error handling?

Enough that the system *fails informatively* but not so much that every line is wrapped in `try`. The senior heuristic: handle errors at the *boundary* (input validation, external calls, persistence) and let domain code propagate. Use typed exceptions (`InvalidEmailException`) for predictable failures, generic `RuntimeException` for unexpected. Don't catch `Exception` and swallow; don't `catch` only to re-throw with the same exception. Logging + propagation is usually right.

**Trap:** `catch (Exception e) { log.error(e); }` — the silent swallow. Always rethrow or convert to a domain exception that the caller can decide on.

---

## Q18. When does "boring technology" lose?

When the boring choice genuinely can't handle the requirements: NoSQL when you really do need a graph, microservices when teams really do need independent deployment cadences, GraphQL when you really do need flexible client-driven queries. The boring-tech heuristic is *default*; it loses when measurement shows the boring tool can't scale, can't model the data, or can't deliver the operational characteristics needed. Senior judgement is in measuring before switching.

**Follow-up:** "What's the most common boring-tech mistake?" — sticking with the boring choice past its limits and patching around the mismatch.

---

## Q19. How do you decide whether to add caching?

Profile first. Caching adds complexity (staleness, invalidation, memory) — it must pay back in measurable performance. Add caching when: (a) profiling proves the un-cached path is the bottleneck; (b) the cached data has a clear TTL or invalidation strategy; (c) the cost of staleness is acceptable. Premature caching usually solves no real problem (modern DBs are fast) and introduces real ones (memory leaks, stale data, restart-only invalidation).

**Trap:** "Cache because reads will be slow." Measure before caching. A 0.5 ms lookup against a 200-row table needs no cache; a 50 ms join across million-row tables might.

---

## Q20. What is the "complexity budget" mental model?

Each component has a *complexity budget* proportional to the value of its features. Authentication and payment can spend their budgets on idempotency, audit, multi-factor, retry — all earn their complexity. Date formatting and slugification have low budgets; one class, no factory. The framing makes the conversation concrete: "the country lookup is over budget — strip the cache". It anticipates the slogans' question — *should we add this?* — with a per-component justification.

**Follow-up:** "Who sets the budget?" — the team, informed by the product's actual value drivers. The budget for security features in a payment app is high; in a personal blog, low.

---

**Use this list:** rotate one question per axis (definitions, snippet critiques, rule order, when-not-to, modern Java features that support the rules). Strong candidates name *when not to apply* DRY/KISS/YAGNI (security, reversibility, compounding performance, cross-team boundaries) and back the choice with a concrete cost-benefit.

# DRY, KISS, YAGNI — Senior

> **What?** The edge cases of the three slogans: when DRY produces "the wrong abstraction" and costs more than duplication, what "simple" means in different domains (algorithmic vs UX vs operational), where YAGNI loses (security, scalability, reversibility), the cost of un-extracting a bad abstraction, and the relationship of the trio to other forces (cohesion, coupling, SOLID, encapsulation).
> **How?** Treat each as a *force*, weighed against the others and against the *cost of being wrong*. DRY without the Rule of Three is dogma; KISS without considering operational simplicity is shallow; YAGNI without considering reversibility is naive.

---

## 1. Sandi Metz's law — "duplication is far cheaper than the wrong abstraction"

Sandi Metz coined the senior-defining rule in *POODR* (2012):

> *Duplication is far cheaper than the wrong abstraction.*

The argument: when you extract a "shared" piece of code and the two callers later diverge, the cost of *un-extracting* exceeds the cost of having left them separate. Specifically:

- The shared abstraction grows conditionals (`if (caller == "order") ... else ...`).
- New callers join the abstraction by accident, deepening the divergence.
- Eventually someone introduces a `boolean` flag, then a second flag, then a flags-management layer.
- By the time the team admits the abstraction was wrong, untangling it touches every caller.

The senior-level corollary: when in doubt, *don't extract*. Keep the duplication. Wait for evidence — at least three occurrences and a clear shared *meaning* — before generalizing.

The rule cuts the other way too: when a real abstraction is *justified*, extracting late is far cheaper than refactoring around a wrong one. Knowing when to wait is the skill.

---

## 2. KISS at different scales — algorithmic, UX, operational

"Simple" depends on the scale.

**Algorithmic simplicity** — short, readable code with low cyclomatic complexity. The classic KISS sense. Helped by: small methods, single-purpose classes, clear names.

**UX simplicity** — the user can accomplish the task with minimal steps and surprises. Often *opposes* algorithmic simplicity: a simple UX requires complex code to handle edge cases the user doesn't see.

**Operational simplicity** — the system is easy to deploy, observe, and recover. *Opposes* algorithmic simplicity too: clean uniform code that fails the same way everywhere is operationally hard; "ugly" code with defensive logging may be operationally elegant.

```java
// Algorithmically simple — clean stream pipeline
return orders.stream().map(this::process).toList();

// Operationally simpler — explicit error context per item
List<ProcessResult> results = new ArrayList<>();
for (Order o : orders) {
    try {
        results.add(ProcessResult.ok(process(o)));
    } catch (Exception e) {
        log.error("failed to process order {}", o.id(), e);
        results.add(ProcessResult.failed(o.id(), e));
    }
}
return results;
```

The first is algorithmically simpler. The second is operationally simpler: on-call engineers can see exactly which order failed and why. Choosing one over the other isn't "KISS vs not-KISS"; it's *which kind of simplicity* matters more in this context.

Senior judgement: name *which simplicity* you're optimizing for. "Simple" without that context is hand-waving.

---

## 3. YAGNI's three legitimate exceptions

YAGNI strips speculation; three categories of "future-proofing" aren't speculation:

**Security.** A system handling user data needs input validation, output encoding, parameterized queries, and authn/authz from day one — even if today's threat model is small. Bolting security on later is far more expensive than designing for it.

**Operational reversibility.** Decisions that are hard to undo deserve up-front design. Database schemas, public APIs, on-disk formats, wire protocols — once data lives in these shapes, migrations are painful. Spend the design time up front.

**Performance characteristics that compound.** O(N²) algorithms that work fine for N=1000 in dev catastrophically fail at N=1M in prod. KISS says "use the simple algorithm"; YAGNI says "don't optimize"; but if the algorithmic complexity *will* hurt, the senior call is to use a different algorithm now, not after the incident.

```java
// Today: N=10, this loop is fine
for (int i = 0; i < orders.size(); i++)
    for (int j = i + 1; j < orders.size(); j++)
        if (orders.get(i).id().equals(orders.get(j).id())) markDuplicate(i);

// At N=10,000 in prod: 50 million comparisons, 30-second hang
```

YAGNI on algorithmic complexity is a trap. The fix is one `HashSet`, today.

---

## 4. The cost of un-extracting

When a DRY extraction was wrong, undoing it costs more than not extracting in the first place. Concretely:

- Every caller of the extracted helper must be inlined back to a private copy.
- Tests for the helper must be split among the callers (or deleted and recreated).
- The git history loses the original duplication signal — future readers can't tell the callers were ever shared.

```java
// Was: 3 callers of one method
public final class TaxRules {
    public BigDecimal computeFor(Money base, Country c, /* 8 booleans */) { ... }
}

// Eventually realized: order, invoice, and audit each need their own rule
// To un-extract:
// - 3 callers each get their own ~80-line tax method
// - The 200-line shared method (with 8 booleans) is deleted
// - The shared tests are split across 3 test classes
```

The lesson: extracting late costs less than extracting early. When `git blame` shows three copies of a piece of code that have been stable for two years, *that's* the moment to extract. Earlier is speculation; later is informed.

---

## 5. KISS vs the "simplest thing that could possibly work"

Kent Beck's *Extreme Programming Explained* phrase — "the simplest design that could possibly work" — has been misread as "the dumbest design". The full sentence: *the simplest design that could **possibly** work*. Work means: handle today's requirements, including correctness, security, observability, and operational needs. Simple doesn't mean *minimal*; it means *fit-for-purpose*.

```java
// "Simplest" (literally interpreted) — broken
public Money taxFor(Money base, Country country) {
    return base.multiply(new BigDecimal("0.20"));
}

// "Simplest that could possibly work"
public Money taxFor(Money base, Country country) {
    return switch (country) {
        case US -> base.multiply(new BigDecimal("0.08"));
        case DE -> base.multiply(new BigDecimal("0.19"));
        case UK -> base.multiply(new BigDecimal("0.20"));
        default -> throw new UnsupportedCountryException(country);
    };
}
```

The first is "simpler" — but doesn't *work* for any of the three real cases. The second is *as simple as the problem allows*. That's KISS.

---

## 6. YAGNI vs the "Lava Layer anti-pattern"

A team applies YAGNI strictly to today's needs. Next sprint, requirements add a constraint that doesn't fit the current shape. The team patches around it. Six sprints later, the codebase is layered: an old YAGNI'd core, two refactor attempts on top, a third refactor stalled half-done. Mike Hadlow named this the *Lava Layer* anti-pattern.

YAGNI doesn't excuse refactoring debt. The senior balance:

- When the new requirement *doesn't fit*, refactor before adding the feature. Don't add the third layer.
- Track the cost of YAGNI'd-out flexibility as technical debt. The decision was right at the time; the *follow-up* is to refactor when the future arrives.
- Recognize that some hedges (e.g., a small abstraction with two implementations) are *cheaper to add today* than to retrofit later.

```java
// Today's KISS+YAGNI shape
public final class PaymentService {
    private final StripeGateway stripe;
    public void charge(Money amount) { stripe.charge(amount); }
}

// New requirement: PayPal support
// WRONG: add an if/else in PaymentService for "if PayPal use this else use that"
// RIGHT: refactor to inject a PaymentGateway interface; both Stripe and PayPal implement it
public interface PaymentGateway { void charge(Money amount); }
public final class PaymentService {
    private final PaymentGateway gateway;
    public void charge(Money amount) { gateway.charge(amount); }
}
```

The refactor happens *when the second implementation arrives*, not before. But it *does happen* — don't accrete layers.

---

## 7. DRY across services — the distributed trap

DRY at the class level is good. DRY across *service boundaries* is dangerous:

```
order-service       --depends on-->  shared-validation-lib (v1.4)
billing-service     --depends on-->  shared-validation-lib (v1.4)
notification-svc    --depends on-->  shared-validation-lib (v1.4)
```

A bug fix in `shared-validation-lib` requires a coordinated release across three services. A breaking change in the shared lib couples all three to the *same deployment cadence*. Some teams will be ready; others won't.

The senior call: at service boundaries, *prefer modest duplication over a shared library*. Each service owns its own validation, even if 95% identical. The remaining shared bits — types so universal they don't change (think `Money`, `Currency`) — can live in a shared lib, but with extreme stability.

```java
// In order-service
class OrderEmailValidator { boolean isValid(String e) { return e.matches(...); } }

// In billing-service — identical, but owned by billing
class BillingEmailValidator { boolean isValid(String e) { return e.matches(...); } }
```

DRY across teams = coupling across teams. Embrace duplication at service boundaries.

---

## 8. KISS and "boring technology"

A senior call: when in doubt, choose *boring* technology. Postgres over MongoDB unless you need MongoDB's specific shape; REST over GraphQL unless you need GraphQL; monolith over microservices unless you've outgrown one process.

The KISS rationale: boring tech has well-understood failure modes, plenty of documentation, large hiring pools, and operational maturity. The "interesting" alternative usually adds capabilities you don't need (YAGNI) at the cost of operational complexity (anti-KISS).

```
Cool new graph database with read replicas, sharding, GraphQL native...
vs
Postgres with one read replica
```

If your data model isn't actually graph-shaped, Postgres wins on every operational axis. The cool tech adds operational complexity proportional to its features — features YAGNI says you don't yet need.

---

## 9. The interplay — when the rules conflict

The three rules can disagree. Senior judgement is in *which one to weight* in each conflict.

| Conflict                                   | Senior heuristic                                |
|--------------------------------------------|--------------------------------------------------|
| DRY says extract; KISS says it complicates | KISS wins. Wait for the third occurrence.        |
| YAGNI says skip; KISS says add structure  | Depends on cost of *not having* the structure now. Security, reversibility favour adding. |
| DRY says merge; YAGNI says the future is unclear | YAGNI wins. Coincidental shape ≠ shared meaning. |
| KISS says one switch; DRY says strategy pattern | KISS wins until 3+ cases.                       |
| KISS says monolith; YAGNI says don't add complexity; market says scale | KISS + YAGNI together: stay monolith.            |

The senior toolkit: name *which rule* you're applying, *why* in this case, and *what evidence* you'd accept to reverse the decision.

---

## 10. The "wrong abstraction" smells

Sandi Metz's wrong-abstraction symptoms:

- Methods with many parameters, especially booleans (DRY tried to combine divergent cases).
- Conditionals deep inside the "shared" method that branch by caller.
- The abstraction is named after a *category* rather than a behaviour (`OrderProcessor` doing 5 unrelated things).
- Callers stub out the abstraction in tests because they only need a fraction.
- New developers can't tell which path through the abstraction their case uses.
- The shared method's commit log shows three different authors fixing three different concerns.

Each is a signal to *un-extract*. The cost is real but bounded; leaving the wrong abstraction in place compounds.

---

## 11. Anti-patterns and "fake KISS / fake YAGNI / fake DRY"

- **Fake KISS** — replacing complexity with primitive constructs. `Object` parameters and reflection-based dispatch are "simple" only in line count; cognitively, they're a fog.
- **Fake YAGNI** — refusing to design for known requirements ("we'll add observability later"). The requirement *is* current; calling it future doesn't make it so.
- **Fake DRY** — extracting shape, not meaning. Two methods with identical bodies serving different stakeholders are *not* duplication; they're parallel.
- **DRY via inheritance** — sharing code through abstract base classes. Couples consumers permanently; see [../06-fragile-base-class-problem/](../06-fragile-base-class-problem/).
- **YAGNI's evil twin** — under-engineering: shipping code that has known critical gaps (no error handling, no logging) and calling it "minimal".

The honest test: does the code handle today's *real* requirements (including security, observability, performance), with the *smallest* design that fits? If yes, it's properly minimal. If it handles imaginary tomorrow, it's over-engineered. If it skips real today, it's under-engineered.

---

## 12. Quick rules

- Sandi Metz: duplication is cheaper than the wrong abstraction. When in doubt, don't extract.
- "Simple" varies by scale: algorithmic, UX, operational. Name which you mean.
- YAGNI's three exceptions: security, reversibility, compounding performance.
- Refactor when the new requirement doesn't fit. Don't layer.
- Across service boundaries: prefer duplication over a shared library.
- "Boring technology" usually wins on KISS + YAGNI.
- Rule of Three for extraction; never the second occurrence, sometimes after the fourth.
- A shared method with conditionals branching by caller is the wrong abstraction; un-extract.
- DRY across services = coupling across teams. Avoid.
- The right design for today is the design YAGNI doesn't strip, KISS doesn't simplify away, and DRY doesn't merge.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving the trio in code review                             | `professional.md`  |
| JLS/JEP support that makes the rules cheap                  | `specification.md` |
| Spotting hidden over-engineering                            | `find-bug.md`      |
| Performance trade-offs                                      | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the senior view treats DRY, KISS, YAGNI as *forces*, not commandments. Each has a counter-force: DRY vs the wrong-abstraction cost, KISS vs operational/UX/security needs, YAGNI vs reversibility and compounding complexity. The senior toolkit: name the rule, name the counter-force, justify which wins in *this* case.

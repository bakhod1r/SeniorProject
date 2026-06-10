# When Object Thinking Fails — Professional

> **What?** As a tech lead, the question is no longer "is OO right here?" but "how do I get a team of eight engineers, with mixed seniority, to make consistent paradigm choices across a 400-kLOC codebase — without religious wars, cargo-cult patterns, or accidental Pareto-shaped rewrites?" This page is about the meta-skill: deciding the paradigm *before* the code is written, encoding that decision in review vocabulary, enforcing it at module boundaries, and rolling back gracefully when the choice turns out wrong.
> **How?** Treat paradigm choice as an architectural decision with the same weight as picking a database. Use a decision matrix early, codify the vocabulary your team uses in code review, draw paradigm boundaries at module seams (not inside a single class), and mentor juniors through the *symptoms* of mismatch rather than through doctrine. The artifacts in this page — matrices, review phrases, refactoring playbooks — are what you actually ship to the team Confluence.

---

## 1. Calling the paradigm decision early — a decision matrix

The cheapest moment to choose between OO, data-oriented, and functional styles is *before the first commit on a new module*. The most expensive moment is three months in, when half the team has built one way and the other half another.

When a new bounded context or service shows up in planning, walk the matrix below with the tech lead and one senior engineer. Ten minutes, written down in the ADR.

| Question                                       | OO (aggregate)    | Functional core         | Data-oriented / records |
| ---------------------------------------------- | ----------------- | ----------------------- | ----------------------- |
| Does the data have **identity** that outlives a request? | Yes               | Sometimes               | No                      |
| Are there **invariants** spanning multiple fields?       | Yes               | Maybe (refined types)   | No                      |
| Is there a **lifecycle / state machine**?                | Yes               | Maybe (sum types)       | No                      |
| Will **non-engineers** speak about the behavior?         | Yes               | Sometimes               | Rarely                  |
| Is this a **hot path** (1M+ ops/sec per node)?           | No (probably)     | Maybe                   | Yes                     |
| Is this **transformation / ETL / reporting**?            | No                | Yes                     | Yes                     |
| Will it need to **survive 5+ years** of requirement churn? | Yes               | Yes                     | No                      |

Three or more "Yes" in the first column means a domain aggregate. Three or more in the third means records and pure functions. Mixed means a layered design — functional core, imperative shell, OO aggregates in the middle — and the ADR should say *which module owns which paradigm*. If you can't answer the matrix, you don't understand the problem yet, and writing code is premature.

A practical tip: write the matrix decision as a one-sentence verdict in the ADR title. "Pricing engine is functional core, OO at the aggregate seam, no service classes" is enforceable. "Use clean architecture" is not.

> **Lead in kickoff:** "Before anyone opens an IDE — what's the paradigm for this module? If we can't agree in fifteen minutes, the problem isn't paradigm choice, it's that we don't yet know what this module *is*."

---

## 2. Code-review phrases that route the conversation

A team converges on a paradigm faster when reviewers use a small set of repeated phrases. These become shorthand; juniors learn them by osmosis.

> **Reviewer:** "Is this domain logic, or data shuffling? The class name says `LoanApplicationService` but the body is six map-and-collect steps over DTOs. If it's shuffling, kill the service and inline it as a function. If it's logic, give me the invariant the service is protecting."

> **Reviewer:** "Does this need an aggregate? You've added a setter for `status`, but `status` only changes when payment is captured *and* inventory is reserved. That's an invariant — put `markPaid()` on the order and delete the setter."

> **Reviewer:** "I see three classes — `EventParser`, `EventMapper`, `EventEnricher` — each with one method. That's a pipeline pretending to be objects. Make it three static methods on `Events` or a single `Stream` chain."

> **Reviewer:** "You've put behavior on a record. If the only reason is to avoid a free function, move it out. Records are for data with shape, not for behavior anchors."

> **Reviewer:** "This `Calculator` class has no state. It's a namespace. Either give it identity (a configured `TaxCalculator` with a jurisdiction) or make the methods static and stop pretending."

Print these on a one-page review cheat sheet. The first reviewer to use one in a PR sets the tone for the next twenty PRs.

---

## 3. Maintaining paradigm consistency within a module

The rule that prevents most of the mess: **one paradigm per module, mixed only at module boundaries**. A module is a Maven/Gradle subproject, a Java module, or — at minimum — a package whose surface area is controlled by `package-private` access.

Inside the `payments-domain` module: behavior-first OO. `Payment`, `Refund`, `Settlement` are aggregates with invariants. No anemic DTOs, no setters, no service classes named `PaymentManager`.

Inside the `payments-reporting` module: data-oriented. `PaymentRow` records, `Stream`-based aggregations, SQL where it fits. No `PaymentReportFactory` orchestrating fifteen builders.

Inside the `payments-api` module: imperative shell. Spring controllers, DTOs, validators. Pure translation to and from the domain. No business rules.

The boundary between these is an *adapter* — a small layer whose only job is paradigm translation (Section 8). When a reviewer sees an aggregate method called from inside a stream pipeline three layers deep in the reporting module, the answer isn't "should this work?" — it's "this should not be reachable from here." Module boundaries enforce the answer.

```java
// payments-domain (OO)
public final class Payment {
    private PaymentStatus status;
    public void capture(Clock clock) { /* invariants live here */ }
}

// payments-reporting (data-oriented)
public record PaymentRow(UUID id, BigDecimal amount, Instant capturedAt, String status) {}

// payments-api (imperative shell)
@PostMapping("/{id}/capture")
public ResponseEntity<Void> capture(@PathVariable UUID id) {
    paymentService.capture(id);   // translates HTTP → domain call
    return ResponseEntity.noContent().build();
}
```

The three styles coexist because none of them leaks across the module wall.

---

## 4. Mentoring: helping juniors see when OO is overkill (and the reverse)

Juniors swing in two directions. The fresh bootcamp graduate sees a `class` keyword and wraps everything — even a five-line CSV transform — in `CsvParser`, `CsvParserFactory`, `CsvParserConfiguration`. The self-taught backend dev who read one Hickey talk wants to delete every aggregate and replace it with `Map<String, Object>` and "data, not classes."

Both are wrong, and the correction is the same: *teach the symptoms, not the doctrine.*

Symptoms of "OO is overkill here":

- Most classes have one public method.
- Most fields are passed straight through with no transformation or invariant.
- Class names are nominalized verbs: `OrderProcessor`, `EventDispatcher`, `ReportGenerator`.
- Tests instantiate ten objects to exercise one calculation.
- Stack traces have eight frames where two would do.

Symptoms of "you should have used OO here":

- The same three-field validation appears in five places.
- A `status` field is mutated from six different services with conflicting rules.
- Bug reports cluster around "the data was in an impossible state."
- New requirements force every reader of the data to learn the new rule.
- Test setup builds the same five-step "valid object" by hand every time.

Bring a junior to one of their own PRs and walk through which symptoms are present. They will internalize the heuristic faster than from any book chapter.

> **Mentor (1:1):** "Forget what I'd write. Show me the invariant this code is protecting. If you can name it in one sentence, an aggregate probably belongs here. If you can't, you're shuffling data, and a function is enough."

A second mentoring move: have the junior delete code for a week. Most paradigm-mismatch problems show up as *excess* — extra layers, redundant DTOs, mirror interfaces with one implementation. A week spent shrinking the codebase teaches paradigm fit better than a week spent adding features. Pair their PRs with a senior who will accept "I deleted 400 lines" as a valid story-point claim.

---

## 5. Designing the team's paradigm policy

Codify the choices once, version-control them, and stop re-arguing. A one-page `PARADIGMS.md` in the repo root is enough. Suggested skeleton:

- **Domain modules** (`*-domain`): behavior-first OO. No `set*` methods. No `*Service` classes holding business rules. Aggregates own their invariants.
- **Application modules** (`*-app`): imperative shell. Orchestrates aggregates, handles transactions, no business rules.
- **Reporting / analytics modules** (`*-reporting`, `*-analytics`): data-oriented. Records, streams, SQL. No aggregates.
- **Adapters** (`*-adapter-*`): translation only. DTOs in, domain types out (or vice versa). No business logic.
- **Hot paths** (rendering, matching engine, pricing kernel): data-oriented arrays. Profile-driven. Document the why.
- **Configuration & DTOs**: anemic records, on purpose.

Pair the policy with a quarterly *paradigm review*: pick one module, walk the matrix from Section 1, ask "if we started this today, would we make the same choice?" Most of the time the answer is yes. The occasional no becomes a planned refactor (Section 6).

The policy is not law — it's the default that a reviewer can quote, and the writer must justify deviating from. That asymmetry is what keeps it alive.

A concrete enforcement hook: write an ArchUnit test per module that pins the paradigm. For domain modules, assert no public setters, no `*Service` classes with mutable state, no imports of web frameworks. For reporting modules, assert no aggregate types are imported. For adapters, assert that the module depends on *both* sides but no business logic class lives inside. These tests run in CI and catch paradigm drift before review.

```java
@AnalyzeClasses(packages = "com.example.payments.domain")
class DomainParadigmTest {
    @ArchTest
    static final ArchRule no_setters =
        methods().that().arePublic().and().haveNameMatching("set[A-Z].*")
                 .should().notBeDeclaredInClassesThat()
                 .resideInAPackage("..domain..");
}
```

The policy plus ArchUnit plus the review vocabulary is a three-legged stool: docs say what we do, tests prevent the obvious violations, reviewers catch the subtle ones.

---

## 6. Refactoring across paradigms

Two refactor playbooks come up over and over. Run them as scheduled work, not as heroic side quests.

### 6.1 Data-bag → aggregate (anemic to rich)

Symptoms: a `Customer` record with a `LoyaltyTier` field, mutated from six services, with each service re-implementing the tier-promotion rule slightly differently. Bugs cluster around stale tiers.

Playbook:

1. Find every site that mutates the field. Grep for the field name.
2. Extract the *rule* — the function that takes current state and an event and produces new state. Make it pure.
3. Move the rule onto the record-turned-class as a method. Make the field private. Delete the setter.
4. Replace every mutation site with a call to the new method.
5. Add a `@Deprecated(forRemoval=true)` setter for one release if needed for migration. Remove it.

```java
// Before
class Customer {
    public LoyaltyTier tier;
    public BigDecimal yearlySpend;
}
// scattered: if (c.yearlySpend.compareTo(GOLD) >= 0) c.tier = GOLD;

// After
public final class Customer {
    private LoyaltyTier tier;
    private BigDecimal yearlySpend;
    public void recordPurchase(Money amount, Clock clock) {
        this.yearlySpend = yearlySpend.add(amount.amount());
        this.tier = LoyaltyTier.from(yearlySpend);   // rule lives here
    }
}
```

### 6.2 God-service → pure functions

Symptoms: a 1,800-line `PricingService` with thirty `@Autowired` fields, half of them never used per call. Every test mocks twelve collaborators.

Playbook:

1. Identify pure sub-computations: any method that doesn't touch a repository or external API.
2. Move them to a sibling class as `static` methods over records. No Spring. No mocks needed.
3. Test the pure functions exhaustively with parameterized tests.
4. In the original service, call the pure functions and keep only the I/O orchestration.
5. The remaining service shrinks to a thin shell; testing it now needs three mocks, not twelve.

> **Lead in review:** "Half of `PricingService.computeQuote()` is a pure function of `(Cart, Catalog, Promotions)`. Pull it out, test it without Spring, leave only the repo lookups in the service. The unit-test feedback loop will get ten times faster."

Budget these refactors. A data-bag-to-aggregate migration in a live module is rarely under two sprints once you count the call-site rewrites, the deprecation cycle, and the test rewrites. Don't smuggle it into an unrelated feature PR — that's how reviews break down and rollbacks become impossible.

---

## 7. Anti-patterns to avoid

Every team has its own variety of cargo cult. Watch for these and name them when you see them.

- **Cargo-cult OO.** Wrapping records in classes "because OO." Adding `*Factory`, `*Strategy`, `*Manager` because patterns are good. A `Strategy` with one implementation is a function. A `Factory` with no variation is a constructor.
- **Cargo-cult FP.** Returning `Optional<Either<Error, Result>>` from every method because Scala does it. Chaining `flatMap` four levels deep where an `if` would suffice. Pretending Java is Haskell.
- **Cargo-cult records.** `record` for *everything*, including domain entities with invariants. Records are great for data with shape — they are not a substitute for aggregates.
- **Cargo-cult streams.** Replacing every `for` loop with a `Stream`, even when the loop is clearer and the stream is single-threaded with no benefit.
- **Cargo-cult ECS.** Building an entity-component framework for a CRUD app because "Unity does it." ECS solves a specific problem; your form-with-validation isn't it.
- **Over-fitting one style.** A team that ships pure functional everywhere and then bolts a `Service` class on for "the part that talks to the DB." Or a team with rich aggregates *and* a 500-line `OrderService` doing the same work twice.
- **Paradigm-by-PR.** No policy, every PR picks a paradigm based on the author's mood. Six months later the codebase is three styles fighting in every file.
- **Refactor for paradigm purity alone.** Rewriting a working module from "anemic" to "rich" because a blog post said anemic is bad — with no actual bug or change pressure driving the rewrite.

> **Lead in retro:** "We added `@Builder` to seventeen records this quarter. Records already have a canonical constructor. Why are we generating builders for them? Half of these don't even have optional fields."

---

## 8. Architectural boundaries: where paradigms meet

The interesting code lives at the seams. A few patterns to recognize and name.

**Adapter (incoming).** HTTP DTO → domain command. Hibernate row → domain aggregate. Kafka envelope → domain event. The adapter is the *only* place where a DTO meets a real domain type. It does no business logic, only translation. Once the domain type exists, the DTO is dead — no aggregate ever holds a reference to a `Request` object.

**Adapter (outgoing).** Aggregate → DTO for the API. Aggregate → row for the database. Aggregate → projection for the read model. Symmetrical to the incoming adapter, and equally dumb.

**Functional core, imperative shell.** The shell is procedural Java with side effects. The core is pure functions over records. The aggregate sits in the middle: pure when computing, mutating only inside its own methods, never reaching for I/O. The boundaries are explicit: the shell calls the aggregate, the aggregate calls pure helpers, no helper ever calls back into the shell.

**Anti-corruption layer.** When integrating with a legacy system or a vendor API, the adapter doubles as an *anti-corruption layer* — it not only translates types, it actively rejects concepts from the other side that don't fit your domain. Without this, the vendor's vocabulary creeps into your aggregates within six months.

```java
// Adapter — incoming, anti-corruption
public final class StripeWebhookAdapter {
    public DomainEvent toDomain(StripeEvent stripe) {
        return switch (stripe.type()) {
            case "payment_intent.succeeded" ->
                new PaymentCaptured(
                    PaymentId.of(stripe.metadata().get("payment_id")),
                    Money.of(stripe.data().amount(), stripe.data().currency()),
                    stripe.created());
            case "charge.refunded" -> new RefundIssued(/* ... */);
            default -> throw new UnsupportedStripeEvent(stripe.type());
        };
    }
}
```

Once `PaymentCaptured` exists, no aggregate cares that Stripe was involved. The vendor's vocabulary stops at the adapter.

A useful litmus: open the domain module, search for the name of the vendor or framework. If `Stripe`, `Hibernate`, `Kafka`, or `Spring` appear anywhere in the domain package, the adapter is leaking and the boundary needs reinforcement. The grep is a one-liner you can put in CI.

> **Lead in review:** "Why does `Order.java` import `org.springframework.beans.factory`? The aggregate doesn't know Spring exists. Move that wiring into the application module and pass the dependency in as a plain Java interface."

---

## 9. Quick rules

- [ ] Make the paradigm decision in an ADR before the first commit of a new module.
- [ ] One paradigm per module; mix only at adapter boundaries.
- [ ] In code review, ask "is this domain logic or data shuffling?" out loud.
- [ ] If a class has one public method and no state, it's a function. Make it static or delete the wrapper.
- [ ] If the same invariant appears in five services, build an aggregate.
- [ ] Mentor by symptoms, not by doctrine — show the junior their own code.
- [ ] Codify the team's paradigm policy in `PARADIGMS.md` and keep it under 200 lines.
- [ ] Schedule paradigm reviews quarterly per module; rewrite only with change pressure.
- [ ] Name the anti-patterns when you see them in retros — give them a vocabulary.
- [ ] Vendor types stop at the adapter. The domain speaks only its own language.
- [ ] Refactor data-bag → aggregate and god-service → pure functions as planned work, not heroics.
- [ ] When in doubt, default to records and functions; *upgrade* to OO when invariants demand it.

---

## 10. What's next

| Topic                                                          | File              |
| -------------------------------------------------------------- | ----------------- |
| Junior-level pattern recognition for paradigm fit              | `junior.md`        |
| Side-by-side OO vs DoD vs functional refactors                 | `middle.md`        |
| ECS, Valhalla, Loom; when JVM mechanics force the choice       | `senior.md`        |
| Hands-on "pick the paradigm" exercises                         | `tasks.md`         |
| Interview Q&A on paradigm choice and trade-offs                | `interview.md`     |

---

**Memorize this:** Paradigm choice is an architectural decision that costs more the later you make it. Decide once per module, encode it in review vocabulary, enforce it at boundaries, and mentor by symptoms — not by doctrine. The tech lead's job is not to win the OO-vs-FP argument, it is to make sure the team has the same answer to it in the same module every day.

# Responsibility-Driven Design — Professional

> **What?** Driving Responsibility-Driven Design across a team: workshops, code-review vocabulary, naming conventions, ArchUnit fitness functions, mentoring, and a strangler-fig sequence for migrating service-fat legacy code.
> **How?** RDD is taught one review comment at a time. Your job as tech lead is to install the vocabulary, set the architectural fences, and coach people through the moment when "I'll just put it in the service" is the easy answer.

---

## 1. Running a responsibility-assignment workshop — a 45-minute script

A workshop turns a vague feature into a stereotype map *before* anyone opens an IDE. Run it whenever a feature has more than two collaborating objects, or when the team is reaching for a new "Service" class.

**Setup (5 min).** One feature, one whiteboard. Print the six stereotypes across the top: Holder, Service, Structurer, Coordinator, Controller, Interfacer. Have someone read the user story aloud.

**Step 1 — Enumerate responsibilities (10 min).** Ignore data. Ask the team to list every *thing the system has to do*, each on a sticky note. "Calculate the loan's amortization schedule." "Decide whether a claim is fraudulent." "Notify the underwriter." Don't write classes yet — only verbs.

**Step 2 — Find owners (15 min).** For each sticky, ask: *who already knows the data this responsibility needs?* Place the sticky under that owner's name. If two candidates are equally plausible, mark it with a star — those are your design decisions.

**Step 3 — Stereotype each owner (5 min).** For each class on the board, write its primary stereotype. A class collecting stickies from two columns is a warning sign — explicitly resolve it now, not in PR.

**Step 4 — Walk the collaborations (10 min).** Pick the most complex use case. Have someone "be" the entry point and verbally call out who they delegate to. The rest of the team checks: does each callee already hold the data it needs? If not, the responsibility is misplaced.

You leave the room with a stereotype map, a list of stars (open questions), and a shared vocabulary. Photograph the board and attach it to the ticket.

---

## 2. Code-review vocabulary

A team's design is shaped by the questions you ask in pull requests. Adopt these phrases — they convert vague unease ("this feels wrong") into actionable feedback.

> **"Who *knows* the data this needs?"**
> Forces the author to justify why the method lives where it lives. If the answer is "well, I had to fetch it anyway," the responsibility is misplaced.

> **"What stereotype is this class trying to be?"**
> Surfaces classes that have drifted into playing two or three roles. The author can usually name the drift themselves once asked.

> **"If I deleted this class, who would notice?"**
> Pure-Service classes that only forward calls often answer "nobody" — a sign the work belongs on a Holder or Controller.

> **"Why is this static?"**
> Static methods are responsibility-free; they belong to no role-player. Most static helpers are misplaced instance methods.

> **"Show me the collaboration diagram for this use case."**
> If the author can't sketch it on a napkin, the design isn't clear in anyone's head — including theirs.

Train juniors to use these phrases on *their own* code before opening a PR.

---

## 3. Naming conventions per stereotype

A class's name should hint at its role. Pick one convention per stereotype and enforce it; the team's reading speed compounds.

| Stereotype          | Suffix / shape                          | Examples                                       |
| ------------------- | --------------------------------------- | ---------------------------------------------- |
| Information Holder  | Bare domain noun                        | `Order`, `Claim`, `Loan`, `Money`, `Address`   |
| Service Provider    | `-er`, `-Service` only when stateless   | `PasswordHasher`, `TaxCalculator`, `Encrypter` |
| Structurer          | Collection-like noun                    | `LoanLedger`, `ClaimsIndex`, `OrderCatalog`    |
| Coordinator         | `-Workflow`, `-Process`, `-Saga`        | `ClaimSettlementProcess`, `OrderPlacementSaga` |
| Controller          | Bare noun + lifecycle verbs as methods  | `Order.place()`, `Claim.approve()`             |
| Interfacer          | `-Controller` (HTTP), `-Repository`, `-Gateway`, `-Adapter` | `OrderRestController`, `LoanRepository`, `StripeGateway` |

Two non-obvious rules:

- A class whose name ends in `Service` should have **no fields** beyond its collaborators. If it holds domain data, rename it to a Holder or Controller.
- A class whose name ends in `Manager` is almost always a smell — it tells the reader nothing about the role. Force a rename.

---

## 4. ArchUnit rules to enforce stereotype direction

Conventions decay without fitness functions. Encode the stereotype hierarchy as ArchUnit rules so the build fails when someone routes a dependency the wrong way.

```java
@AnalyzeClasses(packages = "com.acme.lending")
class StereotypeArchitectureTest {

    @ArchTest
    static final ArchRule holders_must_not_depend_on_coordinators =
        noClasses().that().resideInAPackage("..domain.holder..")
            .should().dependOnClassesThat().resideInAPackage("..domain.coordinator..");

    @ArchTest
    static final ArchRule holders_must_not_depend_on_interfacers =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("..web..", "..persistence..", "..messaging..");

    @ArchTest
    static final ArchRule coordinators_only_orchestrate_holders =
        classes().that().resideInAPackage("..coordinator..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage("..domain..", "java..", "javax..", "..coordinator..");

    @ArchTest
    static final ArchRule services_are_stateless =
        classes().that().haveSimpleNameEndingWith("Service")
            .should().haveOnlyFinalFields()
            .andShould().notBeAnnotatedWith(Entity.class);

    @ArchTest
    static final ArchRule no_manager_classes =
        noClasses().should().haveSimpleNameEndingWith("Manager")
            .because("'Manager' tells the reader nothing about the responsibility");
}
```

The direction of allowed dependencies: Interfacer to Coordinator to Controller to Holder/Service to Structurer. Holders sit at the bottom; nothing in the domain depends on the web or persistence layers.

Add one more guard: forbid `@Autowired` private fields in Holders and Controllers — DI belongs to the outer ring.

---

## 5. Mentoring juniors to identify the right owner

Juniors usually know *that* a responsibility is misplaced after you point it out, but they can't *find* it themselves. The skill is repeatable; teach it explicitly.

**Coach the trace.** When a junior asks "where should this go?", don't answer. Walk them through:

1. "What information does this code read?"
2. "Which object holds that information?"
3. "Does that object already have a method that does something similar?"
4. "What would the method be called if it lived there?"

By step 3 the answer is usually obvious to them.

**Pair on a single PR per week.** Pick one of their PRs and refactor it together, narrating every move: "I'm pulling `calculateInterest` off `LoanService` because `Loan` already owns the principal and rate. The service was just plumbing."

**Read good code together.** Once a fortnight, spend 30 minutes reading a single class from a respected codebase (the JDK `Duration`, Spring's `UriComponentsBuilder`, Hibernate's `Session`) and naming the stereotype out loud. Juniors learn pattern recognition by exposure, not by reading rules.

**Resist the "just put it in a service" answer.** When a junior reaches for a new `XxxService`, ask them to write the responsibility on paper first. Half the time they discover an existing Holder that could own it.

---

## 6. Mediator/Coordinator vs direct collaboration

Two Holders can talk directly if their conversation is *short* and *symmetric*. Introduce a Coordinator when one of the following appears.

**Direct collaboration is fine when:**

```java
public final class Account {
    public Transfer transferTo(Account other, Money amount) {
        this.withdraw(amount);
        other.deposit(amount);
        return new Transfer(this, other, amount, Instant.now());
    }
}
```

Two parties, one round trip, no third concern. A Coordinator here is over-engineering.

**Introduce a Coordinator when:**

- The workflow involves three or more domain objects whose order matters.
- There are compensating actions on failure (refunds, reversals, notifications).
- The workflow is *named* in the ubiquitous language ("claim settlement", "loan disbursement", "order fulfillment").
- The same dance recurs across multiple entry points (REST, scheduled job, message consumer) — centralize it once.

```java
public final class ClaimSettlementProcess {
    private final ClaimRepository claims;
    private final PaymentGateway payments;
    private final NotificationBus notifications;
    private final AuditLog audit;

    public Settlement settle(ClaimId id, Adjuster adjuster) {
        Claim claim = claims.byId(id);
        claim.approve(adjuster);                     // Controller
        Payment payment = payments.disburse(claim);  // Interfacer
        notifications.notifyClaimant(claim);         // Interfacer
        audit.record(SettlementEvent.of(claim, payment));
        return new Settlement(claim, payment);
    }
}
```

The Coordinator owns the *sequence*; each Holder/Controller still owns its own rule. If the Coordinator starts checking business rules itself, push them back to the Holders.

A rule of thumb: if removing the Coordinator would scatter the same five lines across three call sites, it earns its keep. Otherwise, delete it and let the two parties talk.

---

## 7. Strangler-fig migration from "service-fat" legacy

Most legacy Java codebases have one or two megaservices (`OrderService`, `ClaimsManager`) with thousands of lines. You won't fix them in a sprint. Use a strangler-fig sequence.

**Phase 1 — Map (week 1).** List every public method on the megaservice. Annotate each with the responsibility it represents and the Holder that *should* own it. Don't change code yet — this is the migration plan.

**Phase 2 — Tighten the service (weeks 2-3).** Stop the bleeding: introduce ArchUnit rules forbidding *new* methods on the megaservice. Code review enforces "if you need a new behavior, it goes on a Holder." The service can only shrink.

**Phase 3 — Move pure functions (weeks 3-5).** Methods on the service that take a Holder and return a value with no side effects are the easiest to move. They become instance methods on the Holder. The old service method becomes a one-line delegation.

```java
// Before
class OrderService {
    public Money total(Order order) {
        return order.getLines().stream()
            .map(l -> l.unitPrice().multipliedBy(l.quantity()))
            .reduce(Money.ZERO, Money::plus);
    }
}

// After — behavior on the Holder
public final class Order {
    public Money total() {
        return lines.stream()
            .map(OrderLine::lineTotal)
            .reduce(Money.ZERO, Money::plus);
    }
}

// Old call site keeps working via a one-line bridge
class OrderService {
    public Money total(Order order) { return order.total(); }
}
```

**Phase 4 — Move decisions (weeks 5-8).** Methods that read a Holder's data and return a boolean or enum decision (`isEligibleForRefund`, `canBeShipped`) move next. They almost always belong on the Holder.

**Phase 5 — Extract Coordinators (weeks 8-12).** Methods that orchestrate multiple Holders become named Coordinators (`OrderPlacementProcess`, `RefundWorkflow`). Now the megaservice is mostly a facade.

**Phase 6 — Delete the facade (week 13+).** When all callers go through the new Holders and Coordinators, the megaservice has no reason to exist. Delete it. Celebrate.

> **Reviewer's prompt during migration:** "Is this PR adding behavior to the megaservice, or moving behavior out of it? Only the second is allowed."

---

## 8. Anti-patterns juniors produce — and how to redirect

**Anti-pattern 1: the `Helper` class.**

```java
class LoanHelper {
    public static BigDecimal monthlyPayment(BigDecimal principal, BigDecimal rate, int months) { ... }
}
```

> *Review:* "Who *knows* principal, rate, and months? The `Loan` does. Move this onto `Loan` and delete `LoanHelper`."

**Anti-pattern 2: the data-bag with a service per verb.**

```java
class Claim { /* 20 getters and setters */ }
class ClaimValidator { boolean validate(Claim c); }
class ClaimApprover  { void approve(Claim c); }
class ClaimDenier    { void deny(Claim c, String reason); }
```

> *Review:* "Each `-er` class operates on one `Claim`. Move the methods onto `Claim` as `validate()`, `approve()`, `deny(reason)`. Delete the three classes."

**Anti-pattern 3: the orchestrator that owns business rules.**

```java
class OrderPlacementProcess {
    public Order place(Cart cart, Customer customer, Payment payment) {
        if (customer.getStatus().equals("BLOCKED")) throw ...;
        if (cart.getTotal().compareTo(payment.getAmount()) > 0) throw ...;
        // 200 more lines of rules
    }
}
```

> *Review:* "Each `if` is a domain rule. `customer.assertNotBlocked()` and `payment.assertCovers(cart.total())` belong to the customer and payment. The process should call those methods, not implement them."

**Anti-pattern 4: stereotype mixing.**

```java
@Entity
public class Order {
    public BigDecimal total() { ... }
    public void notifyShipped() { kafka.send(...); }       // Interfacer creep
    public void persist() { entityManager.persist(this); } // Interfacer creep
}
```

> *Review:* "`notifyShipped` and `persist` are Interfacer roles. The order is a Holder/Controller. Move messaging to an event handler and persistence to a repository."

**Anti-pattern 5: the `Utils` graveyard.**

A `StringUtils`, `DateUtils`, `OrderUtils` file is where misplaced responsibilities go to die. Forbid them. Every static helper deserves a home on a real role-player.

---

## 9. Quick rules for tech leads

- [ ] Run a 45-minute responsibility-assignment workshop for any feature touching three or more collaborators.
- [ ] Install the review phrases: "Who knows?", "What stereotype?", "Why static?"
- [ ] Enforce naming conventions per stereotype; ban `Manager` and `Helper`.
- [ ] Encode stereotype direction in ArchUnit; fail builds on violations.
- [ ] Teach juniors the trace: what does it read, who holds it, what's the method called.
- [ ] Introduce a Coordinator only when the workflow is named and recurring.
- [ ] Migrate service-fat code with strangler-fig: tighten, move pure functions, move decisions, extract coordinators, delete facade.
- [ ] When you hear "I'll just add it to the service," stop and ask "who already knows this?"

---

## 10. What's next

| Topic                                                       | File             |
| ----------------------------------------------------------- | ---------------- |
| First-principles RDD                                        | `junior.md`      |
| Designing collaborations and stereotype tables              | `middle.md`      |
| RDD with frameworks, ORMs, and real architecture            | `senior.md`      |
| Hands-on RDD exercises                                      | `tasks.md`       |
| Interview Q&A                                               | `interview.md`   |

---

**Memorize this:** RDD is a team practice, not a personal aesthetic. Install the vocabulary in reviews, fence the stereotypes with ArchUnit, name each class's role, and migrate service-fat code one Holder at a time. When someone reaches for a new `XxxService`, the right question is always *who already knows this?*

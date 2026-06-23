# Anthropomorphism — Professional

> **What?** This file is for the person who owns a team's design culture: a tech lead, staff engineer, or architect. The question is no longer "do *I* think in agents?" but "how do I make a team of fifteen people think in agents — consistently, in code review, in onboarding, in glossaries, in tooling — without becoming the design police?"
> **How?** Treat anthropomorphism as a *vocabulary discipline*. Bake it into review scripts, ArchUnit rules, glossaries, and pairing rituals. Know exactly where to apply it (domain code) and where to leave it alone (ETL, analytics, infrastructure). Migrate legacy anemic code with a strangler-fig sequence, not a rewrite.

---

## 1. Running a 15-minute role-play in design reviews

Most design reviews degenerate into class-diagram bingo. Names appear on a whiteboard, arrows connect them, and nobody asks the only question that matters: *what does this object say about itself?* A short, structured role-play fixes that.

Run it as the first 15 minutes of any design review for a non-trivial domain change. Here is the script I hand new tech leads:

> **Minute 0-2.** "Pick the most important class on the board. You are now that class. Stand up if you want — it helps."
> **Minute 2-5.** "Introduce yourself in first person. 'Hi, I am a Claim. I know who filed me, what I cover, and which adjuster owns me. People can ask me…' Keep going until you run out of honest sentences."
> **Minute 5-9.** "Whenever you say 'people can ask me X', someone in the room writes the method signature on the board. Whenever you say 'I refuse Y' or 'only if Z', someone writes an invariant or precondition."
> **Minute 9-12.** "Now the room interrogates you. 'Who pays you? Do you know? Should you know? Who tells you to close?' The point is to find sentences you *cannot* honestly say. Those are misplaced responsibilities."
> **Minute 12-15.** "Reassign the orphan sentences. 'A `Claim` cannot honestly say "I cash myself out." Who can? Maybe `Payout`, maybe `Settlement`, maybe a domain service.' Capture the new candidate."

The exercise is short on purpose. Fifteen minutes is enough to surface 60-70% of misplaced methods. It also normalizes the *language* of design — by month three on a team, engineers naturally ask "can the order say this about itself?" without you prompting.

---

## 2. Code-review phrases that do the heavy lifting

The most efficient way to shift a team's design instincts is to standardize a handful of short review comments. Pin them in your team handbook. The phrases below are not jokes; they are diagnostic.

**Phrase 1: "Can the order say this about itself?"**

Use when a method on a domain class reads like instructions from the outside.

> **Reviewer:** "Can the order say this about itself? `OrderHelper.computeDiscount(order)` reads like the order's tax rules live somewhere else."
> **Author:** "Fair. I'll move `discount()` onto `Order`."

**Phrase 2: "Who is the subject of this method?"**

Use when method names have no grammatical owner — `process`, `handle`, `execute`, `manage`.

> **Reviewer:** "Who is the subject of `processReservation`? If it's the reservation, name it `reservation.confirm()` or `reservation.hold()`. If it's a coordinator, what's its real job? Probably not 'processing'."

**Phrase 3: "Read this signature out loud."**

Use when a method has a clumsy parameter order or unclear intent.

> **Reviewer:** "Read `InvoiceService.update(invoice, true, 0, null)` out loud. What did you just say? Now name the method after that sentence."

**Phrase 4: "What does this object refuse?"**

Use when a class has lots of setters and no preconditions.

> **Reviewer:** "What does `Claim` refuse? Right now it accepts any status transition. A real claim refuses to reopen after settlement."

These four phrases, used consistently, replace 80% of the long-form "this should be more OO" comments that nobody reads.

---

## 3. Naming standards: banning the suffix industrial complex

Adopt an explicit, written naming standard. The teams I have run have all converged on roughly this rule:

> Domain classes are named after **what they are** (a noun for the concept), not after **what they do to other things** (a verb-ish suffix).

That means the following suffixes are banned in domain packages by default:

- `*Manager`
- `*Processor`
- `*Handler`
- `*Helper`
- `*Util`
- `*Coordinator` (with care)

Banning the suffix forces a real name. `OrderManager` becomes either `Order` (the entity), `OrderShipment` (a sub-aggregate), or `PlaceOrder` (an explicit use-case / application service). Each of these is *honest* about its identity in a way `OrderManager` never is.

**Legitimate exceptions** (and you must enumerate them, or engineers will assume the ban is absolute):

- **HTTP handlers** — `OrderHttpHandler`, `WebhookHandler`. These are framework adapters whose *job* is to handle a request lifecycle. The word "handler" is from Servlet/Spring vocabulary, not domain vocabulary.
- **Event-bus handlers / listeners** — `PaymentReceivedHandler`, `ClaimClosedListener`. Same reasoning: the framework dictates the suffix.
- **Exception handlers** — `GlobalExceptionHandler`. Spring/JAX-RS convention.
- **Scheduled job runners** — `NightlyReportRunner`. The word maps to a concrete role.

Codify the exceptions in the standard, and require any other `*Handler` to be justified in the pull request. The default answer is no.

---

## 4. Static analysis: making anemia detectable

Code review catches anemic agents only when reviewers are awake. Static analysis catches them every commit.

**ArchUnit** is the strongest tool here, because it works on architectural shape rather than syntax. A sketch of the rules I deploy on most Java codebases:

```java
@AnalyzeClasses(packages = "com.acme.domain")
public class DomainAnthropomorphismRules {

    @ArchTest
    static final ArchRule no_manager_or_processor_in_domain =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().haveSimpleNameEndingWith("Manager")
            .orShould().haveSimpleNameEndingWith("Processor")
            .orShould().haveSimpleNameEndingWith("Helper")
            .because("Domain classes are named after what they are, not after what they do.");

    @ArchTest
    static final ArchRule domain_classes_should_have_behavior =
        classes()
            .that().resideInAPackage("..domain..")
            .and().areNotEnums()
            .and().areNotInterfaces()
            .and().areNotAnnotatedWith(Embeddable.class)
            .should(haveAtLeastOneNonAccessorMethod())
            .because("A domain class with only getters and setters is anemic.");

    @ArchTest
    static final ArchRule no_public_setters_on_aggregates =
        methods()
            .that().areDeclaredInClassesThat().areAnnotatedWith(Aggregate.class)
            .and().haveNameStartingWith("set")
            .should().notBePublic()
            .because("Aggregates expose intent verbs, not field writes.");
}
```

The `haveAtLeastOneNonAccessorMethod` custom condition counts methods that are neither `getX`, `setX`, `equals`, `hashCode`, nor `toString`. If a domain class fails it, the class is a struct.

**Checkstyle** complements this with method-name patterns. A rule banning method names that match `^(process|handle|execute|manage)[A-Z].*` inside the `domain` package catches a different slice.

**SpotBugs** has a `URF_UNREAD_FIELD` detector and others that find fields written but never read — a frequent symptom of "I added a setter but the rule was never enforced."

None of these tools replace the role-play exercise. They are the safety net under it.

---

## 5. Glossary discipline: one verb, one owner

The fastest way to lose a team is to let three different parts of the codebase use three different verbs for the same business action. "Cancel", "void", and "abort" all show up for the same reservation event, and within six months no one remembers which is canonical.

Maintain a domain glossary. One verb per action. One owning class per verb. Reviewers reject PRs that introduce a synonym.

A sample entry from a reservations system glossary:

```
Term:     cancel
Owner:    Reservation
Signature: reservation.cancel(CancellationReason reason)
Meaning:  The guest or the system terminates the reservation before
          its start date. Refunds may follow; cancellation itself
          does not perform the refund.
Refuses:  A reservation that has already started, completed, or
          been cancelled. Throws IllegalReservationState.
Emits:    ReservationCancelled event.
Forbidden synonyms: void, abort, terminate, kill, remove.
```

When a new engineer writes `reservation.void()` in a PR, the review comment is a one-liner: "See glossary: cancel, not void." There is no debate. The glossary moves the disagreement off the PR and onto a separate, slower, more deliberate conversation.

Keep the glossary in the same repository as the code. Markdown is fine. Treat it as a first-class artifact, not a wiki page that rots.

---

## 6. Onboarding new hires with pairing

Anthropomorphism is taught faster by pairing than by reading. The onboarding ritual I recommend for any new senior or mid-level engineer in their first two weeks:

**Week 1, day 2.** Pair them with a tenured engineer on a small domain change. The tenured engineer narrates *every* method choice in role-play voice: "Now, can the `Invoice` say this about itself? It can say it knows its total, but can it really say it sends itself? No, so we emit an event."

**Week 1, day 4.** Hand the new hire a short PR with deliberately anemic code — three classes, all setter-driven. Ask them to rewrite it in agent style. Review together.

**Week 2, day 1.** Have them lead a 15-minute role-play in a real design review. They will be uncomfortable. That is the point — they will not forget the technique.

**Week 2, day 3-5.** They submit their first PR touching the domain layer. The reviewer applies the four standard phrases. If the PR comes back clean on the first pass, the onboarding has stuck.

By month two, new hires are running role-plays for *other* new hires. The vocabulary self-propagates.

---

## 7. When the metaphor is bad management

Anthropomorphism is a tool for *domain* code — code that holds business rules, invariants, and identities. There are entire categories of code where applying it produces worse software, not better.

**ETL pipelines.** The job of an ETL pipeline is to move and reshape data. A row in a CSV is not an agent; it is a tuple. Forcing `CsvRow` to "validate itself" and "transform itself" leads to thousands of tiny classes representing things that should be functions over data. Use functional pipelines, schemas, and dataframe-style abstractions instead.

**Analytics and reporting.** A `MonthlyRevenueReport` is not an agent that "computes itself." It is the *output* of a query. The interesting agent — if any — is the report-generation job, and even that is usually a procedure with parameters.

**Math-heavy numerical code.** A vector, a matrix, a quaternion: these have rich behavior but they are *values*, not agents. Their methods are mathematical operations, not social acts. Do not write `matrix.refuseToInvertItself()`; write `Matrices.invert(m)` and throw.

**Pure transformations and codecs.** A JSON serializer is not an agent. It is a function.

**Stateless infrastructure.** Schedulers, retry decorators, connection pools — these are mechanisms. They have generic, framework-flavored vocabulary on purpose.

The lead's job is to *recognize the boundary*. A common architectural smell is when a team applies DDD-flavored anthropomorphism to an analytics codebase and ends up with `RevenueRecord.calculateItself()` everywhere. The team is being disciplined about the wrong thing. Push back. The right shape for data is data.

> **Reviewer:** "This is ETL. The row is not a claim. Use a transform function, not a class with `enrichItself()`."

---

## 8. The strangler-fig migration sequence

Most large Java codebases have a substantial layer of anemic, setter-driven entities created in the JPA-and-services era. You cannot rewrite them in a sprint. You strangle them.

The sequence I have run on three different legacy codebases:

**Step 1: Freeze new anemia.** Land ArchUnit rules that fail the build for *new* classes that violate the standard. Existing classes are grandfathered. This stops the bleeding without forcing immediate rewrites.

**Step 2: Add verbs alongside setters.** For each aggregate, write new behavior methods next to the existing setters. Do not remove anything yet.

```java
public class Order {
    // Legacy, still in use:
    public void setStatus(OrderStatus s) { this.status = s; }

    // New, expressing intent:
    public void ship(TrackingNumber tn) {
        if (status != PAID) throw new IllegalOrderState("not paid");
        this.status = SHIPPED;
        this.tracking = tn;
        record(new OrderShipped(id, tn));
    }
}
```

**Step 3: Deprecate the setters.** Mark them `@Deprecated(forRemoval = true)` with a message pointing to the verb method.

```java
@Deprecated(forRemoval = true, since = "2026.05")
public void setStatus(OrderStatus s) {
    this.status = s;
}
```

The deprecation warnings now light up every caller in IDEs and CI.

**Step 4: Migrate callers in waves.** Each team owns a batch of caller sites and rewrites them to use the verb methods. Track progress on a dashboard — number of `setStatus` call sites remaining. Visible progress sustains momentum.

**Step 5: Make setters package-private, then delete.** Once the call-site count is zero, restrict visibility, wait one release, then delete. JPA frameworks usually need either field access or package-private setters; both are fine.

**Step 6: Tighten ArchUnit.** Once a class is fully migrated, add it to the list of classes that must satisfy the stricter "no public setters" rule.

A reasonable cadence is one aggregate per quarter for a medium-sized codebase. Faster than that and you destabilize integrations. Slower and the team loses interest.

---

## 9. Anti-patterns juniors will produce

You will see all of these. They are predictable. Recognize them on sight and have a stock response ready.

**Anti-pattern A: the "I am a person" comment.** A junior reads the role-play technique and adds a Javadoc that says "I am an Invoice. I know my total." Then the class still has only getters and setters. The metaphor is in the comment, not the methods.

> **Response:** "Move the sentences into method names. The Javadoc is for humans; the methods are for the language."

**Anti-pattern B: the god aggregate.** A junior anthropomorphizes one class and gives it every responsibility in the bounded context. `Order` now sends emails, charges cards, books couriers, and writes audit logs.

> **Response:** "An order can say it shipped itself. It cannot honestly say it called Stripe. Emit an event; let a different agent handle the side effect."

**Anti-pattern C: theatrical verbs.** A junior who has just read about DDD names methods `bestowItself`, `enshrine`, `consecrate`. The domain has no such concept.

> **Response:** "Use the verb the business uses. If the operations team says 'close the claim', the method is `close()`, not `seal()`."

**Anti-pattern D: anthropomorphizing the wrong thing.** A junior makes the `OrderRepository` "ask itself" things. The repository is infrastructure; the agent is the aggregate it stores.

> **Response:** "Repositories are not agents. They are collections. The verbs belong on `Order`, not on `OrderRepository`."

**Anti-pattern E: hidden setters wrapped in verbs.** A junior renames `setStatus` to `updateStatus` and declares victory.

> **Response:** "What does `updateStatus` refuse? If the answer is 'nothing', it is still a setter wearing makeup. Name it after the business event: `ship`, `cancel`, `markPaid`."

**Anti-pattern F: anthropomorphizing DTOs.** A junior adds behavior to `OrderRequestDto` because "every class should have behavior."

> **Response:** "DTOs cross wires. They are deliberately passive. Behavior belongs on the aggregate the DTO maps to, not on the DTO itself."

---

## 10. Quick rules, what's next, and the memorize line

Quick rules for the lead:

- [ ] Open every domain review with a 15-minute role-play; do not skip it for "small" changes.
- [ ] Standardize four review phrases; pin them in the team handbook.
- [ ] Ban `*Manager` / `*Processor` / `*Helper` in domain packages; enumerate framework exceptions.
- [ ] Enforce the ban with ArchUnit; fail the build, do not warn.
- [ ] Maintain a glossary with one verb per action, one owner, and forbidden synonyms.
- [ ] Teach the vocabulary by pairing in the first two weeks of onboarding.
- [ ] Recognize where the metaphor does *not* apply: ETL, analytics, math, codecs, infrastructure.
- [ ] Migrate legacy anemic code with strangler-fig steps, not a rewrite.
- [ ] Have a one-line response ready for each predictable anti-pattern juniors produce.

**What's next**

| Topic                                                | File              |
| ---------------------------------------------------- | ----------------- |
| Conceptual foundations and the "I am an X" exercise  | `junior.md`        |
| Linguistic tests and the agent vocabulary workshop   | `middle.md`        |
| When the metaphor fights frameworks and reality      | `senior.md`        |
| Hands-on role-play exercises and rewrite drills      | `tasks.md`         |
| Interview Q&A                                        | `interview.md`     |

---

**Memorize this:** anthropomorphism scales from a personal habit to a team discipline only when you make the vocabulary mechanical — review phrases, naming bans, ArchUnit rules, a glossary, an onboarding ritual, and a migration sequence — and only when you know exactly which corners of the codebase do not deserve the metaphor at all.

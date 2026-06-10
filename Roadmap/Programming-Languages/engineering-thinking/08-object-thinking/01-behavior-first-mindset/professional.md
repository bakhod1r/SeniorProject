# Behavior-First Mindset — Professional

> **What?** Driving behavior-first thinking across a team and a codebase. Code review vocabulary, scaling the smell hunt, strangler-fig migrations of legacy data-bag models, mentoring, where the rule does *not* apply, and the architectural and tooling shifts that follow.
> **How?** You are the tech lead. You set the language people use in reviews, the grep targets they run before they refactor, the boundaries where the rule is suspended, and the ArchUnit fence that keeps the gains from sliding back.

---

## 1. Set the vocabulary before you set the rule

Most teams already know "anemic" the word, but it has become a weapon. The moment you write *"this class is anemic"* on a pull request, the author hears *"you wrote bad code."* The review devolves into defense. Pick a vocabulary that points at code, not at people.

Words I let my team use freely:

- **"feature envy"** — this method spends more time touching another object's data than its own.
- **"tell, don't ask"** — instead of pulling state out and deciding outside, tell the object what to do.
- **"primitive obsession"** — three `BigDecimal` arguments that always travel together want to be a `Money`.
- **"the rule looks like it belongs on the object itself"** — softer than "anemic", but precise.
- **"this reads as a struct"** — the class has fields and accessors and nothing of its own.

Words I steer the team away from:

- *"anemic"* on its own (insulting, vague).
- *"that's not real OO"* (purist, unhelpful).
- *"David West would not approve"* (cult talk).

A good review comment names the smell, points at one method, and proposes a move:

> "Looks like `OrderService.applyDiscount` mostly reads `order.items` and `order.subtotal` to compute a new total. That rule probably wants to live on `Order` as `applyDiscount(DiscountPolicy)`. Want me to sketch it?"

That sentence is the artifact. Print it on a card if you have to.

---

## 2. Code review dialog patterns

The same comment phrased three ways. Pick the one that fits the contributor.

**To a senior:**
> "Feature envy on `InvoiceCalculator.compute` — every line is `invoice.getX()`. Pull it onto `Invoice`?"

**To a mid-level:**
> "This calculator does two jobs: it knows how to total an invoice *and* it knows how to format the total. Splitting the first onto `Invoice` will let the second one collapse."

**To a junior:**
> "Try reading `compute` without looking at the field names. Can you tell what it's doing? If it sounds like a story about an invoice, it probably belongs *on* `Invoice`."

Same observation, three different doors. The wrong door makes the comment land as criticism. The right door makes it land as collaboration.

Another pattern I use for repeated offenders — the **counter-question**. Instead of saying "you wrote a service", I ask:

> "If `Order` had this method, would the call site get simpler?"

Force them to picture the alternative. Half the time they refactor before I review again.

---

## 3. Spotting at scale — the grep pass

You can't review every PR. You can run a quarterly sweep over the codebase and surface the ten worst offenders. Some queries that pay off:

**Service classes with no instance state.** A service whose fields are all `final` injected collaborators and whose methods take a domain object as the first argument is almost always a behavior the domain object should own.

```bash
# Rough: classes ending in *Service that have only injected fields
rg -l 'class \w+Service' src | xargs rg -L 'private (?!final)' | head
```

**Classes where most methods are accessors.** If a class has 18 methods and 14 of them match `^(get|set|is)`, it is a struct.

```bash
rg -c '^\s*public (\w+) (get|set|is)' src/main/java | sort -t: -k2 -nr | head -20
```

**Methods that read three or more fields of another object.** Run a custom check via Error Prone or PMD's `LawOfDemeter`. A method body containing `x.getA().getB()` or `x.getA(); x.getB(); x.getC();` is volunteering to live on `x`.

**Mutation patterns from outside.** `obj.setX(...); obj.setY(...); obj.setZ(...);` in the same caller is a hidden domain operation begging for a name (`obj.reschedule(...)`, `obj.cancel(...)`).

Build a dashboard of the top ten classes by these metrics. Bring it to architecture review. Do not name authors — name code.

---

## 4. The strangler fig for a legacy data-bag

Most real codebases I inherit look like this: `Order` is a JPA entity with 32 fields and 64 accessors; `OrderService` is 1,800 lines; the rules are scattered across services, controllers, and a `helper` package nobody owns. You will not rewrite `Order` in a weekend. You strangle it.

**Step 1 — pick one domain operation, not a class.**

Don't say "we are rewriting `Order`." Say "we are giving cancellation a home."

```java
// New, behavior-first object — lives alongside the JPA entity
public final class Cancellation {
    private final OrderRow row;             // the legacy data bag
    private final RefundPolicy policy;
    private final Clock clock;

    public Cancellation(OrderRow row, RefundPolicy policy, Clock clock) { ... }

    public Refund cancel(Reason reason) {
        if (row.status() == SHIPPED) throw new IllegalStateException(...);
        // rule lives here now, not in OrderService
        ...
    }
}
```

`OrderService.cancel(...)` becomes a one-liner: `new Cancellation(row, policy, clock).cancel(reason)`. The rule has moved. The schema has not.

**Step 2 — route new code through the rich object.**

New features call `Cancellation`. Old code keeps calling `OrderService.cancel` until you migrate it. Both paths must produce identical results, so you wrap with a regression test pair.

**Step 3 — retire the data-bag method.**

Once every caller goes through the rich object, delete the service method. Don't deprecate forever. A deprecation that lives two years is a deprecation that lives forever.

**Step 4 — repeat.**

Cancellation, then refund, then reschedule, then split-shipment. Six months later the service is 200 lines, the entity is still a JPA bag (fine, see §6), and the rules live in named objects.

The key discipline: **never strangle two operations at once**. One at a time, with tests, in a PR small enough to review.

---

## 5. Mentoring without preaching

Behavior-first is a cultural change. If you sermonize, juniors learn to dodge you. Practical patterns I use:

**The "what does this object do?" question.** When a junior shows me a new class, I do not look at the fields. I ask "in one sentence, what does this thing do for the rest of the system?" If they hesitate, the class isn't done.

**Pair on the first PR of a new feature, not the tenth.** Behavior-first decisions are made at the moment the file is created. Once it has 12 fields and 4 services, the door is closed. Spend the expensive hour at the start.

**Encourage getter deletion in review.** When someone adds `getCustomerId()`, ask "what calls this?" If the answer is "the controller, to render JSON," fine — that's a serialization boundary. If the answer is "the discount service, to look up loyalty," wrong — the loyalty rule wants to be on `Order`.

**Don't grade in public.** A bad behavior-first attempt is worth more than a good data-first one. Praise the attempt, fix the details in private DM or pair session.

**Read one chapter of *Object Thinking* per quarter as a book club.** Not the whole book. One chapter. Discuss. Move on. The book is dense; treat it as a reservoir, not a syllabus.

---

## 6. Where the rule does *not* apply

A tech lead's job is to draw the boundary. Behavior-first is a default, not a religion. Pre-declare where the team is allowed to write data-bags without apology:

| Layer                          | Behavior-first?              | Why                                                                 |
|--------------------------------|------------------------------|---------------------------------------------------------------------|
| Domain core (`*.domain.*`)     | **Yes, strictly**            | This is where the business lives. Rules belong on objects.          |
| Persistence entities (JPA)     | No — keep them as data bags  | ORMs need default constructors, mutable fields, no logic.            |
| DTOs / API contracts           | No — records or POJOs        | They serialize. Logic in a wire object is a bug waiting to happen.   |
| Adapters / mappers             | Mostly no                    | They translate. Pure functions, no domain rules.                     |
| Framework integration          | Often no                     | Spring `@ConfigurationProperties`, MapStruct mappers, etc.           |
| Hot paths (perf-critical)      | Pragmatic                    | Sometimes a flat struct + free function is genuinely faster.         |

Write this table in your team's README. New hires will ask. You want one answer.

The most common confusion: people see a JPA entity covered in `@Getter @Setter` and conclude the team doesn't believe in behavior-first. They do — they just don't put rules in the entity. The rule lives in the domain object that *takes* the entity. This is the **two-class pattern**: a JPA `OrderRow` that holds the data, and a behavioral `Order` that holds the rules. Repositories return rows; services wrap them.

---

## 7. The architectural ripple

Once a team is two quarters into behavior-first, packaging starts to change on its own. Watch for it:

**Service classes shrink.** `OrderService` goes from 1,800 lines to 200. Most of what it used to do now lives on `Order`, `Cancellation`, `Shipment`. The service becomes a thin orchestrator: load, delegate, save.

**The domain package grows.** What used to be `com.shop.service` becomes `com.shop.domain.order`, `com.shop.domain.invoice`, with rich objects. The `service` package becomes a transactional façade.

**Tests get faster.** A behavior on a pure domain object is unit-testable in microseconds, no Spring context, no in-memory DB. Your CI test suite splits into *fast domain tests* (run on every save) and *slow integration tests* (run on PR). Watch the split happen.

**Mocks decrease.** When rules live on objects, you stop mocking five services to test one rule. The test reads `new Order(...).cancel(reason)`; no `@Mock` in sight. If you see the team's mock count dropping, it's working.

**Aggregates emerge.** When behavior lives on an object, you start drawing lines around which objects are loaded together. That's DDD aggregates, arriving from the bottom up. You didn't plan it; you got it by following the methods.

---

## 8. Anti-patterns the team will produce while learning

These will show up. Catch them early, name them, don't punish them.

**Renamed getters.** A junior reads "no getters" and writes:

```java
public Money currentBalance() { return this.balance; }
```

A getter wearing a hat. The fix isn't the name — it's the absence of a behavior. If nothing on the object uses `balance`, why does the object have one? Either there's a behavior they haven't found, or `balance` should live elsewhere.

**God-rich methods.** Someone moves five service calls onto one object:

```java
public void process() {
    validate();
    applyDiscount();
    chargeCard();
    sendEmail();
    schedulePickup();
}
```

That isn't behavior-first; it's a procedural script in OO clothing. The fix is to ask: what *single* responsibility names this method? If you can't, split.

**Constructor that does everything.** A misread of "validate in the constructor" produces a class that opens database connections, calls APIs, and crashes the JVM at startup if anything is misconfigured.

```java
public Order(OrderId id, CustomerRepo repo, EmailService email) {
    this.customer = repo.findById(id).orElseThrow();   // I/O in constructor
    email.sendWelcome(customer);                       // side effect in constructor
}
```

The constructor should validate the *invariants* of the object, not the *world*. I/O belongs in a factory or service.

**Behavior on a JPA entity.** Someone adds `cancel()` directly to the JPA `Order` entity, which then tries to look up a repository it doesn't have. They reach for `@PersistenceContext` injection or a static service locator. Stop them. Behavior on persistence entities is the road back to the Big Ball of Mud. Use the two-class pattern from §6.

**Encapsulation theater.** Fields are `private`, but a `state()` method returns the full internal `OrderState` enum, so every caller still branches on it externally. The encapsulation didn't move the rule — it just hid the field for two seconds. Smell test: do callers still `switch` on what they got back?

---

## 9. ArchUnit as the fence

A code review is a moment. ArchUnit is forever. Encode the rules you've decided on.

```java
@AnalyzeClasses(packages = "com.shop")
class DomainArchitectureTest {

    @ArchTest
    static final ArchRule services_must_not_have_rules =
        noMethods()
            .that().areDeclaredInClassesThat().haveSimpleNameEndingWith("Service")
            .should().beAnnotatedWith(BusinessRule.class);

    @ArchTest
    static final ArchRule domain_does_not_depend_on_persistence =
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..jpa..");

    @ArchTest
    static final ArchRule entities_have_no_public_setters =
        noMethods()
            .that().areDeclaredInClassesThat().resideInAPackage("..domain..")
            .and().haveNameMatching("set.*")
            .should().bePublic();
}
```

Keep the rule set small. Five rules everyone respects beat fifty rules everyone routes around.

Pair ArchUnit with a custom Error Prone / PMD check for **setter density** and **getter density**: any new class in `..domain..` whose public surface is >50% accessors fails the build. Tune the threshold so the message reads as "look again", not "rewrite."

---

## 10. Static analysis you can run today

A few things to wire into CI:

- **PMD `LawOfDemeter`** — flags `a.getB().getC().getD()` chains, classic feature envy.
- **SpotBugs / SonarJava `S1188`** — class with only static methods; often a misplaced behavior.
- **A custom Checkstyle rule** for the ratio of accessor methods to total public methods in `..domain..` classes.
- **JaCoCo coverage of domain classes** — domain logic should be at 90%+; if it isn't, you probably have behavior leaking into services where it's harder to test.
- **A small script that lists `*Service` classes with no instance state**, posted weekly to the team's channel. Not a build failure — a conversation starter.

The goal is not to gate every PR on tooling. The goal is that nobody is surprised when you bring up "this service has no state" in review — the tool said it first.

---

## 11. Metrics that tell you it's working

You will be asked. Some signals:

- **Average lines per `*Service` class** — should fall over time.
- **Public method ratio (behaviors : accessors) in `..domain..`** — should rise.
- **Mock count per unit test** — should fall.
- **Test runtime split** — share of "fast" (no Spring) tests should rise.
- **Number of files changed per domain feature PR** — should fall (rules live in fewer places).

Don't make these targets. Track them as a thermometer. If they all move the right way for two quarters, the mindset has landed.

---

## 12. Where this lives in your culture document

A team that takes behavior-first seriously usually writes a short page in its engineering handbook. Mine looks roughly like this:

> **The rule.** New code in the `domain` package starts with methods, not fields. If a service class accumulates business rules, we look for the object the rules belong to.
>
> **The exception.** JPA entities, DTOs, configuration objects, and adapters are allowed to be data bags. They are not the domain.
>
> **Review vocabulary.** *Feature envy*, *tell don't ask*, *primitive obsession*, *the rule belongs on the object*. Not *anemic*.
>
> **The fence.** ArchUnit rules in `core-architecture-tests` enforce package boundaries and accessor density. Adding a public setter to a domain class needs a review approval from a maintainer.
>
> **The migration.** Legacy services are strangled one operation at a time. New behavior goes in domain objects from day one.

Two pages. Pinned. Linked from CONTRIBUTING.md.

---

## 13. What's next

| Topic                                                   | File              |
| ------------------------------------------------------- | ----------------- |
| Foundations and the data-first trap                     | `junior.md`        |
| Refactoring an anemic class step-by-step                | `middle.md`        |
| Persistence, performance, and pragmatic exceptions      | `senior.md`        |
| Hands-on exercises                                      | `tasks.md`         |
| Interview Q&A                                           | `interview.md`     |

---

**Memorize this:** as a tech lead, your job is not to write rich objects — your job is to make rich objects the default. That means a shared vocabulary that doesn't insult, a fence (ArchUnit) that doesn't nag, a migration path (strangler fig) that doesn't stall, and a clear boundary where the rule is suspended (persistence, DTOs, hot paths). Don't preach behavior-first. Make it the cheapest thing for the team to do.

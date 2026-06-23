# Tell, Don't Ask — Professional

> **What?** Driving Tell-Don't-Ask across a team: the vocabulary you use in code review, the grep patterns you run on a million-line codebase, the migration plan that removes getters without setting the office on fire, the static-analysis rules that catch regressions, and the explicit list of places where the rule does not apply.
> **How?** Stop reviewing code line by line. Review it verb by verb. Every five-line `if`-block in a service is a missing method on a domain object; your job is to name the method, sequence the migration, and teach the team to spot the pattern before it lands in `main`.

---

## 1. The vocabulary you use at code review

A tech lead doesn't say "this violates Tell, Don't Ask." That phrasing closes the conversation. It also doesn't survive translation across teams who haven't read the same book. Use three questions instead. They work on anyone, including yourself a year from now.

**Question 1 — "Does the caller need to know this rule?"**

> Reviewer: *"This `if (order.getStatus() == PLACED && order.getTotal().compareTo(LIMIT) > 0)` — does the caller need to know that 'large placed orders require manager approval'? Or is that an `Order` rule?"*
> Author: *"It's an Order rule."*
> Reviewer: *"Then let's name it. `order.requiresApproval()` or `order.requestApproval()` — depending on whether we want a query or a command."*

The point of the question is not gotcha. It is to make the author articulate where the rule belongs, and to surface the verb. Once the verb has a name, the refactor writes itself.

**Question 2 — "What verb is this five-line if-block?"**

> Reviewer: *"Those five lines that read `subscription.getEndsAt()`, compare with `now()`, then call `setStatus(EXPIRED)` — what verb is that? `subscription.expireIfDue()`? `subscription.tick(now)`?"*

The verb is the design. If the author cannot name it in plain English, the abstraction is wrong and you have a larger conversation than a refactor.

**Question 3 — "Who owns this decision?"**

> Reviewer: *"Right now this `PaymentService` decides whether the card is expired by reading `card.getExpiryYear()` and `card.getExpiryMonth()`. Who owns the rule for 'is this card usable'? Service or Card?"*
> Author: *"Card, obviously."*
> Reviewer: *"Then push the rule down. `card.isUsableOn(today)`."*

The third question routes around bike-shedding about getter visibility. Owners own decisions. The data follows.

These three questions are the entire review vocabulary for this principle. Use them by name; they become a shared idiom on the team within two sprints.

---

## 2. Grep patterns to find Tell-Don't-Ask violations at scale

You cannot review every line. You can write a few regexes that catch the most common offenders and run them in CI or as a periodic report. The goal is not zero false positives — it is to surface candidate files for human review.

**Pattern A — getter chains (`.getX().getY().getZ()`):**

```bash
grep -rnE '\.get[A-Z][A-Za-z0-9_]*\(\)\.get[A-Z][A-Za-z0-9_]*\(\)' \
  --include='*.java' src/main/java | wc -l
```

A two-level chain is borderline; three levels is almost always a Law-of-Demeter violation tangled with a Tell-Don't-Ask smell. The list this produces is your weekly refactor backlog.

**Pattern B — `setX(getX() ...)` round-trips on the same receiver:**

```bash
grep -rnE '([a-zA-Z_][a-zA-Z0-9_]*)\.set([A-Z][A-Za-z0-9_]*)\(.*\1\.get\2\(\)' \
  --include='*.java' src/main/java
```

This catches `account.setBalance(account.getBalance() - amount)` and its cousins. Each hit is a missing verb method on the receiver.

**Pattern C — lambdas that pull-and-compute on the same source:**

```bash
grep -rnE '\.stream\(\)\.map\(.* -> [a-zA-Z_]+\.get[A-Z]' \
  --include='*.java' src/main/java
```

Hits look like `items.stream().map(i -> i.getPrice().multiply(...))`. These are usually a sign that the *collection's owner* (cart, order, invoice) should expose `total()` instead of leaking its items.

**Pattern D — services with too many getters per method:**

A simple AST-based counter (use Spoon, JavaParser, or `error_prone`) — flag any method in `*Service.java` that calls `.get*()` more than four times. These are almost always anemic-service code that should live on a domain object.

Save these as a `find-tell-dont-ask-smells.sh` script in `tools/` and run it from CI on a schedule (not on every PR — it would block builds). Treat the output as a budget: the team's goal is "fewer than last month."

---

## 3. The legacy migration plan — removing public getters without breaking everything

You inherited a codebase where `Order.getStatus()` is called from 412 places. You cannot delete it on Monday. You can drive it to zero callers over a quarter, then privatize. The sequence below is the one that survives contact with reality.

**Step 1 — Deprecate the getter on decision paths.**

```java
public class Order {
    /**
     * @deprecated decisions about order state belong on Order itself.
     *             Use {@link #place()}, {@link #ship()}, {@link #cancel()},
     *             or {@link #isShipped()} for read-only display.
     */
    @Deprecated(since = "2026.05", forRemoval = true)
    public Status getStatus() { return status; }
}
```

`forRemoval = true` flips the warning to error-level in most IDEs. The Javadoc names the replacement verbs explicitly — without that, the deprecation is noise.

**Step 2 — Add the verb methods.**

For every common usage pattern of `getStatus()`, add the corresponding verb:

| Old pattern                                            | New verb                |
|--------------------------------------------------------|-------------------------|
| `if (o.getStatus() == DRAFT) o.setStatus(PLACED)`      | `o.place()`             |
| `if (o.getStatus() == PLACED) o.setStatus(SHIPPED)`    | `o.ship()`              |
| `if (o.getStatus() == SHIPPED) o.setStatus(DELIVERED)` | `o.deliver()`           |
| `o.getStatus() == CANCELLED`                           | `o.isCancelled()`       |
| `o.getStatus().displayName()`                          | `o.statusForDisplay()`  |

The point of the table: every legitimate use of the deprecated getter has a *named, intent-revealing* replacement. If you cannot find one for some call site, that call site is doing something weird and needs human review anyway.

**Step 3 — Migrate call sites in waves.**

Wave 1: domain modules. Wave 2: application services. Wave 3: controllers and view layer. Wave 4: tests. Always in that order — domain first so that the new verbs exist before anyone migrates to them.

Track progress with a single number on a dashboard: count of `@SuppressWarnings("deprecation")` plus count of unsuppressed deprecation warnings. It only goes down.

**Step 4 — Privatize, then delete.**

When the call-site count hits zero, downgrade `getStatus()` to package-private. Wait one release. If nothing screams, make it private. Wait one release. Delete.

This four-step sequence has a name on most mature teams: **expose → deprecate → migrate → privatize**. It works for any rich-behavior migration, not just Tell-Don't-Ask.

---

## 4. Static analysis: making the rule enforceable

Hand-grep finds smells in *existing* code. Static analysis prevents them from coming back.

**SonarQube** has built-in rules that catch the obvious offenders:

| Rule key                  | What it catches                                |
|---------------------------|------------------------------------------------|
| `java:S1213`              | Long getter chains                             |
| `java:S2293`              | Anemic data classes (fields + getters/setters, no behavior) |
| `java:S3066`              | Public mutable state                           |
| `java:S138`               | Methods too long — often anemic-service code   |

Enable them at "blocker" severity for new code only. Existing code stays at "info" until refactored — otherwise the team revolts.

**PMD** rules:

- `LawOfDemeter` — explicit Demeter checker (noisy, but tunable per package).
- `DataClass` — finds fields-with-getters-only classes.
- `GodClass` — finds the giant service classes that result from anemic domain models.

**Custom SpotBugs detector for "ask + decide + set":**

The pattern `if (this.<recv>.get<X>(...)) this.<recv>.set<X>(...)` is too specific for built-in rules. Write a one-page SpotBugs detector that walks the bytecode and flags any method containing both `INVOKEVIRTUAL Foo.getX` and `INVOKEVIRTUAL Foo.setX` on the same receiver. False positives exist (builders, mappers), so exclude `*DTO.java`, `*Builder.java`, `*Mapper.java`.

**ArchUnit** test in CI:

```java
@ArchTest
static final ArchRule services_should_not_call_getters_excessively =
    classes().that().resideInAPackage("..service..")
        .should(new ArchCondition<>("not call domain getters in decisions") {
            // implementation: count get* calls per method, fail if > N
        });
```

ArchUnit runs as a JUnit test, so it integrates with your existing CI without new tooling.

---

## 5. The architectural ripple

Once Tell-Don't-Ask takes hold, the *shape* of the codebase changes. A tech lead should anticipate this — it surprises people.

**Service layer shrinks.** A `OrderService` that was 1,500 lines becomes 300 lines. The 1,200 lines move into `Order`, `OrderLine`, `Money`, `ShippingAddress`. Reviewers who measured "complexity" by service-class size will think the codebase is suddenly more complex. It is not — the complexity is now where it belongs.

**Domain modules gain tests.** Behavior in a service is hard to unit-test (mocks everywhere). Behavior on a value object is trivially testable. Expect domain-package coverage to climb from 40% to 85%+ as the migration proceeds. Adjust CI thresholds *gradually*; a sudden jump from 40 to 85 will produce flaky-test panic.

**Repositories stop returning collections of fields.** A `OrderRepository.findOpenOrders()` that used to return rows-of-data starts returning `Order` aggregates that *do things*. The repository's API surface narrows.

**Reusability improves where you didn't expect.** Once `Cart.checkOut()` owns the rule, the CLI checkout, the web checkout, and the batch-import checkout all call one method. Before the migration, each had its own copy of "compute total, validate, mark checked out, fire event." After, the three call sites collapse to one line each.

**CI structure changes.** Long-running integration tests (which used to exercise the service layer) start failing less, because the rules they exercised moved into fast unit tests on domain objects. Rebalance your test pyramid: more unit tests in `domain/`, fewer integration tests in `service/`.

Communicate these ripples *before* they happen. Otherwise someone notices "the service is shrinking" or "domain has more files than service" and files a panic ticket.

---

## 6. The exception list — where Tell-Don't-Ask does not apply

A principle without an exception list becomes a religion. Write the list down, put it in `docs/architecture/tell-dont-ask-exceptions.md`, and link to it from your code-review checklist.

**Exception 1 — Read models and query DTOs.**

A `CustomerSummaryView` returned by a `/customers/{id}` endpoint is *data for display*. It does not make decisions; it does not own behavior. Public getters are correct here. The view layer is allowed to "ask."

**Exception 2 — Telemetry, metrics, audit.**

A metric collector reads `order.id()`, `order.totalAmount()`, `order.placedAt()` and emits them. This is asking for showing, which is fine (junior.md §6). The audit trail is the read model of the system.

**Exception 3 — Serialization.**

Jackson, Gson, JAXB, and Protobuf generators need field access. They are not making business decisions — they are projecting the object onto a wire format. Allow them their getters (or annotate fields and skip getters entirely).

**Exception 4 — ORM mapping.**

Hibernate sometimes needs setters on entities (lazy loading, dirty tracking). Use package-private setters and keep the *business verbs* public. The ORM is a special-purpose framework, not a business caller.

**Exception 5 — Builders, factories, and test data.**

A `OrderBuilder.withStatus(SHIPPED).build()` is constructing test data. It is not making business decisions. Builders are exempt.

**Exception 6 — Boundary translation layers.**

When you map between domain and external schema (REST DTO ↔ domain object, Kafka event ↔ domain object), the mapper inevitably reads fields. Keep mappers thin and put them in a dedicated package (`com.example.adapter.*`). The mapper package gets exemption from your grep rules.

If you don't write this list, every team member invents their own exception, and within six months "Tell-Don't-Ask" means whatever they want it to mean.

---

## 7. Mentoring — the 30-minute refactor exercise

The fastest way to teach Tell-Don't-Ask is a pair-programming session on a real anemic service in your codebase. Here is the script.

**Setup (5 minutes).** Pick a service method with 40-80 lines, lots of `get*` calls, and at least one `if (...) set...(...)` pattern. `BillingService.applyDiscount()` is a classic. Open it in the IDE next to the junior.

**Phase 1 — Name the verbs (10 minutes).** Do not touch code. Together, list every five-line block in the method and name the verb that describes it. Write the verbs on a whiteboard or in a comment block:

```
// Verbs found:
//   1. cart.subtotal()        -- lines 12-18 compute subtotal
//   2. cart.applyDiscount(d)  -- lines 20-28 reduce by discount
//   3. order.placeFrom(cart)  -- lines 30-40 create order
//   4. order.charge(payment)  -- lines 42-50 charge payment
```

Coach: *"Read the verb out loud. Does it sound like something Cart would do? Or like something a procedure would do to Cart?"* If the verb starts with "calculate", "process", or "handle", it is not a verb yet — push for the domain term.

**Phase 2 — Move one verb (10 minutes).** Pick the cleanest verb from the list. Move only that one. Run tests. Commit. The point is to demonstrate that the refactor is small, mechanical, and reversible.

**Phase 3 — Hand off (5 minutes).** Have the junior name the *next* verb without prompting. If they get it right, leave them to migrate the rest over the next day. If they get it wrong, do one more verb together. Don't do the whole service yourself — that defeats the purpose.

Run this exercise once per new hire, then again six months later on a harder service. After the second session, the engineer can lead it themselves with the next new hire. That is how the principle propagates.

---

## 8. Anti-patterns the team will produce

Listing the anti-patterns up front saves twenty code reviews each. Put this list in your team's coding standards.

**Anti-pattern 1 — Cosmetic telling.**

```java
// looks like tell, still asks
public void setStatusToShipped() { this.status = SHIPPED; }
order.setStatusToShipped();
```

The caller still chose to ship the order — the decision happened outside. Rename was the only change. Coach: *"Where did we decide to ship? If the answer is 'in the caller', it is still ask."*

**Anti-pattern 2 — God-methods masquerading as telling.**

```java
order.processEverything(customer, address, payment, warehouse, marketing, analytics);
```

One verb that does eight things is not Tell-Don't-Ask; it is a procedural script hidden inside an object. Split into named verbs: `place()`, `charge(payment)`, `reserveStock(warehouse)`, `notify(marketing)`.

**Anti-pattern 3 — Tell, then ask the result, then act.**

```java
order.tryShip();
if (order.getLastShipResult() == FAILED) {            // asking after telling
    order.setStatus(PENDING_RETRY);                   // and writing back
}
```

The verb returned implicit state. Then the caller fetched that state. Then the caller wrote a decision back. Three layers of leak. Fix: `order.tryShip()` returns a `ShipOutcome` *or* fires events, and the order itself handles `PENDING_RETRY` internally.

**Anti-pattern 4 — Telling a primitive.**

```java
money.add(other);          // mutates? returns new? caller can't tell
```

Value objects should be immutable; "telling" them to change is incoherent. Use `money = money.plus(other)`. Tell-Don't-Ask applies to entities and aggregates, not to value objects in the functional sense.

**Anti-pattern 5 — Verb on the wrong owner.**

```java
shippingService.shipOrder(order);   // verb belongs on order
order.shipVia(shippingService);     // collaborator passed in instead
```

If the verb feels right but the receiver is "Service", the receiver is wrong. Move the verb to the entity and pass collaborators as parameters.

**Anti-pattern 6 — "Telling" a thin pass-through.**

```java
class Order {
    public void setStatus(Status s) { this.status = s; }
    public void changeStatusTo(Status s) { setStatus(s); }   // verb that is a setter alias
}
```

Pure rename. The decision still lives outside. If `changeStatusTo` does not contain at least *one* check, transition, or event, it is not a verb — it is a setter wearing a costume.

When you see these in PRs, name them by number: *"This is anti-pattern 3 from our Tell-Don't-Ask guide."* Numbered references are faster than re-explaining the principle every time.

---

## 9. Decision tables for code review

When the team gets large, you need decisions that don't require you in the room. Two short tables, posted in the wiki.

**Table A — Is this code site a Tell-Don't-Ask violation?**

| Pattern observed                                         | Verdict                       | Action                            |
|----------------------------------------------------------|-------------------------------|-----------------------------------|
| `if (x.get*()) x.set*(...)`                              | Violation                     | Fold into verb on `x`             |
| `x.get*().get*().get*()`                                 | Violation (also Demeter)      | Introduce intermediate verb       |
| `service` reads `> 4` getters of same entity in a method | Likely violation              | Move method to entity             |
| `view.render(x)` calls `x.get*()`                        | Allowed (read model)          | None                              |
| `mapper.toDto(x)` calls `x.get*()`                       | Allowed (boundary layer)      | None                              |
| `metrics.report(x.get*())`                               | Allowed (telemetry)           | None                              |
| `builder.with*(...).build()`                             | Allowed (construction)        | None                              |
| Test fixture sets fields directly                        | Allowed (test data)           | None                              |

**Table B — Migration triage when refactoring is expensive.**

| Caller count of deprecated getter | Action                                            |
|-----------------------------------|---------------------------------------------------|
| 0                                 | Privatize immediately                             |
| 1-5                               | Migrate in this PR                                |
| 6-30                              | Migrate in next sprint, track on dashboard        |
| 31-100                            | Quarterly initiative, divide by owning team       |
| 100+                              | Architectural project, plan release-train rollout |

Numbers, not vibes. The tech lead's job is to keep the migration *visible* — counters in a dashboard, not arguments in Slack.

---

## 10. The five things you must do in your first month as tech lead

1. Run the grep patterns from §2 against your repo. Read the top 20 hits. They are your training set for what "bad" looks like *here*.
2. Write the exception list from §6 in your team's wiki. Get two senior engineers to review it.
3. Add the SonarQube rules from §4 as **info** for legacy code, **blocker** for new code. Wait two weeks; adjust thresholds based on noise.
4. Pair-refactor one anemic service with each engineer on the team using the script from §7. This is your one-on-one curriculum for a quarter.
5. Pick one deprecated getter from §3 and drive it to zero callers as a demo. Document the four-step migration as a runbook everyone can copy.

If you do all five, the principle propagates without you in every review. That is the goal.

---

## 11. Summary tables

**Code-review questions**

| Question                                       | When to ask it                                          |
|------------------------------------------------|---------------------------------------------------------|
| Does the caller need to know this rule?        | Any `if (x.get*())` pattern                             |
| What verb is this five-line if-block?          | Multi-line procedural block touching one receiver       |
| Who owns this decision?                        | Service code that reads-then-decides on a domain object |

**Grep patterns**

| Pattern target                | Regex sketch                                              |
|-------------------------------|-----------------------------------------------------------|
| Getter chains                 | `\.get[A-Z]\w*\(\)\.get[A-Z]\w*\(\)`                      |
| Same-receiver round-trips     | `(\w+)\.set(\w+)\(.*\1\.get\2\(\)`                        |
| Pull-and-compute lambdas      | `\.stream\(\)\.map\(.* -> \w+\.get[A-Z]`                  |
| Anemic services               | Count `.get*()` per method via AST tool                   |

**Static-analysis rules**

| Tool       | Rule / mechanism                          | Catches                                       |
|------------|-------------------------------------------|-----------------------------------------------|
| SonarQube  | `S2293`, `S1213`, `S3066`, `S138`         | Anemic classes, chains, public state, long methods |
| PMD        | `LawOfDemeter`, `DataClass`, `GodClass`   | Demeter, anemia, god services                 |
| SpotBugs   | Custom detector for `get+set` on receiver | Ask-decide-set patterns                       |
| ArchUnit   | Package-scoped behavioral assertions      | Services that call too many domain getters    |

**Migration sequence**

| Step | Action                          | Done when                                |
|------|---------------------------------|------------------------------------------|
| 1    | Deprecate getter                | `@Deprecated(forRemoval=true)` shipped   |
| 2    | Add verb method                 | Replacement exists for each use case     |
| 3    | Migrate call sites              | Deprecation warnings = 0                 |
| 4    | Privatize, then delete          | Getter removed in a later release        |

**Exception list**

| Domain                | Allowed? | Why                                       |
|-----------------------|----------|-------------------------------------------|
| Read models / view DTOs | Yes    | Showing, not deciding                     |
| Telemetry / metrics   | Yes      | Observational, not behavioral             |
| Serialization         | Yes      | Wire-format projection                    |
| ORM mapping           | Limited  | Use package-private setters               |
| Builders / fixtures   | Yes      | Construction, not behavior                |
| Boundary mappers      | Yes      | Adapter layer, isolated package           |
| Application services  | No       | Decisions belong on domain objects        |
| Controllers           | Limited  | Allowed to ask for display; not to decide |

**Anti-patterns**

| # | Name                              | Signature                                   |
|---|-----------------------------------|---------------------------------------------|
| 1 | Cosmetic telling                  | Setter renamed as verb, decision outside    |
| 2 | God-method telling                | One verb does eight things                  |
| 3 | Tell-then-ask hybrid              | Verb returns state, caller decides next     |
| 4 | Telling a value object            | Mutating method on what should be immutable |
| 5 | Verb on wrong owner               | Service has the verb; entity has the data   |
| 6 | Pass-through "verb"               | Verb that is a setter alias                 |

---

**Memorize this:** as a tech lead you do not enforce Tell-Don't-Ask line by line. You install three questions in the team's vocabulary, four scripts in CI, a written exception list in the wiki, and a four-step migration playbook. Then the principle propagates on its own — and your reviews shift from spotting violations to naming verbs.

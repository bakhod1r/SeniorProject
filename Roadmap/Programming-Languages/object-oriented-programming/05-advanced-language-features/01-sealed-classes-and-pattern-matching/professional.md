# Sealed Classes and Pattern Matching — Professional

> **What?** How to drive sealed types and pattern matching across a team and a codebase: the vocabulary you use in PR review, the ArchUnit rules that catch misuse before review, the mentoring move for juniors who over-seal or under-seal, the migration strategy from `instanceof` chains and visitor patterns, and the deprecation cycle for safely adding new permits in a published library.
> **How?** Treat `permits` as an architectural artefact, not a syntactic detail. Enforce mechanical rules in CI (no `default` on sealed switches, sealed parents must live in one module, every permit declares its modifier). Reserve review attention for the judgement calls — should this type be sealed at all, who owns the closure, what is the deprecation path when a new variant must be added.

---

## 1. Code-review vocabulary — name the choice

A sealed-types PR usually contains one of four kinds of change. Each has its own review template.

**A. Refactor of `instanceof` ladder into pattern switch.**

> **Reviewer:** Good shape. Two follow-ups: drop the `default` branch — the switch is already exhaustive over `PaymentInstrument`, and the `default` will silently absorb the next permit. Second, the `Crypto` case should destructure with a record pattern (`case Crypto(BigDecimal amount, String wallet)`) so we stop calling `.amount()` twice in the body.

**B. New sealed type introduced.**

> **Reviewer:** I want to push back on sealing `RiskCheck`. We have one in-tree implementation today but the product roadmap mentions third-party risk plugins in Q3. Sealing now means we'd un-seal in a major version. Leave it as an open interface; add a `sealed interface BuiltinRiskCheck permits FraudCheck, VelocityCheck` if you want exhaustive handling inside the platform code.

**C. New permit added to existing sealed type.**

> **Reviewer:** `permits` change is binary-breaking for `order-reporting` if they have an exhaustive switch against the old set. Confirm: have we run the `reporting` build against this `order-events` snapshot? If yes, ship it; if no, hold until we have. Also bump the artifact's major version — this is API.

**D. `non-sealed` introduced.**

> **Reviewer:** Stop and explain. Why `non-sealed` on `Custom`? The CHANGELOG says "to allow tests to inject", but tests should use one of the existing permits or a `@VisibleForTesting` factory. Adding `non-sealed` is a permanent open door — every consumer will lose exhaustiveness for that branch.

The common thread: name the choice, not the code. "Sealed or open" is an architectural question; "with or without `default`" is a correctness question; "add permit now or major-bump first" is a release-management question. Each gets a different conversation.

---

## 2. ArchUnit rules for sealed-types hygiene

A few rules pay for themselves in any team that uses sealed types at scale.

```java
@ArchTest
static final ArchRule sealed_switches_have_no_default =
    methods().that().areDeclaredInClassesThat().resideInAPackage("..domain..")
             .should(notUseDefaultInSealedSwitch());
// Custom condition: parses bytecode, locates pattern-match switches over sealed types,
// asserts no DEFAULT label is present. Lets the compiler do exhaustiveness for us.

@ArchTest
static final ArchRule permits_lives_in_one_module =
    classes().that().areAnnotatedWith(Sealed.class)
             .should().onlyHavePermittedSubclassesInTheSameModule();
// Custom condition: verifies the JLS rule we already get from javac — useful as a
// project-level smoke test when the module layout is in flux.

@ArchTest
static final ArchRule no_non_sealed_in_domain =
    noClasses().that().resideInAPackage("..domain..")
               .should().haveModifier(JavaModifier.NON_SEALED)
               .because("non-sealed is an SPI/plugin concession; the domain stays closed");
```

ArchUnit's stock matchers don't cover sealed semantics; you write a custom `ArchCondition` over the JavaClass model. The condition is mechanical (a dozen lines), the policy is a one-line annotation. Once installed, juniors cannot introduce a `default` on a sealed switch without the CI failing.

For libraries that publish sealed types, consider an additional rule that fails the build if `permits` changed since the last released version, prompting a major-version review:

```java
@ArchTest
static final ArchRule permits_changes_require_major_version_check =
    sealedTypesIn("api").should(matchPublishedPermitsOrTriggerMajorBump());
```

Implementation reads the previously-published artifact's class file (`PermittedSubclasses` attribute, JVMS §4.7.31), diffs against the current one, fails if the lists differ and `pom.xml` has not bumped the major version. Cheap and decisive.

---

## 3. Mentoring — when to seal, when not to seal

A junior who has just discovered `sealed` is dangerous in the opposite direction from a junior who discovered SOLID. They seal everything in sight, because sealing produces compile errors when "things change", and the compile errors feel like safety.

The mentoring move is to anchor each `sealed` decision to one of three concrete questions:

> **Mentor:** Three questions for every sealed candidate. One — do you own every variant? If a downstream consumer can ever want to add one, do not seal. Two — are the variants stable on the order of months, or do you change them every sprint? Sealing a sprint-volatile type creates churn. Three — does anyone *outside this module* `switch` over it? If yes, treat `permits` as API and bump majors on changes.

The same junior will sometimes refuse to seal because "it's too restrictive". For *those* cases the question is reversed:

> **Mentor:** Look at this `kind` field. It's a `String`. Six places in the codebase switch on it. Three of them have a `default` that does nothing. The seventh place was added last month and forgets one of the values. A sealed type would have flagged that. The point of sealing isn't restriction; it's making forgetting impossible.

Pair both with a real diff from the team's history. SOLID-style retrospective teaching applies here too: don't teach `sealed` as a feature, teach it as the fix for the bug we already had.

---

## 4. Anti-patterns juniors will introduce

These appear in nearly every codebase where sealed types arrived faster than the team's intuition for them.

**The over-sealed SPI.**

```java
public sealed interface RiskCheck permits FraudCheck, VelocityCheck, AmlCheck {}
// Then six months later: customer compliance demands a custom KYC check.
// The team un-seals, adds non-sealed Custom, and writes ten lines of CHANGELOG
// explaining why the major version bumped.
```

The fix is to recognise that an SPI is *open by nature*. Use an open interface for the extension point; if you want exhaustiveness *inside* the platform's own variants, seal a smaller `BuiltinRiskCheck` that the open `RiskCheck` extends.

**The `default` smoke detector.**

```java
return switch (paymentInstrument) {
    case CreditCard c -> ...
    case BankTransfer b -> ...
    case Crypto x -> ...
    default -> throw new IllegalStateException("unhandled");  // never fires — until it does
};
```

The `default` is "defensive programming" against a non-event. Delete it. The compiler already proved exhaustiveness; the `default` only matters when the binary mismatch in section 6 of [senior.md](senior.md) happens, and at that point `MatchException` (Java 19+) communicates the failure more precisely than `IllegalStateException`.

**The mega-sealed catch-all.**

```java
public sealed interface DomainEvent permits
    OrderPlaced, OrderShipped, OrderReturned, RefundIssued,
    UserRegistered, UserLoggedIn, UserLoggedOut, UserDeleted,
    InventoryReceived, InventoryAdjusted, /* 30 more */ {}
```

The `permits` list is now an event registry. Every team adds their event here; every switch over `DomainEvent` is a god switch nobody can complete; the file becomes a merge-conflict magnet. Split by *bounded context*: `sealed interface OrderEvent`, `sealed interface UserEvent`, `sealed interface InventoryEvent`. Each lives in its own module, with its own consumers.

**Pattern-match guards with side effects.**

```java
return switch (e) {
    case Login l when audit.recordLogin(l) -> /* never returns false ... right? */
        "ok";
    default -> "fail";
};
```

The guard *also* mutates the audit log. Two readers will disagree on whether the audit fires for all `Login` events or only for matching ones. Pull the side effect out of the guard; guards are predicates, not actions.

---

## 5. Migration strategy — from `instanceof` chains, from kind-fields, from visitors

You inherit a module that pre-dates sealed types. The migration is mechanical and incremental.

**Phase 1 — introduce the sealed parent.**

Identify the closed set: every concrete class today plus any planned ones. Mark the parent `sealed` and list them in `permits`. Each child gets `final`, `sealed`, or `non-sealed`. No call site changes yet.

```java
// Before
public abstract class Shape { ... }
public class Circle extends Shape { ... }

// After phase 1 — same call sites, sealed parent
public sealed abstract class Shape permits Circle, Square, Triangle { ... }
public final class Circle extends Shape { ... }
```

**Phase 2 — replace `instanceof` chains.**

One method at a time, rewrite to pattern-match `switch`. Drop the `default` branch.

```java
// Before
if (s instanceof Circle) return Math.PI * ((Circle)s).radius() * ((Circle)s).radius();
else if (s instanceof Square) return ((Square)s).side() * ((Square)s).side();
else throw new IllegalStateException();

// After phase 2
return switch (s) {
    case Circle c -> Math.PI * c.radius() * c.radius();
    case Square sq -> sq.side() * sq.side();
    case Triangle t -> 0.5 * t.base() * t.height();
};
```

**Phase 3 — convert to records where possible.**

Plain data classes become records. Their immutability gives `equals`/`hashCode` for free and unlocks record patterns.

```java
public record Circle(double radius) implements Shape {}
```

**Phase 4 — delete visitors.**

If the old code used the visitor pattern, the `accept`/`visit` machinery is now redundant. Delete the visitor interface and its `accept` methods.

The migration is *per method, per class*; do not batch a service-wide rewrite. Each phase is reviewable in a single PR. After phase 2 is complete, the compiler is your safety net for every future variant addition — that's the payoff.

We give a worked exercise in [tasks.md](tasks.md).

---

## 6. Deprecation cycle for adding a new permit in a library

You publish a library with `sealed interface Event permits Created, Updated, Deleted`. Six months in, the product needs `Archived`. How do you ship it without breaking consumers?

**Step 0 — accept that this is a major-version event.** No combination of source compatibility makes a new permit binary-safe for an exhaustive switch downstream. SemVer says major bump.

**Step 1 — announce in the previous minor release.** Add a deprecation note in `package-info.java` and the CHANGELOG: "version 2.0 will add `Archived` to `Event.permits`. Audit your exhaustive switches over `Event` and decide whether to handle the new variant or fall through with a `default`."

```java
/**
 * @apiNote Version 2.0 adds Archived as a permitted variant. Exhaustive
 *          switches against Event in your code will require an Archived
 *          case after upgrading.
 */
public sealed interface Event permits Created, Updated, Deleted {}
```

**Step 2 — ship the major release.** Add the permit, update the major version, document the migration in a release note. Provide a migration tool (a `javac` annotation processor, an OpenRewrite recipe, or a `grep` invocation) that locates exhaustive switches in consumer code.

**Step 3 — provide a default-case helper for slow movers.** A `sealed` switch in a slow-upgrading consumer can keep working through major versions if they accept a `default` branch — but they lose exhaustiveness on future additions. Document this trade-off.

```java
// In consumer code that wants to limp through major versions
return switch (event) {
    case Created c -> handleCreated(c);
    case Updated u -> handleUpdated(u);
    case Deleted d -> handleDeleted(d);
    default -> handleUnknown(event);   // permanent escape hatch; loses exhaustiveness
};
```

**Step 4 — track adoption.** Telemetry on `MatchException` thrown in consumers using the older switch pattern signals incomplete adoption. Treat it as a release-management indicator.

The principle: in a library, every permit change is a published API event. Plan it the same way you'd plan adding a method to a public interface.

---

## 7. Architectural-level sealed types

Sealed types raise *exhaustive dispatch* from a class-level concern to a module-level one. Useful patterns at architecture scale:

**Per-bounded-context sealed event roots.** Each bounded context owns one sealed root (e.g. `sealed interface OrderEvent`). Consumers subscribe per context, never to a god root. The root lives in the context's published module; permits live in the same module.

**Sealed result types at module boundaries.** Cross-module operations return `Result<T, E>` where `E` is a sealed `enum` or sealed interface of failure modes. The caller is forced to handle each failure. This is more disciplined than declaring a checked exception and gets you composition (`flatMap`) for free.

**Sealed command types in CQRS.** Commands form a closed set per aggregate. A `sealed interface AccountCommand permits Open, Deposit, Withdraw, Close` makes the aggregate's accepted operations explicit, exhaustively handled by the aggregate's `apply` method, and testable as a single witness over `getPermittedSubclasses()`.

**Sealed config DTOs.** A `sealed interface DatabaseConfig permits PostgresConfig, MySQLConfig, H2Config` plus a switch on `DatabaseConfig` in the wiring code is more robust than a `String type + Map<String, String>` configuration shape. Misconfigurations fail at startup with a typed error, not at first query.

For each of these, the rule is the same: the sealed root lives in *one* module with all its permits, and consumers in other modules exhaustively switch on it. ArchUnit can enforce "no two modules contribute permits to the same sealed type" mechanically.

---

## 8. Migration checklist for a legacy module

A short checklist when adopting sealed types in a pre-existing codebase.

- [ ] Identify candidate types: closed-set parents with several concrete children today and `instanceof` or `getClass()`-style dispatch.
- [ ] For each candidate, decide: seal now, seal later, or leave open. Document the call in a one-line ADR.
- [ ] Add `sealed` and `permits` to the parent. Mark every child `final`/`sealed`/`non-sealed`. Compile clean.
- [ ] Convert pure data carriers to `record`. Keep behaviour on the sealed parent if it's polymorphic; on the records if it's data-shaped.
- [ ] Rewrite `instanceof` chains to pattern switches, one method at a time. Drop `default`.
- [ ] Run any visitor-pattern infrastructure to dust and delete it.
- [ ] Wire ArchUnit rules: no `default` on sealed switches, no `non-sealed` in domain code, permits-stable check for published types.
- [ ] Tag every public sealed type with `@apiNote` describing the closure intent.
- [ ] For libraries: write a release note describing the new sealed types and the binary-compat policy for their permits.

This sequence is reviewable PR-by-PR. The intermediate states are valid Java; nothing forces you to convert the whole module at once.

---

## 9. Quick rules

- [ ] In review, name the decision (seal vs open, default vs exhaustive, sealed vs non-sealed). Avoid arguing about syntax.
- [ ] ArchUnit-enforce: no `default` on sealed switches, sealed types and their permits live in one module, `non-sealed` is reviewed individually.
- [ ] Teach `sealed` through the bug it fixes, not through the feature description.
- [ ] Don't seal SPIs. Seal application types where you own every variant.
- [ ] In libraries, every `permits` change is a major-version event. Plan a deprecation cycle.
- [ ] Migrate by phase: parent first, switches second, records third, visitor removal fourth.
- [ ] Don't write `default` for "safety" on a sealed switch. The compiler is the safety.
- [ ] Don't bundle disparate event types into one mega-sealed root. Split by bounded context.
- [ ] Guards are predicates. No side effects in `when` clauses.
- [ ] Treat the module-boundary rule for `permits` as a feature, not a limitation — it keeps closure local.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Sealed types and pattern matching, plain English                    | `junior.md`        |
| ADTs, record patterns, refactoring `instanceof` and visitor         | `middle.md`        |
| Closed-world dispatch, typeSwitch internals, binary compat          | `senior.md`        |
| JLS/JVMS/JEP references                                             | `specification.md` |
| Production hazards and runtime symptoms                              | `find-bug.md`      |
| Pattern-switch performance, JIT, JMH benchmarks                     | `optimize.md`      |
| Hands-on refactors                                                  | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

---

**Memorize this:** at team scale, sealed types are about *governance of closure*. You enforce mechanical rules in ArchUnit (no `default`, same-module permits, no `non-sealed` in domain code), reserve review attention for the judgement calls (seal vs open, when to add a permit), and treat published `permits` lists as API surface with a major-version policy for changes. Sealing is not a syntax preference; it is a decision about who owns the closed world and what happens when it grows.

# SOLID Principles — Senior

> **What?** The edge cases of SOLID: when each letter starts fighting cohesion, how behavioural subtyping really works, what dependency direction looks like at the architecture level, where CUPID and functional programming push back, and how to recognise codebases that *look* SOLID but aren't.
> **How?** By treating SOLID as five named forces to balance against each other and against cohesion, simplicity, and the actual change axes of your system — not as five rules to maximise.

---

## 1. SOLIDified to death

Every senior engineer has met the codebase that took SOLID literally and never recovered. Every domain entity has a `IXxxRepository`, `IXxxService`, `IXxxValidator`, `IXxxMapper`, `IXxxFactory`. Each interface has exactly one implementation. Every class has one method. The class diagram is a forest of arrows pointing at single-method interfaces. Finding "where does a thing actually happen" is a 6-hop trace through layers of indirection.

```java
// "SOLID" the way it goes wrong
public interface InvoiceTotalCalculator { BigDecimal total(Invoice i); }
public interface InvoiceTaxCalculator   { BigDecimal tax(Invoice i); }
public interface InvoiceDiscounter      { BigDecimal applyDiscount(BigDecimal base, Invoice i); }
public interface InvoiceRounder         { BigDecimal round(BigDecimal x); }

public final class DefaultInvoiceTotalCalculator implements InvoiceTotalCalculator {
    private final InvoiceTaxCalculator tax;
    private final InvoiceDiscounter    discount;
    private final InvoiceRounder       rounder;
    // ...four-line constructor, six-line method, zero clarity gained
}
```

This is *abstraction theater*. Every interface has one implementation, every implementation has one caller, and the only "polymorphism" lives in unit tests as mocks. You haven't decoupled anything — you've spread one cohesive computation across five files and made it harder to read.

The cure: an interface earns its keep when it has either (a) more than one *real* implementation in production, (b) a runtime swap requirement (e.g., for testing across an interesting boundary), or (c) a stable API consumed by code you don't own. Speculative interfaces without one of these get inlined.

---

## 2. SRP and team boundaries — Conway's Law

The crispest definition of SRP from Robert Martin himself is *"gather together the things that change for the same reason; separate the things that change for different reasons."* That sentence is really a Conway's Law statement: code structure mirrors team structure, because the *reasons code changes* are *the teams that request changes*.

Two practical consequences:

- **Don't split by technical layer; split by stakeholder.** A class that contains pricing rules and another that contains pricing storage are not violating SRP — they serve the same stakeholder (pricing team) at different concerns. Splitting them by team — pricing vs. catalogue vs. checkout — captures real change axes. Splitting "service" from "repository" within one team is layering, not SRP.
- **Watch class ownership.** If two teams keep touching the same class, SRP is wrong somewhere. The class either belongs to one team and the other should call through an API, or it should be split along the boundary the teams already enforce socially.

```java
// Splitting by stakeholder, not by layer
package pricing;        // owned by pricing team
public final class PriceCalculator { ... }

package billing;        // owned by billing team
public final class InvoiceIssuer { ... }
```

If you find yourself running `git log --pretty=format:%an` on a class and seeing seven different team members, SRP is telling you something — but it's also telling you something about your org chart.

---

## 3. OCP and the change axes you actually have

OCP is the most-overapplied letter, because *"closed for modification"* sounds like a virtue independent of context. It isn't. Closing a class against an axis costs design effort (often an interface, a factory, a registry, a strategy hierarchy). If that axis never changes, you've paid for nothing.

The honest question is: **what axes have actually changed in the last 12 months?** Look at the commit history. If you've added three payment methods, payments are an active axis — make them open/closed. If you've shipped one tax rule and never touched it again, leave the `switch` alone.

```java
// Honest OCP — only the axes that move get abstracted
public sealed interface PaymentMethod permits Card, Bank, ApplePay, GooglePay { }

public record Order(List<LineItem> items, TaxRegime regime) {
    // taxRegime is a switch — only two real regimes have ever shipped,
    // both encoded as enum cases. No strategy hierarchy needed.
    public BigDecimal taxAmount() {
        return switch (regime) {
            case STANDARD_VAT -> total().multiply(new BigDecimal("0.20"));
            case ZERO_RATED   -> BigDecimal.ZERO;
        };
    }
}
```

A `sealed` type plus exhaustive `switch` is OCP-respecting *in the right direction*: closed against arbitrary new tax regimes (which need legal review anyway), open in the form of explicit additions. You don't pay for a strategy hierarchy you don't need.

**Rule of thumb:** abstract on the second occurrence, generalise on the third. Pure speculation about future axes is the most expensive form of YAGNI violation.

---

## 4. LSP — behavioural subtyping in depth

Barbara Liskov's original 1987 statement is about *behavioural subtyping*: every property provable about objects of the supertype must hold for objects of the subtype. The Square/Rectangle example is the cartoon version. The real obligations are precise:

- **Preconditions** may not be *strengthened* in the subtype. If `parent.deposit(amount)` accepts any positive amount, a `subclass.deposit` that rejects amounts > 10,000 violates LSP — callers wrote against the parent's contract.
- **Postconditions** may not be *weakened*. If the parent guarantees the deposit is persisted before return, a subclass that queues it asynchronously breaks callers expecting durability.
- **Invariants** of the supertype must be preserved. A `Stack` invariant of *size never negative* must hold in every subclass.
- **History constraint:** the subtype must not allow state transitions the supertype forbids. An `ImmutablePoint` that subclasses `MutablePoint` violates this.

Java provides covariant return types (subclass may return a *more specific* type) and contravariant parameters (in theory — Java doesn't allow them in overrides, which is one reason `equals(Object)` is the only sane signature). Exceptions follow a similar rule: a subclass override may throw *fewer* or *more specific* checked exceptions, never broader ones.

```java
class Repository {
    public Order load(long id) throws SQLException { ... }
}
class CachingRepository extends Repository {
    @Override
    public Order load(long id) throws SQLException {       // LSP-safe: same exception
        // covariant return would let us declare an Order subtype if we had one
    }
    // throwing IOException here would not compile — and rightly so:
    // callers wrote `try { ... } catch (SQLException ...)` against the parent.
}
```

The runtime symptoms of LSP violation: `ClassCastException` deep in framework code, polymorphic calls that mysteriously throw `UnsupportedOperationException`, tests that pass against the parent and fail against a subclass passed through the same code path.

---

## 5. ISP at scale — client-specific facades vs role interfaces

In a service with twenty callers, ISP says don't give every caller a fat interface. But the cure can overshoot in two ways:

**Per-client facades** — one interface per caller — is the extreme. You end up with `OrderServiceForCheckout`, `OrderServiceForReturns`, `OrderServiceForAdmin`, each tracking one caller's exact needs. Coupling moves from API to interfaces, but you've now coupled *interfaces* to *callers*. New caller? New interface.

**Role interfaces** are the middle ground: name interfaces by the *role they play in a collaboration*, not by which caller uses them. The same `OrderReader` interface can serve checkout, returns, and admin if all three play the role of *reading orders*.

```java
// Role interfaces — defined by what the role does, not by who calls it
public interface OrderReader     { Order load(OrderId id); }
public interface OrderWriter     { void save(Order o); }
public interface OrderQuery      { List<Order> findRecent(CustomerId c, int limit); }

// One class can play multiple roles if cohesive
public final class JdbcOrderRepository
        implements OrderReader, OrderWriter, OrderQuery { ... }

// Callers depend on the narrowest role they need
public final class CheckoutFlow {
    private final OrderWriter writer;        // not the full repository
    public CheckoutFlow(OrderWriter writer) { this.writer = writer; }
}
```

Role interfaces let you have one implementation class (cohesion preserved) while each caller depends on a minimal surface (ISP preserved). They also make test mocks small.

---

## 6. DIP at the architecture level — hexagonal / ports and adapters

DIP at the class level is just constructor injection. DIP at the architecture level is *which direction does the codebase as a whole depend?* In a hexagonal (ports and adapters) architecture, the domain is the centre, and infrastructure adapts to it — not the other way around.

```
            +-------------------+
   HTTP --> |    PrimaryPort    | --> domain --> SecondaryPort --> Postgres
            |  (e.g. command)   |    (pure)    |  (e.g. repo)  |
            +-------------------+               +---------------+
```

Concretely in Java:

```java
// Domain (no infrastructure imports — JDK only, maybe a money library)
package shop.domain;
public final class Order { ... }
public interface OrderRepository {   // port owned by the domain
    void save(Order o);
    Optional<Order> find(OrderId id);
}

// Adapter (depends on the domain, not the other way round)
package shop.infrastructure.postgres;
import shop.domain.OrderRepository;
public final class PostgresOrderRepository implements OrderRepository { ... }
```

The dependency arrow points *inward*: `shop.infrastructure` depends on `shop.domain`, never the reverse. Enforce it: a module graph (JPMS) where `shop.domain` does not `requires` any infrastructure module is the strongest possible enforcement.

The payoff at architecture scale is much larger than at class scale. You can swap Postgres for DynamoDB, REST for gRPC, JDBC for R2DBC — all without touching domain code. The domain is the stable centre; everything else is replaceable cladding.

---

## 7. SOLID vs CUPID (Dan North)

In 2022 Dan North proposed **CUPID** as an explicit alternative — five *properties of joyful code* rather than five rules:

- **C**omposable — plays well with others
- **U**nix-philosophy — does one thing well
- **P**redictable — does what you expect
- **I**diomatic — feels natural in the language
- **D**omain-based — speaks the domain's vocabulary

CUPID's critique of SOLID is real: SOLID is *class-centric* and assumes OO with inheritance. CUPID is *outcome-centric* and language-neutral. Some mappings are clean (Unix-philosophy ~ SRP, Composable ~ DIP+OCP), but Idiomatic and Domain-based have no SOLID equivalent.

**When to lean SOLID:** large OO codebases, inheritance-heavy frameworks (Spring), teams trained in classical OO, code with many implementation variants.

**When to lean CUPID:** small services, functional or hybrid Java, domain-driven design contexts, code where "what does this feel like to use" matters more than "what does this class look like inside".

In practice senior engineers carry both vocabularies and pick the one that matches the smell. SOLID names class-level rot; CUPID names module-level rot.

---

## 8. SOLID in functional Java

The letters survive translation into the functional style, sometimes more elegantly:

- **SRP** — a pure function does one thing by construction; you can't accidentally add a side effect without changing the signature.
- **OCP** — higher-order functions are open for extension by passing different functions in.
- **LSP** — for functions, LSP collapses to *substitutability of function values with the same signature*, which is just type compatibility.
- **ISP** — `Function<A, B>` is the smallest possible interface. Lambdas naturally segregate.
- **DIP** — pass functions as parameters; no interfaces, no classes, no DI framework needed.

```java
// DIP without classes
public final class PaymentFlow {
    public Receipt pay(Charge c,
                       Function<Charge, AuthResult> authorize,
                       Consumer<Receipt> notify) {
        AuthResult auth = authorize.apply(c);
        Receipt r = Receipt.of(auth);
        notify.accept(r);
        return r;
    }
}

// In production:  flow.pay(c, stripe::authorize, kafka::send);
// In tests:       flow.pay(c, ch -> AuthResult.ok("test"), r -> {});
```

This is DIP — `PaymentFlow` doesn't depend on Stripe or Kafka — and ISP — each parameter is a one-method type — without a single interface declaration. Modern Java makes this idiom practical via lambdas and method references.

---

## 9. SOLID can fight cohesion

The dirty secret: applying every letter aggressively *reduces* cohesion. A class with one method is the SRP/ISP extreme, but ten such classes are harder to read than one cohesive class with ten methods that genuinely belong together.

Cohesion (Larry Constantine, 1974) is the older principle. **A module is cohesive when its parts belong together by purpose.** SOLID is one set of forces *on top of* cohesion — when SOLID and cohesion conflict, cohesion usually wins.

Symptoms of "SOLID overpowering cohesion":

- A package has 30 single-method classes that together implement one workflow.
- To understand a feature you read 12 files and assemble them mentally.
- A change touches the same five interfaces every time, in lockstep — that's a hidden cohesive unit fighting an artificial split.

When you see these, *recompose*. The fact that two interfaces always change together means they were one role pretending to be two.

---

## 10. Testing implications — what each letter actually buys

| Letter | What it gives the test suite |
|--------|------------------------------|
| **S** SRP | Small classes → small test files. A test failure points to one stakeholder concern, not a tangle. |
| **O** OCP | New behaviour → new test file. Old tests don't need to change when you add a `PaymentMethod`. |
| **L** LSP | One test against the *base contract* runs against every subclass. JUnit's parameterised tests + a `Stream<Repository>` of implementations catches LSP violations automatically. |
| **I** ISP | Tiny mocks. `Mockito.mock(OrderReader.class)` has one method to stub, not twelve. |
| **D** DIP | Test doubles replace real collaborators at construction time, no `PowerMock` or `@MockBean` reflection magic needed. |

The strongest test argument for DIP is the *integration boundary*: the moment a class talks to JDBC, Kafka, or the clock directly, that class can't be unit-tested without infrastructure. DIP across those boundaries makes unit testing possible at all.

```java
// LSP behavioural test — one suite, multiple implementations
@ParameterizedTest
@MethodSource("repositories")
void roundTripsAnOrder(OrderRepository repo) {
    Order o = Order.placed(...);
    repo.save(o);
    assertThat(repo.find(o.id())).contains(o);
}

static Stream<OrderRepository> repositories() {
    return Stream.of(new InMemoryOrderRepository(), new JdbcOrderRepository(testDs()));
}
```

If a new implementation passes this suite, it satisfies the *behavioural* contract — LSP enforced by the test harness, not just the type checker.

---

## 11. Anti-patterns and "fake SOLID"

Codebases that *claim* SOLID but aren't:

- **The Interface/Impl pair.** Every class `X` has `IX` and `XImpl`, one-to-one, forever. The interface has no second implementation and never will. This is *DIP cargo cult*, not DIP.
- **The God Service hiding behind interfaces.** A 4,000-line `OrderService` is split into `IOrderService` and `OrderServiceImpl`. SRP unaffected; you just made it harder to find.
- **The setter-injected anaemic domain.** Domain objects have only getters and setters; all behaviour is in services. SRP nominally satisfied, real cohesion destroyed. Behaviour belongs *near* its data.
- **The deep inheritance chain.** `AbstractBaseOrderProcessor` → `AbstractDomainOrderProcessor` → `AbstractValidatingOrderProcessor` → `OrderProcessor`. Every level violates LSP somewhere, and adding behaviour means picking the right superclass and praying. Composition beats this nine times in ten.
- **The reflection-heavy framework.** Everything is dynamically wired, "you don't need to think about dependencies". DIP nominally; in practice, runtime errors replace compile-time clarity.
- **The interface-per-method explosion.** `interface UserSaver`, `interface UserLoader`, `interface UserDeleter`, `interface UserCounter`. ISP taken to a parody. Just `UserRepository` with the four methods is fine.

The honest test: if you removed an interface and the code still compiled with a single rename, that interface was carrying no design weight.

---

## 12. Quick rules

- An interface earns its keep with either >1 production implementation, a swap-at-runtime requirement, or a stable external API contract.
- Split classes along change axes you can name from history, not axes you imagine.
- LSP is about contracts (preconditions, postconditions, invariants, exception types) — not about the type checker.
- Prefer role interfaces (named by collaboration role) over per-client facades (named by caller).
- Architecture-level DIP is hexagonal: domain at the centre, adapters at the edges, arrows pointing inward.
- When SOLID fights cohesion, cohesion usually wins; recompose.
- Functional Java applies SOLID without classes — lambdas are ISP-compliant DIP by construction.
- "Fake SOLID" is recognisable by 1:1 interface/impl pairs, anaemic domain, deep inheritance, and reflection-only wiring.

---

## 13. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Driving SOLID across a team, codebase metrics, ArchUnit     | `professional.md`  |
| Where SOLID-relevant rules live in JLS/JVMS                 | `specification.md` |
| Spotting silent SOLID violations and runtime symptoms       | `find-bug.md`      |
| JIT, dispatch, allocation: the cost of SOLID idioms         | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** SOLID is five named forces, not five commandments. Apply the letter that names the smell you see; balance each letter against cohesion and the actual change axes of your code. An interface without a second implementation, a hierarchy without a substitutability test, a "service" without behaviour — these are SOLID-shaped code that isn't SOLID. Hexagonal at architecture scale, role interfaces at module scale, behavioural contracts at class scale, lambdas at function scale: that's the senior toolkit.

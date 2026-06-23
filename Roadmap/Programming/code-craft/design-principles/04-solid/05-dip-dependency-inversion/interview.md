# Dependency Inversion Principle (DIP) — Interview Questions

> **Category:** [Design Principles → SOLID](../../README.md) — the fifth principle: depend on abstractions, not on concrete details, and let the high-level policy own the abstraction.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. State the two clauses of the Dependency Inversion Principle.

**Answer:** (a) High-level modules should not depend on low-level modules; **both should depend on abstractions.** (b) Abstractions should not depend on details; **details should depend on abstractions.** It's the "D" of SOLID, from Robert C. Martin.

### J2. What is the "inversion" in DIP? What gets inverted?

**Answer:** The **source-code (compile-time) dependency**, *not* the flow of control. At runtime the high-level policy still calls down into the low-level detail. But by inserting an abstraction the policy owns, the *import arrow* from the detail now points **up** toward the policy — opposite to the call direction. That backward-pointing source dependency is the inversion.

### J3. Who should own (define) the abstraction — the high-level or low-level module?

**Answer:** The **high-level module (the consumer/policy).** The interface expresses what the *policy* needs, so it lives in the policy's package. The low-level detail then implements it, which is exactly what makes the detail's dependency point upward. If the low-level module owns it, nothing is inverted.

### J4. Give the canonical Copy-program example.

**Answer:** A `copy` policy that reads chars from a source and writes to a sink. Un-inverted, it calls `read_keyboard()` and `write_printer()` directly — coupled to those devices. Inverted, it depends on `Reader` and `Writer` interfaces (owned by the policy); `Keyboard` and `Printer` implement them. New devices (`Disk`, `Network`) are new implementations; `copy` never changes.

### J5. What is a composition root?

**Answer:** The single place near the program's entry point (`main`) where concrete implementations are constructed and wired into the abstractions. It's the only place that knows the concrete types; everywhere else depends on abstractions.

### J6. Is injecting a concrete `PostgresClient` into a service an example of DIP?

**Answer:** **No.** That's dependency injection (you injected it) but **not** DIP — you still depend on a *concrete* type. DIP requires the declared dependency to be an **abstraction** (e.g., an `OrderRepository` interface).

### J7. Why does DIP make testing easier?

**Answer:** Because the policy depends on an abstraction, a test can inject a **fake/stub** implementation (a fake clock, in-memory repository, fake gateway) instead of the real database/network/SDK. The policy doesn't change; only the injected implementation does.

### J8. What's a one-line way to remember DIP vs DI vs IoC?

**Answer:** **DIP** = *what* to depend on (abstractions). **DI** = *how* you receive a dependency (supplied from outside). **IoC** = *who* calls whom (the framework calls you). DI is a means to DIP and a kind of IoC; none equals another.

---

## Middle Questions

### M1. Why doesn't merely adding an interface guarantee the dependency is inverted?

**Answer:** Because inversion depends on **ownership**. If the low-level provider defines the interface and the high-level policy imports it from the provider's package, the source arrow still points *down*. The inversion only happens when the **consumer owns** the interface (defines it in its own package) so the provider's dependency points *up*.

### M2. Distinguish DIP, DI, and IoC precisely.

**Answer:** **DIP** is a design *principle* — point source dependencies at abstractions. **DI** is a *technique* — supply collaborators from outside (constructor/setter) instead of constructing them inside. **IoC** is a broad *pattern* — the framework/runtime drives control flow and calls your code ("Hollywood Principle"). DI is *a* way to achieve DIP, and DI is *a kind of* IoC (inversion of *construction*), but IoC also covers control-flow inversion that has nothing to do with DI.

### M3. Why is a service locator considered an anti-pattern compared to DI?

**Answer:** It **hides** dependencies: a class's constructor no longer reveals what it needs — it *pulls* collaborators from a global registry inside its body. That couples every class to the locator (a global singleton), makes tests configure global state, and turns missing wiring into runtime failures instead of compile/construction-time ones. DI *pushes* dependencies in, keeping them visible and fakeable.

### M4. When should you prefer setter injection over constructor injection?

**Answer:** Only when the dependency is genuinely **optional** or must be **reconfigured at runtime**. Constructor injection is the default — it makes dependencies explicit and guarantees a fully-formed object; setter injection permits half-constructed objects with `null` collaborators.

### M5. Do you need a DI container to follow DIP?

**Answer:** No. Hand-wiring constructors at `main` is full DI and full DIP. A container *automates* the composition root (DI + IoC of construction) and helps with large graphs and lifecycles, but it's optional — and misused (e.g., `context.getBean(X)` in business code) it becomes a service locator that *violates* the spirit of DIP.

### M6. What is clause 2 ("abstractions don't depend on details") really guarding against?

**Answer:** **Leaky abstractions.** If a `PaymentGateway` interface mentions `StripeToken` or returns a `StripeCharge`, the abstraction depends on a vendor detail — swapping to PayPal now forces an interface change. A clean port speaks only domain terms (`charge(Card, Money) -> Receipt`), so any vendor can implement it without changing the contract.

### M7. How does DIP relate to Ports and Adapters / Hexagonal architecture?

**Answer:** It *is* DIP at architectural scale. The application core defines **ports** (DIP abstractions it owns) for everything it needs from outside; **adapters** (DB, payment, HTTP) implement or drive those ports and depend *inward* on the core. Clean Architecture's Dependency Rule — source dependencies point only inward toward policy — is DIP generalized to layers.

---

## Senior Questions

### S1. Precisely, which two graphs does DIP relate, and how?

**Answer:** The **runtime call graph** (flow of control), which always points high→low because policy uses mechanism, and the **compile-time dependency graph** (source imports). Without DIP the two are parallel (policy imports the mechanism it calls). DIP **inverts the compile-time edge at chosen boundaries** by inserting a policy-owned abstraction, so the mechanism's source edge points *up*, opposite the call. DIP decouples the compile-time graph from the runtime graph at boundaries.

### S2. Give a case of DI without DIP and DIP without DI.

**Answer:** **DI without DIP:** `new Service(new PostgresClient())` — you injected, but the declared dependency is a *concretion*, so DIP is violated. **DIP without (classic) DI:** a Go function `func Copy(r Reader, w Writer)` depends on abstractions via parameters with no injection framework or ceremony. This shows DIP is the goal (what you depend on) and DI is one tactic to supply it.

### S3. "Depend on abstractions, not concretions" — so should every concrete dependency be wrapped in an interface? Justify.

**Answer:** No. The rule is really **don't depend on volatile concretions; depend toward stability — and abstractions are stable.** You depend on `String`, value types, and the standard library directly because they're stable. You invert across **volatile boundaries** (a vendor SDK, your database). Wrapping every lone, stable, single-implementation class in an interface is **interface-per-class dogma** — indirection that decouples nothing and doubles edit/navigation cost. Volatility across a boundary is the trigger, not abstraction for its own sake.

### S4. How does DIP relate to the other four SOLID principles?

**Answer:** DIP is the structural move the others converge on. It **enables OCP** (an abstraction the policy depends on is what lets you add behavior without modifying the policy — DIP is the lever, OCP the goal). Its abstractions must obey **ISP** (small, client-shaped ports, not fat interfaces). It **relies on LSP** (every injected implementation must be truly substitutable, or the policy breaks). And it **exposes SRP** violations (over-injection = too many responsibilities; fix by splitting, not hiding params).

### S5. Where should the abstraction physically live, and what are the options?

**Answer:** Default: **the consumer's package** (domain owns the port; infra implements it; domain compiles standalone). Alternative: a **Separated Interface** — the port in its own neutral module both sides depend on, used when multiple consumers share it or package hygiene forbids the adapter depending on the full domain. **Provider-owned** interfaces (shipped with the implementation, imported downward) are *not* DIP unless the provider is a stable published abstraction (e.g., SLF4J).

### S6. What's the over-abstraction failure mode of DIP, and how do you recognize it?

**Answer:** **Interface-per-class.** Tells: a one-implementation interface whose method set is *identical* to its sole implementor (a "header interface"); navigation that always goes interface→impl→interface; adding a method edits two files in lockstep; "I need it to mock my own pure logic." It's indirection without decoupling. The cure is the volatility heuristic: invert across real boundaries and second-implementation seams; stay concrete elsewhere; extract the port the day a real reason appears.

---

## Professional Questions

### P1. How do you enforce DIP in code review?

**Answer:** Two questions, catching both failure modes. For concrete coupling: *"This use case imports the SDK directly — what port should it depend on, and where does that port live?"* For speculative abstraction: *"What second implementation, test seam, or boundary justifies this interface?"* Plus the ownership check (consumer-owned, not provider-owned) and the clause-2 check (no vendor types in the port). "It's more flexible" is a red flag, not a justification.

### P2. How do you detect DIP violations mechanically?

**Answer:** With **architecture tests** — ArchUnit (Java), dependency-cruiser/ts-arch (TS), import-linter (Python), deptrac (PHP), NetArchTest (.NET). Assert "`..domain..` must not depend on `..infra..` / driver / SDK packages." This makes the dependency direction a **build-time invariant**, catching under-application automatically. A complementary lint can flag single-impl/identical-signature interfaces as over-application candidates (a hint, not a hard gate).

### P3. How do you refactor a legacy service that `new`s its database/SDK inside its methods?

**Answer:** (1) **Characterize** behavior with tests first. (2) **Extract a consumer-owned port**, trimmed to the policy's actual needs and re-typed in domain terms. (3) **Parameterize the constructor** — replace in-method `new` with a constructor param of the port type (the seam). (4) **Move the `new` to the composition root.** (5) **Enforce** the new direction with an architecture test. One boundary per PR, behind tests, never a big-bang rewrite.

### P4. A teammate adds an interface and says "now it follows DIP." What do you check?

**Answer:** Three things: **ownership** (is the interface in the consumer's package, or did they put it in infra and import it downward — DIP theater?), **second side** (is there a real second implementation/test seam/boundary, or is it a one-impl header interface?), and **clause 2** (does the port leak vendor/persistence types?). Adding an interface ≠ inverting a dependency.

### P5. Why is `applicationContext.getBean(X)` inside a service a problem even though it returns an abstraction?

**Answer:** It's a **service locator** — the service *pulls* its dependency from a global container instead of declaring it in the constructor. The dependency is hidden from the signature and the compiler, every class is coupled to the container, and a missing registration fails at **runtime in production** rather than at construction/startup. Constructor injection makes the dependency visible and the failure early.

### P6. Real cost of *under*-applying DIP at a vendor boundary?

**Answer:** A vendor SDK is a volatile detail across a boundary. If domain code calls it directly in hundreds of places and you must switch vendors (compliance, pricing, deprecation), the migration becomes a high-risk rewrite of business logic that has nothing to do with the vendor. A port owned by the domain localizes the change to one adapter. DIP here is cheap insurance against a costly, irreversible-ish migration.

---

## Coding Tasks

### C1. Invert the dependency (Java).

**Before** — high-level policy welded to a concrete detail:

```java
class InvoiceService {
    private final SmtpEmailClient email = new SmtpEmailClient(); // concrete
    void sendInvoice(Invoice inv) {
        email.send(inv.customerEmail(), inv.render());
    }
}
```

**After** — policy owns a domain-shaped port; detail implements it; wired at the root:

```java
interface InvoiceNotifier { void notify(Invoice inv); }      // owned by policy

class InvoiceService {
    private final InvoiceNotifier notifier;
    InvoiceService(InvoiceNotifier notifier) { this.notifier = notifier; } // ctor injection
    void sendInvoice(Invoice inv) { notifier.notify(inv); }
}

class EmailInvoiceNotifier implements InvoiceNotifier {      // adapter, depends UP
    private final SmtpEmailClient email;
    EmailInvoiceNotifier(SmtpEmailClient email) { this.email = email; }
    public void notify(Invoice inv) { email.send(inv.customerEmail(), inv.render()); }
}
// main: new InvoiceService(new EmailInvoiceNotifier(new SmtpEmailClient()));
```

State: the policy no longer names SMTP; the SMTP detail points up at the policy-owned port.

### C2. Spot DI-without-DIP and fix it (Python).

```python
# DI but NOT DIP — injected a concretion:
class PricingService:
    def __init__(self, db: PostgresClient):     # concrete type
        self.db = db

# DIP — depend on an owned abstraction:
class PriceTable(Protocol):                     # owned by the policy
    def rate_for(self, sku: str) -> Money: ...

class PricingService:
    def __init__(self, prices: PriceTable):     # abstraction
        self.prices = prices
# A PostgresPriceTable implements PriceTable; an InMemoryPriceTable fakes it in tests.
```

Reasoning: same injection technique; only the second depends on an *abstraction*, so only the second is DIP.

### C3. Make a port detail-free (clause 2) (TypeScript).

**Before** — the "abstraction" leaks a vendor type:

```typescript
interface PaymentGateway {
  charge(token: StripeToken, cents: number): Promise<StripeCharge>; // leaks Stripe
}
```

**After** — domain types only, so any vendor can implement it:

```typescript
interface PaymentGateway {
  charge(card: Card, amount: Money): Promise<Receipt>;   // domain-pure
}
class StripeGateway implements PaymentGateway {
  async charge(card: Card, amount: Money): Promise<Receipt> {
    const c = await stripe.charges.create({ /* translate at the edge */ });
    return Receipt.fromStripe(c);                        // translate back to domain
  }
}
```

### C4. Remove a header interface (Go / pseudocode).

**Before** — one-implementation interface with an identical method set, no boundary:

```go
type UserService interface{ Register(u User) error }   // 1 impl, ever
type userService struct{}
func (userService) Register(u User) error { /* pure logic */ return nil }
```

**After** — use the concrete; extract the interface only when a 2nd impl / test seam / boundary is real:

```go
type UserService struct{}                               // concrete
func (UserService) Register(u User) error { /* pure logic */ return nil }
// No interface needed: pure logic, one implementation, no external boundary.
// Go's structural typing lets you add an interface later WITHOUT touching this.
```

State the caveat: if `Register` called an external system you needed to fake, *that* boundary would justify a port — but not the pure logic itself.

### C5. Sketch a composition root (any language, pseudocode).

```text
main():
    pgPool      = new PostgresPool(DSN)
    orderRepo   = new PgOrderRepository(pgPool)        # adapter
    gateway     = new StripeGateway(new StripeClient(KEY))  # adapter
    notifier    = new EmailNotifier(new SmtpMailer(HOST))   # adapter
    placeOrder  = new PlaceOrder(orderRepo, gateway, notifier)  # inject abstractions
    serve(placeOrder)
# Only main() names concrete types. PlaceOrder depends on ports alone.
```

---

## Trick Questions

### T1. "DIP and Dependency Injection are the same thing." True?

**False.** DIP is a *principle* (depend on abstractions); DI is a *technique* (supply collaborators from outside). DI is *a* way to achieve DIP, but you can do DI while *violating* DIP (inject a concrete class) and achieve DIP without classic DI (interface parameters / structural typing). They're related, not equal.

### T2. "DIP inverts the flow of control." Correct?

**No.** DIP inverts the **source-code dependency**, not the flow of control. The high-level policy still *calls* the low-level detail at runtime; only the compile-time import arrow flips (the detail now depends up on the policy-owned abstraction). Inverting *control flow* is **IoC**, a different concept.

### T3. "Following DIP means every class should have an interface." Agree?

**No.** That's interface-per-class dogma. DIP targets **volatile dependencies across boundaries**. A one-implementation interface with an identical method set and no boundary (a header interface) decouples nothing and doubles edit/navigation cost. Depend on stable concretions directly; extract a port when a real second side or boundary appears.

### T4. "I added an interface, so the dependency is now inverted." Always true?

**No.** Inversion depends on **ownership**. If the interface lives in the low-level provider's package and the policy imports it from there, the arrow still points *down* — nothing inverted (DIP theater). The consumer must *own* the interface.

### T5. "A clean `PaymentGateway` interface that returns a `StripeCharge` satisfies DIP." Right?

**No.** That violates clause 2 — the abstraction depends on a *detail* (a Stripe type). The import was inverted but the *types* leak the vendor, so you can't actually swap implementations. Ports must speak domain types.

### T6. "Use a service locator — it returns abstractions, so it's just DI." Correct?

**No.** A service locator *pulls* dependencies from a global, hiding them from the constructor signature, coupling everything to the locator, and turning missing wiring into runtime failures. DI *pushes* dependencies in, keeping them visible. The locator is widely considered an anti-pattern.

---

## Behavioral Questions

### B1. Tell me about a time you decoupled business logic from an external system.

**Sample:** "Our domain called the AWS S3 SDK directly everywhere it stored files. When compliance forced an on-prem store, the migration touched ~300 business files and was high-risk. I led introducing a `FileStore` port owned by the domain, with S3 and on-prem as adapters, and added an ArchUnit test forbidding SDK imports in the domain. The next storage change was localized to one adapter. The lesson I quote: a vendor SDK is a volatile boundary — exactly what DIP is for."

### B2. Describe a time abstraction *hurt* a codebase.

**Sample:** "A team had mandated an interface per service and repository — ~400 one-implementation header interfaces. Navigation went interface→impl→interface, every method addition edited two files, and not one interface ever got a second implementation. I added a lint for single-impl/identical-signature interfaces and we inlined the ones with no boundary, keeping ports only at real boundaries. Edit and navigation cost dropped sharply. The lesson: DIP is justified by a real second side, not by the interface keyword."

### B3. How do you push back when someone adds a speculative interface?

**Sample:** "I ask one non-confrontational question: 'What's the second implementation, test seam, or boundary that justifies this?' If the answer is 'it's more flexible later,' I suggest the concrete type now and extracting a port the day a real reason appears — citing our 'no one-impl interfaces' convention so it's a standard, not my opinion. I frame using the concrete as the simpler, more senior choice."

### B4. When did you choose *not* to invert a dependency?

**Sample:** "A teammate wanted to wrap a pure date/formatting utility behind an interface 'for DIP.' I pushed back: it's stable, single-implementation, internal, with no boundary — inverting it adds a hop and decouples nothing. We depend on volatile things across boundaries (DB, payments) behind ports, and on stable internal logic directly. Knowing *where not* to invert is as much DIP as knowing where to."

### B5. How do you keep dependency direction correct across many teams over time?

**Sample:** "Make it a build-time invariant. We have a written rule (domain imports no driver/SDK/framework), ports owned by consumers, a 'no one-impl interfaces' convention, and — crucially — ArchUnit tests that fail the build if the domain imports infrastructure. A diagram nobody enforces gets violated within weeks, one reasonable import at a time. The architecture test is the enforcement."

---

## Tips for Answering

1. **Lead with the two clauses** and immediately clarify that the **source dependency** inverts, **not** the flow of control.
2. **Nail the ownership point:** the *consumer* owns the abstraction — that's what makes the arrow flip.
3. **Keep DIP / DI / IoC airtight:** DIP = what to depend on; DI = how you receive it; IoC = who calls whom. DI is a means to DIP and a kind of IoC; none equals another.
4. **Show you know DI-without-DIP** (injecting a concretion) — it's the fastest senior signal.
5. **Apply the volatility heuristic:** invert volatile details across boundaries; don't wrap every class in an interface.
6. **Mention clause 2 / leaky ports:** inverting the import isn't enough — the *types* crossing the port must be domain-pure too.
7. **For enforcement, name architecture tests** (ArchUnit / dependency-cruiser / import-linter) — DIP is a machine-checkable invariant.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)

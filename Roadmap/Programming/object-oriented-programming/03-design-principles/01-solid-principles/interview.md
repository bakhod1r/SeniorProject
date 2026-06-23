# SOLID Principles — Interview Q&A

20 questions covering each letter plus integration: definitions, trade-offs, snippet critiques, and senior-level judgement calls.

---

## Q1. What does SOLID stand for, and who coined it?

SOLID is an acronym for five class-level design principles: **S**ingle Responsibility, **O**pen/Closed, **L**iskov Substitution, **I**nterface Segregation, and **D**ependency Inversion. Robert C. Martin ("Uncle Bob") assembled and popularised the set in the early 2000s, drawing on earlier work — OCP from Bertrand Meyer, LSP from Barbara Liskov, DIP from his own *Agile Software Development* book. The acronym itself was coined by Michael Feathers. Treat SOLID as a vocabulary for naming structural smells, not a religion.

**Follow-up:** "Which letter do you find most often violated in production?" — most candidates say SRP or DIP; defend your answer with a real example.

---

## Q2. Explain SRP. What exactly is a "reason to change"?

A class should have one, and only one, reason to change — meaning **one stakeholder concern** that, when it shifts, forces edits to this class. "Stakeholder" can be a team, a regulator, a vendor, or an external system. If your `Invoice` class is edited by the accounting team when tax rules change *and* by the design team when the PDF layout changes, it has two reasons to change. The fix is to split: domain logic in `Invoice`, rendering in `InvoicePdfRenderer`. SRP is about *axes of change*, not method count.

**Trap:** Candidates often define SRP as "one method per class" or "small classes". Neither is correct — a `TaxCalculator` with twenty methods serving one stakeholder still respects SRP.

---

## Q3. Critique this snippet from an SRP standpoint.

```java
public class UserRegistration {
    public void register(String email, String password) {
        if (!email.contains("@")) throw new IllegalArgumentException();
        String hash = BCrypt.hashpw(password, BCrypt.gensalt());
        jdbcTemplate.update("INSERT INTO users(email, hash) VALUES (?, ?)", email, hash);
        mailer.send(email, "Welcome!", "Thanks for joining.");
        analytics.track("user_registered", email);
    }
}
```

This class is edited by at least four teams: validation rules (security), password hashing (security/crypto), persistence (data), email content (marketing), and analytics (product). Each is a separate reason to change. Extract `EmailValidator`, `PasswordHasher`, `UserRepository`, `WelcomeMailer`, and `AnalyticsTracker`; `UserRegistration` becomes an orchestrator that depends on those abstractions. The class shrinks from "does everything" to "decides the order things happen in" — a legitimate single responsibility.

**Follow-up:** "Could you take this too far?" Yes — splitting `email.contains("@")` into its own `EmailFormatValidator` class adds noise without a real change axis.

---

## Q4. Explain OCP. Give an example where it pays off.

Open/Closed says entities should be **open for extension, closed for modification** — you should add new behaviour without editing existing, tested code. The canonical example is a payment processor that handles different payment methods. With a switch on `type`, every new method (Apple Pay, crypto, BNPL) edits the same class, risking regressions in credit-card flow. Replace the switch with a `PaymentMethod` interface and polymorphism: adding Apple Pay means writing a new class, not touching `PaymentProcessor`.

```java
public interface PaymentMethod { void charge(BigDecimal amount); }
public class PaymentProcessor {
    public void pay(PaymentMethod m, BigDecimal amount) { m.charge(amount); }
}
```

**Trap:** OCP doesn't mean "freeze the source forever". Bug fixes and refactoring still edit existing code. OCP applies to *additions of new variants* along a predictable axis.

---

## Q5. Is "closed for modification" absolute?

No — it's an aspiration along *predicted* axes of change, not a universal ban on edits. If you build an extension point for every conceivable future variant, you'll create an unusable maze of abstractions (Speculative Generality). The honest version of OCP is: identify the one or two axes where variants will multiply (payment methods, report formats, currencies), and design those axes to be closed for modification. Everything else is fair game to edit. Bertrand Meyer himself acknowledged that closure is relative — you close against the changes you can anticipate.

**Follow-up:** "How do you decide what to anticipate?" Look at change history — git log reveals which classes get edited repeatedly along the same axis.

---

## Q6. Explain LSP. Why is Square-Rectangle a classic failure?

LSP says **subtypes must be substitutable for their base types without altering correctness**. A caller using `Rectangle` should not be able to tell, at runtime, that they got a `Square`. The Square-Rectangle case fails because `Rectangle.setWidth(w)` is independent of `setHeight(h)` — but in `Square`, setting width forces height to match. Code like `r.setWidth(5); r.setHeight(4); assert r.area() == 20;` passes for `Rectangle` and fails for `Square`. Mathematically a square *is* a rectangle, but behaviourally these types have different contracts, so inheritance is the wrong tool — prefer composition or a shared `Shape` abstraction.

**Trap:** Saying "Square should not extend Rectangle because geometry differs". The real reason is behavioural: the contract of independent setters is broken.

---

## Q7. Can a subclass throw a new checked exception that the parent didn't declare?

No — Java's compiler forbids it, and that aligns with LSP. The parent's contract promises certain checked exceptions; callers handle exactly those. If a subclass declares a new checked exception, callers written against the parent type wouldn't catch it, breaking substitutability. Java enforces this syntactically: an override may declare *fewer* or *more specific* checked exceptions, but not new ones. Runtime exceptions are unchecked, so technically you *can* throw a new `RuntimeException` — but doing so still violates LSP semantically if it surprises callers.

```java
class Parent { void op() throws IOException { } }
class Child extends Parent {
    @Override void op() throws SQLException { } // compile error
}
```

**Follow-up:** "What about narrowing — throwing a subtype of the declared exception?" That's allowed and LSP-respecting.

---

## Q8. Explain ISP. How is it different from "one method per interface"?

ISP says **clients should not be forced to depend on methods they do not use**. A `MultifunctionDevice` interface with `print`, `scan`, `fax`, `email` forces a pure printer to implement methods it can't honour (often by throwing `UnsupportedOperationException`). Split by *the role each caller plays*: `Printer`, `Scanner`, `Fax`. A device that does all three implements all three; a pure printer implements only `Printer`. ISP is about **role cohesion**, not method count — a `UserRepository` with `save`, `findById`, `delete`, `count` is one role (storing users) and shouldn't be shattered into four interfaces.

**Trap:** Over-segregating into `IUserSaver`, `IUserDeleter`, `IUserFinder` produces interface fatigue with no behavioural benefit.

---

## Q9. Explain DIP. What is "inversion" actually referring to?

The "inversion" reverses the natural direction of source-code dependency. Without DIP, a high-level `OrderService` would `import` and instantiate a low-level `PostgresOrderRepository` — the policy depends on the detail. DIP says: introduce an `OrderRepository` interface owned by the domain layer; the Postgres class *implements* that interface. Now the arrow at compile time points *from* the database adapter *to* the domain abstraction — inverted relative to the runtime call. Both high-level and low-level modules depend on the abstraction; details depend on policy, not the other way around.

**Follow-up:** "Who owns the interface — domain or infra?" The domain. That ownership is what gives the inversion its meaning.

---

## Q10. Is DIP the same as using a DI container like Spring?

No — they're related but distinct. **DIP** is a design principle: depend on abstractions, not concretes. **Dependency Injection (DI)** is a technique: receive collaborators from outside (constructor, setter) rather than constructing them yourself. A **DI container** (Spring, Guice, Dagger) is a runtime tool that wires DI for you. You can satisfy DIP with plain constructor injection and no container — pass `OrderRepository` to `OrderService`'s constructor in `main`. You can also misuse a container and still violate DIP (e.g., injecting a concrete class everywhere). DIP is the *why*; DI is the *how*; the container is convenience.

**Trap:** Equating "I use `@Autowired`" with "I follow DIP". Field injection of a concrete type satisfies neither cleanly.

---

## Q11. Critique this snippet for DIP.

```java
public class CheckoutService {
    private final PostgresOrderRepository repo = new PostgresOrderRepository();
    private final SmtpMailer mailer = new SmtpMailer("mail.example.com");

    public void checkout(Cart cart) {
        Order o = repo.save(cart.toOrder());
        mailer.send(cart.email(), "Order confirmed", "Thanks!");
    }
}
```

Three DIP violations: (1) `CheckoutService` depends on concrete `PostgresOrderRepository` and `SmtpMailer`; (2) it constructs them itself (`new ...`), so tests can't substitute fakes; (3) the SMTP host is hard-coded in the constructor call. Replace with `OrderRepository` and `Mailer` interfaces, inject via constructor, configure the concrete adapters in a composition root. Tests now use `InMemoryOrderRepository` and a recording `Mailer`; production wires real ones. The class becomes ignorant of where data goes and how mail leaves.

**Follow-up:** "Is there ever a case for `new` inside a class?" Yes — value objects (`new Money(...)`), local helpers, things that aren't dependencies.

---

## Q12. When can you intentionally violate SOLID?

When the cost of the abstraction exceeds the cost of duplication or coupling — usually in three situations. **One:** the violation lives behind a stable boundary nobody else touches (a 30-line throwaway script). **Two:** the predicted change axis never materialised, and the abstraction is now dead weight (YAGNI applies — remove the interface). **Three:** performance demands inlining (a hot loop where virtual dispatch costs measurable percent). Senior engineers don't apply SOLID dogmatically; they ask "what does this principle buy me here, and what does it cost?" Knowing when to skip a principle is as important as knowing when to apply it.

**Trap:** "I violated SOLID for clarity" is rarely the real reason — usually it's "I didn't think about it." Be honest about which.

---

## Q13. Compare SOLID and CUPID. What's the pitch for CUPID?

Dan North proposed CUPID in 2022 as a successor: **C**omposable, **U**nix-philosophy, **P**redictable, **I**diomatic, **D**omain-based. Where SOLID is class-shaped and prescriptive ("a class should..."), CUPID is property-shaped and aspirational ("code should feel..."). CUPID's strength is that it emphasises *what good code is like to work with* rather than mechanical rules, and it dodges SOLID's tendency to over-abstract. SOLID's strength is that it's concrete and testable in code review — you can point at a switch statement and say "OCP". They're not mutually exclusive; many teams cite both.

**Follow-up:** "Which would you teach a junior first?" Usually SOLID — the concreteness helps until intuition develops.

---

## Q14. How do records and sealed types support SOLID in modern Java?

**Records** give you SRP for free at the data layer: their single responsibility is to carry a tuple of values. They're immutable, final, and auto-generate `equals`/`hashCode`/`toString` — no accidental responsibility creep. **Sealed interfaces** enable a different OCP idiom: instead of unbounded polymorphism, you list permitted subtypes and the compiler checks exhaustiveness in pattern matches. You decide upfront what variants exist, and adding one *is* a deliberate edit (so it's not OCP in the open sense), but every consumer is forced to handle it. Both features push SOLID adherence into the type system rather than relying on discipline.

```java
sealed interface Shape permits Circle, Square, Triangle { }
record Circle(double r) implements Shape { }
```

**Follow-up:** "When do sealed types violate OCP?" When you have many independent consumers — exhaustiveness pain doesn't scale.

---

## Q15. Walk me through refactoring a 200-line `OrderHandler` toward SOLID.

Start with **SRP** — list the responsibilities by reading method names: validation, pricing, tax, persistence, email, audit logging. Each is a candidate class. Extract one at a time, starting with the cleanest seam (often persistence). After each extract, the original shrinks and tests stabilise. Next pass: **DIP** — identify constructors that `new` concretes (DB, mailer); introduce interfaces, inject via constructor. Now check **OCP**: are there switch statements on `OrderType`? Replace with polymorphism. **LSP** and **ISP** usually fall out naturally — small focused classes implement narrow interfaces and rarely break substitutability. Don't try to score all five letters in one pass; one targeted extraction per commit keeps the diff reviewable.

**Trap:** "Rewrite from scratch." Tempting, almost always wrong — incremental refactoring keeps tests honest.

---

## Q16. How does SOLID interact with frameworks like Spring and JPA?

Frameworks make some letters easy and others harder. **DIP** is natural in Spring: `@Component` plus constructor injection of interfaces gives you textbook DIP with minimal ceremony. **OCP** benefits from Spring's pluggable beans — register a new `PaymentMethod` bean and the processor picks it up. But **SRP** suffers when entities accumulate JPA annotations, validation annotations, JSON annotations, and lifecycle callbacks — the class now answers to ORM, validation framework, and serialiser. **LSP** can break when JPA proxies behave subtly differently from the entity (lazy loading throws, `equals` quirks). The pragmatic move: keep entities thin (data + invariants), put orchestration in services injected via constructor, isolate framework concerns at the edges.

**Follow-up:** "What about field injection (`@Autowired` on fields)?" Avoid it — breaks DIP testability (can't construct without the container) and hides dependencies.

---

## Q17. Should every dependency be wrapped in an interface?

No. Interfaces have a cost: an extra file, indirection during reading, friction during refactor. Wrap dependencies that **cross an interesting boundary** — database, network, message bus, external API, clock, randomness — because those are exactly the ones you want to swap for tests or future migrations. Don't wrap value types, JDK utilities, or internal helpers that never need substitution. An `IString` or `IClock` *might* be useful (Java does ship `Clock` as a swappable abstraction for testing), but `IListUtils` is noise. The rule: ask "would I ever want a second implementation of this?" If no, no interface.

**Trap:** "Defensive interfaces just in case" — they ossify the API and rarely pay off; YAGNI applies.

---

## Q18. Explain LSP and covariant return types.

Java allows an overriding method to return a **subtype** of the parent's declared return — that's covariant returns. It's LSP-compatible because any caller written against the parent's return type can still use the subtype (substitutability in the other direction). The classic example is `clone()`: `Object.clone()` returns `Object`, but a subclass can override to return its own type, removing the cast.

```java
class Animal { Animal copy() { return new Animal(); } }
class Dog extends Animal {
    @Override Dog copy() { return new Dog(); } // covariant, LSP-safe
}
```

The reverse — covariant *parameters* — would violate LSP, and Java disallows it. You can only override with the same parameter types (not subtypes).

**Follow-up:** "What about generics and `List<? extends Number>`?" That's PECS — related but covers variance at the type-parameter level, not method signatures.

---

## Q19. When does SOLID lose to performance?

When virtual dispatch, allocation, or indirection appears in a hot loop and profiling proves it matters. A polymorphic `PaymentMethod.charge` is fine for a checkout (called once per order); the same idiom inside a per-tick game engine or a per-packet network filter can cost noticeable CPU. Specific anti-cases: deep abstraction chains where the JIT can't inline through megamorphic call sites; defensive copies (DIP-adjacent) that allocate millions of times per second; over-segregated interfaces that prevent escape analysis. The principled answer is **measure first** — modern JITs inline monomorphic and bimorphic dispatch nearly for free, so most "SOLID is slow" claims are folklore. When measurement shows a real cost, denormalise that hot path and document why.

**Trap:** Premature de-abstraction "for performance" is the most common over-correction; profile before you compromise design.

---

## Q20. What is the "SOLID checklist" anti-pattern?

The anti-pattern is treating SOLID as five boxes to tick on every class — score five out of five and ship. Symptoms: a tiny project with twenty interfaces all having one implementation; abstract factories building abstract builders; getters and setters around immutable records; comments like `// SRP-compliant`. The result is **structural noise** that obscures intent and makes navigation painful, without paying back in any real change axis. SOLID's value is *contextual* — apply the letter that names the smell you're seeing today, not all five to every class. A class that has none of the smells doesn't need any of the principles applied prophylactically.

**Follow-up:** "How do you spot this in review?" Look for interfaces with one implementor, factories that wrap one constructor, and tests that need ten mocks for one assertion — those are the tells.

---

**Use this list:** rotate one question from each letter plus integration topics (Q1, Q12, Q14, Q15, Q19). Strong candidates apply SOLID as judgement, not ritual — they can name when *not* to follow a principle and back the choice with a concrete trade-off.

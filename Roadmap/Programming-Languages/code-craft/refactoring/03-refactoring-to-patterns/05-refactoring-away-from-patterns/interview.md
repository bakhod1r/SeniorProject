# Refactoring Away From Patterns — Interview Questions

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016).

These questions probe *judgment*, not pattern trivia. A weak answer recites a pattern's definition; a strong answer reasons about *fit* — when structure earns its keep and when it's pure cost. Model answers below.

---

### 1. When is a design pattern over-engineering?

A pattern is over-engineering when you pay its structural cost but never collect its benefit. The benefit of every pattern is to *absorb a specific kind of change* — Strategy absorbs new algorithms, Factory absorbs new product types, Decorator absorbs new optional behaviors, Observer absorbs new listeners. If that change isn't happening — one implementor, one product, one always-on decorator, one synchronous listener — the pattern is structure with no payoff: extra files, extra indirection, extra concepts to learn, for flexibility nobody uses.

The decisive test is: *what change does this pattern make easier, and does that change actually occur?* If you can name the change and it's real and recurring, it's earning its keep. If you can't name it, or it's purely imagined ("we might need…"), it's over-engineering — speculative generality. The fix isn't "avoid patterns"; it's matching the structure to the variation that actually exists, in both directions: add the pattern when the variation arrives, remove it when the variation leaves.

---

### 2. Explain the "wrong abstraction" tax. Why did Sandi Metz say duplication is cheaper?

The wrong-abstraction tax is the compounding cost of an abstraction that doesn't fit the real cases. Metz's sequence: someone extracts an abstraction from duplication; new requirements *almost* fit, so people add a parameter or flag inside it rather than rework it; repeat until the abstraction is a tangle of conditionals doing subtly different things per caller. Now it's used everywhere and is terrifying to change, so people add *more* flags instead of fixing it — the tax compounds.

"Duplication is far cheaper than the wrong abstraction" because duplication is *honest and local*: each copy says exactly what it does, and changing one doesn't risk the others. The wrong abstraction is *dishonest and global*: it claims the cases are the same when they've diverged, and every change risks every caller. Duplication's cost is visible and bounded; the wrong abstraction's cost is hidden and compounding.

Her recovery advice is the part most people miss: don't fix the tangle in place — **re-inline it back into each caller**, resolve each caller's flags to concrete code, delete the dead branches, and look at the honest duplication fresh. The *right* abstraction (often smaller, often different) becomes visible once the real cases sit side by side. The sunk cost of the existing abstraction is irrelevant; only the forward cost matters.

---

### 3. What's the Rule of Three, and how does it apply to removing patterns?

The Rule of Three: don't abstract on the first occurrence (it's a method), resist on the second (two points don't reveal the abstraction's true shape), and abstract on the third, when you have enough real cases to see what genuinely varies. It guards against premature abstraction driven by *one imagined* future case.

For removal, run it backward: a pattern's seam justified by three real variations can lose that justification when variations are deleted. If two of three strategies get removed, the Strategy interface now wraps one algorithm — it's reverted to over-engineering and should be inlined. The rule formalizes that abstractions aren't permanent: the right structure tracks the *current count of real variations*, and that count moves both up and down.

---

### 4. How do you safely remove a Singleton?

First, separate the two things a Singleton bundles: *uniqueness* (one instance) and *global static access* (`getInstance()` reachable from anywhere). The uniqueness is sometimes a real requirement; the global access is the part that hurts — it hides dependencies and breaks tests (you can't substitute a different instance, and statics leak between tests).

The removal is **Inline Singleton**, turning global access into an explicit, injected dependency:

1. Add a constructor parameter on each consumer for the formerly-global object.
2. Thread the instance in from the outside — work from leaf consumers toward the composition root (`main` / DI container), converting one caller at a time.
3. Run tests after each caller; keep green.
4. When no code calls `getInstance()`, delete it and the static field; make the constructor public.
5. Create the single instance once at the composition root and inject it. "Single instance" becomes a wiring fact, not a class-enforced law.

Safety: have characterization tests around behavior first; go caller-by-caller; watch for code relying on lazy-init ordering. If uniqueness is genuinely required (a process-wide pool), keep one instance — just inject it instead of exposing global access.

---

### 5. Why is "one implementation behind an interface" often a smell?

Because the interface's entire value is *polymorphism* — supporting more than one implementation — and with exactly one implementor there's nothing to polymorph. You pay the interface's costs (an extra type, a navigation hop on every read, change amplification when a method signature changes) for flexibility no one uses. It's textbook speculative generality, usually a reflex from over-reading "always code to an interface."

But — and the interviewer wants this nuance — one production implementor does *not* automatically mean remove. Keep it when: (a) a *test fake* is the second implementor and that seam is how you test; (b) it's a *port* crossing an architectural boundary (Hexagonal/Clean), so the interface encodes a dependency-direction rule the domain owns; or (c) it's a *published API / plugin point* others implement. If none of those hold and there's no imminent second implementor, collapse the interface into the concrete class. The smell is the *speculative* one-implementor interface, not every one-implementor interface.

---

### 6. YAGNI versus future-proofing — how do you decide?

They're not opposites; they're a cost comparison. YAGNI says: don't build for needs you only imagine, because the carrying cost of unused structure (reading, onboarding, change-amplification) is paid *now and continuously*, while the need may never arrive — and if it does, it usually arrives in a shape different from what you guessed, so your speculative structure is the *wrong* structure anyway.

Future-proofing is justified only when the cost of *adding* the flexibility later is genuinely high — irreversible decisions, public API contracts, data schemas/migrations, wire formats. There, the asymmetry favors thinking ahead because retrofitting is expensive or breaking.

The deciding question: *how cheap is it to add this later?* For most in-process code — a Strategy, a Factory, an interface — adding it later is a cheap, mechanical, reversible refactor (you have the IDE, the tests, and now the *real* requirement to shape it). So defer: YAGNI wins. For a published API or a database schema, later is expensive and breaking, so invest up front. Reversibility is the axis.

---

### 7. A teammate says "we should always code to interfaces, never to concrete classes." How do you respond?

I'd agree with the *intent* (decoupling, testability) and push back on the *absolutism*. "Always" turns a useful heuristic into pattern fever: an interface for every class, most with one implementor, each adding a type and a hop for zero variation. The principle behind the slogan is the [Dependency Inversion Principle](../../../design-principles/) — depend on abstractions *for the dependencies that are volatile or that you need to substitute*, not for every collaborator.

Concretely: introduce an interface when there's real or imminent polymorphism, when it's a test seam you actually use, or when it's a boundary you're deliberately protecting. For a stable, single-implementor collaborator with no test-substitution need, the concrete class *is* the right dependency. Coding to interfaces everywhere isn't "more decoupled" — it's more *indirect*, and indirection without payoff is a cost, not a virtue.

---

### 8. How do you tell essential complexity (keep the pattern) from accidental complexity (remove it)?

Essential complexity is inherent in the *problem* — a tax system genuinely has many jurisdictions and rules; no design removes that, you can only model it honestly, and patterns like Strategy are the right tool to organize it. Accidental complexity is what *we* added through *how* we built it — a Strategy for one algorithm, a plugin system for one plugin, a rules engine for three `if`s.

A practical test: explain the abstraction to a domain expert. If they'd nod — "yes, discounts really do come in those kinds" — it reflects an essential distinction; keep it. If they'd be baffled — "why four classes for one fixed rule?" — it's accidental; it's a removal candidate. When you remove a pattern you're asserting "the domain doesn't actually vary here," so you'd better understand the domain. That's why these calls belong to people who know the problem, not to whoever is most pattern-enthusiastic.

---

### 9. You inherit a service split into a microservice "for scalability" that has never needed to scale. Is that over-engineering, and what would you do?

It's over-engineering at the architectural grain — a pattern (the service boundary) that isn't earning its keep. The boundary charges network latency, serialization, partial-failure handling, deployment complexity, and distributed debugging, in exchange for independent scaling and deployment the system has never used. It's the same judgment as inlining a single-impl Strategy, just bigger and riskier.

But the risk asymmetry is real, so I'd be careful, not reflexive. I'd verify there's no *other* reason for the split (team ownership boundaries, independent release cadence, a different scaling profile that's coming) — Chesterton's Fence. If the boundary genuinely buys nothing today, the de-abstraction is to merge it back into the monolith, sequenced like any risky change: characterization/integration tests at the kept boundary, merge behind a flag, shadow-compare in production, soak, then delete the old service. "Right-size to the requirements that actually exist" cuts both ways — you can collapse a premature boundary just as you'd add a justified one.

---

### 10. Removing an abstraction feels like deleting a colleague's good work. How do you handle that, technically and socially?

Technically: the sunk cost of the existing abstraction is irrelevant — only the *forward* cost of keeping versus removing it matters. If it carries high interest (reading hops, mandatory mocks, change amplification) and near-zero chance of being needed, it's a bad loan to pay off, regardless of how good the original work was.

Socially: I lead with evidence, not aesthetics. "This is over-engineered" starts a fight; "this interface has one implementor, forces a mock in 14 tests, adds a hop on every read, and in two years no second implementor appeared" is a case. I make removal *reversible* and say so out loud — "it's in git; re-adding it is a 20-minute mechanical change if a real second case shows up" — which dissolves the loss-aversion that keeps dead abstractions alive. I respect Chesterton's Fence by finding out *why* it exists before proposing removal. And I pilot one removal so the team can see the simpler code with unchanged behavior before generalizing. A demonstrated win converts skeptics faster than a design doc.

---

### 11. What's a characterization test, and why is it the right safety net for pattern removal?

A characterization test pins down what code *currently does* — not what it should do — so you can change structure without changing behavior. You write a deliberately-wrong assertion, run it, read the real value from the failure, and assert that. Now the test documents reality.

It's the right net for removal because removal is behavior-preserving by definition: after you inline the Singleton or collapse the Decorator, the public results and visible side effects must be identical, and the characterization test enforces exactly that. The key discipline is to characterize at the boundary you'll *keep* — the public method's result, the observable side effect — *not* at the seam you're deleting. A test that mocks `DiscountStrategy` tests the wiring you're removing and will break uselessly; a test that asserts `cart.total() == 4500` survives the removal and catches any real regression.

---

### 12. Give a case where you'd *defend keeping* a single-implementor abstraction against a junior who wants to delete it.

A `PaymentGateway` interface with one `StripeGateway` implementor, where the interface is the *port* in a Hexagonal architecture and the domain depends on it so it never imports the Stripe SDK directly. Even with one implementor, this interface earns its keep three ways: it enforces the dependency direction (domain doesn't depend on infrastructure), it's the seam our domain tests use with an in-memory fake gateway, and payment providers are genuinely the kind of thing that gets a second implementor (add PayPal, swap to Adyen). Deleting it would let Stripe types leak into the domain and break the fast domain tests.

I'd use it to teach the distinction: the smell isn't "one implementor," it's "one implementor *and* no test seam *and* no boundary *and* no imminent second case." Here, three of those justifications hold, so we keep it. The discipline cuts both ways — knowing when *not* to remove is as important as knowing when to.

---

### Back to the topic

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md)
- [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)

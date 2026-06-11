# Refactoring Toward Structural Patterns — Interview Q&A

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Model answers for the structural-refactoring questions that come up in senior interviews and design reviews. Each answer is written to be *said out loud* in two minutes: a crisp claim, a reason, and a concrete example or trade-off. The strongest candidates always tie the pattern back to the **smell that justified it** — patterns as destinations, not decorations.

---

### 1. Decorator vs. inheritance — when do you reach for each?

**Answer.** Inheritance fixes behavior at compile time and combinations explode multiplicatively: `Window`, `WindowWithBorder`, `WindowWithScrollbar`, `WindowWithBorderAndScrollbar`... `N` independent options need up to `2^N` subclasses. Decorator turns that into `N` wrapper classes you stack at runtime — additive, not multiplicative — and lets you add/remove behavior dynamically. I reach for Decorator when behaviors are *optional, combinable, and may vary at runtime* (I/O stream filters are the canonical case). I keep inheritance when the set of combinations is small and closed, or when I need to extend the *type* (add fields/methods), which a decorator can't do because it hides the concrete type behind the component interface. The refactoring trigger is flag soup: `if (withBorder) ... if (withScroll) ...` inside one class is the smell that says "move embellishment to Decorator."

---

### 2. When is Composite the right model — and when is it overkill?

**Answer.** Composite fits when you have a **part-whole hierarchy** and you want clients to treat individual objects and groups **uniformly** — a file system, a UI widget tree, a nested order, an AST. The win is that operations (`size`, `render`, `price`) recurse polymorphically with no `if (isLeaf)` checks. It's overkill when the "tree" is always flat or fixed-depth, when leaf and branch share almost no behavior (forcing a fake common interface), or when single-vs-group genuinely behave differently as a *business rule* rather than as accidental duplication. The smell that justifies it is either a hand-rolled tree with type flags (*Replace Implicit Tree with Composite*) or methods that fork on single-vs-collection everywhere (*Replace One/Many Distinctions with Composite*).

---

### 3. Distinguish Adapter, Facade, and Proxy. They all "wrap" something.

**Answer.** All three put an object in front of another, but their *intent* differs:
- **Adapter** changes the **interface**: it makes an existing class fit an interface the client expects (incompatible → compatible). One adaptee, translated.
- **Facade** changes the **surface area**: it hides a whole *subsystem* of many classes behind one simple entry point. The subsystem's interfaces are fine; there are just too many of them and clients shouldn't wire them by hand.
- **Proxy** keeps the **same interface** and controls **access/lifecycle**: lazy creation, authorization, caching, remoting. Same contract as the subject, but it gatekeeps.

One-liner: Adapter *converts*, Facade *simplifies*, Proxy *guards*. Decorator, by contrast, keeps the interface and adds *features* — Proxy and Decorator share structure but Proxy's intent is access control, Decorator's is enrichment.

---

### 4. When does a Decorator chain become unreadable, and what do you do about it?

**Answer.** It degrades when the stack is deep (more than ~3–4 layers), when the *order* is significant but invisible at the call site, or when callers can build illegal orderings (`new Buffer(new Encrypt(...))` vs. `new Encrypt(new Buffer(...))` mean different things). The fix is *Encapsulate Composite/Decorator with Builder*: a fluent builder that owns the legal orderings and exposes intent-named steps — `StreamBuilder.from(raw).compress().encrypt(key).buffer().build()`. The builder makes invalid stacks unrepresentable and reads top-to-bottom. If even that doesn't help because one *combination* is both hot and permanent, I collapse that specific combination into a single class and keep decorators only for the varied paths.

---

### 5. Bridge vs. Strategy — they look identical in code.

**Answer.** Structurally both are "an object holding a pluggable collaborator," but the intent and scale differ. **Strategy** swaps **one algorithm** behind a single operation — a `SortStrategy`, a `PricingPolicy`; it's behavioral and the host has *a* behavior it delegates. **Bridge** decouples **two whole hierarchies** that vary independently — shapes × renderers — so each axis grows separately; it's structural and *both* sides are expected to become families. My test: if only one side varies and it's a single algorithm, it's Strategy. If I see an `M × N` class explosion because two dimensions are tangled in one inheritance tree, it's Bridge. I refactor *to* Bridge when I observe that explosion, not speculatively.

---

### 6. What's the "transparent vs. safe" trade-off in Composite?

**Answer.** *Transparent* means child-management methods (`add`, `remove`, `getChildren`) live on the shared component interface, so clients treat leaf and branch identically — but a leaf must then refuse `add()` at runtime (throw, or no-op), which is a Liskov-ish wart. *Safe* means those methods live only on the composite/branch type, so the compiler prevents `leaf.add(...)` — but clients sometimes have to type-check or downcast to manage children. GoF and Kerievsky both note there's no free lunch: you choose uniformity-with-runtime-risk or type-safety-with-downcasts. I lean transparent when uniform treatment is the whole point and leaf-add is an obvious programmer error; safe when calling `add` on a leaf would be a damaging, easy-to-make mistake.

---

### 7. How does Visitor relate to Composite, and what does adding it cost?

**Answer.** A Composite with many *unrelated* operations bloats the component interface and spreads unrelated concerns across node classes (a pricing method living in a UI node). Visitor moves each operation into its own object; nodes expose one `accept(visitor)`. This flips the expression problem: with operations-as-methods, adding a **node type** is cheap and adding an **operation** is expensive; with Visitor it's the reverse — new operations are cheap (one visitor), new node types are expensive (edit every visitor). So I add Visitor only when **operations vary faster than node types** — a stable AST with a growing set of passes is the textbook fit. The cost is that visitors reach into node internals, weakening encapsulation, so the visited state must be deliberately exposed and stable.

---

### 8. A junior wraps an existing class in a Decorator that filters some calls and it breaks clients. What happened?

**Answer.** The decorator violated the **component contract** even though it "implements the interface." Implementing an interface is necessary but not sufficient — the decorator must honor the *behavioral* contract (Liskov). If `read()` promises "returns -1 at EOF" and the decorator returns `0` on a slow read, or a rate-limiting decorator returns partial data where the contract promised a full buffer, every client written to the contract breaks. The fix is to define the decorator's added behavior so it *strengthens or preserves* the postconditions, never weakens them — and to test the decorated object against the same contract tests as the bare component.

---

### 9. You're integrating three payment providers with different APIs. Walk me through the refactoring.

**Answer.** The naïve version has one client switching on a `version` flag inside every method — cents-vs-dollars and return-code-vs-result-object quirks bleed everywhere. I apply *Extract Adapter*: define the target `Gateway` interface the client wants, then write **one adapter per provider** (`LegacyGatewayAdapter`, `ModernGatewayAdapter`, ...), moving each `if`-branch into the matching adapter where it translates that provider's quirks. The client then holds a single `Gateway` and the version flag disappears — polymorphism replaces the conditionals. Provider #4 is a new adapter with zero edits to the client. I'd *not* do this if there were only one provider that's stable — then a couple of private translation methods beat a ceremony of interfaces.

---

### 10. When should you Adapter vs. just rewrite the client to call the class directly?

**Answer.** Adapter when I *don't own* the class (third-party), when several adaptees must look alike behind one interface, or when I want the client testable against a clean seam. Rewrite the client when I own both sides, there's exactly one adaptee, and the interfaces will stay aligned — then the Adapter is pure indirection with nothing behind it. An Adapter earns its keep when there's more than one thing on its far side, or it crosses a real ownership/stability boundary. An adapter that exists only to paper over a method name I could rename is dead weight that *Refactoring Away From Patterns* would later remove.

---

### 11. How do you decide between a Virtual Proxy (lazy load) and just constructing eagerly?

**Answer.** Lazy via Proxy when the object is *expensive* to build and *often not used* — a 50 MB image or a DB connection that most requests never touch. The proxy defers the cost to first use. The catch is the **first-access latency spike**: the unlucky first caller pays the full bill, which is bad on a latency-sensitive path — there I'd warm the proxy off the hot path instead. I'd also flag thread-safety: the `if (real == null) real = build()` is a race, so a real implementation needs a holder idiom or `AtomicReference`. If the object is cheap or almost always used, eager construction is simpler and avoids the spike and the concurrency machinery.

---

### 12. When is Flyweight worth it, and how do you justify it with numbers?

**Answer.** Flyweight pays when you have a huge population of objects whose *intrinsic* (immutable, shareable) state has few distinct values — millions of glyphs over ~100 characters. I split state into intrinsic (pooled, shared) and extrinsic (passed per call, e.g. position). I justify it by measuring: `N` objects × per-object bytes without it, versus `K` pooled objects (`K ≪ N`) with it. A 5M-glyph document over ~300 distinct glyphs drops glyph memory from ~160 MB to kilobytes — verified with a heap dump, not assumed. The trade is memory-for-CPU: every acquisition is a pool lookup, and a synchronized factory can become a contention hotspot, so I use a concurrent pool. It's *not* worth it when the objects are mostly distinct (`K ≈ N`) — no sharing, only the lookup tax.

---

### 13. When would you *remove* a structural pattern you previously added?

**Answer.** When I'm paying its indirection cost but not using its flexibility, and a profiler shows the cost is material. Concretely: a Decorator that's the only wrapper ever applied, sitting in a 60fps loop; a Composite that's always exactly one level deep; a Bridge whose second axis never gained a second member; a Proxy whose access control never triggers. I inline it back out — fold the decorator into the component, fold the adapter into the client — because the future variation it anticipated didn't arrive. The discipline is that I inline based on a *measurement plus an unused-flexibility observation*, keeping it reversible, never as a blanket "patterns are over-engineering" reflex. The pattern was correct when the variation was plausible.

---

### 14. What's the single biggest enabler of all these structural refactorings?

**Answer.** A **narrow, role-based, stable interface**. Every structural move requires it: a Decorator must delegate every method (so a fat interface makes wrappers painful and tempts no-op methods), a Composite leaf must implement every method, a Proxy must be a drop-in for the subject. If clients depend on `Image` rather than `RealImage`, I can slip in a Proxy or Decorator with zero client changes; if they depend on the concrete class, *no* structural refactoring is possible without touching every caller first. So the real skill is interface design — structural refactorings are interface refactorings in disguise.

---

### 15. Give an example where Facade and Adapter are confused, and how you'd tell them apart in a design review.

**Answer.** Someone introduces a `PaymentFacade` that wraps a single `StripeClient` and renames its methods to match the app's vocabulary. That's mislabeled — it's an **Adapter** (one subject, interface translation), not a Facade. A true **Facade** sits in front of *many* collaborators — say `RiskEngine`, `Ledger`, `Notifier`, `FraudCheck` — and offers one `placeOrder()` that orchestrates them in the right order, so clients stop reaching deep into the subsystem. My review test: count the things behind it. One subject with a converted interface is Adapter; a *subsystem* of several classes hidden behind a simpler front is Facade. Getting the name right matters because it signals intent to the next maintainer.

---

## Next

- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md)
- [tasks.md](tasks.md) — Hands-on exercises.
- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.

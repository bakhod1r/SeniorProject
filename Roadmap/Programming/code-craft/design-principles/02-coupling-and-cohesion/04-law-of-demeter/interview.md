# Law of Demeter — Interview Questions

> **Category:** [Design Principles](../../README.md) — the Principle of Least Knowledge: a method should talk only to its immediate collaborators, never reach through them into a stranger's internals.

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

### J1. State the Law of Demeter in one sentence.

**Answer:** *Only talk to your immediate friends; don't talk to strangers.* A method should call methods only on nearby objects — not reach through one object into another. It's also called the **Principle of Least Knowledge.**

### J2. Where did it come from?

**Answer:** Northeastern University, 1987, by **Ian Holland** and **Karl Lieberherr** during the **Demeter Project** (about building adaptive software — named after the Greek goddess of agriculture / "growth"). It's a style guideline, not a literal law.

### J3. List the four kinds of object a method may legally call methods on.

**Answer:** Inside method `M` of object `O`: (1) `O` itself (`this`/`self`), (2) `M`'s parameters, (3) objects `M` creates/instantiates, (4) `O`'s direct component objects (its own fields). **Not** objects *returned* by any of those calls.

### J4. What is a "train wreck"?

**Answer:** A long chain like `a.getB().getC().getD().doSomething()`. Each dot past the first reaches into a new, deeper object (a stranger), so the caller becomes coupled to the shape of an object graph it shouldn't know about.

### J5. Why is each dot past the first a problem?

**Answer:** Each one leaks structural knowledge into the caller — "an Order has a Customer has an Address has a City." The method now depends on every relationship in the chain and breaks if any of them changes, even though it only wanted one value.

### J6. What is "Tell, Don't Ask"?

**Answer:** Instead of *asking* an object for its data and acting on it yourself, *tell* the object to do the work. Push behavior to where the data lives. It's the positive counterpart to LoD — if you tell your friend to do the job, you never reach through it to a stranger.

### J7. Explain the Paperboy-and-Wallet example.

**Answer:** **Violation:** the paperboy does `customer.getWallet().subtractMoney(due)` — reaching into the customer's wallet and taking cash himself, coupling `Paperboy` to `Wallet`. **Fix:** `customer.pay(due)` — tell the customer to pay; the wallet becomes the customer's private business. Now the paperboy doesn't know a wallet exists.

### J8. Is `builder.a().b().c()` a Law of Demeter violation?

**Answer:** **No.** That's a fluent interface — each call returns *the same object* (`this`). You keep talking to one immediate friend; no structural knowledge leaks. It only *looks* like a train wreck.

### J9. What's a delegation (wrapper) method?

**Answer:** A small method on object A that forwards a request to A's internal collaborator (e.g., `order.shippingCity()` calls `customer.shippingCity()`), so callers ask A instead of reaching past it.

### J10. Does the Law of Demeter mean "never write more than one dot"?

**Answer:** No — that's a *smell detector*, not the rule. The real rule is "don't reach through an object into its hidden internals." Fluent interfaces and data-structure traversal can have many dots and be perfectly fine.

---

## Middle Questions

### M1. What's the single distinction that decides most LoD questions?

**Answer:** **Objects vs. data structures.** LoD protects *encapsulation* — an object hides behavior behind its data, so reaching through it breaks that. A data structure (DTO, record, map, parsed JSON, config tree) has no behavior to hide; its shape *is* its contract, so chaining through it is fine. LoD applies to objects, not data structures.

### M2. Precisely, how does a fluent interface differ from a train wreck?

**Answer:** A **fluent interface** returns *the same type* (or a peer of it) at each step — you keep addressing one collaborator and configure/transform it (builders, streams, `Optional`, immutable date math). A **train wreck** returns a *new, deeper* object at each step — you navigate an ownership graph and leak its shape. Count *types crossed*, not dots.

### M3. Why shouldn't you wrap a DTO in delegation methods?

**Answer:** A DTO's entire purpose is to *expose* its fields for transport — it has no behavior to encapsulate. Wrapping it protects nothing, fights its purpose, and hurts readability. LoD doesn't apply to data structures.

### M4. What is the Middle Man smell, and how does LoD cause it?

**Answer:** A **Middle Man** is a class whose methods do nothing but forward to a single collaborator. Over-applying LoD — wrapping every getter behind a delegating method — bloats a class into a forwarding shell, trading structural coupling for interface bloat. Delegate to hide a *real behavioral* dependency, not reflexively.

### M5. How is a train wreck related to Feature Envy?

**Answer:** Both are *behavior living far from the data it operates on*. A train wreck reaches out to distant data; Feature Envy is a method obsessed with another object's data. The cure is the same: move the behavior to the data (Tell, Don't Ask) — which fixes both.

### M6. Give a case where chaining is correct despite many dots.

**Answer:** `config["database"]["replica"]["host"]` (data structure), `stream.filter(p).map(f).collect(toList())` (fluent), `response.data.user.address.city` (parsed DTO), `date.plusDays(3).withHour(9)` (immutable value math). None reaches through a behavior-hiding object.

### M7. What does LoD cost, and why is it a heuristic rather than a law?

**Answer:** It costs **delegation/wrapper methods**, which can bloat interfaces into Middle Men. Because that cost can outweigh the benefit (e.g., chaining through data, or short local chains), LoD is a judgement call — apply it to behavioral coupling through objects, skip it for data and fluent chains.

---

## Senior Questions

### S1. What does LoD actually reduce, in connascence terms?

**Answer:** It **localizes connascence.** A train wreck makes the caller connascent (of name and type) with *every* type in the chain, often across module boundaries — non-local, expensive connascence. Collapsing it to `a.answer()` makes each connascence local (only `A` with `B`, `B` with `C`). Connascence is cheaper when local, so LoD matters most when the chain crosses module/team boundaries and least for short local chains.

### S2. When is the delegation cure worse than the train-wreck disease?

**Answer:** When delegation (a) bloats a class into a **Middle Man**, (b) merely *hides* coupling without removing it (`order.customerCreditLimit()` still gives `Order` knowledge it shouldn't own), or (c) scatters logic across delegators so the *system* is harder to read than the explicit chain. Clarity and "fewest elements" outrank LoD — don't add a wrapper that obscures more than the chain it replaces. Allow the chain when it's local, shallow, through stable data structures.

### S3. How can you "obey" LoD and make coupling worse?

**Answer:** By passing whole objects so the chain hides inside a helper — e.g., `feeFor(order)` instead of the chain. The helper now has "one dot" but is **stamp-coupled** to all of `Order`; changing `Order`'s structure still breaks it. The real fix passes the minimal *value* (`Country`) — data coupling, the loosest kind. LoD and "pass the value, not the container" are the same concern.

### S4. What's the root cause of train wrecks, and what's the durable fix?

**Answer:** **Leaky encapsulation** — objects exposing their internal collaborators via getters (`getCustomer()`, `getWallet()`). Each getter is an invitation to a train wreck. The durable fix isn't to wrap every chain (whack-a-mole) — it's to **eradicate the leaky getter and expose behavior instead**, making the train wreck structurally unwritable. Treat repeated violations as an encapsulation defect, not a calling-style defect.

### S5. How does LoD interact with functional / data-oriented code?

**Answer:** Functional style deliberately uses *transparent* immutable data and free functions over it — the opposite of "hide data, expose behavior." Chaining through transparent immutable data (`pipe(getCustomer, getCity)`) isn't an LoD violation, because there are no hidden internals to protect. LoD is an OO-encapsulation principle; it weakens to near-irrelevance in a data-oriented style. Apply it to the OO regions, relax it in the functional ones — the same objects-vs-data line at the paradigm level.

### S6. How does Tell-Don't-Ask interact with Command-Query Separation?

**Answer:** They can tug against each other: "tell" suggests *commands*, while CQS says commands shouldn't return values. The reconciliation: ask the object to **compute and return** (a query) instead of handing you its parts — `order.total()` honors both LoD (no reaching) and CQS (computes without mutating). Tell-Don't-Ask is about *who does the work*, not about forcing mutating commands.

### S7. At system scale, where does LoD apply and where doesn't it?

**Answer:** LoD applies **strongly** in the behavior-rich domain core; it **does not** apply in DTO/API boundary layers, persistence records, config trees, or view models — those are data. The architectural job is keeping objects and data structures in *distinct regions* (mappers, anti-corruption layers) so "may I chain here?" is answerable. An anemic domain model blurs this and invites both train wrecks and homeless behavior.

---

## Professional Questions

### P1. How do you enforce LoD in review without being dogmatic?

**Answer:** Don't count dots. Ask one targeting question per chain: *"Is this reaching through an object into hidden internals, and is that relationship expensive to change?"* Flag only real domain-object navigation. **Say nothing** about DTOs, config, fluent builders, and streams — flagging those burns trust and gets your reviews ignored. Precision is the whole job.

### P2. Can you lint for LoD? What are the limits?

**Answer:** Partially. PMD's `LawOfDemeter` exists but is **notoriously noisy** — it flags streams, builders, `Optional`, and DTOs unfiltered, so it gets disabled. The fix is a **type-aware** rule that only flags chains crossing *distinct domain types* (not fluent same-type), plus an **allowlist** for fluent/data packages. Even better, use **git change-coupling** (files that change together) — it surfaces the *real* structural coupling without false-positiving on fluent code.

### P3. How do you refactor a legacy train wreck safely?

**Answer:** Characterization tests **first** (pin behavior *and* null cases). Then **Hide Delegate** one hop at a time (`a.getB().doX()` → `a.doX()` forwarding `b.doX()`), tests green between hops; migrate callers; delete the now-unused getter so the wreck is unwritable. Watch for creating a **Middle Man** (then *Remove Middle Man* instead). Do it opportunistically as you touch files — never a "remove all chains" sweep.

### P4. What's the reliability (not just style) argument for LoD?

**Answer:** Deep getter chains multiply **null-failure points** — `order.getCustomer().getAddress().getCity()` has three places to NPE, and the stack trace can't say which link was null. Collapsing to `order.shippingCity()` **localizes null/error handling** to the object that owns each relationship, which can decide what a missing link means. LoD localizes failure-handling decisions, not just coupling.

### P5. A teammate "fixed" train wrecks by passing whole objects into helpers. Good?

**Answer:** No. The helpers now have "one dot" but are **stamp-coupled** to the whole object — changing its structure still breaks them. The coupling was renamed, not removed. The fix is to pass the minimal values the helpers actually use. (Static analysis going green here is a false signal.)

### P6. Why is an unfiltered LoD linter a mistake?

**Answer:** It floods reviews with false positives on streams, builders, `Optional`, and DTOs; developers suppress them reflexively, lose respect for the rule, and disable it within a sprint. You end up enforcing *dogmatism*, not the principle. Calibrate to the codebase's fluent/data patterns (type-aware + allowlist) before rolling it out.

---

## Coding Tasks

### C1. Fix the train wreck with Tell, Don't Ask (Python).

**Before:**

```python
def discount_rate(order):
    return order.get_customer().get_membership().get_tier().rate()
```

**After:**

```python
def discount_rate(order):
    return order.discount_rate()           # ask one friend

class Order:
    def discount_rate(self):
        return self._customer.discount_rate()      # forward one hop
class Customer:
    def discount_rate(self):
        return self._membership.discount_rate()    # forward one hop
```

State: the caller now depends only on `Order`; the `Customer → Membership → Tier` shape is hidden behind one-step delegations.

### C2. Identify which of these violate LoD (Java).

```java
a) order.getCustomer().getAddress().getCity();                 // ?
b) new StringBuilder().append("x").append("y").toString();    // ?
c) config.get("db").get("host");                              // ?
d) stream.filter(p).map(f).collect(toList());                 // ?
e) response.data.user.address.city;                          // ?
```

**Answer:** Only **(a)** violates LoD — it navigates distinct *domain objects* (`Order → Customer → Address → City`). (b) and (d) are **fluent** (same type each step). (c) and (e) traverse **data structures** (a map; a parsed DTO) — no encapsulation to protect.

### C3. The Paperboy and Wallet (Java).

**Before (violation):**

```java
Wallet w = customer.getWallet();
if (w.getTotal() >= due) { w.subtract(due); paid(due); }
```

**After (tell, don't ask):**

```java
Payment p = customer.pay(due);          // the customer handles their own wallet
if (p != null) paid(p.amount());
```

State: `Paperboy` no longer knows a `Wallet` exists; swap it for a card or app and the paperboy is unchanged.

### C4. Spot the disguised coupling (Python).

```python
# "LoD-clean" — only one dot inside — but what's wrong?
def fee(order):
    return rate_table[order.customer.address.country]
```

**Answer:** It's *still* a train wreck (`order → customer → address → country`) — one statement, three hops through objects. And if "fixed" by passing `order` to a helper, that helper becomes **stamp-coupled** to all of `Order`. Right fix: `fee(order.shipping_country())` where `Order` resolves its own country; `fee(country)` depends on one value (data coupling).

### C5. Eradicate the getter, don't wrap the chain (TypeScript).

**Before:**

```typescript
class Account { getCustomer(): Customer { return this.customer; } }
// callers: account.getCustomer().getTier().priceFor(item)   // train wreck everywhere
```

**After:**

```typescript
class Account {
  priceFor(item: Item): Money { return this.customer.priceFor(item); }  // behavior, no getter
}
// account.getCustomer() no longer exists → the train wreck is unwritable.
```

State: removing the leaky getter is the root-cause fix; wrapping each call site individually is whack-a-mole.

---

## Trick Questions

### T1. "Any chain with more than one dot violates the Law of Demeter." True?

**False.** Dot-counting is a smell detector with false positives. Fluent interfaces (`builder.a().b().c()`, returning the same object) and data-structure traversal (DTOs, config, parsed JSON) can have many dots and be perfectly fine. The rule is "don't reach through an *object* into its hidden internals" — count *types crossed*, not dots.

### T2. "LoD applies to all chaining, including DTOs and config maps." Right?

**No.** LoD applies to **objects** (which hide behavior), not **data structures** (which expose data). A DTO/config/map/JSON has no encapsulation to protect — chaining through it is correct, and wrapping it in delegation creates a Middle Man that protects nothing.

### T3. "I fixed the train wreck by passing the whole object to a helper." Decoupled?

**No.** You traded a train wreck for **stamp coupling** — the helper now depends on the whole object's structure. The coupling was renamed, not removed. Pass the minimal value the helper actually needs (data coupling).

### T4. "A fluent builder with ten dots is worse than a train wreck with two." Agree?

**No.** The builder (ten dots, same object) leaks zero structural knowledge and is fine; the two-dot train wreck (`order.getCustomer().getName()`) hops into a deeper object and leaks the graph's shape. Type-crossing, not dot-count, decides.

### T5. "Honoring LoD always reduces coupling." Always?

**Not always.** Mechanical delegation can produce a **Middle Man** (interface bloat) or merely *hide* coupling without removing it (a forwarding method still gives the host knowledge it shouldn't own). Clarity and fewest-elements can outrank LoD; sometimes the explicit chain — or having the caller talk to the *right* object directly — is the better design.

### T6. "The way to enforce LoD is to turn on the PMD LawOfDemeter rule." Sound?

**Dangerous.** Unfiltered, it flags streams, builders, `Optional`, and DTOs — thousands of false positives — and gets disabled within a sprint. You need a type-aware rule (distinct domain types only) plus a fluent/data allowlist, or better, change-coupling analysis. Tooling must be precise or it enforces dogmatism, not the principle.

---

## Behavioral Questions

### B1. Tell me about a time a deep object chain caused a production problem.

**Sample:** "We exposed `getCustomer()` on `Order` and chained `order.getCustomer().getAddress().getCity()` in ~70 files. A requirement gave customers multiple addresses; the single-address getter went away and all 70 broke at once. I fixed it by introducing `order.shippingAddress()` behavior, migrating callers, then changing the model behind that one method. The lesson I quote now: train wrecks spread the object graph's shape across the whole codebase — the getter was the root cause, and LoD would have confined the blast radius to one method."

### B2. Describe a time you pushed back on a 'fix' that didn't actually help.

**Sample:** "A teammate 'fixed' our train wrecks by passing whole `Order` objects into helpers so the chains lived inside them. Static analysis went green, but the helpers were now stamp-coupled to all of `Order` — changing its structure still broke them. I showed that the coupling had been renamed, not removed, and we changed the helpers to take the minimal values (`Country`, `Money`) they used. Green tooling isn't the same as decoupled."

### B3. How do you keep a team from over-applying LoD?

**Sample:** "I make the objects-vs-data line explicit — domain package = LoD applies, DTO/api package = chain freely — and I applaud correct fluent and DTO chains as loudly as I flag real train wrecks. The fastest way to make a team hate a principle is to flag their streams and config maps. I also calibrate any linter to be type-aware with a fluent/data allowlist before turning it on, so it never floods reviews with noise."

### B4. When did you decide *not* to apply Tell-Don't-Ask / LoD?

**Sample:** "We had a short, local chain through a couple of value records inside one cohesive module. Honoring LoD would have meant adding forwarding methods that buried the host class's real responsibility under pass-throughs — a Middle Man for no coupling benefit, since the chain was local and through data. I left it. LoD is a heuristic; clarity and fewest-elements outrank it when the chain is local, shallow, and through data structures."

### B5. How do you refactor train wrecks in a large legacy codebase?

**Sample:** "Tests first — characterize behavior *and* null cases, because that's where the subtle breakage hides. Then Hide Delegate one hop at a time, tests green between hops, migrate callers, and delete the dead getter so the wreck can't come back. I watch for accidentally building a Middle Man. And I do it opportunistically in files I'm already touching — a standalone 'de-train-wreck the codebase' project is all risk and no feature value and never survives a deadline."

---

## Tips for Answering

1. **Lead with the friends phrasing** and the four legal call targets — it shows you know the *formal* rule, not just the slogan.
2. **Nail the fluent-vs-train-wreck distinction:** same type returned each step = fine; new deeper type each step = violation. *Count types, not dots.*
3. **State the master exception loudly:** LoD applies to **objects**, not **data structures** (DTOs, config, JSON). This is the senior signal.
4. **Quote the Paperboy-and-Wallet** as your canonical example, and "Tell, Don't Ask" as the cure.
5. **Mention the cost** — delegation can create a **Middle Man**; LoD is a heuristic, not a law.
6. **For senior depth:** connascence (LoD *localizes* it), stamp coupling (the disguised-coupling trap), and "eradicate the getter" (root cause is leaky encapsulation).
7. **For production:** unfiltered LoD linters are noise; be precise, not dogmatic.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)

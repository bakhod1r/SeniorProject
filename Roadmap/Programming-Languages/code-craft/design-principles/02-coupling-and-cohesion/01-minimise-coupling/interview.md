# Minimise Coupling — Interview Questions

> **Category:** [Design Principles → Coupling & Cohesion](../../README.md) — coupling is how much one module depends on another; minimising it reduces how far a change in A ripples into B.

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

### J1. What is coupling?

**Answer:** The degree to which one module depends on — and knows about — another. Two modules are coupled when a change to one may force a change to the other. Minimising coupling shrinks that ripple.

### J2. What's the difference between coupling and cohesion?

**Answer:** Coupling is *between* modules (how tangled the boundaries are — you want it **low**). Cohesion is *within* a module (how well its elements belong together — you want it **high**). The classic pairing is "low coupling, high cohesion."

### J3. List the classic coupling types from worst to best.

**Answer:** Content → Common (global) → External → Control → Stamp → Data. The ranking tracks how much one module must know about the other — content (its internals) is worst, data (just the values it needs) is best.

### J4. Why is content coupling the worst?

**Answer:** Because the dependent module reaches into the other's *internal* details — private fields or code. Almost any change to those internals breaks the dependent. Data coupling, by contrast, shares only the small explicit data needed, so changes rarely ripple.

### J5. What is the ripple effect? What is shotgun surgery?

**Answer:** The ripple effect is a change in one module forcing changes in others that depend on it. Shotgun surgery is the specific symptom where *one* conceptual change forces *many* small scattered edits across files — a sign of high coupling.

### J6. A function takes a `boolean` flag and behaves differently inside. What coupling is that, and how do you fix it?

**Answer:** Control coupling — the caller passes a flag that steers the callee's internal logic. Fix by splitting into two clearly named methods (or injecting the behaviour), so the caller picks instead of toggling internals.

### J7. Name three ways to reduce coupling.

**Answer:** (Any three) Depend on a small interface instead of a concrete class (DIP); inject dependencies from outside; use events/pub-sub so A doesn't know B exists; follow the Law of Demeter (don't reach through chains); hide a subsystem behind a facade; pass only the data needed; reduce public surface area.

### J8. Why isn't "zero coupling" the goal?

**Answer:** Two modules with zero coupling never cooperate — they do nothing useful together. The goal is the *minimum* coupling needed for the modules to do their job, not the absence of coupling.

### J9. What is stamp coupling and how do you reduce it?

**Answer:** Passing a whole composite object to a function that needs only one or two of its fields — coupling the function to the whole object's shape. Reduce it by passing just the fields needed (down to data coupling).

### J10. What do Ca and Ce mean?

**Answer:** Afferent coupling (Ca) = how many modules depend *on* this one (incoming). Efferent coupling (Ce) = how many modules this one depends *on* (outgoing). Instability `I = Ce/(Ca+Ce)`, from 0 (stable) to 1 (unstable).

---

## Middle Questions

### M1. Why is "adding an interface" not automatically decoupling?

**Answer:** An interface only decouples if the dependency can *genuinely vary* — a real second implementation, a test fake, or a plugin. A one-implementation interface that's always wired the same way just adds an indirection hop and removes no real dependency. That's indirection, not decoupling.

### M2. How can over-decoupling *increase* coupling?

**Answer:** Scattering a cohesive concept across many modules "to decouple" forces those fragments to call each other in order (control/temporal coupling) and bind to each other's shapes — manufacturing coupling between pieces that wanted to be one cohesive module. Over-decoupling also costs traceability.

### M3. What does instability `I` tell you, and is low `I` "good"?

**Answer:** `I = Ce/(Ca+Ce)` measures how stable a module is: low `I` = many depend on it, it depends on little (stable); high `I` = it depends on much, nothing depends on it (unstable). Low isn't automatically good — stable modules *should* hold abstractions and change rarely; unstable modules *should* hold volatile details and churn freely. The defect is a *wrong-direction* dependency.

### M4. State the Stable Dependencies Principle.

**Answer:** Dependencies should point toward stability — a module should depend only on modules at least as stable as itself. A stable module depending on an unstable detail is the recipe for system-wide ripple.

### M5. What is temporal coupling, and how do you design it out?

**Answer:** A dependency on *ordering* — B works only if A ran first (e.g. `open()` before `send()`), invisible in the signatures. Design it out by making misuse impossible: return an already-valid object, fuse the ordered steps into one call, or own the lifecycle with a resource block (`try-with-resources`/`with`/RAII).

### M6. When do you add a decoupling seam now vs. later?

**Answer:** By reversibility. If the seam is cheap to add later (internal, reversible refactor), stay direct now and extract it when a real need appears. If it's expensive later (a volatile boundary — DB, network, third-party SDK that would entangle many files), invest in the seam now.

### M7. What does each decoupling mechanism *cost*?

**Answer:** Interfaces add an indirection hop and a file; DI moves wiring to a composition root; events cost traceability and add eventual-consistency reasoning; facades can grow into god-objects; mappers add boundary code. Decoupling moves cost, it doesn't delete it — always know what you're paying.

---

## Senior Questions

### S1. Why is coupling not a single number you can "minimise"?

**Answer:** It has at least three independent axes: **strength** (how much A must know about B — weaker is better), **direction** (which way it points — toward stability is better), and **locality/degree** (how far apart and how many elements entangled — more local, fewer is better). "Minimise coupling" really means weaken it, redirect it toward stability, and localise it — three different refactorings.

### S2. How does connascence improve on the 1974 coupling taxonomy?

**Answer:** Connascence (Page-Jones) is sharper and covers *dynamic* coupling the static taxonomy can't name (execution/timing = temporal coupling). It gives a measurement — strength × locality × degree — and maps the old kinds to precise ones (control coupling = connascence of meaning of flag values; common coupling = connascence of identity). Its three rules — make coupling weaker, more local, lower degree — subsume "push it down the ladder." It tells you *which* refactoring, not just that something's wrong.

### S3. Explain "coupling is conserved."

**Answer:** If two things genuinely encode one decision, no pattern *removes* their coupling — it only relocates it. An event turns coupling-to-behaviour into coupling-to-event-shape plus timing coupling; a service split turns type coupling into network-contract coupling. Essential coupling (one decision) can only be reshaped — weakened, redirected, localised — not deleted; only accidental coupling (two decisions that merely touch) can truly be removed. Hiding essential coupling behind an event is *fake decoupling*: it's still coupled, now implicitly and untyped.

### S4. What is a distributed monolith, and why is it worse than a monolith?

**Answer:** Services split "to decouple" that still call each other synchronously in chains, share a database, deploy in lockstep, and share a types library. The coupling didn't decrease — it moved onto the network, where it now also has latency, partial failure, serialization, and versioning. Microservice boundaries reduce coupling *only* when they fall on lines of genuine independence (different change rates, owners, data); a boundary through an essentially-coupled cluster just network-ifies the coupling.

### S5. What is the "Zone of Pain," and how do you escape it?

**Answer:** A component that's both *concrete* and *stable* (low abstractness, low instability) — many things depend on it, but it's full of details that want to change, so every change ripples through all dependents (e.g. a DB schema everyone imports directly). Escape via DIP: replace the concrete stable dependency with a stable *abstraction*, so dependents couple to a contract that doesn't churn. This is `D = |A + I − 1|` distance from the main sequence made actionable.

### S6. When is *more* coupling, or staying coupled, the right call?

**Answer:** When the coupling is to a *stable* shared abstraction (`Money`, `UserId`, standard library) — decoupling it causes drift and conversion bugs. When the coupling is *essential* — two things that must change together are better coupled directly and visibly (one cohesive module, a typed call) than hidden behind an event whose contract they secretly share. And before a real second side exists, a concrete dependency beats a speculative seam.

---

## Professional Questions

### P1. How do you enforce appropriate coupling in code review?

**Answer:** Name the coupling kind in the diff and ask "what does this need to *know* about that — can it know less?" Flag new concrete infra imports in domain code, shared globals, behaviour-switching flags, whole-entity passing, Demeter chains, cross-service DB sharing, and new package cycles. Crucially, push back on *over*-decoupling too: one-implementation interfaces, events for must-change-together things, service splits through coupled clusters. Ask "what real variation does this seam enable *today*?"

### P2. What metrics actually track coupling in production?

**Answer:** Change-coupling from git history (files that actually change together — the ground truth that static tools miss) is the most honest; plus Ca/Ce, instability `I` *with direction*, distance from the main sequence, cyclic dependencies (gate in CI), and per-request service-hop count (distributed-monolith signal). The downstream truth is DORA lead time and change-failure rate. Don't claim "reduced coupling" from one decoupled class.

### P3. How do you decouple a legacy system safely?

**Answer:** Use change-coupling analysis (`code-maat`/CodeScene) to find the *real* coupling first; pin behaviour with characterization tests; introduce a consumer-owned seam and invert, smallest scope first; break cycles before anything else; use the Strangler Fig for large couplings; do it opportunistically as you touch files (Boy Scout Rule). Never decouple without tests, never big-bang, never network-ify to "decouple," never replace coupling with over-decoupling.

### P4. A team wants to split a monolith into microservices to "reduce coupling." What do you check?

**Answer:** Whether the boundaries fall on genuine independence — different change rates, owners, and data. I'd check: can each service deploy independently? Does a single request fan out to many synchronous hops? Do they share a database or a lockstep-upgraded types library? If yes to those, it's a distributed monolith — all the coupling of a monolith plus network cost. Decompose on cohesion, give each service its own data, and communicate asynchronously across real boundaries.

### P5. How do you stop a codebase from drifting into an interface-per-class tangle?

**Answer:** Make "concrete first, interface on the second implementation (test fakes excepted, and documented)" a written convention; gate package cycles in CI; require every new seam to name the real variation it enables today; and *celebrate deletions* — a net-negative-LOC PR that removes a one-implementation interface should earn more respect than adding one. Senior engineers must model "direct until a real boundary appears."

### P6. Why report change-coupling rather than "we decoupled class X"?

**Answer:** Because decoupling one class may have hidden the coupling, not removed it (fake decoupling). Change-coupling from git history shows whether files *still change together* — the actual measure of whether the system got more changeable. Pair it with "a cycle removed" or "a stable module no longer imports a volatile one" for an honest report.

---

## Coding Tasks

### C1. Remove control coupling (Java).

**Before:**

```java
String export(Report r, boolean asJson) {
    if (asJson) return toJson(r);
    else        return toCsv(r);
}
```

**After** — split; the caller picks, no flag steers internals:

```java
String exportJson(Report r) { return toJson(r); }
String exportCsv(Report r)  { return toCsv(r); }
```

### C2. Stamp → data coupling (TypeScript).

**Before** — coupled to the whole `Order` shape for one field:

```typescript
function qualifiesForFreeShipping(order: Order): boolean {
  return order.total >= 50;
}
```

**After** — depends on one number:

```typescript
function qualifiesForFreeShipping(total: number): boolean {
  return total >= 50;
}
```

### C3. Common (global) coupling → injection (Python).

**Before:**

```python
RATE = {}                       # global, mutated elsewhere
def bill(amount):
    return amount * RATE["tax"] # hidden dependency, breaks if RATE unset
```

**After** — explicit, local, no hidden global:

```python
def bill(amount, tax_rate):
    return amount * tax_rate
```

State the win: the dependency is now visible in the signature and can't be left uninitialized by another module.

### C4. Invert a volatile dependency (TypeScript / DIP).

**Before** — domain depends on a concrete vendor SDK (Zone of Pain in the making):

```typescript
class Checkout {
  constructor(private stripe: StripeClient) {}     // concrete, volatile
  pay(amount: number) { this.stripe.charge(amount); }
}
```

**After** — depend on an owned port; inject the concrete at the edge:

```typescript
interface PaymentGateway { charge(amount: number): void; }   // owned by domain
class Checkout {
  constructor(private gateway: PaymentGateway) {}
  pay(amount: number) { this.gateway.charge(amount); }
}
class StripeGateway implements PaymentGateway { charge(a: number) { /* ... */ } }
```

*(Caveat to state: this is justified because the SDK is volatile and external — a real boundary — not "to follow SOLID." For a stable internal class, stay concrete.)*

### C5. Design out temporal coupling (Go).

**Before** — caller must Open before Use, Close after (hidden ordering):

```go
c := NewClient()
c.Open()
defer c.Close()
c.Use()
```

**After** — lifecycle owned by the API; misuse unrepresentable:

```go
func WithClient(f func(c *Client) error) error {
    c, err := dial(); if err != nil { return err }
    defer c.close()
    return f(c)        // caller gets an already-valid client; can't skip Open/Close
}
```

---

## Trick Questions

### T1. "Always decouple — more interfaces and events mean better code." True?

**False.** Decoupling has a cost (indirection, lost traceability) and the goal is *appropriate*, not maximal, decoupling. A one-implementation interface is indirection, not decoupling. An event for two things that still change together is *fake* decoupling — they're coupled, now implicitly. The target is the minimum coupling that lets modules cooperate, on the right axis.

### T2. "Microservices are loosely coupled by definition." Right?

**No.** Splitting deployment units doesn't reduce coupling — it can move it onto the network (a distributed monolith): synchronous chains, shared database, lockstep deploys, shared types. Boundaries reduce coupling only when they fall on genuine independence. Otherwise you get all the monolith's coupling plus network cost.

### T3. "Low instability `I` is good, high is bad." Agree?

**No.** `I` is descriptive, not a score. Stable modules (low `I`) *should* be stable and hold abstractions; unstable modules (high `I`) *should* churn and hold volatile details. The defect is a wrong-direction dependency (stable depending on unstable), which raw `I` doesn't show — you need direction and abstractness too.

### T4. "Passing the whole object is fine — it's just one argument." Correct?

**No.** That's stamp coupling: the function is now coupled to the *whole object's shape*, so a change to any field risks it, even fields it never reads. Pass the specific data it needs (data coupling) — fewer facts must stay in sync.

### T5. "I removed the duplication by sharing a global, so coupling went down." Right?

**Wrong direction.** A shared mutable global is common coupling — the *second-worst* kind — plus an invisible dependency and often a temporal-coupling trap. You increased coupling. Pass the value explicitly instead.

### T6. "Zero coupling is the ideal." True?

**No.** Zero coupling means modules that never cooperate — useless. The ideal is *minimal appropriate* coupling: enough to do the job, as weak as possible, pointing toward stability, kept local. Paired with high cohesion.

---

## Behavioral Questions

### B1. Tell me about a time high coupling caused a problem.

**Sample:** "We had a `static` mutable config map read across billing and written by a refresh job — common coupling with a hidden ordering dependency. A deploy reordered startup so billing read it before it was populated, and we charged at a zero rate until alarms fired. I removed the global: the rate is now an immutable value loaded once at the composition root and injected explicitly. The lesson I quote: a shared mutable global is invisible coupling — it's in no signature, so nobody sees the dependency until it breaks."

### B2. Describe a time you decided *not* to decouple something.

**Sample:** "A teammate wanted an interface for every service class 'to decouple.' These were one-implementation, pure-logic classes with no real second side — the interfaces would have doubled navigation and added no swappability or testability. I argued for staying concrete until a real boundary or second implementation appeared, citing our 'concrete first, interface on the second impl' convention. Indirection isn't decoupling."

### B3. How do you push back when a team wants microservices 'for decoupling'?

**Sample:** "I ask whether the boundaries fall on genuine independence: can each deploy alone, do requests fan out to many synchronous hops, do they share a database? If the answers point to a distributed monolith, I show that the coupling just moves onto the network with extra failure modes. I push to decompose on cohesion — group what changes together — and to communicate asynchronously across only the boundaries that are genuinely independent."

### B4. Tell me about reducing coupling in a legacy system.

**Sample:** "I ran change-coupling analysis over git history to find which files *actually* changed together — that pointed at the real coupling, not whatever the import graph showed. I wrote characterization tests around the worst seam, introduced a consumer-owned interface, inverted the dependency, and migrated callers with a Strangler Fig — all opportunistically as we touched the code for features. No big-bang, tests at every step. The change-coupling between those modules dropped over the next quarter."

### B5. How do you keep coupling appropriate across a large team over years?

**Sample:** "Make the right level the default: an architecture-fitness test so dependencies point toward stability, a CI gate against new package cycles, 'concrete first' and 'no shared mutable globals' as written conventions, and — culturally — celebrate net-negative-LOC PRs that remove needless indirection. Coupling drifts up one reasonable PR at a time, so the defense is at review: name the coupling kind, and ask what real variation any new seam enables today."

---

## Tips for Answering

1. **Define coupling crisply** — "how much one module must *know* about another, and thus how far a change ripples" — and contrast it with cohesion (between vs. within).
2. **Recite the taxonomy worst→best** (content → common → external → control → stamp → data) and tie the ordering to "how much must one know about the other."
3. **Say "indirection ≠ decoupling"** — a one-implementation interface removes no dependency.
4. **Know "coupling is conserved"** — decoupling *moves* essential coupling; only accidental coupling can be deleted. Name fake decoupling.
5. **Nail the distributed monolith** — splitting deploy units can network-ify coupling; decompose on cohesion.
6. **Use direction, not just magnitude** — dependencies should point toward stability; mention the Zone of Pain and DIP as the escape.
7. **Stress "appropriate, not zero"** — and pair it with high cohesion.
8. **For metrics, lead with change-coupling** (git history) over static analysis.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md) · **Next:** [Maximise Cohesion](../02-maximise-cohesion/junior.md)

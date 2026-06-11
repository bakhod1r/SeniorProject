# Encapsulate What Changes — Interview Questions

> **Category:** [Design Principles](../../README.md) — find the part of a system most likely to change and hide it behind a stable interface, so change stays contained.

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

### J1. State the principle "Encapsulate What Changes" in one sentence.

**Answer:** *Identify the aspects of your application that vary and separate them from what stays the same* — find the part most likely to change and hide it behind a stable interface, so change is contained. It's the Gang of Four's first design principle.

### J2. What's the practical method for applying it?

**Answer:** (1) Identify the *axis of variation* — the concept that will change. (2) Define a *stable interface* capturing what all cases share. (3) Put each varying case behind it (one implementation per case). (4) Make the stable code depend on the interface, never on the cases.

### J3. What is an "axis of variation"? Give examples.

**Answer:** The dimension along which a concept varies. Examples: which payment method, which currency, which notification channel, which file format, which storage backend, which auth provider.

### J4. Who is David Parnas and why does he matter here?

**Answer:** Parnas wrote *On the Criteria To Be Used in Decomposing Systems into Modules* (1972), the intellectual foundation. His rule: a module should **hide a design decision likely to change** (information hiding), and you should decompose around *those decisions*, **not** around the steps of the flowchart. That's exactly "encapsulate what changes," stated decades earlier.

### J5. You see `if type == "a" … elif type == "b" …` repeated in five files. What does that mean and what's the fix?

**Answer:** "Which type" is a real axis of variation that has leaked everywhere unencapsulated. The fix: define a stable interface and one implementation per type (polymorphism), so the ladders collapse and a new type is one new class.

### J6. What's the payoff when you encapsulate the right axis?

**Answer:** Adding a new case (payment method, channel, format, backend) touches **one place** — a new class behind the interface — and the stable code never changes. Without it, the change ripples across many files (shotgun surgery).

### J7. Why is encapsulating something that *never* varies a mistake?

**Answer:** You pay the abstraction's full cost (extra interface, indirection, more to read and maintain) forever and get **zero** benefit, because no change ever comes to contain. It's speculative generality — a YAGNI violation.

### J8. What's a quick rule of thumb for when you have enough evidence to encapsulate?

**Answer:** The Rule of Three / "two real cases": don't encapsulate until variation is *demonstrated* — two real cases, clear domain knowledge, or git churn — not merely imagined.

### J9. Name a mechanism for encapsulating each of: a varying behavior, a varying value, an external system.

**Answer:** Varying behavior → a Strategy object behind an interface. Varying value → configuration. External system → an adapter/port behind an interface.

### J10. What does it mean that the interface should be "stable"?

**Answer:** Its shape stays put while implementations behind it change. The interface is the wall; the volatile cases live behind it. If adding a new case forces you to edit the interface, the seam is leaky or the axis was wrong.

---

## Middle Questions

### M1. How is this principle the engine behind the Open/Closed Principle?

**Answer:** OCP wants new behavior added without modifying existing code. The *only* way to achieve that is to encapsulate the varying part behind a stable interface — then "extension" means adding a new implementation, and the existing code (closed for modification) never changes. OCP is the goal; Encapsulate What Changes is the mechanism.

### M2. How does it relate to Dependency Inversion?

**Answer:** DIP says policy should depend on abstractions, not concrete details. The abstraction *is* the stable interface in front of the volatile detail (the DB, the vendor, the framework). DIP is this principle applied to the stable-policy / volatile-detail boundary, with the dependency pointed at the stable abstraction.

### M3. Precisely reconcile this principle with YAGNI.

**Answer:** They only conflict if you misread it as "encapsulate what *might* change." Read correctly — "encapsulate what *varies*," present tense — there's no conflict: **encapsulate what *demonstrably* varies** (two cases / domain knowledge / churn / scheduled requirement); do **not** encapsulate what you merely imagine might. YAGNI is the tiebreaker when evidence is thin.

### M4. Describe Parnas's two decompositions and which absorbs change better.

**Answer:** Flowchart decomposition draws boundaries around processing steps; a change (e.g., input format) touches many modules sharing the representation. Information-hiding decomposition draws boundaries around *decisions likely to change*, each module hiding one; a change is confined to the one module whose secret it was. The second absorbs change far better.

### M5. How do you find the real axis of variation in an existing codebase?

**Answer:** Domain volatility analysis (known-volatile categories: payments, tax, channels, storage, formats), git history (files that churn most are measured volatility), known requirement direction (scheduled roadmap items), and the scattered-conditional smell (a type discriminator branched in several places).

### M6. State the Rule of Three and why it applies here.

**Answer:** Tolerate the variation twice; encapsulate on the third occurrence. One case shows no axis; two show an axis but not its real *shape* (a two-point line fits many curves); three let you *observe* what's truly invariant, so the interface fits instead of being a guess. It defends against premature/wrong abstraction.

### M7. How does this principle relate to SRP?

**Answer:** SRP's "one reason to change" *is* an axis of variation. SRP says give each axis its own module (where the seams go); Encapsulate What Changes says hide the volatile decision behind each seam (what goes behind them). Tangling two axes in one class violates both.

### M8. What's a "leaky interface" and why does it fail?

**Answer:** An interface that carries one implementation's specifics (e.g., `charge(amount, cvv, mandate_id, redirect_url)`). Every caller and implementation must then know about each case, so adding a case means editing the interface — the seam fails to contain change, which is its only job.

---

## Senior Questions

### S1. What is volatility-based decomposition, and why beat decomposition by noun or layer?

**Answer:** Decomposing the whole system around its axes of change (Parnas scaled up; Löwy's *Righting Software*), so each boundary encapsulates something that varies independently. Decomposition by noun (`Order`, `Customer`) or by layer (controllers/services/repos) is *change-blind*: a requirement like "add a payment provider" cuts across all layers/nouns. Volatility-based boundaries make that requirement land inside one module. Litmus test: trace your three likeliest upcoming requirements — each should touch one module.

### S2. Why is encapsulating the *wrong* axis worse than not encapsulating at all?

**Answer:** The abstraction doesn't contain the change that actually arrives, *and* it misleads everyone into bending new requirements around the guessed seam — accruing flags and optional parameters until it's a leaky maze that's load-bearing and risky to undo. Sandi Metz: "the wrong abstraction is more expensive than no abstraction." A missing seam costs one refactor later; a wrong seam costs two plus a carrying period — which is the asymmetry that makes YAGNI the default.

### S3. When does reversibility override the "wait for evidence" default?

**Answer:** For one-way doors — storage/persistence, third-party vendor SDKs, public API contracts, wire protocols — you encapsulate **up front**, even with one implementation, because the cost of retrofitting the seam (a migration touching hundreds of files) dwarfs the abstraction tax. Reversibility, not the Rule of Three, governs there. Reversible internals → wait for evidence; irreversible boundaries → seam from day one.

### S4. Explain the principle in terms of connascence.

**Answer:** A scattered, exposed axis is *connascence of meaning spread across modules* (the magic value `"credit_card"` and its handling appear everywhere and must change together) — strong, distributed, the worst kind. Encapsulating it **converts** that into localized strong connascence (the provider logic, now confined inside one module) plus weak connascence of name at the boundary (callers depend only on the interface's names). That conversion is *why* the change stops rippling. A leaky seam leaks connascence-of-meaning across the boundary — which is why it fails.

### S5. Why does this principle favor composition over inheritance?

**Answer:** Inheritance encapsulates variation badly — a subclass override is a Strategy you can't swap at runtime or combine. Composing the varying behavior as an injected collaborator (a `PricingRule` field) makes the seam explicit, swappable, and combinable. The GoF's own corollary to "encapsulate what varies" is "favor object composition over class inheritance" for exactly this reason.

### S6. What is the last responsible moment, applied to seams?

**Answer:** Introduce the seam as late as possible *but no later than the point where deferring would foreclose your options*: when the second concrete case lands (reversible internals) or when an irreversible decision is imminent (one-way doors). Not earlier (speculative generality), not later (retrofitting under pressure). It reframes YAGNI as "abstract at the last responsible moment, gated by reversibility."

### S7. How do you decide whether an encapsulation is net-positive?

**Answer:** Cost-benefit: encapsulate when `P(variation) × cost_of_scattered_change > abstraction_tax`. When variation is demonstrated, the left side dominates → encapsulate. When variation is imagined, `P(variation)` is low → the tax dominates → stay concrete. The tell of net-negative: a one-implementation interface with no domain reason for a second, especially one leaking that implementation's specifics.

---

## Professional Questions

### P1. How do you enforce this principle in code review — both directions?

**Answer:** Symmetrically. For any new abstraction: *"What present requirement — two real cases, a scheduled feature, or an irreversible boundary — forces this seam?"* ("future-proof" = remove it). For any new/edited type-branch: *"Is this the third place we branch on this discriminator? Then it's a real axis — encapsulate it."* And for existing seams: *"Can a new case be added without editing the interface?"* (no = leaky/wrong axis).

### P2. What metrics locate the real axes of variation?

**Answer:** Git **change frequency** (files that churn most = where volatility concentrates) and **change coupling** (files that co-change share a hidden axis → extract the shared seam) identify *under*-encapsulation. **One-implementation-interface count** and **element-count-per-feature trend** identify *over*-encapsulation. Measure, don't guess — intuition about "what changes" is unreliable.

### P3. How do you introduce a seam into a legacy system safely?

**Answer:** Characterization tests first (pin current behavior of every site of the axis), confirm the axis via change-coupling, extract the interface *from the existing cases* (you already have the Rule-of-Three data), move one case behind the seam at a time keeping tests green, then collapse the repeated switch. Never extract without tests; never replace a wrong seam with a different speculative one.

### P4. How do you safely remove a wrong, load-bearing seam?

**Answer:** Characterize all callers with tests → inline the interface back into each caller (temporarily more duplication — correct, the wrong seam was worse) → simplify each caller independently (delete flags it never used) → re-extract only the genuinely shared contract → delete the old interface.

### P5. How do you fight speculative seams culturally?

**Answer:** Make "evidence before a seam" a written policy (license to refuse speculation), celebrate *removing* unused seams as a senior move, and make change-coupling reports visible so *prevention* (encapsulating an exposed axis before it bites) is rewarded, not just incident response. Seniors model "concrete until the second case — except at one-way doors."

### P6. A real axis is exposed and causing pain, but no one noticed for months. How could that have been caught earlier?

**Answer:** Change-coupling analysis — the files branching on the same discriminator were a co-change cluster in git history long before the painful change. The signal exists in the repository; the failure is not *measuring* it. A quarterly volatility review surfaces exposed axes (and frozen seams to inline) before they cause a missed edit.

---

## Coding Tasks

### C1. Encapsulate the scattered axis (Python).

**Before** — the axis "payment type" leaked across the codebase:

```python
def checkout(order):
    if order.type == "card":   charge_stripe(order.total)
    elif order.type == "paypal": charge_paypal(order.total)
# the SAME ladder repeats in refund() and report()
```

**After** — stable interface in front, cases behind:

```python
class PaymentMethod(ABC):
    @abstractmethod
    def charge(self, amount): ...

class CardPayment(PaymentMethod):   def charge(self, amount): ...
class PayPalPayment(PaymentMethod): def charge(self, amount): ...

def checkout(order, payment: PaymentMethod):
    payment.charge(order.total)   # no ladder; new method = one new class
```

### C2. Spot and remove the speculative seam (Go).

**Before** — one provider, one interface, day one (no second case, not a one-way door):

```go
type Greeter interface{ Greet(name string) string }
type EnglishGreeter struct{}
func (EnglishGreeter) Greet(n string) string { return "Hello, " + n }
func welcome(g Greeter, n string) string { return g.Greet(n) }
```

**After** — concrete until variation is real; Go lets you add the interface later for free:

```go
func welcome(name string) string { return "Hello, " + name }
// Add a Greeter interface IF a second greeting style becomes a real requirement.
```

### C3. Encapsulate a one-way door up front (Python).

```python
# Storage is irreversible to retrofit → encapsulate EARLY even with one impl.
class EventStore(ABC):
    @abstractmethod
    def append(self, stream, event): ...
    @abstractmethod
    def read(self, stream): ...

class PostgresEventStore(EventStore): ...   # today's only implementation
# Domain depends on EventStore. A future engine swap = one new class, not 200 edits.
# Justified by REVERSIBILITY, not by the Rule of Three.
```

### C4. Fix the leaky interface (TypeScript).

**Before** — leaks each channel's specifics across the boundary:

```typescript
interface Notifier {
  send(user: User, channel: string, subject?: string,
       smsTemplate?: string, pushPayload?: object): void;  // leaky
}
```

**After** — interface carries only the shared contract; specifics live behind it:

```typescript
interface Notifier { send(recipient: Recipient, message: Message): void; }
class EmailNotifier implements Notifier { send(r, m) { /* email specifics */ } }
class SmsNotifier   implements Notifier { send(r, m) { /* sms specifics   */ } }
// A new channel = one new class; the interface is UNTOUCHED. That's the test.
```

### C5. Escape the wrong axis (Python).

**Before** — interface guessed from one case, now leaking three misfits:

```python
def charge(method, amount, cvv=None, redirect=None, mandate=None):
    if method == "card":   return _card(amount, cvv)
    if method == "paypal": return _paypal(amount, redirect)
    if method == "sepa":   return _sepa(amount, mandate)
```

**After** — inline to clear, independent handlers; each takes only what it needs:

```python
class CardPayment:   def charge(self, amount, cvv): ...
class PayPalPayment: def charge(self, amount, redirect): ...
class SepaPayment:   def charge(self, amount, mandate): ...
# The "unified" signature was the WRONG axis. Re-extract only a truly shared
# contract (e.g. each returns a Receipt) — not the leaky parameter soup.
```

---

## Trick Questions

### T1. "If encapsulating what changes is good, encapsulate everything just in case." Right?

**Wrong.** Encapsulating an axis that never varies is speculative generality — full abstraction tax, zero benefit, a YAGNI violation. Encapsulate what *demonstrably* varies (evidence: two cases / churn / schedule / one-way door), not everything.

### T2. "An interface with one implementation is always good design — program to an interface." Agree?

**No.** "Program to an interface" applies to a seam with *two real sides*. Applied to a one-implementation type with no domain reason for a second, it's speculative generality wearing a principle's clothes. Exceptions: a genuine test-double need (present requirement) or a one-way door (reversibility governs).

### T3. Is "encapsulate what changes" the same as "encapsulate what might change"?

**No — and the difference is the whole point.** The verb is "vary/changes," present tense — demonstrated variation. "Might change" is imagined variation, which is YAGNI's target. Conflating them is what produces over-engineering.

### T4. "Decompose your system around its main entities — Order, Customer, Product." Best approach?

**Not for absorbing change.** Decomposing by noun (or by layer) is change-blind: a requirement like "add a payment provider" cuts across all of them. Decompose around *axes of variation* (volatility-based) so each likely requirement lands inside one boundary.

### T5. "We DRY'd the three payment branches into one parameterized function — that encapsulates the variation, right?"

**Only if the axis was right.** If the function grew `cvv=None, mandate=None, redirect=None` flags that each serve one case, you encapsulated the *wrong* axis — a leaky abstraction that leaks connascence of meaning across the boundary and must be edited for every new case. Real encapsulation lets you add a case *without touching the interface*.

### T6. "YAGNI says never abstract early, so we should never add a seam before the third case." Correct?

**Dangerously incomplete.** YAGNI governs *reversible* decisions. For one-way doors (storage, vendor, public API, protocol) you encapsulate *up front*, because the seam is cheap now and a migration later is catastrophic. The real rule is "last responsible moment, gated by reversibility."

---

## Behavioral Questions

### B1. Tell me about a time you removed a speculative abstraction.

**Sample:** "We had an 'integration framework' — generic, plugin-based — running four integrations all written by our own team; the framework was 12,000 lines, the integrations 600. The 'third-party plugin authors' it was built for never existed. I re-expressed the integrations as plain adapter classes behind a thin interface and deleted the framework. 'Add an integration' went from a week to an afternoon. The lesson I quote: encapsulating an axis nobody actually varies along is pure cost."

### B2. Describe a time an exposed axis bit you in production.

**Sample:** "A payments service branched on `payment_type` in seven places. Adding BNPL meant editing all seven; an engineer missed the fraud-check path, and BNPL skipped fraud screening for eleven days. We collapsed the seven branches behind a `PaymentMethod` interface — characterization tests first — so the next method was one class in one place. The deeper lesson: change-coupling had flagged those seven files as a co-change cluster months earlier; we'd ignored a measurable signal."

### B3. How do you push back when a teammate adds a one-implementation interface?

**Sample:** "I ask one non-confrontational question: 'What present requirement — a second implementation, a scheduled feature, or a one-way door — forces this seam?' If it's 'might need it later,' I suggest the concrete type now and extracting the interface when the second case is real, citing our evidence-before-a-seam policy so it's a standard, not my opinion. I frame removing the seam as the senior move."

### B4. When did you decide to encapsulate something *before* you had evidence of variation?

**Sample:** "Persistence. A teammate wanted to call the database driver directly throughout the domain 'for fewer elements.' I pushed back: storage is a one-way door — a future migration would be brutal if the driver's types are entangled everywhere. YAGNI governs reversible decisions; that boundary was irreversible, so a repository seam from day one was the *correct* call even with one implementation."

### B5. How do you keep a large codebase encapsulated along the *right* axes over years?

**Sample:** "Measure, don't guess. Quarterly we run change-frequency and change-coupling analysis: co-change clusters reveal exposed axes to encapsulate; one-implementation-interface counts reveal speculative seams to inline; frozen seams get removed. Policy makes it stick — evidence before a seam, one-way doors get a seam up front, and we celebrate net-negative-LOC PRs that delete unused abstractions."

---

## Tips for Answering

1. **Lead with the GoF sentence** — "identify the aspects that vary and separate them from what stays the same" — and credit **Parnas (1972)** as the foundation (decompose around decisions that change, not flowchart steps).
2. **Always name the YAGNI tension and resolve it precisely:** encapsulate what *demonstrably* varies, not what you imagine might. Mention the Rule of Three.
3. **Show you know it's the engine behind OCP, DIP, and SRP** — that signals you understand the principle, not just the acronyms.
4. **Quote "the wrong abstraction is worse than no abstraction"** and the escape (inline back, re-extract only the shared contract).
5. **Tie timing to reversibility:** evidence-gated for reversible internals; up front for one-way doors (storage, vendor, public API, protocol).
6. **Name the seam test:** a real seam lets you add a case *without editing the interface*; a leaky one forces an edit.
7. **For finding axes, say "measure it" — git change-coupling**, not intuition.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md) · **Next:** [Command Query Separation](../02-command-query-separation/junior.md)

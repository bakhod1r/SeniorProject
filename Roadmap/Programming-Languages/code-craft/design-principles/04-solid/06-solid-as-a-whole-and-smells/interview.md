# SOLID as a Whole, and the Smells That Signal a Violation — Interview Questions

> **Category:** [Design Principles → SOLID](../../README.md) — synthesis-level questions on how the five interlock, the smell-to-principle map, and the honest critique.

Conceptual and coding questions graded junior → professional, plus refactor-this-violation tasks, trick questions, and behavioral questions.

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

### J1. What does SOLID stand for, and who is behind it?

**Answer:** **S**ingle Responsibility, **O**pen/Closed, **L**iskov Substitution, **I**nterface Segregation, **D**ependency Inversion. **Robert C. Martin** assembled and popularized the five; **Michael Feathers** suggested the ordering of the initials that spells SOLID. The principles predate the acronym.

### J2. Is SOLID one principle or five?

**Answer:** Five named principles, but they function as **one system** with a single goal — making change cheap and local by managing dependencies. They reinforce each other; you rarely apply one in isolation.

### J3. You see a `switch` on a type code that you must edit every time a new type is added. Which principle is smelled?

**Answer:** **OCP** (Open/Closed). The fix is polymorphism: make each case a class implementing a shared interface, so a new type is a new class, not an edit to existing code.

### J4. A subclass overrides a method with `throw new UnsupportedOperationException()`. Which principle does that break?

**Answer:** **LSP** (Liskov Substitution) — the subtype refuses a promise the base type made (a "refused bequest"), so callers can no longer substitute it blindly.

### J5. A class does `new SmtpClient()` inside its business logic. Which principle, and why is it a problem?

**Answer:** **DIP** (Dependency Inversion). High-level policy is nailed to a concrete detail — you can't swap the mailer, and you can't unit-test the class without real SMTP. Fix: depend on an injected `EmailSender` abstraction.

### J6. What are Martin's four signs of a "rotting" design?

**Answer:** **Rigidity** (hard to change), **Fragility** (changes break unrelated things), **Immobility** (can't reuse without dragging dependencies), **Viscosity** (the hack is easier than the right fix).

### J7. What's the difference between a smell and a bug?

**Answer:** A **smell** is a surface symptom that *suggests* a design problem and may be acceptable in context; a **bug** is incorrect behavior. Smells guide refactoring; bugs require fixing.

### J8. Which principle is the "foundation" the others rest on?

**Answer:** **SRP.** A single-responsibility class has a small interface (ISP), few promises to keep (LSP), one variation axis (OCP), and one clear thing to abstract (DIP). A god class makes all four hard.

---

## Middle Questions

### M1. Why does OCP usually need DIP and LSP to actually work?

**Answer:** To be closed-for-modification but open-for-extension, the stable code must call through an **abstraction** (DIP — the seam) and every new implementation plugged in must be **safely substitutable** (LSP). Without DIP there's nowhere to plug the extension; without LSP the seam breaks on new subtypes and the caller starts adding `instanceof` checks, killing OCP.

### M2. How does ISP support DIP?

**Answer:** DIP says depend on an abstraction; ISP says make that abstraction the *right size*. A fat interface re-introduces coupling — you depend on methods you don't call, so their changes still affect you. Trimming the interface to what the client actually uses completes DIP's decoupling.

### M3. When is a `switch` statement *not* an OCP violation?

**Answer:** When the set of cases is **closed and stable** (e.g., the four card suits, seven weekdays). OCP guards *open* axes of variation; forcing polymorphism onto a fixed set adds classes for no flexibility and is harder to read.

### M4. Give an example where two SOLID principles tension each other.

**Answer:** **OCP vs. YAGNI** — adding an extension seam before a second case exists is speculative generality; resolve by adding the seam when the second variant (or a test double) is real. Or **SRP vs. cohesion** — over-splitting a cohesive class lowers cohesion; resolve by splitting on real *reasons to change*, not method count.

### M5. How do ISP and LSP cooperate?

**Answer:** A fat interface (ISP violation) forces classes to stub methods they can't honor, and those stubs throw at runtime — an LSP violation. Segregating the interface so no class is forced to stub *prevents* the situation that creates the LSP break. Fix the ISP problem and the LSP symptom disappears.

### M6. What single question tells you whether a smell is a real violation?

**Answer:** *"Does this make a **likely future change** expensive or risky?"* If the change it guards against will never happen (closed set, stable concretion), applying the principle is over-engineering. Smells are priors, not verdicts.

### M7. How does DIP differ from "just use an interface"?

**Answer:** DIP is about the *direction* of dependency — high-level policy must not point at low-level detail. You can use an interface and still violate DIP if the abstraction is owned by the detail layer and the high-level module imports *down* to get it. The abstraction must belong to (or point toward) the policy.

---

## Senior Questions

### S1. Make the honest case that SOLID is "dated."

**Answer:** It's **OO-centric** — LSP is explicitly about subtype substitution, a non-issue in composition-heavy or functional code; OCP/ISP are framed around interfaces-as-extension. The acronym was reverse-engineered for memorability (Feathers), so the *ordering* carries no methodological meaning. The principles are individually vague ("one reason to change" — whose, at what granularity?), so competent engineers reach opposite conclusions. And mechanically applied, they produce interface-per-class mazes. The fair rebuttal: the OO-centricity is real, but the "vague/produces-bad-code" complaints indict *misapplication*, which is true of every heuristic.

### S2. What is CUPID, and how does it relate to SOLID?

**Answer:** Dan North's 2021 alternative — five *properties* (not rules): **Composable, Unix-philosophy, Predictable, Idiomatic, Domain-based.** Its objection: SOLID prescribes *structure*; we actually want *qualities*. Notably, **Predictable subsumes LSP's intent** ("no surprises") without the inheritance framing, which fits modern composition-based code. The synthesis: use SOLID's concrete smells as the *diagnostic*, use CUPID's properties as the *goal* — they're means and ends, not rivals. CUPID's weakness is checkability: "joyful" is harder to enforce in review than "don't ship a type-switch."

### S3. Explain the data-oriented (Muratori) critique. When is it right?

**Answer:** Casey Muratori ("Clean Code, Horrible Performance") and the data-oriented design community argue SOLID's central mechanism — polymorphism behind abstractions — is hostile to hardware: virtual dispatch defeats branch prediction (his benchmark showed a polymorphic shape calculator ~15× slower than a `switch`), and per-object modeling scatters data the cache wants contiguous. It's **right in performance-critical inner loops** (engines, codecs, storage engines) and **over-generalized for I/O-bound business code**, where the vtable cost is unmeasurable next to network/DB latency and SOLID's changeability is worth far more. Reconciliation: SOLID optimizes *programmer time under change*; DOD optimizes *machine time under load* — profile to learn which cost dominates your code.

### S4. How do the five principles translate to functional code?

**Answer:** **SRP and ISP survive almost unchanged** (one job per function; narrow your inputs). **OCP and DIP reduce to "use higher-order functions"** — the function *is* the abstraction you parameterize over. **LSP is best re-expressed as "obey the contract/law"** (parametricity; a `Monoid`/`Ord` instance must satisfy its laws) — i.e., CUPID's *Predictable*. That LSP needs the most translation is itself evidence for the OO-centric critique.

### S5. Name two alternatives/complements to SOLID and what they add.

**Answer:** **GRASP** (Larman) answers *which class should own a responsibility* (Information Expert, Creator, Protected Variations ≈ generalized OCP) — placement rules SOLID lacks. **Component/package principles** (Martin's own: REP/CCP/CRP cohesion, ADP/SDP/SAP coupling) handle the *module* scale — how to draw component boundaries and point dependency arrows — which SOLID (a class-scale story) doesn't address. Also **Simple Design / KISS / YAGNI** as the restraint that stops SOLID over-application.

### S6. When does applying a SOLID principle make the code *worse*?

**Answer:** One-implementation interfaces (speculative DIP/OCP — adds indirection for no second case), SRP shattered into anemic fragments that change together (lowers cohesion), OCP forced onto a closed set (a `switch` would be clearer and faster), ISP taken to one-method-interface soup (hides the design). The common tell: an abstraction with no second case behind it, justified by "flexibility" rather than a present requirement — a YAGNI violation.

---

## Professional Questions

### P1. How do you enforce SOLID in review without causing over-engineering?

**Answer:** Use **two questions, bidirectionally.** For a suspected violation: *"What likely change does this make expensive?"* (prevents under-engineering). For a suspected over-application: *"What present requirement forces this abstraction?"* (prevents over-engineering). Enforce both the "fix" and the "false-alarm" column of the smell catalog — a `switch` over a closed set and a one-impl interface are *not* to be "fixed."

### P2. What's the single highest-leverage automated SOLID rule?

**Answer:** A **layering check** (ArchUnit / import-linter): *domain packages may not import infrastructure packages.* It enforces DIP's *direction* at the boundary that matters and catches `new ConcreteService()` / framework-imports in the domain (the costliest DIP smells) before review. Automation handles mechanical smells (size, imports, type-switches); judgement calls (closed set? coincidental duplication? speculative interface?) stay human.

### P3. How would you refactor a legacy system toward SOLID safely?

**Answer:** Characterization tests first (you can't refactor safely without pinning behavior). Then invert the **worst DIP seam you must touch anyway** — it unlocks testing downstream (Feathers' Extract Interface / Parameterize Constructor). Then polymorphism at the type-switch (OCP/LSP) where the variation axis is genuinely open. Then split fat interfaces/god classes (ISP/SRP) *opportunistically* as you touch files (Boy Scout Rule). Strangle over-engineered subsystems rather than rewriting. Never SOLID-ify without tests; never replace under-engineering with an interface maze.

### P4. A fat `Device` interface forces a label printer to stub `scan()`/`fax()`. Walk through the smell and the fix.

**Answer:** Fat interface = **ISP** smell (#10); the forced stub throwing `UnsupportedOperationException` becomes an **LSP** smell (#11→#7) that crashes at runtime when a batch job calls `scan()` on a label printer. Fix: segregate `Printer`/`Scanner`/`Fax`; the label printer implements only `Printer`; the scanning job's collection becomes `List<Scanner>`, so the type system *prevents* a non-scanner from being in it. Fixing ISP removes the LSP runtime bug.

### P5. Why is "mandate an interface for every class" a bad policy?

**Answer:** It manufactures the complexity SOLID was meant to remove — hundreds of one-implementation interfaces, every "go to definition" landing on an interface, a comprehension tax on every reader, and onboarding friction. It violates "fewest elements" (Simple Design). The right rule is "extract an interface at the **second** implementation or a real test-double/plugin need," and *celebrate deleting* speculative ones.

---

## Coding Tasks

### C1. Refactor this OCP/DIP violation (Python).

**Before** — switch on type + concrete construction:

```python
def notify(user, msg):
    if user.channel == "email":
        SmtpClient("mail.acme.com").send(user.email, msg)   # OCP + DIP smell
    elif user.channel == "sms":
        TwilioClient(KEY).text(user.phone, msg)             # OCP + DIP smell
```

**After** — polymorphism behind an injected abstraction:

```python
class Notifier(Protocol):
    def notify(self, user, msg) -> None: ...

class EmailNotifier:
    def __init__(self, smtp): self._smtp = smtp
    def notify(self, user, msg): self._smtp.send(user.email, msg)

class SmsNotifier:
    def __init__(self, gateway): self._gw = gateway
    def notify(self, user, msg): self._gw.text(user.phone, msg)

def notify(notifier: Notifier, user, msg):   # caller injects the right Notifier
    notifier.notify(user, msg)
# Adding a PushNotifier = new class, zero edits here. (OCP)  Each is injected. (DIP)
```

State: every `Notifier` must honor the same contract (LSP), and the interface stays one method (ISP).

### C2. Spot and fix the LSP violation (Java).

**Before:**

```java
class Bird { void fly() { /* ... */ } }
class Penguin extends Bird {
    void fly() { throw new UnsupportedOperationException("penguins can't fly"); }  // LSP
}
```

**After** — segregate the capability so the *is-a* is honest (LSP + ISP):

```java
interface Bird { void eat(); }
interface Flyer { void fly(); }
class Sparrow implements Bird, Flyer { public void fly() { /* ... */ } public void eat() {} }
class Penguin implements Bird { public void eat() {} }   // never claims it can fly
```

### C3. Spot the over-application and remove it (Go).

**Before** — speculative one-impl interface:

```go
type OrderRepo interface{ Save(o Order) error }
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// SQLRepo is the ONLY implementation, used in one place, no test double.
```

**After:**

```go
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// Use SQLRepo directly. Go's structural typing lets you extract OrderRepo
// later — without touching SQLRepo — when a 2nd impl or a test fake is REAL.
```

*(Caveat to state: if a test double is needed now, the interface is justified — that's a present requirement.)*

### C4. Untangle the SRP/DIP violation (any OO language).

Given a `Report` class that *queries the DB, computes totals, renders HTML, and emails the file*, describe the refactor.

**Answer:** Four reasons to change → split into `ReportRepository` (query), `ReportCalculator` (totals), `HtmlReportRenderer` (render), `ReportMailer` (send), orchestrated by a thin `ReportService` that depends on each via an **injected abstraction** (DIP). Now changing the email provider, the HTML, the query, or the math each touches exactly one class, and `ReportService` is unit-testable with fakes.

---

## Trick Questions

### T1. "Every class should have an interface — that's SOLID." True?

**False.** A one-implementation interface with one caller is speculative generality (YAGNI), not DIP. It adds indirection and a comprehension tax. Extract an interface at the *second* implementation or a real test-double/plugin need. "Fewest elements" (Simple Design) vetoes the speculative one.

### T2. "`instanceof` always violates LSP." Right?

**No.** It's a *smell*, not a verdict. Deliberate pattern-matching over a **sealed/sum type** (Kotlin `sealed`, Rust `enum`) is legitimate. The violation is when callers *must* downcast to make polymorphism work that *should* have been polymorphic.

### T3. "Replacing a `switch` with polymorphism is always cleaner and at least as fast." Agree?

**No.** Over a *closed, stable* set, the `switch` is often clearer than a swarm of classes. And per Muratori, the polymorphic version's virtual dispatch can be dramatically *slower* in a hot loop (his benchmark: ~15×). OCP guards open variation axes; it isn't free and isn't universal.

### T4. "SOLID is paradigm-neutral — it applies equally to functional code." Correct?

**Mostly no.** It's OO-centric. SRP/ISP survive; OCP/DIP reduce to "use higher-order functions"; **LSP needs the most translation** (it becomes "obey the contract/law" — CUPID's *Predictable*) precisely because subtype substitution is an OO concern. The goals survive; the *phrasing* doesn't.

### T5. "More SOLID structure = better code." True?

**No.** SOLID is a means (managing change), not a quality to maximize. A codebase with *more* abstractions is often *worse* — harder to read and navigate. The goal is changeable, comprehensible code; sometimes that means deleting a seam, not adding one.

### T6. "The order of the letters in SOLID is the order you should apply them." Right?

**No.** The ordering exists so the initials spell "SOLID" (Feathers); it carries no methodological meaning. In practice you fix **SRP first** (it unblocks the others), and you apply principles in response to smells, not in alphabetical-mnemonic order.

---

## Behavioral Questions

### B1. Tell me about a time SOLID (or its absence) caused a production problem.

**Sample:** "An order module instantiated its Stripe client and Postgres connection directly inside domain methods — a DIP violation. It couldn't be unit-tested without live credentials, so it barely was, and when compliance forced a payment-processor change, Stripe calls were entangled across 60 files; the migration took a quarter. We introduced `PaymentGateway`/`OrderRepository` ports owned by the domain with adapters at the edge, and added a CI rule banning infrastructure imports from the domain. The lesson I quote: DIP's payoff is testability *and* swappability — skipping it at a one-way-door boundary is the costliest SOLID mistake."

### B2. Describe a time you pushed back on *over*-applying SOLID.

**Sample:** "A teammate added an `IEmailSender` interface with one implementation and one caller 'to be SOLID.' I asked the one question I always ask: 'what present requirement — a second sender or a test double — forces this?' There was none. We used the concrete class and agreed to extract the interface when a second sender appeared. I framed deleting the speculative interface as the senior move, citing our 'earn the abstraction' policy so it was a standard, not my opinion."

### B3. How do you teach SOLID to a junior without turning them into a dogmatist?

**Sample:** "I teach the **smell catalog**, not the acronym — 'we don't ship `instanceof` ladders or `new ConcreteService()` in the domain' lands better than abstract definitions. And I teach the *false-alarm* cases just as hard: a `switch` over a closed set is fine, a one-impl interface is a YAGNI smell. The two together keep them from swinging from spaghetti to interface-maze."

### B4. When did you decide *not* to apply a SOLID principle?

**Sample:** "We had a `switch` over the four card suits in a game. A reviewer flagged it as an OCP violation. I pushed back: the set of suits is closed — it will never grow — so polymorphism would add four classes for zero flexibility and a slower dispatch in a render loop. OCP guards *open* variation axes; this wasn't one. We kept the `switch`."

### B5. How do you keep a large codebase from rotting into either extreme over years?

**Sample:** "Make both failure modes catchable at review with two questions — 'what likely change does this cost?' (under-engineering) and 'what present requirement forces this abstraction?' (over-engineering). Automate the one mechanical rule with the most leverage — domain ↛ infrastructure — in CI. And flip the incentive culturally: celebrate deleting a speculative `IFooFactory` as much as adding a needed seam. Rot enters one reasonable-looking PR at a time, in *both* directions, so the defense is a shared smell catalog plus restraint."

---

## Tips for Answering

1. **Lead with the smell-to-principle map** — switch→OCP, `instanceof`/`UnsupportedOperation`→LSP, fat interface/stubs→ISP, `new Concrete()`→DIP, shotgun surgery→SRP. It's the most useful thing you know.
2. **Stress the interlock:** OCP needs DIP (the seam) + LSP (safe substitutes); ISP sharpens DIP; SRP underlies all. Show you see it as one system.
3. **Be honest about the critique** — name CUPID (North), the data-oriented counterpoint (Muratori), and the OO-centricity. Seniors who can critique SOLID stand out from those who only recite it.
4. **Always pair a violation answer with the over-application caveat** — closed-set switch, one-impl interface — to show you avoid both failure modes.
5. **Tie it to a present requirement:** earn abstractions at the second case or a real test double, not preemptively (YAGNI).
6. **Match the philosophy to the cost** — SOLID for change-dominated I/O-bound code; data-oriented for hot loops. Profile, don't dogmatize.

---

[← Professional](professional.md) · [SOLID Section](../../README.md) · [Roadmap](../../../README.md)

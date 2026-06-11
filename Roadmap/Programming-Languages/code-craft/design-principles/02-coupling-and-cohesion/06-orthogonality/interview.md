# Orthogonality — Interview Questions

> **Category:** [Coupling & Cohesion](../../README.md) — designing a system so that unrelated parts stay unrelated: a change in one place has no effect on the others.

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

### J1. Define orthogonality in one sentence.

**Answer:** Two or more things are orthogonal if a change in one has **no effect** on the others — Hunt & Thomas's "eliminate effects between unrelated things." Unrelated features/modules should be independent.

### J2. Where does the term come from?

**Answer:** From **geometry / linear algebra**: orthogonal vectors meet at right angles and are **independent axes**. Moving along one axis doesn't change your position on another — the metaphor for changing one concern without affecting others.

### J3. Explain the helicopter and stereo analogies.

**Answer:** Helicopter controls are **non-orthogonal**: every input (collective, throttle, pedals, cyclic) affects every axis, so nothing can be adjusted alone — which is why helicopters are hard to fly. A stereo is **orthogonal**: volume, balance, and tone each change exactly one thing, so each can be set independently. We want code that behaves like the stereo.

### J4. Name three benefits of orthogonality.

**Answer:** (Any three) Localized change (an edit stays in one place); reuse (independent components lift out cleanly); reduced risk (faults are isolated, not cascading); a smaller test surface (test a part alone); parallel team work (two people change two modules without colliding).

### J5. Why is global mutable state bad for orthogonality?

**Answer:** It creates **invisible connections** between modules that look unrelated. Two functions sharing a global are silently coupled — running one changes what the other computes, and the effect can depend on execution order. Passing data in explicitly removes the hidden wire.

### J6. How does orthogonality relate to coupling and cohesion?

**Answer:** It's coupling and cohesion **at the system level**: low coupling (a change in A doesn't force a change in B) plus high cohesion (each concern lives on one axis) *is* orthogonality — "decoupling along feature axes."

### J7. Give an example of a non-orthogonal design and how you'd fix it.

**Answer:** A `processOrder` function that computes the price *and* writes a log file *and* runs SQL inline. Changing the log format forces edits to pricing, its callers, and its tests. Fix: pricing becomes a pure function; logging and persistence are separate collaborators (interfaces) the caller composes — now a logging change touches only the logger.

### J8. What does "depend on contracts, not internals" mean?

**Answer:** Depend on another component's **published interface** (a promise it keeps), not on its internal fields or undocumented behavior (accidents of the current implementation). Coupling to internals you don't control means a change you can't see can silently break you.

---

## Middle Questions

### M1. State the orthogonality test and what answer indicates good design.

**Answer:** *"If I dramatically change the requirements behind one function, how many modules are affected?"* An orthogonal design answers **one** (or close); a high count signals non-orthogonality — concerns you thought were separate are wired together. The module count is a direct measurement.

### M2. What is the contractor/team test?

**Answer:** Could you hand a feature to an independent contractor behind a thin interface and have them build it without learning — or disturbing — the rest of the system? The team version: can two engineers work two features in parallel without colliding? A "no" means those modules aren't orthogonal. It's what lets team throughput scale with team size.

### M3. What is toolkit/library orthogonality, and how do you protect it?

**Answer:** Whether using library A constrains library B, or a framework forces its assumptions into unrelated code (e.g., demanding your domain objects extend its base class). Protect it by **wrapping the dependency behind your own thin interface** so the library touches one place and can be swapped locally.

### M4. How do you keep cross-cutting concerns orthogonal?

**Answer:** Cross-cutting concerns (logging, auth, persistence, metrics) naturally want to touch every module. Don't braid them into business logic; isolate them with **decorators / middleware / AOP and dependency injection**, applied *around* the business code. Then a logging change touches the logging axis only. This is [Separation of Concerns](../../01-generic/03-separation-of-concerns/junior.md).

### M5. How does layering support orthogonality?

**Answer:** Stack the system into layers (UI → app → domain → persistence), each depending only downward and only through an interface. You can rework one layer's internals without crossing the boundary — independence along the vertical axis. It only works if you respect the boundaries; the first time a layer reaches two layers down, the orthogonality is gone.

### M6. Does orthogonality mean "no dependencies at all"?

**Answer:** No. Some dependencies are intentional and healthy (shared infrastructure: a `Money` type, a logging facade, a DI container). Orthogonality targets coupling between **unrelated business concerns**, not the existence of a shared platform. A system with zero shared infrastructure is maximally duplicated, not maximally orthogonal.

---

## Senior Questions

### S1. Is perfect orthogonality achievable? Should you aim for it?

**Answer:** No, and no. Every real system shares *something* (runtime, database, config, framework, domain types), so some coupling is unavoidable — and shared infrastructure is *leverage*, making the system more coherent. The target is **no coupling between conceptually unrelated concerns**, not zero coupling. Distinguishing intentional infrastructure coupling from accidental concern coupling is the judgement; audit and kill the second, cherish the first.

### S2. What is over-orthogonalizing, and why is it as bad as tangling?

**Answer:** Splitting the system into so many "independent" pieces — one-implementation interfaces, config-as-code, plugin systems for one plugin, layers of indirection — that understanding one behavior means reassembling a dozen fragments. It **relocates** cognitive load from "ripple risk" to "assembly cost" rather than removing it. The corrective is [YAGNI](../../01-generic/02-yagni/junior.md): earn an axis of independence from *real* variation; don't speculate it. An interface with one implementation is an unpaid abstraction tax, not orthogonality.

### S3. When do orthogonality and DRY conflict, and which wins?

**Answer:** They conflict when two pieces of code **look alike but encode independent concerns** that may diverge (e.g., signup vs. admin password rules, identical today). DRY says merge; orthogonality says keep separate so they vary independently. **Orthogonality wins** — merging couples unrelated concerns through one abstraction, and the next divergence forces a flag (the "wrong abstraction," which is more expensive than duplication). The decisive test: *would a change to one necessarily force the same change to the other?* No → keep separate.

### S4. How would you decide which axes deserve a seam?

**Answer:** Spend the (finite) orthogonality budget on the **axes the business actually moves along** — persistence mechanism, external vendors, delivery/UI, cross-cutting policies, volatile business rules. Don't seam dimensions that don't vary (one currency, one notification path, three hard-coded rules). This is [Encapsulate What Changes](../../03-module-and-class/01-encapsulate-what-changes/junior.md): find the hotspot of change and put the seam there, identified from real requirements, not imagination.

### S5. What's the catch with using AOP for orthogonality?

**Answer:** AOP perfectly separates cross-cutting *code*, but fully invisible weaving creates **action at a distance** — a reader of the business method has no local evidence that a transaction starts or that calls are retried/logged. The orthogonality of code becomes opacity of behavior. Prefer cross-cutting mechanisms **visible at the call site** (annotations like `@Transactional`, decorators, middleware) over invisible pointcuts. The goal (separate axis) is right; "separate" must not become "hidden."

### S6. How does orthogonality scale to architecture?

**Answer:** Microservices and bounded contexts are orthogonality bets: each owns a concern and changes independently. But a boundary only creates independence where the underlying connascence is genuinely low. Drawing a service wall across a tightly coupled concern doesn't decouple it — it makes the coupling cross a network/team boundary (a "distributed helicopter," worse than the monolithic one). Orthogonality at any scale is only as real as the boundaries are true.

---

## Professional Questions

### P1. How do you catch non-orthogonality in code review?

**Answer:** Run the blast-radius test on the PR: *does it make an unrelated concern depend on this one, or vice versa?* Smells: inline `log`/SQL in business logic, a new global/static mutable, a leaked SDK type in a boundary signature, a UI reaching past its layer, a flag added to a shared function for one caller. The highest-value question: *"If this concern's requirements changed, would it force a change to anything unrelated?"* And symmetrically, push back on speculative seams (one-impl interface, config nobody sets) — "it's more flexible" is a red flag.

### P2. What metrics actually track orthogonality?

**Answer:** **Change-coupling** (which files repeatedly change together in git history) is the best signal — it surfaces real coupling, including hidden global-state coupling, that static metrics miss. Also: afferent/efferent coupling and instability (Ca/Ce), connascence (kind/locality/degree), and global-mutable count as a leading indicator. The ground truth is the outcome: DORA lead time and change-failure rate. **Not** cyclomatic complexity or LOC — both are blind to cross-concern coupling.

### P3. How do you restore orthogonality in a legacy system?

**Answer:** Use change-coupling analysis to *find* the real tangles (don't guess) → characterization tests to pin behavior → introduce a seam (Extract Interface / Wrap) and route callers through it → kill global state one call site at a time → all opportunistically (Boy Scout Rule), never a big-bang rewrite. Never decouple without tests; never replace a tangle with a maze of one-impl interfaces (the over-orthogonalizing trap).

### P4. What team conventions keep a codebase orthogonal over years?

**Answer:** No global mutable state (pass dependencies in); cross-cutting concerns in their own layer (decorators/middleware visible at the call site); wrap external SDKs at the boundary; respect layer boundaries enforced by an **architecture-fitness test in CI** (ArchUnit / dependency-cruiser / import-linter); seams require a *present* axis of variation (no one-impl interfaces); depend on contracts not internals; one-way doors get a design note. These make the orthogonal path the default and let reviewers cite policy, not opinion.

### P5. Why can't you prove an orthogonality improvement with cyclomatic complexity?

**Answer:** Because cyclomatic complexity measures branchiness *within* code, not coupling *between* concerns. Decoupling two modules — moving a logging call out of business logic, wrapping an SDK — usually doesn't change branch counts at all. Quoting it makes the report suspect. Report change-coupling, afferent/efferent coupling, and DORA lead time, which actually move with the decoupling win.

---

## Coding Tasks

### C1. Make this orthogonal (TypeScript). Pricing, logging, and persistence are braided.

**Before:**

```typescript
function processOrder(order: Order, db: Database, logFile: string): number {
  let total = 0;
  for (const i of order.items) total += i.price * i.qty;
  appendFileSync(logFile, `Order ${order.id}: $${total}\n`);
  db.execute(`INSERT INTO orders VALUES (${order.id}, ${total})`);
  return total;
}
```

**After** — each concern on its own axis:

```typescript
function orderTotal(order: Order): number {                 // pricing: pure
  return order.items.reduce((s, i) => s + i.price * i.qty, 0);
}
interface Logger { record(event: string, data: object): void; }   // logging axis
interface OrderStore { save(id: string, total: number): void; }   // persistence axis

function processOrder(order: Order, log: Logger, store: OrderStore): number {
  const total = orderTotal(order);          // composition root: the ONLY meeting point
  log.record("order_priced", { id: order.id, total });
  store.save(order.id, total);
  return total;
}
```

Explain: now "change the log format" = one new `Logger` implementation; pricing is untouched and independently testable.

### C2. Remove the global state coupling (Python).

**Before** — checkout and reporting silently coupled through a global:

```python
CONFIG = {"tax_rate": 0.0}
def checkout(cart):
    CONFIG["tax_rate"] = 0.20
    return total(cart) * (1 + CONFIG["tax_rate"])
def generate_report(orders):
    return sum(o.amount * CONFIG["tax_rate"] for o in orders)  # affected by checkout!
```

**After** — explicit inputs, no shared mutable:

```python
def checkout(cart, tax_rate):
    return total(cart) * (1 + tax_rate)
def generate_report(orders, tax_rate):
    return sum(o.amount * tax_rate for o in orders)
```

State the reasoning: the report's output no longer depends on whether a checkout ran first; the hidden wire is gone, and each function is independently testable.

### C3. Spot and fix the leaked library type (TypeScript).

**Before** — axios leaks across the boundary:

```typescript
import axios, { AxiosResponse } from "axios";
function getUser(id: string): Promise<AxiosResponse> {     // every caller now needs axios
  return axios.get(`/users/${id}`);
}
```

**After** — wrap it; your own type at the boundary:

```typescript
interface HttpClient { get<T>(url: string): Promise<T>; }
class AxiosHttpClient implements HttpClient {              // axios lives here ONLY
  async get<T>(url: string): Promise<T> { return (await axios.get<T>(url)).data; }
}
```

Note in the interview: swapping axios for `fetch` is now one class, not a system-wide edit.

### C4. Orthogonality vs. DRY — when NOT to merge (Python).

```python
# Look identical today, but encode INDEPENDENT policies that may diverge.
def validate_signup_password(pw): return len(pw) >= 8 and any(c.isdigit() for c in pw)
def validate_admin_password(pw):  return len(pw) >= 8 and any(c.isdigit() for c in pw)
```

**Answer:** Do **not** DRY these into one function. They're independent concerns (tomorrow admins may need 16 chars + a symbol). Merging couples them; the divergence then forces a flag — the wrong abstraction. The test: *would a change to one force the same change to the other?* No → keep them separate; orthogonality beats DRY here. (If they instead shared a *real* invariant that must always agree, then merge.)

### C5. Pull a cross-cutting concern onto its own axis (Python).

**Before** — logging/auth/persistence braided into the business rule:

```python
def transfer(account, amount):
    logging.info(f"transfer {amount}")
    if not is_authorized(account): raise PermissionError
    account.balance -= amount
    db.commit()
```

**After** — business rule alone; concerns layered around it:

```python
@logged
@authorized
@transactional
def transfer(account, amount):
    account.balance -= amount     # pure business rule
```

Explain: "change the log format" now touches `@logged` only; the rule is independently testable.

---

## Trick Questions

### T1. "Orthogonality means no two parts of the system depend on anything." True?

**False.** It means *unrelated* parts are independent. Related parts *should* depend on each other, and shared infrastructure (a `Money` type, a logging facade, config) is healthy, intentional coupling. Zero coupling means maximal duplication, not maximal orthogonality.

### T2. "DRY is always good — remove every duplicate to improve orthogonality." Right?

**No — they can conflict.** DRY targets duplicated *knowledge*. Merging code that merely *looks* alike but encodes independent concerns *couples* those concerns — non-orthogonality. When dedup would couple independent things, orthogonality wins and you keep the duplication; the wrong abstraction is worse than duplication.

### T3. "More interfaces and layers always make a system more orthogonal." Agree?

**No.** Speculative seams — one-implementation interfaces, config nobody sets, layers of indirection — are **over-orthogonalizing**: they relocate complexity into assembly cost instead of removing it. An axis of independence is only worth it when the concern *actually* varies. Same `interface` tool, opposite verdict depending on whether the axis really moves.

### T4. "Microservices automatically give you orthogonality." Correct?

**No.** A service boundary only creates independence where the underlying coupling is genuinely low. Split a tightly coupled concern across services and you get a *distributed helicopter* — the same coupling, now crossing network and team boundaries, which is worse. Orthogonality is only as real as the boundaries are true.

### T5. "If a one-line logging change touches twenty files, that's just a big change." Right?

**No — it's a measurement of non-orthogonality.** The change is one line; the twenty-file blast radius is the *design* telling you that logging is tangled into twenty unrelated places. The problem is the design, not the change.

### T6. "Use AOP everywhere to make cross-cutting concerns perfectly orthogonal." Good idea?

**Caution.** AOP separates the *code* well, but fully invisible weaving hides *behavior* — action at a distance, where you can't tell from the call site that a transaction or retry is happening. Prefer mechanisms visible at the call site (annotations, decorators, middleware). Orthogonality of code must not become opacity of behavior.

---

## Behavioral Questions

### B1. Tell me about a time you found hidden coupling between unrelated features.

**Sample:** "Our nightly report intermittently produced wrong totals that we couldn't reproduce. The cause was a global `tax_rate` that the checkout flow *mutated* and the report *read* — two completely unrelated features coupled through shared mutable state. The report's output depended on whether a checkout had run that day. I removed the global and passed the rate explicitly to both. The lesson I quote now: global mutable state is an invisible, non-orthogonal wire between unrelated concerns."

### B2. Describe a time a missing abstraction (or an extra one) hurt you.

**Sample:** "We used a payment SDK's response type directly in service signatures 'to skip a wrapper.' When we changed processors, the types were entangled in ~80 files and a one-adapter change became a six-week migration. I added a `PaymentGateway` interface isolating the vendor in one place. The lesson: an unwrapped third-party type is non-orthogonality waiting for the vendor to change — the wrapper that felt 'not worth it' would have made the swap one file."

### B3. How do you push back when a teammate over-engineers for flexibility?

**Sample:** "I ask one non-confrontational question: 'Which axis does this seam correspond to — what actually varies here?' For a `CurrencyFormatterStrategy` with one implementation, the honest answer is 'nothing yet.' I suggest the concrete version now and earning the seam when a second case is real — citing our 'seams need a present axis of variation' standard, so it's policy, not my opinion. I frame deleting a speculative interface as the senior move."

### B4. When did you decide *not* to remove duplication?

**Sample:** "Two password validators were byte-identical, and a teammate wanted to DRY them. But one was for signup and one for admin — independent policies. I argued for keeping them separate: tomorrow admin rules tighten and signup doesn't, and a merged function would need a flag, coupling two unrelated concerns. The test I used: *would a change to one force the same change to the other?* No — so a little duplication kept them orthogonal. Two months later admin rules did change, and the separation paid off."

### B5. How do you keep a large codebase orthogonal over years?

**Sample:** "Make the orthogonal path the default: no global mutable state, cross-cutting concerns in their own layer, wrap external SDKs, and an architecture-fitness test in CI that fails the build if a layer is skipped. I run change-coupling analysis periodically to find unrelated files that keep changing together — that's where the hidden tangles are — and decouple them opportunistically as we touch them. Culturally, we celebrate deleting a speculative seam as much as adding a real one, because both failure modes — tangling and over-orthogonalizing — creep in one reasonable PR at a time."

---

## Tips for Answering

1. **Lead with the definition and the two analogies** (stereo = orthogonal, helicopter = not) — they're the clearest, most memorable framing.
2. **Give the test as a question:** "change one function's requirements — how many modules move?" Orthogonal → one.
3. **Tie it to coupling and cohesion:** orthogonality is those two at the system level (low coupling + high cohesion along feature axes).
4. **Name global mutable state** as the classic killer, and "pass it in" as the fix.
5. **Show both failure modes:** tangling (helicopter) *and* over-orthogonalizing (one-impl interfaces, config-as-code).
6. **Nail the DRY tension:** when dedup would couple independent concerns, orthogonality wins (the wrong abstraction is worse than duplication).
7. **For metrics, name change-coupling**, not cyclomatic complexity.

---

[← Professional](professional.md) · [Coupling & Cohesion](../../README.md) · [Roadmap](../../../README.md)

# Separation of Concerns — Interview Questions

> **Category:** [Design Principles](../../README.md) — each section of a system should address one concern, so you can reason about and change it without understanding or breaking the others.

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

### J1. What is Separation of Concerns?

**Answer:** Organizing a system so each section/module/layer addresses **one distinct concern** (aspect or responsibility), so you can understand and change that part **without** understanding or breaking the others. The payoff is independent reasoning and localized change.

### J2. What is a "concern"? Give examples.

**Answer:** A distinct aspect the software deals with. Application roles: **presentation, business logic, persistence.** Technical concerns: **logging, security/authorization, validation, transactions.**

### J3. Who coined the term, and what was the bigger idea?

**Answer:** **Edsger Dijkstra**, in *"On the role of scientific thought"* (**1974**). His bigger point: SoC is a technique for *ordering one's thoughts* — focusing on one aspect at a time — which he called the *only* available technique he knew for effectively managing complexity.

### J4. What's the test of whether two concerns are *actually* separated?

**Answer:** **Independent reasoning/change:** can you open one concern's code, understand it, and change it *without reading* the others? If you can't, they're still tangled — even if they're in different files.

### J5. Name some everyday manifestations of SoC.

**Answer:** Layered architecture (presentation/domain/data), MVC/MVP/MVVM, HTML/CSS/JS separation, functions doing one thing, middleware, decorators.

### J6. What's the difference between horizontal and vertical separation?

**Answer:** **Horizontal** = by technical layer (presentation/domain/data). **Vertical** = by feature/module (Users/Orders/Payments). Good designs use both — vertical modules, each layered internally.

### J7. Why is a god function (validation + business + SQL + logging + HTTP in one place) bad?

**Answer:** Every change touches everything: you can't change the DB without re-reading validation and HTTP; you can't reuse the logic from a CLI; you can't test the rule without a real DB and request. Concerns are tangled, so the change blast radius is huge.

### J8. What's the relationship between SoC and SRP?

**Answer:** **SRP is SoC applied to a single class** — the class-level, OO expression of the older, broader SoC idea. SoC is the principle; SRP ("one reason to change") is a rule that follows from it.

### J9. Name three benefits of separating concerns.

**Answer:** (Any three) Independent reasoning, localized change, testability (test a concern in isolation), reuse, parallel work, replaceability (swap the DB/UI by touching only that concern).

### J10. Can you over-separate?

**Answer:** Yes. Too many layers add indirection and hops ("where does X actually happen?"), and anemic layers that only forward calls are pure cost. Separation is bounded by [KISS](../01-kiss/) — match it to the problem's size and real axes of change.

---

## Middle Questions

### M1. What's the practical test for "is this a separate concern worth splitting out"?

**Answer:** **Does it change for a different reason, on a different schedule, driven by different people?** Different *reasons to change* = different concerns. The deepest definition of a concern is an *axis along which the system changes independently*.

### M2. What is a cross-cutting concern, and why does it resist plain layering?

**Answer:** A concern that cuts across many modules/layers because nearly every operation needs it — **logging, security, transactions, caching, metrics.** It resists plain layering because it can't live in *one* layer; handling it inline causes **scattering** (the concern copy-pasted everywhere) and **tangling** (each module braiding several concerns).

### M3. How do decorators, middleware, and AOP address cross-cutting concerns?

**Answer:** All three define the concern **once** and **weave it around** the business code from the outside, keeping the business code clean. **Decorators** wrap a function/method, **middleware** wraps a request in a pipeline, **AOP aspects** wrap a set of methods via a pointcut. Same idea at function / request / method-set scale.

### M4. Explain "functional core, imperative shell."

**Answer:** Separate **computation from I/O.** The **functional core** is pure (data in, decision out, no I/O) and holds the logic; the **imperative shell** is thin and does the I/O (read, then call the core, then write). The core becomes trivially testable (no mocks); the shell has no logic to test. It's SoC applied to *effects*.

### M5. What's policy vs. mechanism?

**Answer:** **Policy** = the *decision* (retry 3 times; VIPs get free shipping). **Mechanism** = the *machinery* that executes it (the retry loop; the shipping calculator). Separating them lets you change the decision without rewriting the machinery, and reuse the machinery with a different policy — e.g. pass `max_attempts` and `backoff` into a generic `with_retry`.

### M6. In a layered architecture, which way do dependencies point, and why?

**Answer:** **Inward, toward the domain.** Presentation and data depend on the domain; the domain depends on nothing technical. The domain is the valuable, stable concern (the business rules), so it stays free of HTTP and SQL and becomes testable in isolation. This is the Clean/Hexagonal Architecture direction.

### M7. When should you *not* separate two pieces of code?

**Answer:** When they **always change together** (they're really one concern), when the program is small enough that separation adds more indirection than it saves ([KISS](../01-kiss/)), when you'd create an anemic pass-through layer, or when you're separating to satisfy a pattern rather than a real axis of change.

### M8. How does SoC relate to cohesion and coupling?

**Answer:** SoC is the *intent*; cohesion and coupling are the *evidence*. Separating concerns *produces* **high cohesion** (each module serves one concern) and **low coupling** (modules don't reach into each other). It also yields **[orthogonality](../../02-coupling-and-cohesion/06-orthogonality/)** — changing one concern doesn't affect unrelated ones.

---

## Senior Questions

### S1. Why can't you separate every concern cleanly at once?

**Answer:** The **dominant decomposition problem** ("tyranny of the dominant decomposition"). Source code is laid out along *one* primary axis; whichever you pick, that concern separates cleanly and **all others scatter across it.** Decompose by layer → features scatter across layers; by feature → layer-concerns scatter across features; either way cross-cutting concerns scatter across everything. You choose a *dominant* axis (matching your real axis of change) and use secondary mechanisms (AOP/middleware/ports) to recover the scattered concerns.

### S2. When does separation become over-separation?

**Answer:** When the layer is **anemic** (only forwards calls, no nameable concern), when the parts **always change together** (false axis — indirection cost, no independence benefit), when it **destroys traceability** ("where does X happen?" is unanswerable), or when it's **speculative** (added because the diagram has it, not because an axis of change demands it). Over-separation is as real a defect as tangling.

### S3. What's the trade-off between separation and locality of behavior?

**Answer:** Separated code is easy to *change* (touch one concern) but hard to *read* (a feature is smeared across layers). Local code is easy to *read* (it's all in one place) but harder to *change one concern* (it's mixed in). Resolution: **separate along axes that change independently; keep local the things read and changed together.** When two aspects always co-vary, locality wins; when they vary independently, separation wins. Change-coupling from git history tells you which.

### S4. What's the real cost of AOP / woven cross-cutting concerns?

**Answer:** **Implicitness — "spooky action at a distance."** The business code says nothing about the woven concern (logging, tx, auth), so behavior happens with no local evidence; debugging is harder (you must know the aspect exists), and aspect *ordering* (auth inside vs. outside the transaction) is a correctness question invisible in the business code. Heuristic: weave only **pervasive, business-uninteresting** concerns; keep business-meaningful behavior **visible** at the call site.

### S5. How do SoC, SRP, cohesion, coupling, and orthogonality relate?

**Answer:** They're **one idea at five scales**: SoC is the general principle; **SRP** is it at class scale ("one reason to change"); **cohesion** is the internal view (a well-separated module is cohesive); **low coupling** is the result; **orthogonality** is the system-level effect (change one thing, unrelated things unaffected). Separate concerns well and all five hold at once.

### S6. How do you choose between a layer-dominant and a feature-dominant decomposition?

**Answer:** Match the **dominant axis to the real axis of independent change/ownership.** If teams own features and ship them independently → **feature/module-dominant** (modular monolith, microservices), each layered internally. If one team churns *technology* (swaps DBs, adds UIs) → layers isolate that churn. The mature answer is usually **both, hierarchically**: vertical modules at the top, layered inside. Getting the dominant axis backwards makes your most-frequent changes the most expensive.

### S7. How does dependency inversion keep layered separation from leaking at the boundary?

**Answer:** The domain defines a **port** (interface) for what it needs (e.g. `OrderStore.save`); the persistence concern implements it as an **adapter**. So the dependency points *inward* (domain → port ← adapter), the domain stays pure (no SQL), and you can swap implementations by touching only the adapter. Without this, the domain ends up depending on the data layer and the separation is theater.

---

## Professional Questions

### P1. How do you enforce separation of concerns in code review?

**Answer:** Catch concerns leaking across boundaries — SQL in controllers, business rules in templates/repositories, HTTP in the domain, inlined logging/auth/metrics — and push back on *false* separation (anemic pass-through layers) too. The highest-value questions: *"Does this concern belong in this layer?"* and *"What does this layer decide that its neighbors don't?"*

### P2. What metrics actually track separation?

**Answer:** **Dependency-direction tests in CI** (ArchUnit / import-linter / deptrac: "domain imports nothing technical") — the highest-leverage automated control. **Change-coupling** (files that change together in git history) reveals both tangling and false separation. **DORA outcomes** (lead time, change-failure rate) are the ground truth. **Not** a tidy folder tree alone — folders are a hypothesis, not proof.

### P3. How do you untangle a legacy god class toward separated concerns?

**Answer:** **Characterization tests first** (you can't separate safely without pinning behavior), then **name the concerns** inside the god method, **extract one at a time** smallest-first (tests green each step, small commits), push **I/O to the edges leaving a pure core**, and **weave cross-cutting concerns into wrappers.** Strangle, never big-bang rewrite; and don't replace a tangle with *over-separation* (eight anemic layers).

### P4. How do you manage cross-cutting concerns at scale?

**Answer:** Each goes through **shared infrastructure** — one logging decorator/middleware, one auth filter, one transaction boundary, one caching decorator — not copy-pasted. Weave the pervasive, business-uninteresting ones; keep business-meaningful behavior visible; watch aspect/middleware **ordering** (pin it with tests); prefer explicit, listed application (decorators/registered middleware) when the concern's *presence* matters to the reader.

### P5. A one-line business-rule change requires editing five files (controller, service, facade, repository, mapper). What does that tell you?

**Answer:** The separation is **wrong** — almost certainly **over-separated** along false axes (anemic layers), or split along the wrong dominant axis. Well-separated code lets you change one concern in one place. The fix: collapse the anemic layers (facade/mapper that only forward) and keep layers that *decide* something. Files-touched-per-change is the signal.

### P6. Why isn't a clean `controllers/services/repositories` folder tree proof of good separation?

**Answer:** Because the folders can be theater. If the "service" reaches into the repository's SQL, knows the controller's HTTP shape, and shares mutable state, there's *zero* independent reasoning despite the tidy tree. SoC is **conceptual independence**, not folder layout. Prove it with dependency-direction tests (green in CI) and change-coupling — not the directory structure.

---

## Coding Tasks

### C1. Untangle this god handler (Python).

**Before** — five concerns in one function:

```python
def register_user(request):
    body = json.loads(request.body)
    if "@" not in body["email"]:                       # validation
        return Response(400, '{"error":"bad email"}')  # presentation
    hashed = bcrypt.hash(body["password"])             # business
    db.execute("INSERT INTO users ...", ...)           # persistence
    print(f"[INFO] registered {body['email']}")        # logging
    return Response(201, '{"status":"ok"}')            # presentation
```

**After** — one concern per place:

```python
def validate_registration(email, password): ...         # validation
class UserService:                                       # business
    def register(self, email, password): ...             # calls validate + repo
class UserRepository:                                    # persistence
    def save(self, user): ...                            # SQL only here
@logged                                                  # logging woven in
def register_user(request):                              # presentation only
    user = service.register(body["email"], body["password"])
    return Response(201, '{"status":"ok"}')
```

State the win: each concern is now changeable and testable in isolation; logging is woven, not inlined.

### C2. Separate computation from I/O — functional core, imperative shell (Python).

**Before** — logic tangled with I/O:

```python
def process_refund(order_id):
    order = db.fetch(order_id)                       # I/O
    if order.status != "PAID": raise Error()         # logic
    amount = order.total * Decimal("0.9")            # logic
    db.update(order_id, status="REFUNDED")           # I/O
    mailer.send(order.email, f"Refunded {amount}")   # I/O
```

**After:**

```python
def decide_refund(order) -> RefundDecision:          # PURE core — testable, no mocks
    if order.status != "PAID": raise NotRefundable()
    return RefundDecision(amount=order.total * Decimal("0.9"),
                          email=order.email, new_status="REFUNDED")

def process_refund(order_id):                        # thin shell — I/O only
    order = db.fetch(order_id)
    d = decide_refund(order)
    db.update(order_id, status=d.new_status)
    mailer.send(d.email, f"Refunded {d.amount}")
```

### C3. Pull a cross-cutting concern out with a decorator (Python).

```python
# BEFORE — logging + auth + tx tangled into business code (and scattered everywhere)
def transfer(a, b, amt):
    log.info("transfer start"); 
    if not user.can("transfer"): raise Forbidden()
    with db.transaction():
        accounts.debit(a, amt); accounts.credit(b, amt)
    log.info("transfer done")

# AFTER — each cross-cut is one reusable wrapper; business code is clean
@logged
@requires("transfer")
@transactional
def transfer(a, b, amt):
    accounts.debit(a, amt)
    accounts.credit(b, amt)
```

Mention the senior caveat: decorator **order** changes semantics (auth inside vs. outside the tx), and the woven concerns are invisible at the call site.

### C4. Separate policy from mechanism (Python).

**Before** — retry policy baked into the mechanism:

```python
def fetch(url):
    for attempt in range(3):                  # policy (3) + mechanism tangled
        try: return http.get(url)
        except Timeout:
            if attempt == 2: raise
            time.sleep(2 ** attempt)           # policy (backoff) baked in
```

**After** — mechanism takes the policy as a parameter:

```python
def with_retry(action, *, max_attempts, backoff):   # MECHANISM (reusable)
    for attempt in range(max_attempts):
        try: return action()
        except Timeout:
            if attempt == max_attempts - 1: raise
            time.sleep(backoff(attempt))

fetch = lambda url: with_retry(lambda: http.get(url),
                               max_attempts=3, backoff=lambda a: 2 ** a)  # POLICY
```

### C5. Spot the leaked concern (Java).

```java
// What's wrong here?
class Order {                          // a DOMAIN object
    public HttpResponse toResponse() { // ← presentation concern leaking IN
        return HttpResponse.ok(this.toJson());
    }
    public void save() {               // ← persistence concern leaking IN
        db.execute("INSERT INTO orders ...");
    }
}
```

**Answer:** `Order` is a domain object but it knows about **HTTP** (`HttpResponse`) and **SQL** (persistence). Both are leaks: a presentation change or a DB change can now break business logic. Move `toResponse()` to a presentation mapper/controller and `save()` to an `OrderRepository`; `Order` should hold only business rules and data.

---

## Trick Questions

### T1. "Putting code in separate folders/files means concerns are separated." True?

**False.** SoC is **conceptual independence**, not folder layout. Ten files that all reach into each other's internals are still tangled. The test is whether you can change one concern *without reading* the others — folders are a hypothesis, not proof. Prove it with dependency-direction tests and change-coupling.

### T2. "More layers = better separation = more senior." Agree?

**No.** Past the real axes of change, extra layers are **over-separation**: anemic pass-throughs that add hops, destroy traceability ("where does X happen?"), and buy no independence. Collapsing an un-needed layer is the senior move. Separation is bounded by [KISS](../01-kiss/).

### T3. "AOP makes code cleaner, so use it for everything." Right?

**No.** AOP/weaving buys clean business code with **implicitness** — action-at-a-distance that's invisible at the call site and hard to debug. Reserve it for **pervasive, business-uninteresting** concerns (logging, metrics, tracing, transactions). Never hide business-meaningful behavior (or error-handling control flow) in a woven aspect.

### T4. "You can separate all concerns cleanly if you just design carefully enough." Correct?

**No** — that's the **dominant decomposition problem.** Code lays out along one primary axis; whatever you pick, the other concerns scatter across it, and cross-cutting concerns scatter no matter what. You choose a dominant axis and recover the scattered concerns with secondary mechanisms (AOP/middleware/ports). There's no single perfectly-separated structure.

### T5. "SoC and SRP are different principles you must apply separately." True?

**Misleading.** **SRP is SoC at class scale** — the same idea ("keep independent things independent / one reason to change") expressed for a single class. Along with cohesion, coupling, and orthogonality, they're one principle viewed at five scales, not five competing rules.

### T6. "Separating concerns always makes code easier to work with." Always?

**No.** Separation trades **locality of behavior** for changeability. If two aspects always change *together*, splitting them just adds hops and makes the feature harder to read with no benefit. Separate along axes that change *independently*; keep co-varying things local.

---

## Behavioral Questions

### B1. Tell me about a time you untangled a god class or function.

**Sample:** "We had a 3,000-line `OrderManager` doing validation, pricing, SQL, payment calls, email, and logging. I pinned its behavior with characterization tests, labeled the concerns inside, and extracted them one at a time — repository for persistence, a pure pricing core, a notifier, and a logging decorator — running the tests after each step. The pricing logic finally became unit-testable without a database. The lesson I quote: name the concerns first, then extract one at a time with tests green."

### B2. Describe a time a leaked concern caused a production problem.

**Sample:** "A discount rule lived inside an email template because it was the fast place to put it. Later the same rule was implemented differently in checkout, and they diverged — customers were charged one number and emailed another. We moved the rule into the domain and reduced the template to *displaying* a computed value. The lesson: the domain decides; presentation only shows. Business logic leaking into presentation duplicates and drifts."

### B3. How do you push back when a teammate inlines a query in a controller?

**Sample:** "I ask 'does this concern belong in this layer?' — a query is persistence leaking into presentation, which makes a future DB change touch every controller. I suggest moving it behind the repository, and I lean on our CI rule that the controller package may not import the db package, so it's a standard, not my opinion. I frame it as keeping the change cheap later, not as criticism."

### B4. When did you decide *against* adding more separation?

**Sample:** "A teammate wanted controller → service → facade → repository → mapper for simple CRUD. I pushed back: the facade and mapper were anemic pass-throughs with no concern of their own — pure indirection that destroys traceability. We kept controller → service → repository, each with a real concern. Files-per-change dropped by half. Over-separation is a defect, not seniority."

### B5. How do you keep concerns separated in a large codebase over years?

**Sample:** "Make the separated path the default and the leak path expensive: a CI dependency-direction rule (domain imports nothing technical), 'no SQL in controllers / no HTTP in the domain' as policy, one shared wrapper per cross-cutting concern, and a documented dominant axis so people put code where its concern lives. Boundaries erode one reasonable commit at a time, so the defense is automated checks plus review asking 'does this concern belong here?'"

---

## Tips for Answering

1. **Define a concern as an axis of independent change** — "different reason to change" — not just "a thing."
2. **Lead with Dijkstra (1974)** and the bigger idea: ordering one's thoughts, the only technique for managing complexity.
3. **Nail cross-cutting concerns**: scattering + tangling, solved by decorators/middleware/AOP (same idea at three scales) — and name the AOP cost (implicitness / action-at-a-distance).
4. **State the test of real separation**: independent reasoning/change, not folder layout.
5. **Show the locality trade-off**: separate along independent axes; keep co-varying things local.
6. **Place SoC among its relatives**: SRP = SoC at class scale; cohesion/coupling = the measurements; orthogonality = the effect.
7. **For production, name dependency-direction CI tests and change-coupling** — and that a tidy folder tree isn't proof.
8. **Mention the dominant-decomposition problem** when asked why you can't separate everything — it signals senior depth.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)

# Open/Closed Principle (OCP) — Interview Questions

> **Category:** [Design Principles → SOLID](../../README.md) — add new behavior by writing new code, not by editing code that already works.

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

### J1. State the Open/Closed Principle.

**Answer:** "Software entities (classes, modules, functions) should be **open for extension but closed for modification**." You should be able to add new behavior by writing new code, not by editing existing, tested code. Origin: Bertrand Meyer (1988); the polymorphic reformulation everyone uses today is Robert C. Martin's.

### J2. How can something be open and closed at the same time?

**Answer:** The two words describe different things. **Closed** refers to the *source code* — you don't edit it. **Open** refers to *behavior* — it can grow. A stable interface (closed) with a growing set of implementations (open) satisfies both.

### J3. What's the textbook code smell that signals an OCP violation?

**Answer:** A `switch`/`if`-ladder that dispatches on a **type or kind**. Every new type forces you to reopen and edit that function, re-testing the existing branches.

### J4. What two ingredients make OCP work?

**Answer:** **Abstraction** (an interface that captures *what* varies, like `Shape.area()`) and **polymorphism** (the calling code invokes the right implementation at runtime without knowing which concrete type it has).

### J5. Refactor a type-switch to satisfy OCP — describe the steps.

**Answer:** (1) Find what varies (the per-type behavior). (2) Define an interface capturing it. (3) Make each type implement the interface. (4) Have the calling code depend on the interface and call the polymorphic method. New types become new classes; the calling code is never edited again.

### J6. Name a design pattern that directly realizes OCP.

**Answer:** **Strategy** (also Template Method, Decorator, and plugin/registry architectures). Strategy puts the varying behavior behind an interface so new strategies plug in without editing the context.

### J7. Does OCP mean you never change code?

**Answer:** No. You still change code to fix bugs and to introduce the abstraction itself the first time. OCP means you shouldn't have to edit *existing, working code* to add a *new variant* of an already-abstracted behavior.

### J8. What does "closed against *what*?" mean?

**Answer:** You can only close a module against a *specific, chosen axis of variation* (e.g., "new shapes"). You can't be closed against all possible changes — every abstraction protects one direction and leaves others exposed.

---

## Middle Questions

### M1. Why is choosing the wrong axis of variation worse than not abstracting at all?

**Answer:** A wrong axis costs you twice: you build and maintain indirection that doesn't help, *and* the change that actually arrives (on a different axis) still edits working code. No abstraction at least avoids the first cost. Predict the axis from the module's change history, not imagination.

### M2. When should you apply OCP — and when not?

**Answer:** Apply it when an axis has *proven* it varies — usually after the second or third real variant (the rule of three) — or when growth is provably certain (a framework plugin point, a committed list of providers). Don't apply it to a small, stable set or to variation you've only imagined; that's speculative abstraction, a YAGNI violation.

### M3. How do OCP, DIP, and dependency injection relate?

**Answer:** **OCP** says put the varying behavior behind an abstraction so new variants don't edit existing code. **DIP** says high-level code should depend on that abstraction, not the concrete. **DI** is the mechanism that supplies the concrete from outside (constructor/parameter/container). OCP defines the seam, DIP enforces the dependency direction, DI delivers the implementation through it.

### M4. Give three ways to achieve OCP that don't use classical inheritance.

**Answer:** Higher-order functions (pass the varying behavior as a function), composition/delegation (inject a collaborator holding the behavior), configuration/data tables (move the variation into data the code reads), and plugin registries (self-registering modules). OCP is a property of the dependency shape, not of any keyword.

### M5. Is every `if`/`switch` an OCP violation?

**Answer:** No. A conditional over a *closed, stable set* (days of the week, card suits, HTTP methods) is fine — an interface there is pure ceremony. The smell is specifically a conditional over a *type/kind that keeps growing*, forcing repeated edits to working code.

### M6. Why is introducing the abstraction itself not free?

**Answer:** The first time you add the interface, you *do* edit existing code. OCP buys you closure for *subsequent* variants, not for the initial refactor. That's why you wait until variation is real — so the one-time cost buys genuine future savings.

### M7. How does OCP sometimes conflict with DRY or clarity?

**Answer:** Pushing all variants behind one interface can spread a single conditional across many files. If the variants share most logic and differ trivially, the abstraction can *reduce* clarity. Judge by whether the axis truly churns; don't fragment cohesive logic just to avoid a small switch.

---

## Senior Questions

### S1. Explain the expression problem and why it limits OCP.

**Answer:** A structure varies along two axes — **types** (Circle, Rectangle…) and **operations** (area, perimeter, render…). Mainstream dispatch lets you make only *one* axis open at a time. OO interfaces make adding a **type** cheap but adding an **operation** expensive (edit every class); visitor/functional dispatch makes adding an **operation** cheap but adding a **type** expensive (edit every function). So "open for extension" is always relative to one chosen axis — you cannot be open to both with one hierarchy. This is *why* "closed against all change" is impossible.

### S2. Meyer's OCP vs. Martin's OCP — what's the difference?

**Answer:** Meyer (1988) framed it around **inheritance**: a class is closed but extensible via subclassing. Martin reformulated it around **polymorphism through abstraction**: depend on an interface, extend by adding implementations. Meyer's literal reading encourages implementation inheritance (fragile base class, Liskov risks); Martin's uses interface inheritance + composition and is the recommended modern reading.

### S3. Why can a speculative OCP abstraction be worse than the duplication or conditional it replaced?

**Answer:** A conditional is visible, local, and cheap to replace with the *right* abstraction once the axis is observed. A wrong abstraction is invisible coupling: when variation arrives on an unanticipated axis, you bend the interface with extra methods/flags, it becomes misshapen, and it's load-bearing — expensive to keep *and* risky to remove. "Prefer a concrete `if` to a speculative abstraction." OCP must be earned, not front-loaded.

### S4. Is OCP a goal or a consequence?

**Answer:** Best treated as a **consequence**. Front-loading OCP ("make this open for extension") produces speculative abstractions guessing the axis. Applying it retroactively — write concrete code, watch what you keep editing, close that axis once it proves it varies — produces abstractions that fit. Martin explicitly says to protect only the changes *experience* tells you are likely, not all change.

### S5. How are OCP and DIP two views of the same refactor?

**Answer:** OCP names the *benefit* (existing code doesn't change when behavior extends). DIP names the *dependency rule* that produces it (high-level policy and low-level variants both depend on an abstraction owned by the high-level side; the variant's dependency points *up* to the abstraction). OCP is usually unachievable without DIP — if high-level code depends directly on concretes, no amount of wishing makes it closed.

### S6. When is OCP worth front-loading despite "earn it" advice?

**Answer:** At **published boundaries** — plugin contracts, public APIs. Once external code depends on the abstraction, it's a one-way door: changing it breaks consumers. So plugin/API interfaces deserve deliberate up-front design, the opposite of internal abstractions which should emerge. The reversibility of the seam decides whether to front-load.

---

## Professional Questions

### P1. OCP can be violated in two opposite directions — name and police both.

**Answer:** **Under-OCP** is a growing type-switch (every variant edits working code) — ask "has this branch grown 3+ times? close it." **Over-OCP** is speculative abstraction (one-impl interface, framework for a fixed set) — ask "what *present* requirement forces this, and is this the right axis?" Most reviews catch only under-OCP because adding structure looks responsible; in mature codebases over-OCP is the more common and expensive disease, so treat an unjustified interface like a missing test.

### P2. How do you refactor a legacy type-switch toward OCP safely?

**Answer:** (1) **Characterization tests** pinning every branch's current behavior first. (2) Introduce the implied interface. (3) Move **one branch per commit** to an implementing class, keeping the switch delegating, tests green each step. (4) Replace the switch with polymorphic dispatch. (5) Delete the dead switch. Never refactor without tests; never polymorphism-ify a *stable* switch for purity.

### P3. How do you remove a wrong, load-bearing OCP abstraction?

**Answer:** Characterize all callers → inline the implementations back (or collapse the interface to the one method that actually varies) → simplify each caller independently, deleting the bolted-on methods/flags it never used → re-extract only the genuinely varying axis if it still varies → delete the old interface. Watch for implementations that `throw UnsupportedOperationException` — they're premature OCP that also violate LSP/ISP and are prime removal candidates.

### P4. How do you decide the axis to be open against in production?

**Answer:** From **change history**, not imagination. Run change-coupling / `git log` analysis on the module: the dimension that has varied repeatedly is the one to close against. If formats have been stable but the schema changed eleven times, closing against formats is useless — protect the schema axis.

### P5. What team conventions keep the OCP balance healthy?

**Answer:** Rule-of-three before extracting; no one-implementation interfaces in new code (exceptions: test seams and published boundaries); name the axis in the PR when introducing a seam; published extension points get up-front design and a deprecation policy; lint against `instanceof`/type-field reads in "closed" code; and *celebrate* the right concrete code (deleting an unused framework is a win, not a regression).

### P6. Why is "we built it to be flexible" a red flag in review?

**Answer:** Because flexibility nobody uses is pure cost — indirection to read and maintain, plus wrong-axis risk. The justification for an abstraction must be a *present* requirement (a real second implementation, a real test fake, a real external extender), not a hypothetical future. "Flexible/future-proof/extensible" describes a *guess*; OCP should respond to *evidence*.

---

## Coding Tasks

### C1. Refactor this OCP violation (Java).

**Before** — every new shape edits `area`:

```java
double area(Object shape) {
    if (shape instanceof Circle c) return Math.PI * c.radius * c.radius;
    if (shape instanceof Rectangle r) return r.width * r.height;
    throw new IllegalArgumentException("unknown shape");
}
```

**After** — closed against new shapes:

```java
interface Shape { double area(); }
record Circle(double radius) implements Shape {
    public double area() { return Math.PI * radius * radius; }
}
record Rectangle(double width, double height) implements Shape {
    public double area() { return width * height; }
}
double totalArea(List<Shape> shapes) {
    return shapes.stream().mapToDouble(Shape::area).sum();
}
// A Triangle is now a new class — totalArea is never touched.
```

State: "adding a shape went from editing *two* places (the new shape + `area`) to *one* (just the new shape)."

### C2. Achieve OCP without classes (TypeScript).

```typescript
// Closed: sortBy never changes when a new ordering is needed.
function sortBy<T>(items: T[], key: (x: T) => number): T[] {
  return [...items].sort((a, b) => key(a) - key(b));
}
sortBy(orders, o => o.total);      // extend by passing a NEW function
sortBy(orders, o => o.createdAt);  // sortBy untouched
```

Point to make: OCP is a property of *dependency shape*; a higher-order function is as valid a seam as an interface.

### C3. Spot the speculative abstraction and remove it (Go).

**Before:**

```go
type Repo interface{ Save(o Order) error }
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// SQLRepo is the only implementation, used in one place.
```

**After:**

```go
type SQLRepo struct{ db *sql.DB }
func (r SQLRepo) Save(o Order) error { /* ... */ return nil }
// Use SQLRepo directly. When a 2nd repo or a test fake is REAL, extract the
// interface then — Go's structural typing adds it without touching SQLRepo.
```

Caveat to state: *if you need a test double right now, the test seam is a present requirement — then the interface is justified.*

### C4. Pick the right axis (discussion task).

> "A reporting module added a `Report` interface to be open to new report *types*. In the last year, zero new types were added, but a new *operation* (export-to-PDF) was requested, forcing edits to all five report classes. What went wrong and what would you do?"

**Answer:** The team closed against the *type* axis, but the *operation* axis is the one that varied (the expression problem). With OO interfaces, adding an operation is the expensive direction. Options: orient dispatch around operations (a visitor over a stable report set), or — if the history shows operations churn and types don't — invert the design so operations are the open axis. Choose the axis from observed change, not from which one sounds extensible.

### C5. Earn the abstraction (Python).

**Before** — a flag ladder that's grown three times:

```python
def notify(user, msg, channel="email"):
    if channel == "email": send_email(user.email, msg)
    elif channel == "sms": send_sms(user.phone, msg)
    elif channel == "push": send_push(user.device, msg)   # 3rd → extract now
```

**After** — closed against new channels:

```python
class Channel(ABC):
    @abstractmethod
    def send(self, user, msg): ...

class EmailChannel(Channel):
    def send(self, user, msg): send_email(user.email, msg)
class SmsChannel(Channel):
    def send(self, user, msg): send_sms(user.phone, msg)
class PushChannel(Channel):
    def send(self, user, msg): send_push(user.device, msg)

def notify(user, msg, channel: Channel):
    channel.send(user, msg)   # a Slack channel is now a new class, not an edit
```

Point: the abstraction was *earned* on the third concrete variant — not guessed on the first.

---

## Trick Questions

### T1. "OCP means you should make everything open for extension." True?

**False — and the most common misunderstanding.** Making everything open for extension produces speculative abstractions: one-implementation interfaces and frameworks for fixed sets. That's *over*-OCP, more expensive than the concrete code it replaced. OCP is a *localized* investment along an axis you have evidence will vary. The default is concrete; abstract the axis that proves it churns.

### T2. "Any `if`/`switch` violates OCP." Right?

**No.** A conditional over a *closed, stable set* (card suits, days, HTTP methods) is correct and clearer than an interface. OCP targets a conditional over a *type/kind that keeps growing* and forcing edits to working code. Don't polymorphism-ify stable switches.

### T3. "More interfaces and patterns = more senior, more OCP-compliant code." Agree?

**No.** Speculative interfaces are gold-plating. The senior move is often *removing* an unearned abstraction. Complexity must be justified by a present requirement; simplicity is the default. A 20-line function beating a one-strategy "Strategy framework" is the better OCP outcome.

### T4. "You can write a module that's closed against all future changes." Possible?

**No — it's structurally impossible (the expression problem).** Every dispatch choice makes one axis open and another closed. Closing against new types opens you to expensive operation-additions, and vice versa. You always choose *which* change to be open against; predicting that axis is the entire skill.

### T5. "Introducing the abstraction is the moment OCP starts paying off." Right?

**No — introducing it is itself a *modification* of existing code.** OCP pays off on the *subsequent* variants, which become new classes instead of edits. That's why you don't introduce the seam until variation is real: the one-time refactor cost only pays back if more variants actually arrive.

### T6. "OCP and DIP are unrelated principles." True?

**False.** They're two views of the same refactor. OCP is the benefit (closed existing code); DIP is the dependency rule that produces it (depend on an abstraction; the variant's dependency points up to it). OCP is usually unachievable without inverting the dependency — if high-level code depends on concretes directly, it can't be closed.

---

## Behavioral Questions

### B1. Tell me about a time you removed complexity from a system.

**Sample:** "We had a generic, plugin-based 'decision engine' running six business rules, all written by our own team — the 'business users will author rules' premise never came true. The framework was thousands of lines; the rules were a couple hundred. I re-expressed the rules as plain functions and deleted the engine. 'Add a rule' dropped from days to minutes. The lesson I quote now: OCP at a boundary only pays if someone else actually crosses it — flexibility nobody uses is pure cost."

### B2. Describe a time an abstraction guessed the wrong axis.

**Sample:** "A `DocumentExporter` interface was built to be open to new formats. Over a year we added *zero* formats but changed the document schema eleven times — and each change forced editing all five exporters. We'd closed against the stable axis. I unified the export logic, which barely varied, and centralized the schema mapping so a field change touched one place. I learned to choose the axis from change history, not from which dimension sounds extensible."

### B3. How do you push back when a teammate over-engineers with a speculative interface?

**Sample:** "I ask one non-confrontational question: 'What present requirement makes this interface necessary — how many implementations exist today?' If it's one and the rest is hypothetical, I suggest the concrete class now and extracting the interface when the second one is real, citing our rule-of-three convention so it's a standard, not my opinion. I frame using the concrete type as the disciplined choice, not a shortcut."

### B4. Tell me about refactoring a brittle type-switch in legacy code.

**Sample:** "A checkout service dispatched on payment type in a 300-line switch that broke on every release — shared mutable state above the switch meant a new case could regress an untouched one. The axis had clearly proven it varied (five additions in a year), so I wrote characterization tests for each branch, then moved one case per commit into its own `PaymentMethod` class, keeping the switch delegating until all were migrated. New methods became new classes; the cross-branch regression class of bug disappeared."

### B5. When did you decide *not* to apply OCP?

**Sample:** "A teammate wanted a `Renderer` interface for a feature that had exactly one renderer and no second on the roadmap. I pushed back — a one-implementation interface is indirection with no payoff and risks guessing the wrong axis. We used the concrete class and agreed to extract the interface the day a second renderer or a test fake became a real requirement. That kept the code readable and let the abstraction, when it came, be shaped by two real cases."

---

## Tips for Answering

1. **State the definition precisely** — "open for extension, closed for modification" — and immediately resolve the apparent contradiction (open = behavior, closed = source code).
2. **Name the smell** (type-switch) and the **mechanism** (abstraction + polymorphism).
3. **Stress "closed against *what*?"** — OCP protects one chosen axis; you can't be closed against all change (mention the expression problem for senior roles).
4. **Tie OCP to YAGNI and the rule of three** — earn the abstraction; don't front-load it. Over-OCP is the more common, more expensive mistake.
5. **Connect OCP to DIP** — depend on the abstraction; the dependency inversion is the mechanism that achieves closure.
6. **Distinguish internal seams (emergent) from published boundaries (up-front)** — reversibility decides whether to front-load.
7. **Police both failure directions** — for senior/professional roles, show you catch speculative abstraction as readily as a growing switch.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)

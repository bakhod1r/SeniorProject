# Refactoring as a Discipline — Interview Questions

> **Category:** [Craftsmanship Disciplines](../README.md) — refactoring as a continuous, behavior-preserving habit done under passing tests, not a big-bang rewrite.

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

### J1. Define refactoring.

**Answer:** Changing the *internal structure* of code **without changing its external behavior**. Same observable inputs/outputs/side effects before and after. If behavior changed, it wasn't a refactoring.

### J2. What are "the two hats"?

**Answer:** At any moment you're either *adding behavior* (tests go red→green) or *refactoring* (tests stay green) — never both at once. Kent Beck's metaphor; you swap hats frequently but wear only one at a time.

### J3. Why wear only one hat at a time?

**Answer:** Because the two activities have opposite relationships to the tests. If you do both at once and a test fails, you can't tell whether your new feature has a bug or your refactor broke something. One hat keeps every failure unambiguous.

### J4. Why do you refactor only when the tests are green?

**Answer:** A green bar is evidence behavior is currently correct. Refactor on green, re-run, and if it's still green the suite *proves* you didn't change behavior. On red, you can't distinguish your change from the pre-existing failure.

### J5. What's the difference between refactoring and a rewrite?

**Answer:** Refactoring is small, behavior-preserving, continuous, tests-green-throughout. A rewrite is big-bang, behavior re-derived, tests broken until "done," all-or-nothing — and it discards the bug fixes baked into the old code.

### J6. What is a code smell?

**Answer:** A surface symptom hinting at a deeper structural problem (long function, duplication, magic numbers, a lying name). It's a *trigger* to investigate, not a command to refactor.

### J7. What's the Boy Scout Rule?

**Answer:** "Leave the code a little cleaner than you found it." Opportunistic, small refactoring every time you pass through a file, so the codebase trends cleaner without a special cleanup effort.

### J8. Name the most common refactoring move.

**Answer:** **Extract Function** (Extract Method) — pull a cohesive block out into a well-named function. It's the workhorse that cures long functions, duplication, and comments-explaining-what.

### J9. Is renaming a variable a refactoring?

**Answer:** Yes. A truthful name improves structure without changing behavior. Renaming is a first-class refactoring — and IDEs do it safely across the whole codebase.

### J10. What do you need before you can safely refactor?

**Answer:** A passing test suite that covers the behavior you're about to touch. No tests → write characterization tests first.

---

## Middle Questions

### M1. Give three smells and the refactoring that cures each.

**Answer:** Long Function → Extract Function; Duplicated Code → Extract Function / Pull Up; Magic Number → Extract Constant; Long Parameter List → Introduce Parameter Object; Nested Conditionals → Replace with Guard Clauses. (Any valid pairs.)

### M2. How do you change a function's signature safely across many callers?

**Answer:** **Parallel Change (expand-and-contract):** add the new function alongside the old (delegating to it), migrate callers one at a time testing after each, then inline and delete the old one. Each step is green and reversible.

### M3. Where does refactoring fit in red-green-refactor?

**Answer:** It's the third beat. Red: failing test. Green: make it pass by any means, even ugly. Refactor: now the test pins behavior, remove the duplication/mess you just created. Skipping the refactor beat is why TDD code can still be ugly.

### M4. What is "make the change easy, then make the easy change"?

**Answer:** Kent Beck's maxim for preparatory refactoring: first (refactoring hat) reshape the code so the feature drops in cleanly, tests staying green; then (adding-behavior hat) add the now-easy feature.

### M5. Why prefer automated IDE refactorings?

**Answer:** They're behavior-preserving by construction — the tool rewrites the syntax tree correctly across the whole project (rename, extract, move). Faster and safer than hand-editing. Caveat: they can miss reflection/serialization/DI/string-wired references.

### M6. Why separate refactor commits from feature commits?

**Answer:** It's the two hats applied to history. Mixed commits are unreviewable (can't separate risky behavior change from safe restructuring) and break `git bisect`. One hat per commit.

### M7. What's the "rule of three"?

**Answer:** Don't extract an abstraction on the first or second occurrence of similar code; wait for the third. Premature extraction with too few examples produces the *wrong* abstraction, which is worse than duplication.

### M8. Why run tests after every small step, not just at the end?

**Answer:** When a step goes red, you've changed exactly one tiny thing, so the cause is obvious. Testing only at the end buries the cause among many changes. This is why a *fast* suite is a precondition for fluent refactoring.

### M9. When does an "automated rename" actually change behavior?

**Answer:** When the name is also a serialized JSON key, DB column, reflection target, or DI bean name. The IDE updates the code but not the wire/persistence contract — so external behavior changes. Not a pure refactoring; needs a compat shim.

### M10. Name the three "free" types of refactoring.

**Answer:** Preparatory (reshape before a feature), comprehension (capture understanding as you read), and litter-pickup/Boy Scout (small local cleanup as you pass through). All happen inside normal work, under the two hats, with no separate ticket.

---

## Senior Questions

### S1. How do you refactor code with no tests?

**Answer:** Don't refactor it directly. First introduce a **seam** (a point to inject a test double) in the smallest, most careful step possible. Then write **characterization tests** that pin current behavior (bugs included). *Then* refactor freely behind them. Sequence: seam → characterize → refactor → (separately) fix bugs.

### S2. What is a characterization test, and what must you resist while writing one?

**Answer:** A test that asserts what the code *currently does*, not what it *should* do — to lock behavior before refactoring. You must resist "fixing" bugs you discover: a characterization encodes current behavior, bugs and all. Fixing is a separate behavior change under the other hat. A downstream system may depend on the bug.

### S3. What's the Strangler Fig pattern?

**Answer:** Refactoring a large system without a big-bang rewrite: put a facade in front of the old system, build the new implementation one slice at a time, route each slice's traffic to the new code behind a flag (reversibly), and delete the old once nothing uses it. The system works and ships at every step.

### S4. Branch by abstraction — what and why?

**Answer:** The in-process strangler fig. Introduce an interface over the component to replace, migrate all callers to it, build the new impl behind the same interface, flip the binding via flag, delete the old. Keeps `main` always-shippable and avoids a long-lived divergent refactor branch.

### S5. When is refactoring the wrong call?

**Answer:** When the code is about to be deleted; when nothing will change it and there's no plan to (stable+untouched beats freshly-destabilized); when you can't write tests *and* can't safely add a seam before a deadline; when the "refactor" is really a rewrite; when it blocks a deadline with no payoff before it. Refactoring is justified by *future change*.

### S6. How is architectural refactoring different from local refactoring?

**Answer:** It's the *same discipline at a larger granularity* — still behavior-preserving, still small reversible steps, still under tests — but the safety mechanism changes: contract/integration tests, feature flags, dual-running, and production telemetry instead of fast unit tests. The cardinal sin is letting it become a big-bang rewrite.

### S7. Refactor vs rewrite — how do you decide?

**Answer:** Default to refactor. A rewrite is justified only if *all* hold: platform genuinely dead, behavior captured in tests/specs, you can replace *incrementally* (strangler fig), and refactor cost truly exceeds replace cost. Note the "plausible rewrite" is itself an incremental strangler-fig migration; big-bang flag-day rewrites almost always fail.

### S8. How do you refactor under deadline pressure without going to either extreme?

**Answer:** Keep the *cheap continuous* refactorings (renames, extractions, guards) — they make you faster *now*. Defer the *expensive planned* ones, but record the debt explicitly. Do preparatory refactoring if it pays off within the deadline. Never disable tests. Make the trade-off visible to whoever owns the schedule. It's triage, not abdication.

---

## Professional Questions

### P1. "We need a refactoring sprint / ticket." What's wrong with that?

**Answer:** Treating refactoring as a separate schedulable item is the core organizational anti-pattern. It competes with features and loses; it bundles cheap continuous improvements into one expensive deferred lump; it splits the two hats across time. Continuous refactoring belongs *in the estimate*, like testing. Only rare large migrations get scheduled work — sold as roadmap-enablers.

### P2. How do you sell a large refactoring to management?

**Answer:** Speak business, not "clean code." Tie it to the roadmap: "three upcoming features all need this; reshape once instead of fighting it three times." Quantify the debt's interest (lead time, change-failure rate per module). Show payback. For everyday refactoring, explain it's already in estimates — that's why velocity is sustainable.

### P3. Which metrics show refactoring is working?

**Answer:** Lag/outcome metrics (DORA): lead time for changes down, change-failure rate down, deployment frequency up. Lead/code metrics: cognitive-complexity and hotspot (churn×complexity) trends on *touched* code, coverage on changed code. Avoid activity vanity metrics (lines refactored, tickets closed) and single-function complexity KPIs (gameable).

### P4. What's the Mikado Method?

**Answer:** For tangled large refactorings: set a goal, try it directly, when it breaks something note the prerequisite and **revert to green**, recurse on the prerequisite until you find a change that breaks nothing (a leaf), do it, commit green, walk back up. You're always green and never in a wide broken state — the reverts *discover* the safe order.

### P5. How do you handle refactoring in code review, as reviewer and author?

**Answer:** Author: one hat per commit, label intent (`refactor:`/`feat:`), keep refactor diffs small and mechanical. Reviewer: split mixed PRs, verify refactor diffs are behavior-preserving by inspection, and suggest *unrelated* cleanup as a follow-up rather than blocking. Clean hat separation turns review from "trust" into "verify."

### P6. How do you roll the discipline out across a team?

**Answer:** Make a fast safety net exist first (you can't refactor continuously with a slow suite); bake refactoring into the definition of done and estimates; establish the one-hat-per-commit convention; lower activation energy with tooling; model it in review/pairing; ratchet quality gates on changed code only; and get leadership to protect it under pressure.

### P7. How do you stop a refactoring from becoming a rewrite disaster?

**Answer:** Forbid long-lived refactoring branches; demand always-shippable `main` (land incrementally via branch-by-abstraction + flags); use Mikado for tangles; time-box with "can we stop here with value?" checkpoints; and watch for the euphemism — force the explicit distinction between behavior-preserving steps and rebuild-from-scratch.

### P8. Give a real incident caused by a "refactoring."

**Answer:** Several: a "simplified" `BigDecimal` chain that changed rounding and broke reconciliation (no characterization test); a six-month refactor branch that diverged and shipped nothing; an IDE rename of a field that was also a JSON key, breaking external clients; a "tech-debt sprint" that froze features, showed no payoff, and killed management's appetite forever.

---

## Coding Tasks

### C1. Refactor under a test, in small steps (Python).

**Given (must keep `price` returning the same values):**

```python
def price(order):
    if order.customer is not None:
        if order.customer.is_member:
            return order.subtotal - (order.subtotal * 0.10)
        else:
            return order.subtotal
    else:
        return order.subtotal
```

**Solution (each step run the tests):**

```python
MEMBER_DISCOUNT_RATE = 0.10                       # Extract Constant

def member_discount(subtotal):                    # Extract Function
    return subtotal * MEMBER_DISCOUNT_RATE

def price(order):                                 # Guard Clauses
    if order.customer is None:        return order.subtotal
    if not order.customer.is_member:  return order.subtotal
    return order.subtotal - member_discount(order.subtotal)
```

### C2. Safe signature change via Parallel Change (Java).

**Goal:** migrate `send(String to, String subj, String body)` to `send(Message m)` without breaking callers.

```java
// Step 1: new function delegates to old — no caller changes, tests green
void send(Message m) { send(m.to(), m.subject(), m.body()); }

// Step 2: migrate callers one at a time (test after each)
//   send(u.email(), "Hi", body)  →  send(new Message(u.email(), "Hi", body));

// Step 3: once no caller uses the 3-arg form, inline its body into send(Message) and delete it.
```

### C3. Replace Conditional with Polymorphism (Python).

**Before — a switch on type repeated across the code:**

```python
def area(shape):
    if shape.kind == "circle":
        return 3.14159 * shape.r ** 2
    elif shape.kind == "square":
        return shape.side ** 2
    raise ValueError(shape.kind)
```

**After — behavior in the types (run tests after each extraction):**

```python
class Circle:
    def __init__(self, r): self.r = r
    def area(self): return 3.14159 * self.r ** 2

class Square:
    def __init__(self, side): self.side = side
    def area(self): return self.side ** 2

# callers: shape.area()  — no conditional, open to new shapes
```

### C4. Introduce a seam to make legacy testable (Go).

**Before — untestable (real clock, hidden global):**

```go
func ExpireSessions() int {
    now := time.Now()
    for _, s := range globalStore.All() {
        if now.Sub(s.LastSeen) > timeout { globalStore.Delete(s.ID) }
    }
    // ...
}
```

**After — seams injected, core extracted and pure:**

```go
type Store interface { All() []Session; Delete(id string) }

func ExpireSessions(now time.Time, store Store) int {
    expired := selectExpired(now, store.All())   // pure, characterization-testable
    for _, s := range expired { store.Delete(s.ID) }
    return len(expired)
}
func selectExpired(now time.Time, ss []Session) []Session { /* ... */ }
```

### C5. Introduce Parameter Object (Java).

**Before — a data clump travels together through many calls:**

```java
double quote(double width, double height, double depth, Material m) { ... }
```

**After — the clump becomes a type:**

```java
record Dimensions(double width, double height, double depth) {}
double quote(Dimensions d, Material m) { ... }   // fewer params, named concept
```

---

## Trick Questions

### T1. "Refactoring improves performance." True?

**Mostly false / beside the point.** Refactoring targets *structure*, not speed; behavior (including observable timing contracts) is preserved. Clean code is *easier to optimize later*, and some refactorings incidentally help, but "make it faster" is the *optimization* hat, not refactoring. Don't conflate them.

### T2. "We refactored the whole service over three months." Is that refactoring?

**Almost certainly not.** That's the diluted colloquial use. A three-month, branch-bound, ships-nothing effort is a *rewrite*. Disciplined refactoring is small, continuous, behavior-preserving, and lands incrementally on green.

### T3. Does refactoring reduce the number of tests you need?

**No.** Refactoring is behavior-preserving, so the behavior under test is unchanged — you need the same tests. Refactoring makes code *readable and changeable*, not *less tested*. (It often makes the existing tests *easier to write*, which is different.)

### T4. Should you fix a bug you find while refactoring legacy code?

**Not in the same step.** Characterize the current (buggy) behavior, complete the refactor on green, *then* fix the bug separately under the adding-behavior hat with its own test. A downstream system may rely on the bug; conflating fix and refactor causes incidents.

### T5. Can you refactor on a red bar?

**No.** On red you can't tell whether a change is your refactor's fault or the pre-existing failure's. Get to green first; the green bar is the license and the proof.

### T6. "Automated IDE refactorings are always safe." True?

**No.** Safe *within what the tool can see*. They miss references via reflection, serialization (JSON/DB keys), and string-wired DI. A rename crossing those boundaries changes external behavior — your tests remain the real safety net.

---

## Behavioral Questions

### B1. Tell me about refactoring you did that paid off.

**Sample:** "A pricing module hard-coded one discount type and product wanted three. Instead of bolting on `if`s, I did preparatory refactoring first — extracted the discount into a strategy, tests green throughout — then added the two new strategies in minutes. The feature that would've been a tangled mess became trivial, and the next discount type after that was a one-class change."

### B2. Describe a refactoring that went wrong.

**Sample:** "A teammate 'simplified' a monetary calculation and changed intermediate rounding; totals drifted by cents and reconciliation broke at month-end. The root cause was no characterization test pinning the arithmetic, and the change was bundled with a feature. We added characterization tests on monetary code and a rule that money changes are never mixed with features. I learned that a 'harmless simplification' that alters output isn't a refactoring at all."

### B3. How do you get time to refactor when management only wants features?

**Sample:** "I reframe it: continuous refactoring is *in* my estimates, like testing — that's what keeps velocity sustainable, so it's not a negotiation. For larger work I tie it to the roadmap: 'these three features all touch this code; reshaping it once is cheaper and lower-risk than fighting it three times,' and I back it with lead-time and change-failure numbers on that module. I never ask for a 'refactoring sprint' — that's the thing that gets cut and discredits the practice."

### B4. A teammate wants to rewrite a module from scratch. How do you respond?

**Sample:** "I'd push hard for incremental replacement over big-bang. First, do we have tests/specs capturing current behavior? If not, that's step one. Then I'd propose a strangler fig or branch-by-abstraction so we replace it slice by slice with `main` always shippable and rollback as a flag flip. A big-bang rewrite discards every bug fix baked into the old code and ships nothing for months — the canonical way these efforts die. If after that analysis the platform's genuinely dead and replacement truly beats refactoring, fine — but the path is still incremental."

### B5. How do you keep refactoring discipline under a tight deadline?

**Sample:** "Triage. The cheap refactorings — renames, extractions, guards — stay, because they make me faster and less bug-prone right now. The expensive planned ones I defer, but I write the debt down explicitly with a ticket reference in the code, not a vague intention. If reshaping for ten minutes saves an hour, I do it — that's speed, not polish. And I make the trade visible: 'clean and Friday, or debt and Thursday' is the schedule-owner's call, but I won't silently disable tests to look fast."

---

## Tips for Answering

1. **Lead with the definition:** behavior-preserving structural change. Everything follows from "external behavior must not change."
2. **Name the two hats** and *why* (unambiguous test failures).
3. **Insist on green:** refactor on green, the suite is the proof.
4. **Distinguish refactoring from rewrite** every time the word "refactor" appears in a question — the risk profiles are opposite.
5. **For legacy:** seam → characterize → refactor → fix bugs separately.
6. **For scale:** strangler fig / branch by abstraction / Mikado — incremental, always-shippable, reversible.
7. **For the org:** refactoring is in the estimate, not a ticket; sell large ones via the roadmap and DORA metrics.

---

[← Professional](professional.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)

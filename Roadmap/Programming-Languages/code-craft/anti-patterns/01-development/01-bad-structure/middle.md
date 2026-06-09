# Bad Structure Anti-Patterns — Middle Level

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Structure** — *code that has grown into a shape that resists change.*
> **Covers (collectively):** God Object · Spaghetti Code · Lava Flow · Boat Anchor · Arrow Anti-Pattern

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Real Question: When Does This Creep In?](#the-real-question-when-does-this-creep-in)
4. [God Object — How It Forms and How to Stop It](#god-object--how-it-forms-and-how-to-stop-it)
5. [Spaghetti Code — Untangling Control Flow](#spaghetti-code--untangling-control-flow)
6. [Lava Flow — Proving Code Is Dead](#lava-flow--proving-code-is-dead)
7. [Boat Anchor — The Cost of "Just in Case"](#boat-anchor--the-cost-of-just-in-case)
8. [Arrow Anti-Pattern — Beyond Guard Clauses](#arrow-anti-pattern--beyond-guard-clauses)
9. [Catching Structure Problems in Review](#catching-structure-problems-in-review)
10. [Measuring Structure: Metrics That Help](#measuring-structure-metrics-that-help)
11. [Refactoring Without Breaking Things](#refactoring-without-breaking-things)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **When does this creep in?** and **What do I do instead?**

At the junior level you learned to *recognize* the five bad-structure shapes. The uncomfortable truth is that **nobody sets out to write a God Object.** These anti-patterns aren't created — they *accumulate*, one reasonable-looking commit at a time. A class gains one more method. A function gets one more `if`. A feature is replaced but the old code is left "for now."

The middle-level skill is **seeing the slope before you're at the bottom of it** — noticing the third method that doesn't belong, the second flag that controls flow from a distance, the comment that admits nobody understands a block. And then knowing the small, safe move that reverses direction *before* it becomes a multi-week rewrite.

This file is about the **forces** that produce bad structure and the **practical countermoves** you apply during everyday work and code review.

---

## Prerequisites

- **Required:** Comfortable reading [`junior.md`](junior.md) — you can identify all five anti-patterns.
- **Required:** You've written enough code to have *maintained* something you wrote months ago.
- **Helpful:** Basic refactoring vocabulary — Extract Method, Extract Class (see [Refactoring](../../../refactoring/02-refactoring-techniques/README.md)).
- **Helpful:** You participate in code review, as author or reviewer.
- **Helpful:** Awareness of the [SOLID principles](../../../../../Architecture/README.md), especially SRP and the Dependency Inversion idea.

---

## The Real Question: When Does This Creep In?

Bad structure has predictable triggers. If you can name the moment, you can intervene:

| Trigger | What happens | Which anti-pattern |
|---|---|---|
| **"Just add it here, it's related"** | A class accretes one more loosely-related method | God Object |
| **Deadline pressure** | A flag is added to reuse a function for a new case | Spaghetti |
| **Requirement replaced, not removed** | New path added; old path left running | Lava Flow |
| **"Build it generic now"** | Abstraction created ahead of real need | Boat Anchor |
| **New edge case** | One more `if` wrapped around existing logic | Arrow |
| **Fear** | "I don't understand this, I'll go around it" | Lava Flow → grows |

The common thread: **the cheap local move (add) is more expensive globally than the slightly-harder move (shape).** The middle engineer learns to pay the small shaping cost now.

---

## God Object — How It Forms and How to Stop It

### How it forms

It starts innocent: `OrderService` handles orders. Then "checkout also needs to send email — and email is about orders, so put it here." Then "the invoice is part of the order, add `renderInvoice()`." Each step is locally sensible. Twelve sprints later it's 2,000 lines.

The root cause is a **missing boundary**: there was no clear answer to *"where does email logic belong?"*, so it defaulted to "wherever it was first needed."

### What to do instead

**1. Detect early with cohesion.** A healthy class's methods use its fields. When you see clusters of methods that touch *different* fields, those clusters want to be separate classes.

```python
# Smell: two field-clusters living in one class
class Account:
    def __init__(self):
        self.balance = 0          # cluster A
        self.transactions = []    # cluster A
        self.smtp_host = ...      # cluster B  ← email, unrelated to money
        self.email_template = ... # cluster B

    def deposit(self, amt): ...           # uses A
    def withdraw(self, amt): ...          # uses A
    def send_statement_email(self): ...   # uses B  ← extract me
```

**2. Extract by responsibility, inject the collaborators.** Move cluster B into its own class and pass it in. This is the practical application of [Dependency Injection](../../../../language-internals/README.md) and SRP.

```python
class Account:
    def __init__(self, statements: StatementMailer):
        self.balance = 0
        self.transactions = []
        self._statements = statements        # injected, not built here

    def deposit(self, amt): ...
    def send_statement(self):
        self._statements.send(self)          # delegate

class StatementMailer:                       # one job, testable alone
    def send(self, account): ...
```

**3. Use the "reasons to change" test.** Ask: *who* asks for changes to this class? If the answers are "the payments team, the marketing team, **and** the reporting team," it has three masters and should be three classes. (This is Robert Martin's framing of SRP: *a class should have one reason to change.*)

> **Countermove in review:** when a PR adds a method to an already-large class, ask "does this method use the class's existing data, or new unrelated data?" New unrelated data → it belongs elsewhere.

---

## Spaghetti Code — Untangling Control Flow

### How it forms

Spaghetti grows from **reusing a function for a case it wasn't designed for** by adding a flag, plus **communicating through shared mutable state** instead of parameters and return values.

```java
// Java — a boolean parameter is an early spaghetti symptom
void processOrder(Order o, boolean isRefund, boolean skipEmail, boolean dryRun) {
    // the body is now a maze of: if (isRefund) ... else ... if (!skipEmail && !dryRun) ...
}
```

Each flag doubles the number of paths through the function. Three booleans → up to eight behaviors crammed into one body. Callers can't tell which combination is valid.

### What to do instead

**1. Replace flag arguments with separate functions.** If the behavior differs, the function should differ.

```java
void processOrder(Order o)      { /* the normal path, clear */ }
void refundOrder(Order o)       { /* the refund path, clear */ }
void previewOrder(Order o)      { /* dry-run path, clear */ }
```

**2. Make dependencies explicit — pass data in, return data out.** Order-dependent shared state is the heart of spaghetti. Convert it to a pipeline where each step's output is the next step's input.

```python
# Before: functions mutate a shared dict in a fragile order.
# After: an explicit pipeline — order is encoded in the code, not in your head.
def handle(raw):
    parsed   = parse(raw)
    validated = validate(parsed)     # takes input, returns output
    return persist(validated)
```

**3. Localize state.** If state must be shared, wrap it in a small object with methods that enforce valid transitions — so callers can't reach in and set fields in the wrong order. (This previews the **state machine** idea covered at the senior level.)

> **Rule of thumb:** more than ~2 boolean parameters, or a function that "only works if you call X first," is spaghetti forming.

---

## Lava Flow — Proving Code Is Dead

### How it forms

A requirement changes. The new code is written *alongside* the old, with a flag or a branch, "until we're sure." We're never sure. The flag stays `true` forever; the old branch fossilizes. Multiply across years and you get strata of dead code.

### What to do instead — *prove* it's dead, then delete

The reason juniors keep Lava Flow is **uncertainty**. The middle skill is replacing uncertainty with evidence:

1. **Coverage.** Run the test suite (or production traffic) with coverage on. Code that never executes is a strong delete candidate.
2. **Logging / feature-flag telemetry.** Add a temporary log line or counter at the suspicious branch and ship it. If it doesn't fire in a week of real traffic, it's dead.
3. **`git log` / `git blame`.** Find when and why it was added. Often the linked ticket is long closed — the reason for keeping it no longer exists.
4. **Static analysis.** Dead-code detectors (`staticcheck`/`deadcode` in Go, IDE inspections in Java, `vulture` in Python) flag unreachable functions.

```bash
# Go: find unreachable code across the module
go run golang.org/x/tools/cmd/deadcode@latest ./...
```

Then **delete it in its own commit** with a message explaining the evidence ("removed: 0 coverage + no prod hits in 30d, ticket PROJ-123 closed"). Git is your undo button.

> **Anti-pattern to avoid while fixing this:** don't "tidy" lava flow by *renaming and reorganizing* it — that signals it's alive and makes it harder to delete later. Either prove-and-delete, or leave it untouched.

---

## Boat Anchor — The Cost of "Just in Case"

### How it forms

A Boat Anchor is usually **well-intentioned over-preparation**: "Let's support three export formats so we're ready," "let's make this an interface in case we swap implementations." The future use case never materializes, but the code is now a permanent maintenance liability.

### What to do instead

**1. Apply YAGNI as a default.** Build for the requirement in front of you. Adding the second implementation *when it actually arrives* is usually cheap — and you'll design it better against a real need.

**2. Distinguish a Boat Anchor from a real seam.** Not every abstraction is ballast. An interface with **one** implementation is a Boat Anchor *if it exists only for a hypothetical future*; it's justified if it serves testing (a mock), a published API contract, or a known near-term second implementation. The question is: *does this earn its keep today?*

```go
// Boat Anchor: interface invented for an imagined future, one impl, never mocked.
type Frobnicator interface { Frob() }
type realFrob struct{}

// Justified seam: the interface exists so the caller can be tested with a fake.
type Clock interface { Now() time.Time }   // prod uses real clock; tests inject a fixed one
```

**3. Delete unused exports.** A public method, flag, or config option with no callers is a Boat Anchor with a blast radius — people may start depending on it. Remove it before it ossifies.

> **Review heuristic:** when a PR adds capability "for the future," ask for the ticket that needs it. No ticket → defer it. The cost of adding later is almost always lower than the cost of carrying it unused.

---

## Arrow Anti-Pattern — Beyond Guard Clauses

Guard clauses (from `junior.md`) handle the common case. At the middle level you also recognize when nesting signals a **deeper structural problem** than a few early returns can fix.

### When guard clauses aren't enough

If the nesting comes from **dispatching on a type or state**, the real fix is polymorphism or a lookup table, not more `if`s.

```java
// Arrow by type-switching — guard clauses won't flatten this well
String render(Shape s) {
    if (s instanceof Circle) {
        if (((Circle) s).radius > 0) { return drawCircle(s); }
    } else if (s instanceof Square) {
        if (((Square) s).side > 0) { return drawSquare(s); }
    } else if (s instanceof Triangle) {
        ...
    }
}
```

```java
// Fix: let each type render itself (Replace Conditional with Polymorphism)
interface Shape { String render(); }
class Circle implements Shape { public String render() { /* ... */ } }
// caller becomes one line:
String out = shape.render();
```

For value-based dispatch (status codes, command names), a **map of handlers** removes the branching entirely:

```python
HANDLERS = {"create": handle_create, "delete": handle_delete, "update": handle_update}
def dispatch(cmd, payload):
    handler = HANDLERS.get(cmd) or handle_unknown
    return handler(payload)
```

> **Decision rule:** nesting from *validation* → guard clauses. Nesting from *type/state dispatch* → polymorphism or a handler map. Nesting from *both* → guard the validation, dispatch the rest.

---

## Catching Structure Problems in Review

Code review is the cheapest place to stop bad structure, because the change is still small. Practical reviewer questions:

- **"Does this new method use the class's existing fields?"** No → possible God Object growth.
- **"How many call sites does this new abstraction have?"** Zero → Boat Anchor.
- **"What happens if I call these functions in a different order?"** "It breaks" → Spaghetti.
- **"Why is this old branch still here?"** "Not sure" → Lava Flow; ask for evidence or deletion.
- **"What's the deepest indent here?"** 4+ → Arrow; suggest guard clauses or dispatch.

As an *author*, pre-empt these: keep PRs small and scoped to the ticket. A 40-line PR rarely hides a God Object; a 2,000-line PR routinely does.

---

## Measuring Structure: Metrics That Help

Metrics don't *define* bad structure, but they point your attention. Treat them as smoke detectors, not judges:

| Metric | Tooling | Rough warning sign |
|---|---|---|
| **Lines per class** | `cloc`, IDE | One class dwarfing the rest of the module |
| **Methods / fields per class** | linters | Many methods that don't share fields → low cohesion |
| **Cyclomatic complexity** | `gocyclo`, `radon` (Py), Checkstyle (Java) | A single function > ~10–15 paths → Arrow/Spaghetti |
| **Nesting depth** | linters | Depth > 3–4 → Arrow |
| **Fan-in / fan-out** | dependency tools | A class everything imports → God Object |
| **Dead code** | `deadcode`, `vulture` | Any hit → Lava Flow / Boat Anchor candidate |

```bash
# Python: report functions with high cyclomatic complexity
radon cc -s -n C path/to/pkg     # flags C-grade and worse
```

> **Caution:** metrics are guides, not gates wielded blindly. A cohesive 600-line class can be fine; a "small" function with three boolean flags can be awful. Use numbers to *find* candidates, then judge with your eyes.

---

## Refactoring Without Breaking Things

The middle-level discipline: **never refactor structure without a safety net.**

1. **Pin behavior with a test first.** Before extracting a class or flattening logic, write a *characterization test* that captures what the code does now (even if "what it does now" is partly wrong — you're freezing behavior, not blessing it).
2. **Refactor in small, reversible steps.** Extract one method, run tests, commit. Don't combine "extract class" with "fix the bug" in one commit — separate structural change from behavioral change.
3. **Keep it green.** If tests go red, your last small step is the culprit; revert it. This is why small steps beat a big-bang rewrite.
4. **Lean on the IDE.** Automated Extract Method / Rename / Move are behavior-preserving and faster than hand edits.

```text
Cycle:  green → extract one piece → green → commit → repeat
        (behavioral change, if any, gets its own separate commit)
```

> Senior-level material (`senior.md`) goes deeper on refactoring a God Object *at scale* under production constraints — strangler-fig migration, seams, and when **not** to refactor.

---

## Common Mistakes

1. **Big-bang rewrites.** "I'll just rewrite the God Object over the weekend." It explodes into a multi-week, bug-ridden branch that never merges. Refactor incrementally instead.
2. **Refactoring and fixing bugs in the same commit.** When something breaks, you can't tell whether the structure change or the bug fix caused it. Keep them separate.
3. **Extracting classes by *file size* instead of *responsibility*.** Splitting one 2,000-line God Object into two 1,000-line God Objects fixes nothing. Split by *reason to change*.
4. **Over-correcting into Lasagna.** Flattening a God Object into 30 one-line pass-through classes creates the opposite anti-pattern (Lasagna Code, see [Over-Engineering](../03-over-engineering/middle.md)). Aim for *cohesive*, not *maximally small*.
5. **Keeping dead code "until the next release."** That release never feels safe. Delete with evidence; git is the rollback.
6. **Treating metrics as gospel.** Chasing a complexity number can produce contorted code that satisfies the linter and confuses humans. Numbers find candidates; judgment decides.

---

## Test Yourself

1. Your `UserService` has grown to 18 methods. Six of them touch `passwordHash`/`salt`; the other twelve touch `profile`/`preferences`. What does this cohesion split suggest, and what's the refactor?
2. A function signature is `export(data, asPdf, asCsv, compress, dryRun)`. Why is this spaghetti-prone, and how would you redesign the API?
3. You suspect a 200-line module is dead. List three independent ways to gather *evidence* before deleting it.
4. When is an interface with a single implementation **justified** rather than a Boat Anchor?
5. You're about to flatten a deeply nested function. How do you decide between *guard clauses* and *polymorphism/handler-map*?
6. Why should a structural refactor and a bug fix never share a commit?

<details>
<summary>Answers</summary>

1. Two **field-clusters** in one class = low cohesion, a forming **God Object**. Extract the password/salt cluster into a `Credentials`/`PasswordService` class and the profile cluster into `UserProfile`, leaving `UserService` as a thin coordinator (or removing it).
2. Each boolean multiplies the paths through the body and lets callers pass invalid combinations (`asPdf=true, asCsv=true`?). Redesign into distinct functions (`exportPdf`, `exportCsv`) or pass an explicit `ExportOptions`/format enum so illegal states can't be expressed.
3. (a) **Coverage** — run tests/traffic with coverage, see if it executes; (b) **telemetry** — add a temporary log/counter and ship, see if it fires in real traffic; (c) **`git blame` + ticket** — find why it was added and whether that reason still holds. (Also: static dead-code analysis.)
4. When the interface serves a real need *today*: a test seam (injecting a fake/mock), a published API boundary/contract, or a confirmed near-term second implementation. If it exists only for a hypothetical future, it's a Boat Anchor.
5. Nesting from **validation/preconditions** → guard clauses with early returns. Nesting from **dispatching on a type or state value** → polymorphism (let each type handle itself) or a handler map keyed by the value. Both present → guard the validation, dispatch the rest.
6. So that if tests break, you can attribute the failure unambiguously — a refactor is supposed to preserve behavior, so any test change reveals a mistake; mixing in a behavioral fix destroys that signal and makes reverting messy.

</details>

---

## Cheat Sheet

| Anti-pattern | Creeps in when… | Countermove |
|---|---|---|
| **God Object** | "Just add the related method here" | Watch cohesion; extract by responsibility + inject |
| **Spaghetti** | A flag is added to reuse a function; shared mutable state | Split functions; explicit data in/out; localize state |
| **Lava Flow** | New path added beside old; old never removed | Prove dead (coverage/telemetry/blame) → delete with evidence |
| **Boat Anchor** | "Build it generic for the future" | YAGNI; keep only seams that earn their keep today |
| **Arrow** | One more `if` per edge case / type | Guard clauses (validation) or polymorphism/map (dispatch) |

**Two golden rules:**
- *Pay the small shaping cost now — it's cheaper than the global cost later.*
- *Never refactor structure without a test pinning behavior, and never mix structural and behavioral changes in one commit.*

---

## Summary

- Bad structure **accumulates** from locally-reasonable decisions; the middle skill is spotting the slope early and applying a small countermove.
- **God Object**: track cohesion (do methods share fields?), extract by responsibility, inject collaborators. **Spaghetti**: kill flag-arguments and shared-state ordering with explicit data flow. **Lava Flow**: replace fear with evidence (coverage, telemetry, blame), then delete. **Boat Anchor**: default to YAGNI; keep only abstractions that earn their keep today. **Arrow**: guard clauses for validation, polymorphism/handler-maps for dispatch.
- **Code review and small PRs** are your cheapest defense; **metrics** point your attention but don't replace judgment.
- **Refactor safely**: pin behavior with a test, take small reversible steps, keep structural and behavioral changes in separate commits.
- Next: [`senior.md`](senior.md) — refactoring these at scale under production constraints, and the architectural forces that breed them.

---

## Further Reading

- **Refactoring** — Martin Fowler (2nd ed., 2018) — Extract Class, Move Method, Replace Conditional with Polymorphism, characterization tests.
- **Working Effectively with Legacy Code** — Michael Feathers (2004) — seams, characterization tests, breaking dependencies in tangled code.
- **Clean Code** — Robert C. Martin (2008) — SRP, function arguments, flag arguments.
- **The Pragmatic Programmer** — Hunt & Thomas (20th anniv. ed., 2019) — orthogonality, reversibility, "don't live with broken windows."

---

## Related Topics

- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — cohesion and SRP in depth.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — the mechanical moves referenced here.
- [Design Patterns → Strategy / State](../../../design-patterns/README.md) — the positive counterparts to type-switch Arrow code.
- [Bad Shortcuts](../02-bad-shortcuts/middle.md) and [Over-Engineering](../03-over-engineering/middle.md) — the sibling categories; Boat Anchor and Lasagna live next door.

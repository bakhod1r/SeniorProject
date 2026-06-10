# Simple Design — Simplification Drills

> **Category:** [Craftsmanship Disciplines](../README.md) — Kent Beck's four rules for writing code that is no more complicated than it needs to be, in strict priority order.

10 drills that take over-engineered code and simplify it toward the four rules. Unlike performance optimization, the "optimization" here is **removing complexity** — the win is in reading, changing, and testing the code, not in CPU cycles (though deleting machinery often *also* runs faster). Each drill names the rule(s) it moves toward.

---

## Table of Contents

1. [Drill 1: Collapse a One-Implementation Hierarchy](#drill-1-collapse-a-one-implementation-hierarchy)
2. [Drill 2: Replace a Pattern with a Function](#drill-2-replace-a-pattern-with-a-function)
3. [Drill 3: Inline a Pass-Through Layer](#drill-3-inline-a-pass-through-layer)
4. [Drill 4: Remove Speculative Parameters](#drill-4-remove-speculative-parameters)
5. [Drill 5: DRY Real Duplication into One Home](#drill-5-dry-real-duplication-into-one-home)
6. [Drill 6: Split the Wrong Abstraction](#drill-6-split-the-wrong-abstraction)
7. [Drill 7: Replace a Switchboard with Polymorphism — Only If Earned](#drill-7-replace-a-switchboard-with-polymorphism--only-if-earned)
8. [Drill 8: Delete Dead Flexibility (Config, Hooks)](#drill-8-delete-dead-flexibility-config-hooks)
9. [Drill 9: Rename to Reveal Intent (Then Delete the Comment)](#drill-9-rename-to-reveal-intent-then-delete-the-comment)
10. [Drill 10: Replace a Builder Nobody Needs](#drill-10-replace-a-builder-nobody-needs)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Collapse a One-Implementation Hierarchy

### Before — abstract base, one subclass

```java
abstract class Notifier {
    abstract void send(String to, String msg);
    void notifyUser(User u, String msg) { send(u.email(), msg); }
}
class EmailNotifier extends Notifier {
    void send(String to, String msg) { smtp.send(to, msg); }
}
// EmailNotifier is the only subclass. The hierarchy serves no one.
```

### After — one concrete class

```java
class Notifier {
    void notifyUser(User u, String msg) { smtp.send(u.email(), msg); }
}
```

**Rule:** 4 (fewest elements). **Gain:** Two types become one; the abstract method and the indirection disappear. Reintroduce the hierarchy when a *second* notifier (SMS, push) is a real requirement — then it's shaped by two concrete cases.

---

## Drill 2: Replace a Pattern with a Function

### Before — Strategy pattern for one strategy

```python
class SortStrategy(ABC):
    @abstractmethod
    def sort(self, data): ...

class QuickSortStrategy(SortStrategy):
    def sort(self, data): return sorted(data)

class Sorter:
    def __init__(self, strategy: SortStrategy): self.strategy = strategy
    def run(self, data): return self.strategy.sort(data)
```

### After — just call the function

```python
def sort(data):
    return sorted(data)
```

**Rule:** 4 + YAGNI. **Gain:** Three classes and an injection collapse to one function. The Strategy pattern is correct when you have *multiple* interchangeable algorithms chosen at runtime — here there's one. A design pattern with one variant is speculative generality wearing a pattern's name.

---

## Drill 3: Inline a Pass-Through Layer

### Before — service that only forwards

```go
type UserService struct{ repo *UserRepo }
func (s *UserService) Get(id int) (User, error)  { return s.repo.Get(id) }
func (s *UserService) Save(u User) error         { return s.repo.Save(u) }
// No behavior added; pure delegation.
```

### After — callers use the repo directly

```go
// UserService deleted. Handlers call *UserRepo directly.
// Add a service back the day it has real behavior (a transaction
// spanning two repos, a domain rule, an orchestration).
```

**Rule:** 4 (fewest elements). **Gain:** An entire layer of indirection removed. A layer earns its keep by *adding behavior*; a forwarding-only layer is a needless element added out of habit ("you should always have a service layer").

---

## Drill 4: Remove Speculative Parameters

### Before — parameters no caller varies

```python
def render(report, fmt="pdf", watermark=None, dpi=300, compress=True, lang="en"):
    # every call site: render(report) — all defaults, always
    ...
```

### After — keep only what varies

```python
def render(report):
    ...   # fmt/watermark/dpi/compress/lang were never varied; gone.
```

**Rule:** 4 + YAGNI. **Gain:** The signature shrinks to what callers actually use; five dead code paths inside vanish too. Add a parameter when a caller *needs* to vary it — not "to be flexible." (Runtime bonus: fewer branches to evaluate.)

---

## Drill 5: DRY Real Duplication into One Home

### Before — the same validation rule in three handlers

```java
if (email == null || !email.contains("@")) throw new BadRequest("bad email"); // handler A
// ... handler B: same three-token check ...
// ... handler C: same three-token check ...
```

### After — one home for the rule (parse, don't validate)

```java
record Email(String value) {
    Email {                                        // the rule lives here, once
        if (value == null || !value.contains("@"))
            throw new IllegalArgumentException("bad email: " + value);
    }
}
// Handlers accept Email; the check fires once at construction, nowhere else.
```

**Rule:** 3 (no duplication) + 2 (the type names the concept). **Gain:** A single source of truth for "what a valid email is"; the duplicated checks can't drift apart. This is genuine knowledge duplication (the *same* rule everywhere), so DRYing it is correct — contrast Drill 6, which DRYed the *wrong* thing.

---

## Drill 6: Split the Wrong Abstraction

### Before — flag-driven megafunction

```python
def price(item, member=False, bulk=False, clearance=False, tax=True):
    p = item.base
    if member:    p *= 0.9
    if bulk:      p *= 0.95
    if clearance: p = item.base * 0.5     # ignores member/bulk — special!
    if tax:       p *= 1.2
    return p
# Callers pass wildly different flag combos; clearance breaks the pattern entirely.
```

### After — separate the genuinely-different cases

```python
def standard_price(item, member=False, bulk=False, taxable=True):
    p = item.base
    if member: p *= 0.9
    if bulk:   p *= 0.95
    return p * 1.2 if taxable else p

def clearance_price(item, taxable=True):     # a different rule — its own function
    p = item.base * 0.5
    return p * 1.2 if taxable else p
```

**Rule:** 2 + 3 (escape the wrong abstraction). **Gain:** `clearance` was never really the same calculation — forcing it into the shared function created a special-case branch. Splitting it out makes both functions clear and independently changeable. The shared tax step (`* 1.2`) is small enough to leave duplicated, or extract if it recurs a third time.

---

## Drill 7: Replace a Switchboard with Polymorphism — Only If Earned

### Before — a type-switch repeated in several places

```go
func area(shapeType string, a, b float64) float64 {
    switch shapeType {
    case "rect":   return a * b
    case "circle": return math.Pi * a * a
    }
    return 0
}
// The SAME switch appears in perimeter(), draw(), and describe().
```

### After — polymorphism, because the switch recurs (earned)

```go
type Shape interface{ Area() float64 }
type Rect struct{ W, H float64 }
func (r Rect) Area() float64 { return r.W * r.H }
type Circle struct{ R float64 }
func (c Circle) Area() float64 { return math.Pi * c.R * c.R }
```

**Rule:** 3 (no duplication) — *earned*. **Gain:** The shape-type switch was duplicated across four functions (`area`, `perimeter`, `draw`, `describe`) — that's real knowledge duplication ("the set of shapes and how each behaves"). Polymorphism gives it one home per shape. **Caveat:** if the switch appeared *once*, the function would be simpler than an interface + two structs — don't introduce polymorphism until the duplication (or a real need for open extension) earns it.

---

## Drill 8: Delete Dead Flexibility (Config, Hooks)

### Before — extension points nobody extends

```python
class Pipeline:
    def __init__(self, pre_hooks=None, post_hooks=None, middleware=None):
        self.pre = pre_hooks or []
        self.post = post_hooks or []
        self.middleware = middleware or []
    def run(self, data):
        for h in self.pre: data = h(data)        # pre is ALWAYS empty
        data = self._core(data)
        for h in self.post: data = h(data)       # post is ALWAYS empty
        return data                              # middleware never used at all
```

### After — the one behavior, no hooks

```python
class Pipeline:
    def run(self, data):
        return self._core(data)
```

**Rule:** 4 + YAGNI. **Gain:** Three extension mechanisms — built "for flexibility" — that no code ever populates. Deleting them removes fields, loops, and a whole mental model. Add a hook the day a real extension needs one (and shaped by that real need).

---

## Drill 9: Rename to Reveal Intent (Then Delete the Comment)

### Before — comment compensating for a bad name

```java
// returns true if the user is allowed to edit the document
boolean check(User u, Doc d) {
    return u.id() == d.ownerId() || u.roles().contains("editor");
}
```

### After — the name says it; the comment is redundant

```java
boolean canEdit(User user, Doc doc) {
    return user.id() == doc.ownerId() || user.roles().contains(Role.EDITOR);
}
```

**Rule:** 2 (reveals intention). **Gain:** A comment that restates *what the code does* is a sign the code didn't say it itself. A good name (`canEdit`) makes the comment redundant — delete it (one fewer element to keep in sync). Bonus: `"editor"` → `Role.EDITOR` removes a magic-string connascence-of-meaning.

---

## Drill 10: Replace a Builder Nobody Needs

### Before — Builder for a 2-field object

```java
class Point {
    final int x, y;
    private Point(int x, int y) { this.x = x; this.y = y; }
    static class Builder {
        private int x, y;
        Builder x(int x) { this.x = x; return this; }
        Builder y(int y) { this.y = y; return this; }
        Point build() { return new Point(x, y); }
    }
}
// Usage: new Point.Builder().x(1).y(2).build();
```

### After — a plain constructor (or record)

```java
record Point(int x, int y) {}
// Usage: new Point(1, 2);
```

**Rule:** 4 (fewest elements). **Gain:** The Builder pattern earns its place for objects with *many* optional fields where telescoping constructors get unwieldy. For two required fields it's pure ceremony — a nested class and four methods replacing one constructor call. Use a record/struct; introduce a builder when the field count actually justifies it.

---

## Optimization Tips

### Where simplification actually pays off

1. **The win is cognitive, not cycles.** Measure with **cognitive complexity** and **element-count-per-feature**, not a stopwatch (though deleting machinery often speeds things up incidentally).
2. **Deleting an abstraction beats tuning it.** The biggest simplification wins come from *removing* elements (interfaces, layers, flags), not polishing them.
3. **DRY only real knowledge duplication.** Drills 5 and 7 DRY genuine duplication; Drill 6 *un*-DRYs a wrong abstraction. Know which you're doing — ask *would a change to one force the same change to the other?*
4. **Earn every abstraction.** Polymorphism (Drill 7), builders (Drill 10), and patterns are justified by a *present* need (recurring duplication, many fields, real variation) — not by "best practice."

### Simplification checklist

- [ ] Collapse one-implementation interfaces/hierarchies (Rule 4).
- [ ] Replace single-variant patterns (Strategy, Builder) with a function/constructor.
- [ ] Inline pass-through layers that add no behavior.
- [ ] Remove parameters/config/hooks no caller varies (YAGNI).
- [ ] DRY *real* knowledge duplication into one home (Rule 3).
- [ ] Split (un-DRY) the *wrong* abstraction — inline, then re-extract only shared knowledge.
- [ ] Introduce polymorphism only when a type-switch recurs or extension is a real need.
- [ ] Rename to reveal intent; delete comments the name makes redundant (Rule 2).
- [ ] Replace magic numbers/strings with named constants/enums (kills connascence-of-meaning).

### Anti-simplifications (don't do these)

- ❌ **Crushing clarity for element count** — a cryptic one-liner is not simpler than a clear function (Rule 4 never beats Rule 2).
- ❌ **DRYing coincidental similarity** — manufactures coupling between independent things.
- ❌ **Deleting a seam at a one-way door** — under-engineering; YAGNI is for *reversible* decisions only.
- ❌ **Simplifying without tests** — Rule 1 first; a "harmless cleanup" that flips behavior is a defect.
- ❌ **Dropping a required case to shorten code** — that's *simplistic*, not simple (fails Rule 1).

---

## Summary

Simplification toward the four rules is mostly **subtractive**: collapse one-impl hierarchies, replace single-variant patterns with functions, inline pass-through layers, and delete dead flexibility (config, hooks, unused parameters). The hardest judgement is **DRY direction** — DRY *real* knowledge duplication into one home, but *un*-DRY the wrong abstraction by inlining and re-extracting only what's genuinely shared. Throughout, the priority order holds: never trade clarity (Rule 2) for element count (Rule 4), never drop a required case (Rule 1) to shorten code, and never delete a seam at an irreversible boundary. The measurable win is cognitive complexity and element-count-per-feature — and, downstream, how quickly and safely the team can change the code.

---

[← Find-Bug](find-bug.md) · [Craftsmanship Disciplines](../README.md) · [Roadmap](../../../README.md)

**Simple Design suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next discipline:** [Pair & Mob Programming](../05-pair-and-mob-programming/junior.md).

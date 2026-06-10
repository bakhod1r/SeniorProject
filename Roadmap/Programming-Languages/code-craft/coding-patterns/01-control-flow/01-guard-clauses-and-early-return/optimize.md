# Guard Clauses & Early Return — Optimization Drills

> **Category:** [Control-Flow Patterns](../README.md) — handle invalid and edge cases up front, then return, keeping the happy path un-nested.

10 snippets to improve by applying (or sharpening) guard clauses. Most of these are **readability and correctness** optimizations — the pattern's payoff is cognitive, not cycles — but several have real runtime or maintainability gains.

---

## Table of Contents

1. [Drill 1: Flatten the Arrow](#drill-1-flatten-the-arrow)
2. [Drill 2: Collapse the else Ladder](#drill-2-collapse-the-else-ladder)
3. [Drill 3: Short-Circuit the Cheap Guard First](#drill-3-short-circuit-the-cheap-guard-first)
4. [Drill 4: Move Cleanup to Scope, Then Return Early](#drill-4-move-cleanup-to-scope-then-return-early)
5. [Drill 5: Guard Out the Empty Case Before Allocating](#drill-5-guard-out-the-empty-case-before-allocating)
6. [Drill 6: Lift Loop-Invariant Guards Out of the Loop](#drill-6-lift-loop-invariant-guards-out-of-the-loop)
7. [Drill 7: Replace Pervasive Null Guards with a Type](#drill-7-replace-pervasive-null-guards-with-a-type)
8. [Drill 8: Keep the Hot-Path Guard Allocation-Free](#drill-8-keep-the-hot-path-guard-allocation-free)
9. [Drill 9: Aggregate Validation Errors](#drill-9-aggregate-validation-errors)
10. [Drill 10: Replace a Guard with a Null Object](#drill-10-replace-a-guard-with-a-null-object)
11. [Optimization Tips](#optimization-tips)
12. [Summary](#summary)

---

## Drill 1: Flatten the Arrow

### Before — nested, happy path buried

```python
def checkout(cart):
    if cart is not None:
        if cart.items:
            if cart.total > 0:
                return charge(cart)
            else:
                raise ValueError("total must be positive")
        else:
            raise ValueError("empty cart")
    else:
        raise ValueError("no cart")
```

### After — guards on top, work at the bottom

```python
def checkout(cart):
    if cart is None:        raise ValueError("no cart")
    if not cart.items:      raise ValueError("empty cart")
    if cart.total <= 0:     raise ValueError("total must be positive")
    return charge(cart)
```

**Gain:** No perf change — JIT/compiler emits equivalent branches. The win is **cognitive complexity**: nesting depth drops from 3 to 1. SonarQube cognitive score falls; cyclomatic is unchanged.

---

## Drill 2: Collapse the else Ladder

### Before

```java
String tier(int points) {
    if (points >= 1000) {
        return "gold";
    } else if (points >= 500) {
        return "silver";
    } else if (points >= 100) {
        return "bronze";
    } else {
        return "none";
    }
}
```

### After

```java
String tier(int points) {
    if (points >= 1000) return "gold";
    if (points >= 500)  return "silver";
    if (points >= 100)  return "bronze";
    return "none";
}
```

**Gain:** Same behavior, fewer tokens, flatter read. Each returning `if` makes its `else` redundant. Linters (`no-else-return`) flag the original.

---

## Drill 3: Short-Circuit the Cheap Guard First

### Before — expensive check runs even for trivially-bad inputs

```go
func authorize(user *User, resource string) bool {
    if db.HasPermission(user.ID, resource) {   // DB round-trip FIRST
        if user != nil && user.Active {        // cheap checks last
            return true
        }
    }
    return false
}
```

### After — cheapest, most-disqualifying guards first

```go
func authorize(user *User, resource string) bool {
    if user == nil      { return false }   // free
    if !user.Active     { return false }   // free
    return db.HasPermission(user.ID, resource)   // expensive, only if needed
}
```

**Gain:** Real runtime win. Inactive/nil users now short-circuit **before** the DB call. Order guards by cost *and* fundamentality: free existence/shape checks before expensive value checks.

---

## Drill 4: Move Cleanup to Scope, Then Return Early

### Before — single-exit to keep cleanup correct, at the cost of nesting

```go
func process(path string) error {
    f, err := os.Open(path)
    var result error
    if err == nil {
        data, err2 := io.ReadAll(f)
        if err2 == nil {
            result = handle(data)
        } else {
            result = err2
        }
        f.Close()
    } else {
        result = err
    }
    return result
}
```

### After — `defer` lets every path return early, flat

```go
func process(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()              // cleanup on every return

    data, err := io.ReadAll(f)
    if err != nil {
        return err
    }
    return handle(data)
}
```

**Gain:** The single-exit version contorted control flow purely to guarantee `f.Close()`. `defer` removes that constraint, so guards can flatten the function. This is the optimization that retires single-exit.

---

## Drill 5: Guard Out the Empty Case Before Allocating

### Before — builds machinery before checking if there's any work

```java
List<Report> build(List<Row> rows) {
    Map<String, Aggregator> aggs = new HashMap<>();   // allocated even if rows is empty
    Formatter fmt = new Formatter();
    for (Row r : rows) { ... }
    if (rows.isEmpty()) return List.of();             // checked too late
    return render(aggs, fmt);
}
```

### After — guard the empty case first

```java
List<Report> build(List<Row> rows) {
    if (rows.isEmpty()) return List.of();             // bail before allocating

    Map<String, Aggregator> aggs = new HashMap<>();
    Formatter fmt = new Formatter();
    for (Row r : rows) { ... }
    return render(aggs, fmt);
}
```

**Gain:** For the common empty case, skips two allocations and a loop setup. A guard at the top isn't just readability — it can elide real work.

---

## Drill 6: Lift Loop-Invariant Guards Out of the Loop

### Before — guard re-evaluated every iteration

```python
def notify_all(users, channel):
    for u in users:
        if channel is None:          # invariant — same every iteration
            raise ValueError("channel required")
        if u.subscribed:
            channel.send(u)
```

### After — invariant guard once, per-item guard inside

```python
def notify_all(users, channel):
    if channel is None:              # checked once
        raise ValueError("channel required")
    for u in users:
        if not u.subscribed:         # per-item guard, flat
            continue
        channel.send(u)
```

**Gain:** The `channel` guard moves out of the loop (N checks → 1), and the per-item case uses `continue` to keep the body flat. Correctness bonus: the function fails *before* sending to anyone if the channel is missing.

---

## Drill 7: Replace Pervasive Null Guards with a Type

### Before — the same null+format guard duplicated across functions

```java
void emailUser(String addr)  { if (addr == null || !addr.contains("@")) return; send(addr); }
void cc(String addr)         { if (addr == null || !addr.contains("@")) return; ... }
void bcc(String addr)        { if (addr == null || !addr.contains("@")) return; ... }
```

### After — parse once into a type; the guard fires at construction

```java
record Email(String value) {
    Email {
        if (value == null || !value.contains("@"))
            throw new IllegalArgumentException("invalid email: " + value);
    }
}
void emailUser(Email e) { send(e.value()); }   // no guard
void cc(Email e)        { ... }                // no guard
void bcc(Email e)       { ... }                // no guard
```

**Gain:** N scattered runtime guards collapse to **one** constructor check, enforced by the compiler at every call site. "Parse, don't validate." Maintainability and correctness both improve; the duplicate guards can't drift apart.

---

## Drill 8: Keep the Hot-Path Guard Allocation-Free

### Before — guard formats a string on every call, even when it passes

```go
func handle(req *Request) error {
    err := fmt.Errorf("bad request: id=%d size=%d", req.ID, req.Size)  // allocated EVERY call
    if req.Size > maxBytes {
        return err
    }
    return process(req)
}
```

### After — build the error only when the guard actually fires

```go
func handle(req *Request) error {
    if req.Size > maxBytes {
        return fmt.Errorf("bad request: id=%d size=%d", req.ID, req.Size)  // only on rejection
    }
    return process(req)
}
```

**Gain:** On a hot path, the success case no longer allocates and formats an error string it never uses. Build the failure payload **inside** the guard, not above it.

```text
BenchmarkHandle_Before-8    18M    65 ns/op    48 B/op   (alloc every call)
BenchmarkHandle_After-8     90M    12 ns/op     0 B/op   (alloc only on reject)
```

---

## Drill 9: Aggregate Validation Errors

### Before — fails on the first guard; caller fixes one error at a time

```python
def validate(form):
    if not form.get("name"):  raise ValueError("name required")
    if not form.get("email"): raise ValueError("email required")
    if not form.get("phone"): raise ValueError("phone required")
    return Form(**form)
```

### After — collect all guard failures, report once

```python
def validate(form):
    errors = []
    if not form.get("name"):  errors.append("name required")
    if not form.get("email"): errors.append("email required")
    if not form.get("phone"): errors.append("phone required")
    if errors:
        raise ValidationError(errors)
    return Form(**form)
```

**Gain:** Not faster, but a far better UX for form/API validation — the user sees all five missing fields at once instead of five round-trips. Use this style at the boundary; keep fail-on-first for internal invariants where the first failure is already a bug.

---

## Drill 10: Replace a Guard with a Null Object

### Before — every caller guards for the missing-logger case

```python
def run(job, logger):
    if logger is not None:
        logger.info("start")
    do(job)
    if logger is not None:
        logger.info("done")
```

### After — a do-nothing logger removes the guards entirely

```python
class NullLogger:
    def info(self, *_): pass
    def error(self, *_): pass

def run(job, logger=NullLogger()):
    logger.info("start")     # no guard — NullLogger.info is a safe no-op
    do(job)
    logger.info("done")
```

**Gain:** The repeated `if logger is not None` guards vanish. Absence is handled by polymorphism instead of branching. This is the bridge to the sibling pattern [Null Object](../03-null-object/junior.md) — sometimes the best guard is the one you delete by making absence behave correctly.

---

## Optimization Tips

### Where guard clauses actually pay off

1. **Cognitive complexity** is the metric to watch — measure with SonarQube or a nesting linter, *not* cyclomatic complexity (which won't move).
2. **Short-circuit ordering** is the one reliable *runtime* win: cheap, disqualifying guards before expensive ones.
3. **Early-out before allocation** skips real work in the common bad/empty case.
4. **Allocation-free success path** matters only on proven hot paths — build error payloads inside the guard.

### Optimization checklist

- [ ] Flatten arrows into stacked guards (invert + return).
- [ ] Delete every `else` after a returning `if`.
- [ ] Order guards: free/existence checks before expensive/value checks.
- [ ] Bind cleanup with `defer`/`finally`/`with` so early returns are leak-safe.
- [ ] Guard the empty/trivial case before allocating machinery.
- [ ] Lift loop-invariant guards out of the loop.
- [ ] Push repeated value guards into a type (parse, don't validate).
- [ ] On hot paths, build error payloads inside the guard, not above it.
- [ ] Aggregate validation errors at the boundary.
- [ ] Replace pervasive null guards with a [Null Object](../03-null-object/junior.md) where absence has a safe default.

### Anti-optimizations

- ❌ **Micro-optimizing guard order** on a cold path — readability order (existence → shape → value) wins there.
- ❌ **Combining guards to save lines** when each needs a distinct error message.
- ❌ **Chasing cyclomatic complexity** with guards — it won't drop; you want the cognitive metric.
- ❌ **Removing a guard "for speed"** that protects an invariant — correctness beats nanoseconds.

---

## Summary

Guard-clause optimization is mostly about **flattening for the reader** and **short-circuiting for the machine**. The pattern itself is essentially free at runtime — the compiler emits the same branches — so its measurable wins are **cognitive complexity** (use a nesting-aware metric), **short-circuit ordering** (cheap guards first), and **early-out before allocation**. The deeper optimization is structural: push repeated guards into types and replace null guards with null objects, deleting whole classes of checks rather than tuning them.

---

[← Find-Bug](find-bug.md) · [Control-Flow](../README.md) · [Roadmap](../../../README.md)

**Guard Clauses & Early Return suite complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next pattern:** [Fail Fast](../02-fail-fast/junior.md).

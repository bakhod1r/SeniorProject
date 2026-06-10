# Null Object — Find the Bug

> **Category:** [Control-Flow Patterns](../README.md) — return a do-nothing object that satisfies the expected interface instead of `null`.

11 buggy snippets across Go, Java, Python.

---

## Bug 1: Null Object Throws (Java)

```java
Logger NULL = new Logger() {
    public void info(String msg) {
        throw new UnsupportedOperationException();   // BUG
    }
};
```

**Symptoms:** Every call site crashes instead of silently doing nothing.

<details><summary>Find the bug</summary>

A Null Object's methods must be no-ops. Throwing defeats the entire point — callers would still have to guard.

</details>

### Fix

```java
public void info(String msg) { /* no-op */ }
```

### Lesson

If "do nothing" is not safe here, you don't want a Null Object — you want [Fail Fast](../02-fail-fast/junior.md). A Null Object never throws.

---

## Bug 2: New Instance Per Call (Java)

```java
public Customer find(String id) {
    Customer c = db.lookup(id);
    return c != null ? c : new NullCustomer();   // BUG: fresh instance each time
}

if (customer == Customer.GUEST) { ... }          // never true!
```

**Symptoms:** Identity checks against the singleton fail; needless allocation on every miss.

<details><summary>Find the bug</summary>

A new Null Object is allocated per call. It's stateless, so this wastes memory and breaks `==` identity comparisons against the shared `GUEST`.

</details>

### Fix

```java
return c != null ? c : Customer.GUEST;   // shared singleton
```

### Lesson

A stateless Null Object is a shared immutable singleton. Never `new` it per call.

---

## Bug 3: Typed nil Returned as Interface (Go)

```go
func New(enabled bool) Logger {
    var l *consoleLogger          // nil pointer
    if enabled {
        l = &consoleLogger{}
    }
    return l                      // BUG: returns a non-nil interface wrapping a nil pointer
}

log := New(false)
if log == nil { return }          // FALSE — check doesn't fire
log.Info("x")                     // PANIC: nil pointer dereference
```

**Symptoms:** `log == nil` is false, yet `log.Info` panics.

<details><summary>Find the bug</summary>

A `nil` *pointer* boxed in an interface is **not** a `nil` *interface* — its type word is set. The nil check passes through and the method call dereferences nil.

</details>

### Fix

```go
func New(enabled bool) Logger {
    if !enabled {
        return nopLogger{}   // a real no-op value
    }
    return &consoleLogger{}
}
```

### Lesson

The Null Object pattern *is* the fix for Go's nil-interface trap: return a concrete no-op value, never a typed nil.

---

## Bug 4: Null Object for a Required Dependency (Java)

```java
PaymentGateway gw = lookup();          // returns NullGateway when unconfigured
gw.charge(order.total());              // BUG: silently does nothing — order ships unpaid
```

**Symptoms:** Orders complete "successfully" but no money is charged. No error, no log.

<details><summary>Find the bug</summary>

A payment gateway is a *required* dependency. A no-op `charge()` turns a misconfiguration into a silent financial bug. Null Object is wrong here.

</details>

### Fix

```java
PaymentGateway gw = Objects.requireNonNull(lookup(), "payment gateway not configured");
gw.charge(order.total());
```

### Lesson

Required collaborators must [fail fast](../02-fail-fast/junior.md). Only give a Null Object to *optional* collaborators whose silence is acceptable.

---

## Bug 5: Mixed null and Null Object Returns (Java)

```java
public Customer find(String id) {
    if (id == null) return null;                 // BUG: sometimes null...
    Customer c = db.lookup(id);
    return c != null ? c : Customer.GUEST;       // ...sometimes Null Object
}
```

**Symptoms:** Callers must check for *both* `null` and `GUEST`. Worst of both worlds.

<details><summary>Find the bug</summary>

The method returns `null` on one path and a Null Object on another. The whole point was to never return `null`.

</details>

### Fix

```java
public Customer find(String id) {
    if (id == null) return Customer.GUEST;       // consistent contract
    Customer c = db.lookup(id);
    return c != null ? c : Customer.GUEST;
}
```

### Lesson

Pick one contract. A method that returns a Null Object must *never* also return `null`.

---

## Bug 6: Dishonest Neutral Value (Python)

```python
class NullAccount:
    def balance(self): return 0      # BUG: 0 means "broke", not "no account"

acct = find_account(uid) or NullAccount()
if acct.balance() < required:
    deny()                            # denies a real customer whose lookup failed
```

**Symptoms:** A failed lookup is indistinguishable from a zero balance; real users are wrongly denied.

<details><summary>Find the bug</summary>

`balance() == 0` is not an honest neutral value for "account not found." The Null Object lies, and the lie propagates into a wrong decision.

</details>

### Fix

```python
def find_account(repo, uid):
    return repo.get(uid)             # return None; force the caller to handle absence

acct = find_account(repo, uid)
if acct is None:
    raise AccountNotFound(uid)       # distinct from "balance is zero"
```

### Lesson

When no neutral value is *truthful*, Null Object is the wrong pattern. Use `Optional`/error so "absent" and "zero" stay distinct.

---

## Bug 7: Null Object With Hidden Mutable State (Java)

```java
public final class NullCounter implements Counter {
    private int count = 0;                    // BUG: state in a "null" object
    public void incr() { count++; }
    public int total() { return count; }
}
Counter NULL = new NullCounter();             // shared, but now mutated by everyone
```

**Symptoms:** The shared singleton accumulates counts across unrelated callers; not thread-safe.

<details><summary>Find the bug</summary>

A Null Object must be stateless to be safely shared. This one mutates shared state across all callers and races under concurrency.

</details>

### Fix

```java
public final class NullCounter implements Counter {
    public void incr()      { /* no-op */ }
    public int total()      { return 0; }     // neutral, stateless
}
Counter NULL = new NullCounter();             // safe to share
```

### Lesson

A "no-op" that secretly keeps state isn't a Null Object. Keep it immutable and stateless so one instance can be shared.

---

## Bug 8: __getattr__ Null Object Swallows a Typo (Python)

```python
class Null:
    def __getattr__(self, name):
        return lambda *a, **k: None    # BUG: absorbs EVERY attribute

gw = payment_gateway or Null()
gw.chrage(order.total)                 # typo: "chrage" — silently does nothing
```

**Symptoms:** A misspelled method call succeeds and charges nothing. No `AttributeError`.

<details><summary>Find the bug</summary>

`__getattr__` makes *any* attribute a no-op, including typos and methods that never existed. The bug-catching `AttributeError` is gone.

</details>

### Fix

```python
class NullGateway:                     # implement the REAL interface explicitly
    def charge(self, amount): pass     # only `charge` is a no-op

gw = payment_gateway or NullGateway()
gw.chrage(order.total)                 # now raises AttributeError — caught
```

### Lesson

Prefer an explicit Null class implementing exactly the interface. `__getattr__` Null Objects silently absorb typos and undefined calls.

---

## Bug 9: Null Object Leaks Into Persistence (Java)

```java
Customer c = repo.find(id);            // may be Customer.GUEST
session.save(c);                       // BUG: persists a phantom "Guest" row
```

**Symptoms:** A `GUEST` Null Object gets written to the database as if it were a real customer.

<details><summary>Find the bug</summary>

The Null Object was meant for in-memory branch-free logic, but it crossed the persistence boundary and got stored as a real entity.

</details>

### Fix

```java
Customer c = repo.find(id);
if (c == Customer.GUEST) return;       // don't persist the Null Object
session.save(c);
```

Or make `GUEST` un-persistable (override `save`/serialization to reject it at the boundary).

### Lesson

Null Objects must not leak across boundaries (persistence, serialization) where their "phantom" nature becomes real data.

---

## Bug 10: Forgetting the Argument Is Still Evaluated (Java)

```java
Logger logger = Logger.NULL;
logger.info("payload=" + expensiveSerialize(bigObject));   // BUG: serialize runs anyway
```

**Symptoms:** Even though logging does nothing, `expensiveSerialize` runs on every call, dominating the hot loop.

<details><summary>Find the bug</summary>

The Null Object's `info` is a no-op, but the *argument* is constructed before the call. The expensive string is built and thrown away.

</details>

### Fix

```java
if (logger.isInfoEnabled()) {                          // guard expensive construction
    logger.info("payload=" + expensiveSerialize(bigObject));
}
// or pass a supplier the logger only invokes when enabled:
logger.info(() -> "payload=" + expensiveSerialize(bigObject));
```

### Lesson

A Null Object eliminates the *call* cost, not the cost of building its arguments. Guard or lazily defer expensive argument construction.

---

## Bug 11: Re-checking for the Null Object (Java)

```java
Customer c = repo.find(id);            // returns GUEST when absent
if (c != Customer.GUEST) {             // BUG: reintroduced the conditional
    sendNewsletter(c);
}
```

**Symptoms:** Every call site now branches on "is this the Null Object?" — exactly the conditional the pattern was meant to delete.

<details><summary>Find the bug</summary>

If callers must check whether they got the Null Object, the absence wasn't really "do nothing" — they needed to *react* to it. Null Object was the wrong choice.

</details>

### Fix

```java
// Use Optional so the absence decision is explicit and the type forces it:
repo.find(id).ifPresent(this::sendNewsletter);
```

### Lesson

If call sites re-check for the Null Object, you needed [Optional](../04-special-case/junior.md)/Special Case all along. Null Object only works when callers can *ignore* absence.

---

## Practice Tips

1. **Run `go test -race`** on shared Null Objects — confirm they're stateless.
2. **Grep for `new NullX()`** — Null Objects should be singletons, not per-call allocations.
3. **In Go, never return a typed-nil from a constructor** — return a no-op value.
4. **For every Null Object, ask:** would a reader seeing the no-op fire say "good" or "wait, why?" The latter means [Fail Fast](../02-fail-fast/junior.md).
5. **Check boundaries:** can the Null Object be persisted, serialized, or sent over the wire?

---

[← Tasks](tasks.md) · [Control Flow](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Optimize](optimize.md)

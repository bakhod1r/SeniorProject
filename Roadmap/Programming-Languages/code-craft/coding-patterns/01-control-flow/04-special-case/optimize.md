# Special Case — Optimization Drills

> **Category:** [Control-Flow Patterns](../README.md) — return a dedicated object for a recurring exceptional condition instead of branching for it at every call site.

9 inefficient implementations + optimizations.

Apple M2 Pro, single thread.

---

## Optimization 1: Replace Duplicated Sentinel Branches

### Slow / unmaintainable

```java
String name = (c == null) ? "occupant" : c.name();
Plan plan   = (c == null) ? Plan.BASIC  : c.plan();
boolean tax = (c == null) ? false       : c.isTaxExempt();
```

Three data-dependent branches per call site, copied across the codebase.

### Optimized

```java
Customer c = repo.find(id);   // UnknownCustomer if absent
String name = c.name();       // "occupant"
Plan plan   = c.plan();       // BASIC
boolean tax = c.isTaxExempt();// false
```

**This is primarily a maintainability optimization** — but on hot paths where the miss rate is unpredictable, removing the data branch also removes branch mispredictions (see Optimization 2).

---

## Optimization 2: Branch → Dispatch on Unpredictable Misses

### Slow — unpredictable branch

```java
for (String id : ids) {                 // ~50% miss, random
    Customer c = map.get(id);
    total += (c == null) ? 0 : c.spend();
}
```

A 50/50 unpredictable branch costs a ~15-cycle mispredict roughly half the time.

### Optimized — polymorphic, no data branch

```java
for (String id : ids) {
    total += repo.find(id).spend();     // UnknownCustomer.spend() == 0
}
```

### Benchmark (JMH)

```
SentinelBranch_50pctMiss     thrpt  10  310M ± 5M ops/s
SpecialCase_polymorphic      thrpt  10  600M ± 6M ops/s
```

The virtual call is monomorphic-friendly and has no mispredict. ~2× on this pattern.

---

## Optimization 3: Share the Singleton (Don't Allocate Per Miss)

### Slow

```python
def find(cid):
    row = db.get(cid)
    return UnknownCustomer() if row is None else Customer(row.name, row.plan)  # new each time
```

### Optimized

```python
UNKNOWN_CUSTOMER = UnknownCustomer()    # once

def find(cid):
    row = db.get(cid)
    return UNKNOWN_CUSTOMER if row is None else Customer(row.name, row.plan)
```

### Benchmark (Python, per call)

```
new UnknownCustomer() per miss   310 ns
shared singleton                  70 ns
```

A stateless special case is a constant — construct it once.

---

## Optimization 4: Zero-Size Special Case in Go

### Slow

```go
type unknownCustomer struct {
    name string   // unused, always "occupant"
    plan string   // unused, always "BASIC"
}
```

Each value carries dead fields; storing it in an interface may box and escape.

### Optimized

```go
type unknownCustomer struct{}                  // zero-size

func (unknownCustomer) Name() string { return "occupant" }
func (unknownCustomer) Plan() string { return "BASIC" }

var Unknown Customer = unknownCustomer{}        // shared, no per-use alloc
```

Zero-size structs cost nothing and a single shared interface value avoids per-call allocation. Confirm with `go build -gcflags='-m'`.

---

## Optimization 5: Cache Negative Lookups (Avoid Re-Querying)

### Slow

```go
func (r *Repo) Find(id string) Customer {
    row := r.db.Query(id)   // hits DB even for known-missing IDs, every call
    if row == nil { return Unknown }
    return realCustomer{row.Name, row.Plan}
}
```

A hot path repeatedly querying for IDs that don't exist hammers the DB.

### Optimized — cache the special case too

```go
func (r *Repo) Find(id string) Customer {
    if c, ok := r.cache[id]; ok {
        return c            // may be Unknown — a valid cached value
    }
    c := r.load(id)         // returns Unknown on miss
    r.cache[id] = c
    return c
}
```

### Tradeoff

- Use a **short TTL** or invalidate on write, or a late-registering customer stays "unknown" (see [find-bug](find-bug.md) Bug 10).

---

## Optimization 6: Devirtualize a Monomorphic Site

### Context

```java
for (Order o : orders) {
    audit(o.customer().name());   // customer() almost always RealCustomer
}
```

If a call site is **monomorphic** (one concrete type) or **bimorphic** (two), HotSpot devirtualizes and inlines the call — dispatch cost vanishes.

### Optimization

Keep special-case *types* few per call site. A site that sees `RealCustomer` + `UnknownCustomer` stays bimorphic and inlinable. Ten special-case types at one hot site go *megamorphic* and fall back to vtable lookup (still cheap, but no inlining).

**Rule:** don't proliferate special-case subtypes on the hottest paths.

---

## Optimization 7: Avoid Re-Wrapping at Every Boundary

### Slow

```python
# Each layer re-checks and re-wraps
def service_find(cid):
    c = repo_find(cid)
    return UNKNOWN_CUSTOMER if c is None else c   # repo already returns special case!
```

Double-handling: the repo already returns the special case, the service re-decides.

### Optimized

```python
def service_find(cid):
    return repo_find(cid)   # already a usable Customer
```

Decide **once**, at the lowest layer. Higher layers pass the object through untouched.

---

## Optimization 8: Lazy-Init Parameterized Special Cases

### Slow

```java
public Subscription find(String id) {
    Row r = db.query(id);
    String reason = computeHoldReason(r);          // always computed
    if (r == null)                return UnknownSubscription.INSTANCE;
    if (r.status() == HOLD)       return new SuspendedSubscription(reason);
    return new ActiveSubscription(r.renewsOn());
}
```

`computeHoldReason` runs for every lookup, even active/unknown ones that ignore it.

### Optimized

```java
if (r == null)            return UnknownSubscription.INSTANCE;
if (r.status() == HOLD)   return new SuspendedSubscription(computeHoldReason(r));  // only when needed
return new ActiveSubscription(r.renewsOn());
```

Compute special-case parameters only on the branch that uses them.

---

## Optimization 9: Instrument Without Slowing the Hot Path

### Slow

```java
if (r == null) {
    log.info("unknown customer for id=" + id);   // string concat + I/O per miss
    return UnknownCustomer.INSTANCE;
}
```

Per-miss string concatenation and synchronous logging dominate on a hot path.

### Optimized

```java
if (r == null) {
    unknownCounter.increment();                  // cheap atomic, no allocation
    return UnknownCustomer.INSTANCE;
}
```

A counter gives you the observability of [senior](senior.md)/[professional](professional.md) without the per-call cost. Alert on the metric; log at a sampled rate if you need detail.

---

## Optimization Tips

### How to find issues

1. **Profile allocations** — `pprof -alloc_objects`, async-profiler — a per-call special-case constructor shows up here.
2. **Check escape analysis** in Go: `go build -gcflags='-m'`.
3. **Inspect inlining** in Java: `-XX:+PrintInlining` — verify hot dispatch sites devirtualize.
4. **Watch the DB** — negative lookups that aren't cached are a common hidden cost.

### Optimization checklist

- [ ] Replace duplicated sentinel branches with one special case.
- [ ] Share stateless special cases as singletons.
- [ ] Use zero-size structs (Go) / immutable singletons (Java/Python).
- [ ] Cache negative lookups (with TTL/invalidation).
- [ ] Keep special-case types few per hot call site (stay mono/bimorphic).
- [ ] Decide once, at the lowest layer; don't re-wrap.
- [ ] Compute special-case parameters lazily.
- [ ] Instrument with counters, not per-call logs.

### Anti-optimizations

- ❌ **Allocating a new special case per call.** Share the singleton.
- ❌ **Caching negative results forever.** Late-arriving rows stay "unknown."
- ❌ **Proliferating subtypes on a hot path.** Megamorphic sites lose inlining.
- ❌ **Special-casing failures to "save" an error path.** That masks corruption.

---

## Summary

Special Case optimizations are mostly about **not paying twice**: don't allocate a stateless case per call, don't re-decide at every layer, and don't re-query for known-missing rows. On hot paths with unpredictable misses, swapping a data branch for polymorphic dispatch is a genuine speedup — and a singleton, immutable special case is essentially free.

---

[← Find-Bug](find-bug.md) · [Control Flow](../README.md) · [Roadmap](../../../README.md)

**Special Case roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

# Special Case — Find the Bug

> **Category:** [Control-Flow Patterns](../README.md) — return a dedicated object for a recurring exceptional condition instead of branching for it at every call site.

11 buggy snippets across Go, Java, Python.

---

## Bug 1: Special Case Masks a Real Error (Java)

```java
public Customer find(String id) {
    try {
        Row r = db.query(id);
        return (r == null) ? UnknownCustomer.INSTANCE : new Customer(r.name(), r.plan());
    } catch (SQLException e) {
        return UnknownCustomer.INSTANCE;   // BUG
    }
}
```

**Symptoms:** When the database is down, every customer becomes "occupant." Billing runs on garbage; no alert fires.

<details><summary>Find the bug</summary>

A *transport failure* is treated as a special case. "No row" is a valid absence; "DB unreachable" is an error that must fail fast.

</details>

### Fix

```java
} catch (SQLException e) {
    throw new RepositoryException("customer lookup failed", e);   // fail loud
}
```

### Lesson

Special-case *absence*, never *failure*. Distinguish "not found" from "couldn't look."

---

## Bug 2: Mutable Singleton Special Case (Java)

```java
public final class UnknownCustomer extends Customer {
    public static final UnknownCustomer INSTANCE = new UnknownCustomer();
    public List<String> tags = new ArrayList<>();   // BUG: mutable shared state
}

repo.find("a").tags.add("vip");   // mutates the shared singleton for everyone
```

**Symptoms:** A tag added for one "unknown" lookup shows up on all of them.

<details><summary>Find the bug</summary>

The shared singleton has mutable state. Any caller mutating it corrupts every other caller's view.

</details>

### Fix

Make it immutable; return an unmodifiable empty list:

```java
public List<String> tags() { return List.of(); }
```

### Lesson

Shared special cases must be immutable.

---

## Bug 3: Decision Duplicated at Call Sites (Python)

```python
c = repo.find(cid)            # returns UNKNOWN_CUSTOMER on miss
name = c.name if not c.is_unknown else "occupant"   # BUG: re-deciding
```

**Symptoms:** The branch the pattern was supposed to delete is back — and now the default ("occupant") lives in *two* places.

<details><summary>Find the bug</summary>

The caller re-implements the default that `UnknownCustomer` already provides. The whole point is that `c.name` already returns `"occupant"`.

</details>

### Fix

```python
name = c.name   # UNKNOWN_CUSTOMER.name is already "occupant"
```

### Lesson

Put the default *in* the special case; never re-decide at the call site.

---

## Bug 4: Returns `null` AND a Special Case (Go)

```go
func (r *Repo) Find(id string) Customer {
    row, ok := r.db[id]
    if !ok {
        return nil          // BUG: sometimes nil...
    }
    if row.Deleted {
        return Unknown      // ...sometimes the special case
    }
    return realCustomer{row.Name, row.Plan}
}
```

**Symptoms:** Callers still need a `nil` check *and* may get a special case. Inconsistent contract; nil-panic on the "not found" path.

<details><summary>Find the bug</summary>

The function has two contracts: `nil` for missing, special case for deleted. Callers can't rely on a non-nil result.

</details>

### Fix

```go
if !ok {
    return Unknown          // one contract: never nil
}
```

### Lesson

Pick one contract. If you adopt Special Case, the factory must *never* return null.

---

## Bug 5: Per-Call Allocation Instead of Singleton (Python)

```python
def find(customer_id):
    row = db.get(customer_id)
    if row is None:
        return UnknownCustomer()   # BUG: new object every miss
    return Customer(row.name, row.plan)
```

**Symptoms:** In a hot loop over millions of lookups, this allocates millions of identical objects — measurable GC churn.

<details><summary>Find the bug</summary>

A stateless special case should be a shared singleton, not constructed on every miss.

</details>

### Fix

```python
UNKNOWN_CUSTOMER = UnknownCustomer()   # module-level, once

def find(customer_id):
    row = db.get(customer_id)
    return UNKNOWN_CUSTOMER if row is None else Customer(row.name, row.plan)
```

### Lesson

Share stateless special cases.

---

## Bug 6: Special Case Leaks Across the Wire (Java)

```java
@GetMapping("/customers/{id}")
public Customer get(@PathVariable String id) {
    return repo.find(id);    // BUG: serializes UnknownCustomer as a real one
}
```

**Symptoms:** The API returns `{"name":"occupant","plan":"BASIC"}` for missing IDs. Clients save "occupant" as a real customer; nobody gets a 404.

<details><summary>Find the bug</summary>

The in-memory special case is honest; serialized, it impersonates a real customer. The wire boundary needs the raw condition.

</details>

### Fix

```java
@GetMapping("/customers/{id}")
public ResponseEntity<Customer> get(@PathVariable String id) {
    Customer c = repo.find(id);
    if (c.isUnknown()) return ResponseEntity.notFound().build();   // 404
    return ResponseEntity.ok(c);
}
```

### Lesson

Special cases are process-local ergonomics. At a boundary, emit the raw condition (404/null) and let the consumer re-hydrate.

---

## Bug 7: Write Silently Swallowed (Python)

```python
class UnknownCustomer:
    is_unknown = True
    def change_email(self, new):
        pass   # BUG: silently does nothing
```

**Symptoms:** `repo.find(missing_id).change_email("x@y.z")` returns successfully but nothing is saved. The caller believes the update happened.

<details><summary>Find the bug</summary>

A no-op write on a missing entity hides a real problem (updating a record that doesn't exist) behind a successful-looking call.

</details>

### Fix

```python
def change_email(self, new):
    raise PermissionError("cannot modify an unknown customer")
```

### Lesson

Special cases default *reads*. A write against "missing" is a bug; refuse it loudly.

---

## Bug 8: Parameterized Special Case Without Value Equality (Java)

```java
public final class MissingProduct extends Product {
    private final String sku;
    public MissingProduct(String sku) { super("Unavailable", BigDecimal.ZERO); this.sku = sku; }
    // BUG: no equals()/hashCode()
}

Set<Product> seen = new HashSet<>();
seen.add(new MissingProduct("a"));
seen.contains(new MissingProduct("a"));   // false — identity equality
```

**Symptoms:** Two missing products for the same SKU compare unequal; dedup logic and map keys break.

<details><summary>Find the bug</summary>

A parameterized special case uses default identity equality. Distinct instances for the same SKU don't compare equal.

</details>

### Fix

Use a `record` (auto `equals`/`hashCode`) or implement them:

```java
public record MissingProduct(String sku) implements ProductView { /* ... */ }
```

### Lesson

If the special case carries data, give it value equality.

---

## Bug 9: Special Case Used for a Security Decision (Go)

```go
func currentUser(r *http.Request) User {
    tok := r.Header.Get("Authorization")
    if tok == "" {
        return Guest          // ok for display...
    }
    u, err := verify(tok)
    if err != nil {
        return Guest          // BUG: invalid token treated as guest
    }
    return u
}

// later
if currentUser(r).Can("admin") { ... }   // guest.Can → false, "safe"?
```

**Symptoms:** A *forged or expired* token silently downgrades to guest. It looks safe (guest can't do admin), but it masks attacks and breaks audit ("who tried?").

<details><summary>Find the bug</summary>

A failed verification is a security event, not a special case. Defaulting to `Guest` hides tampering and conflates "anonymous" with "rejected."

</details>

### Fix

```go
u, err := verify(tok)
if err != nil {
    return nil, ErrInvalidToken   // fail closed and explicit, log it
}
```

### Lesson

Authentication failures must be explicit. Anonymous (no token) may be a special case; *rejected* (bad token) is an error.

---

## Bug 10: Cached Special Case Never Invalidated (Java)

```java
public Customer find(String id) {
    return cache.computeIfAbsent(id, k -> {
        Row r = db.query(k);
        return r == null ? UnknownCustomer.INSTANCE : new Customer(r.name(), r.plan());
    });
}
```

**Symptoms:** A customer who registers *after* their first (missing) lookup stays "unknown" forever — the cache pinned the special case.

<details><summary>Find the bug</summary>

The special case is cached permanently. When the real row later appears, the stale `UnknownCustomer` is still served.

</details>

### Fix

Don't cache negative results indefinitely — use a short TTL for special cases or invalidate on write:

```java
// On customer creation:
cache.invalidate(newCustomer.id());
```

### Lesson

Negative (special-case) cache entries need invalidation or a short TTL.

---

## Bug 11: `isUnknown()` Everywhere — Pattern Not Helping (Python)

```python
c = repo.find(cid)
if c.is_unknown:
    show_signup()
else:
    show_dashboard(c)

# ...repeated in 9 other views, each branching on is_unknown
```

**Symptoms:** The `if` the pattern was meant to remove is now spread across every view as `if c.is_unknown`. The special case added a class *and* kept the branches.

<details><summary>Find the bug</summary>

If nearly every caller must branch on `is_unknown`, the defaults aren't useful here — this condition wants `Optional`/explicit handling, not a Special Case.

</details>

### Fix

Push the behavior into the object so callers don't branch (e.g., `c.render()` dispatches to signup vs dashboard), or return `Optional[Customer]` and force one explicit decision.

### Lesson

If callers keep branching on `isUnknown()`, the pattern is misapplied — fix the defaults or switch to `Optional`/exceptions.

---

## Practice Tips

1. **Always separate "not found" from "lookup failed."** The first is a special case; the second fails fast.
2. **Grep for `isUnknown()`/`is_special` at call sites** — heavy use signals misapplication.
3. **Test the serialization boundary** — assert a missing entity yields 404/null, not a defaulted body.
4. **Test write paths on special cases** — they should refuse, not silently succeed.
5. **Run `go test -race`** for shared special-case singletons holding any state.

---

[← Tasks](tasks.md) · [Control Flow](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)

# Sentinel & Special Values — Find the Bug

> **Category:** [Resource & Type-Safety Patterns](../README.md) — 12 buggy snippets where a sentinel lies, leaks, or is mis-compared.

---

## Table of Contents

1. [Bug 1: Overloaded `0` for "no reading"](#bug-1-overloaded-0-for-no-reading)
2. [Bug 2: `-1` for a value that can be negative](#bug-2--1-for-a-value-that-can-be-negative)
3. [Bug 3: Forgotten sentinel check → out of bounds](#bug-3-forgotten-sentinel-check--out-of-bounds)
4. [Bug 4: `err == io.EOF` after wrapping](#bug-4-err--ioeof-after-wrapping)
5. [Bug 5: `map.get == null` can't tell absent from null](#bug-5-mapget--null-cant-tell-absent-from-null)
6. [Bug 6: `NaN` compared with `==`](#bug-6-nan-compared-with-)
7. [Bug 7: `None` as default hides a real `None`](#bug-7-none-as-default-hides-a-real-none)
8. [Bug 8: Returning `null` collection](#bug-8-returning-null-collection)
9. [Bug 9: Go nil interface is not nil](#bug-9-go-nil-interface-is-not-nil)
10. [Bug 10: Sentinel node exposed to caller](#bug-10-sentinel-node-exposed-to-caller)
11. [Bug 11: Validation logs instead of failing](#bug-11-validation-logs-instead-of-failing)
12. [Bug 12: `NaN` poisons a sort](#bug-12-nan-poisons-a-sort)

---

## Bug 1: Overloaded `0` for "no reading"

```python
def read_temp(sensor) -> float:
    if not sensor.ready():
        return 0.0          # BUG: 0.0 °C is a real temperature
    return sensor.value()

avg = (read_temp(a) + read_temp(b)) / 2   # absent sensors drag the mean down
```

<details><summary>Find the bug</summary>
`0.0` is a legal reading, so "no data" and "freezing" collapse into one value and leak into the average.
</details>

### Fix
```python
from typing import Optional
def read_temp(sensor) -> Optional[float]:
    return sensor.value() if sensor.ready() else None
```
**Lesson:** Never overload a valid value to mean "absent". Surface absence in the type.

---

## Bug 2: `-1` for a value that can be negative

```java
// returns the account's balance delta, or -1 if no transactions
static int balanceDelta(Account a) {
    if (a.transactions().isEmpty()) return -1;   // BUG: -1 is a valid delta
    return a.netChange();
}
```

<details><summary>Find the bug</summary>
A delta can legitimately be `-1` (a one-unit decrease), so `-1` is *inside* the domain — it collides with real data.
</details>

### Fix
```java
static OptionalInt balanceDelta(Account a) {
    return a.transactions().isEmpty() ? OptionalInt.empty()
                                      : OptionalInt.of(a.netChange());
}
```
**Lesson:** `-1` is only safe when it is out of the valid domain (array indices), not for general integers.

---

## Bug 3: Forgotten sentinel check → out of bounds

```go
i := indexOf(xs, target)   // -1 if absent
fmt.Println(xs[i])         // BUG: xs[-1] panics when absent
```

<details><summary>Find the bug</summary>
The `-1` sentinel was not checked before indexing, so the absent case indexes out of bounds.
</details>

### Fix
```go
if i := indexOf(xs, target); i >= 0 {
    fmt.Println(xs[i])
}
```
**Lesson:** Sentinels are forgettable by design — the missed check is the whole risk.

---

## Bug 4: `err == io.EOF` after wrapping

```go
_, err := readConfig(r)             // wraps: fmt.Errorf("read: %w", io.EOF)
if err == io.EOF {                  // BUG: wrapping changed the value
    // never runs
}
```

<details><summary>Find the bug</summary>
`%w` wrapping produces a new error value, so `==` against the sentinel fails.
</details>

### Fix
```go
if errors.Is(err, io.EOF) { /* ... */ }
```
**Lesson:** Compare sentinel errors with `errors.Is`, which walks the wrap chain.

---

## Bug 5: `map.get == null` can't tell absent from null

```java
Integer v = scores.get(user);
if (v == null) {
    scores.put(user, 0);   // BUG: also fires when user is mapped to null on purpose
}
```

<details><summary>Find the bug</summary>
`get` returns `null` for *both* "key absent" and "key present, value null"; the branch can't distinguish them.
</details>

### Fix
```java
if (!scores.containsKey(user)) {
    scores.put(user, 0);
}
```
**Lesson:** `null` is an overloaded sentinel inside maps — use `containsKey` / `(value, ok)`.

---

## Bug 6: `NaN` compared with `==`

```java
double r = compute();
if (r == Double.NaN) {        // BUG: always false
    handleInvalid();
}
```

<details><summary>Find the bug</summary>
IEEE-754 makes `NaN` unequal to everything, including itself, so `r == NaN` is never true.
</details>

### Fix
```java
if (Double.isNaN(r)) handleInvalid();
```
**Lesson:** Detect `NaN` with `isNaN` (or `r != r`), never `==`.

---

## Bug 7: `None` as default hides a real `None`

```python
def update(profile, nickname=None):
    if nickname is not None:        # BUG: caller can't intentionally set None
        profile.nickname = nickname
update(p, nickname=None)            # meant "clear it" — silently ignored
```

<details><summary>Find the bug</summary>
`None` is overloaded as both "not passed" and "explicitly None", so a caller cannot clear the field.
</details>

### Fix
```python
_MISSING = object()
def update(profile, nickname=_MISSING):
    if nickname is not _MISSING:
        profile.nickname = nickname   # None now means "clear it"
```
**Lesson:** When `None` is a legal argument, use a unique sentinel object for "not passed".

---

## Bug 8: Returning `null` collection

```java
List<Order> orders(String id) {
    if (!exists(id)) return null;   // BUG: forces null checks everywhere
    return db.query(id);
}
for (Order o : orders(id)) { ... }  // NPE when null
```

<details><summary>Find the bug</summary>
Returning `null` instead of an empty list makes every caller null-check; one miss is an NPE.
</details>

### Fix
```java
if (!exists(id)) return List.of();
```
**Lesson:** Return empty collections, not `null` (Effective Java, Item 54).

---

## Bug 9: Go nil interface is not nil

```go
type myErr struct{}
func (*myErr) Error() string { return "x" }

func op() error {
    var e *myErr            // nil pointer
    if false { e = &myErr{} }
    return e               // BUG: interface (type=*myErr, value=nil) != nil
}
if op() == nil { /* never runs */ }
```

<details><summary>Find the bug</summary>
A typed nil pointer returned as an interface yields a non-nil interface value; `== nil` is false.
</details>

### Fix
```go
func op() error {
    return nil   // return the literal nil, not a typed nil pointer
}
```
**Lesson:** From interface-returning functions, return a bare `nil`, never a nil typed pointer.

---

## Bug 10: Sentinel node exposed to caller

```python
class LinkedList:
    def __init__(self): self.head = Node(None)   # sentinel
    def items(self):
        node = self.head                          # BUG: starts at the sentinel
        while node:
            yield node.val                        # yields the sentinel's None first
            node = node.next
```

<details><summary>Find the bug</summary>
Iteration starts at the dummy sentinel node, leaking its placeholder value to the caller.
</details>

### Fix
```python
def items(self):
    node = self.head.next     # skip the sentinel
    while node:
        yield node.val
        node = node.next
```
**Lesson:** Sentinel *nodes* are internal scaffolding — never expose them across the API.

---

## Bug 11: Validation logs instead of failing

```python
def parse_port(s: str) -> int:
    try:
        return int(s)
    except ValueError:
        print("bad port")     # BUG: logs, then...
        return -1             # ...returns a sentinel callers won't check
```

<details><summary>Find the bug</summary>
On bad input it logs and returns `-1`; callers treat `-1` as a port and bind to a bogus value.
</details>

### Fix
```python
def parse_port(s: str) -> int:
    try:
        p = int(s)
    except ValueError as e:
        raise ValueError(f"invalid port {s!r}") from e
    if not (0 < p < 65536):
        raise ValueError(f"port out of range: {p}")
    return p
```
**Lesson:** For exceptional input, fail loudly — don't return a sentinel a caller will misuse.

---

## Bug 12: `NaN` poisons a sort

```java
double[] xs = { 3.0, Double.NaN, 1.0, 2.0 };
Arrays.sort(xs, ...);   // with a naive (a,b) -> a < b ? -1 : 1 comparator → BUG
// NaN breaks the comparator's contract → undefined order / IllegalArgumentException
```

<details><summary>Find the bug</summary>
A comparator using `<`/`>` returns inconsistent results around `NaN` (all comparisons false), violating the total-order contract.
</details>

### Fix
```java
Arrays.sort(xs);                 // primitive sort: defined NaN ordering (NaN last)
// or for boxed:
list.sort(Comparator.comparingDouble(x -> x)); // uses Double.compare, NaN-aware
```
**Lesson:** `NaN` lacks a total order; use NaN-aware comparators (`Double.compare`), not raw `<`/`>`.

---

## Practice Tips

1. **Run `go test -race` and `go vet`** — `vet` catches some nil-interface and `==`-on-error issues.
2. **Grep for bare `-1`, `0`, `""`, and `null` returns** and ask: could this collide with real data?
3. **Search for `== NaN`, `!= null` chains, and `== io.EOF`** — classic sentinel mis-comparisons.
4. **Test the absent case explicitly**, not just the happy path.

---

[← Tasks](tasks.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)

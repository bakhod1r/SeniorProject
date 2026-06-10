# Sentinel & Special Values — Interview Questions

> **Category:** [Resource & Type-Safety Patterns](../README.md) — sentinels, `null`, `NaN`, `Optional`, and the API rule that ties them together.

---

## Table of Contents

1. [Junior Questions](#junior-questions-10)
2. [Middle Questions](#middle-questions-10)
3. [Senior Questions](#senior-questions-10)
4. [Professional Questions](#professional-questions-8)
5. [Coding Tasks](#coding-tasks-5)
6. [Trick Questions](#trick-questions-5)
7. [Behavioral Questions](#behavioral-questions-4)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions (10)

### J1. What is a sentinel value?
**Answer:** An ordinary in-band value reserved to mean a special condition — `-1` for "not found", `EOF` for "end of stream", `\0` for "end of string", `null` for "no object".

### J2. When is a sentinel safe?
**Answer:** When it is **out of the valid domain** — impossible as a real value (`-1` can never be an array index), so it can never be confused with real data.

### J3. Why is returning `0` to mean "no data" dangerous?
**Answer:** `0` is a legal value, so "no data" and "the value is zero" become indistinguishable, and the special meaning leaks silently into arithmetic.

### J4. What does `"abc".indexOf("z")` return, and is that a good sentinel?
**Answer:** `-1`. Yes — `-1` is out of the index domain and the contract is universal.

### J5. What is in-band vs out-of-band signaling?
**Answer:** In-band hides the special case inside the return value (`-1`). Out-of-band uses a separate channel: a second return (`(value, ok)`), an exception, or an `Optional`.

### J6. Name three out-of-band alternatives to a bad sentinel.
**Answer:** `Optional`/`Optional`/`Maybe`; multiple return values (`(value, ok)`/`(value, error)`); exceptions; (also the Null Object).

### J7. What is Tony Hoare's "billion-dollar mistake"?
**Answer:** Inventing the `null` reference — an overloaded sentinel the type system did not force you to check, causing decades of null-dereference crashes.

### J8. Why can't you detect `NaN` with `x == NaN`?
**Answer:** IEEE-754 defines `NaN` as unequal to everything, including itself. Use `isNaN`/`math.IsNaN`, or the idiom `x != x`.

### J9. What is `io.EOF` in Go?
**Answer:** A sentinel error value returned by readers to signal end of input; it is *expected*, so it is a sentinel rather than a thrown error.

### J10. What should a method return instead of a `null` list?
**Answer:** An empty list (`List.of()`, `[]`), so callers can iterate without a null check.

---

## Middle Questions (10)

### M1. Give the one test for whether a sentinel is acceptable.
**Answer:** *Can a legitimate value of the same type ever equal the sentinel?* If yes, don't use it — go out-of-band.

### M2. When do you use `(value, ok)` vs `(value, error)` in Go?
**Answer:** `ok` when absence is ordinary (map miss) and the zero value is legal; `error` when the caller may want a *reason* for the failure.

### M3. Why is `Optional` discouraged as a field or parameter type?
**Answer:** `Optional` is designed for return types. As a field it adds an allocation and a second "absent" axis (`null` Optional vs empty Optional); as a parameter it forces callers to wrap. Use `@Nullable` fields / overloads instead (Effective Java, Item 55).

### M4. Why must you compare Go sentinel errors with `errors.Is`?
**Answer:** Wrapping (`fmt.Errorf("...: %w", err)`) changes the error value, so `==` fails; `errors.Is` walks the wrap chain and matches by identity.

### M5. What is the difference between a sentinel value and a sentinel node?
**Answer:** A sentinel *value* is an overloaded/out-of-domain return; a sentinel *node* is a real but inert element placed at a data-structure boundary to remove edge-case branches. Different tools, same name.

### M6. How does `OptionalInt` relate to this pattern?
**Answer:** It expresses "an int or nothing" without the boxing cost of `Optional<Integer>` — removing a common excuse for overloading `-1`.

### M7. Why does `map.get(k) == null` not tell you the key is absent?
**Answer:** The key may be present and mapped to `null`. Use `containsKey` (Java) or `(value, ok)` (Go) to disambiguate.

### M8. How do you refactor a function that returns `0` for "no reading"?
**Answer:** Change the return type to `Optional<T>`/`T?`, surface the absence in the type, then handle it once at the boundary (or push a default via a Null Object).

### M9. When is a thrown exception better than a sentinel?
**Answer:** When the absence/failure is *truly exceptional* and should not be silently ignorable — the exception is impossible to forget, unlike a sentinel.

### M10. What is "stringly-typed" sentinel code and how do you fix it?
**Answer:** Using magic strings like `status == "UNKNOWN"` as sentinels. Fix with a [type-safe enum](../02-type-safe-enums/junior.md) the compiler can check exhaustively.

---

## Senior Questions (10)

### S1. Where do sentinel nodes genuinely help?
**Answer:** Doubly-linked lists (dummy head/tail removes first/last branches), red-black trees (shared `NIL` node simplifies delete-fixup), and sentinel-search loops (planting the key removes the bounds check).

### S2. State the cardinal API-design rule for sentinels.
**Answer:** A function's failure/absent result must come from a value the success path can never produce; never overload a value from the valid range to mean failure.

### S3. How does the `NIL` node simplify a red-black tree?
**Answer:** Every real leaf points to one shared black `NIL`; rotations and recoloring can read `NIL`'s color/parent freely instead of guarding `node == null`, eliminating many delete-fixup edge cases.

### S4. How does Rust avoid `null` entirely?
**Answer:** There is no `null`; absence is `Option<T>` (a sum type). For pointer-like types, niche optimization stores `None` in the invalid (null) bit pattern, so `Option<&T>` is the same size as `&T` — zero cost.

### S5. Explain the `nil` interface trap in Go.
**Answer:** An interface is `(type, value)`; it equals `nil` only if both are nil. Returning a typed nil pointer yields a non-nil interface, so `err == nil` is false unexpectedly.

### S6. When is the sentinel-search optimization *not* worth it?
**Answer:** When the array is read-only or shared (you must mutate to plant the sentinel), or when branch prediction already hides the bounds-check cost — on modern CPUs the win is often marginal.

### S7. How do you migrate a `null`-heavy API safely?
**Answer:** Add `Optional`-returning variants delegating to the old ones, deprecate the old, migrate callers incrementally, then delete. Or introduce a Null Object at the wiring point.

### S8. Why is `NaN` reaching persistence a problem?
**Answer:** JSON has no `NaN` (invalid output); databases may error or coerce to `NULL`. Validate floats at the boundary before serialization.

### S9. Compare `Optional`, `Result`, and a sentinel for an HTTP fetch.
**Answer:** Sentinel (`null`) — forgettable, no reason. `Optional` — explicit absence, no reason. `Result`/`(T, error)` — explicit failure *with* a reason as data. For network calls you want the reason, so `Result`/`error`.

### S10. How does this pattern connect to the rest of its category?
**Answer:** Sentinels are the *problem statement*: [Type-Safe Enums](../02-type-safe-enums/junior.md) replace stringly-typed sentinels, `Optional` replaces `null`, and [RAII](../01-raii-and-dispose/junior.md) is the same "make the right thing automatic" philosophy for resources.

---

## Professional Questions (8)

### P1. How is `null` represented and why is dereferencing it a fault?
**Answer:** It is the machine address `0`. The OS leaves page 0 unmapped, so `*null` triggers a page fault → SIGSEGV; the JVM converts the SEGV into an NPE via a signal handler, so the happy path costs zero instructions.

### P2. When does Java `Optional` allocate?
**Answer:** A non-empty `Optional` is a heap object, but escape analysis scalar-replaces it when it doesn't escape (map/orElse chains). It cannot be elided when stored in a field or collection.

### P3. What is NaN-boxing?
**Answer:** JS engines reuse the ~2^51 unused NaN bit patterns of a 64-bit double to encode tagged pointers and small integers, so one 64-bit slot holds either a real double or a tagged non-double.

### P4. Quiet vs signaling NaN?
**Answer:** qNaN (top mantissa bit set) propagates silently through arithmetic; sNaN raises an FP exception on use. Managed languages almost always produce qNaN.

### P5. How does Rust's niche optimization make `Option` free?
**Answer:** It stores the `None` discriminant inside an invalid bit pattern of the inner type (e.g., a null pointer), so the tag costs no extra space — `Option<&T>` is the size of `&T`.

### P6. Why is `strlen` O(n), and what fixes it?
**Answer:** C strings mark their end with the `\0` sentinel and carry no length, so length requires scanning to the terminator. Length-prefixed strings (`{ptr, len}`) make length O(1) and prevent over-reads.

### P7. What's the cost of wrapping a sentinel error in Go?
**Answer:** `fmt.Errorf("...: %w", err)` allocates (~48 B). `errors.Is` is cheap. So wrap for context at boundaries, not inside hot loops.

### P8. How do tagged pointers relate to sentinels?
**Answer:** Aligned heap objects leave low address bits zero; runtimes reuse those bits (and a reserved pattern for `nil`) as type tags — finding a bit pattern the domain can't produce and using it as a marker, the sentinel idea at the implementation layer.

---

## Coding Tasks (5)

### C1. Replace an overloaded `-1` with `Optional` (Java).
```java
Optional<Integer> firstEven(int[] xs) {
    for (int i = 0; i < xs.length; i++)
        if (xs[i] % 2 == 0) return Optional.of(i);
    return Optional.empty();
}
```

### C2. Map lookup that distinguishes "absent" from "zero" (Go).
```go
func count(m map[string]int, k string) (int, bool) {
    v, ok := m[k]
    return v, ok
}
```

### C3. A unique sentinel so `None` can be a real argument (Python).
```python
_MISSING = object()
def patch(obj, *, name=_MISSING):
    if name is not _MISSING:
        obj.name = name   # caller may legitimately pass None
```

### C4. Sentinel-error API with `errors.Is` (Go).
```go
var ErrNotFound = errors.New("not found")
func get(m map[string]int, k string) (int, error) {
    if v, ok := m[k]; ok { return v, nil }
    return 0, fmt.Errorf("get %q: %w", k, ErrNotFound)
}
```

### C5. NaN-safe maximum (Python).
```python
import math
def safe_max(xs):
    clean = [x for x in xs if not math.isnan(x)]
    return max(clean) if clean else None
```

---

## Trick Questions (5)

### T1. Is `-1` always a bad sentinel?
**No.** For an array index it is *ideal* (out of domain). It is bad only when `-1` is a legal value of the type (a number that can be negative).

### T2. Is `null` always wrong?
**No.** `null` as a sentinel is fine when the language forces the check (Kotlin `T?`, Rust has none) or the convention is local and documented. It is wrong when callers can silently skip the check.

### T3. Does `Optional` always allocate?
**No.** `Optional.empty()` is a singleton; non-empty Optionals are elided by escape analysis when they don't escape. They allocate only when stored.

### T4. Is `err == io.EOF` correct?
**Sometimes.** It works for an *unwrapped* EOF, but breaks once the error is wrapped with `%w`. Always prefer `errors.Is(err, io.EOF)`.

### T5. Is a dummy linked-list head a sentinel *value*?
**No.** It is a sentinel *node* — a legitimate structural device, not an overloaded return value. Different concept, same word.

---

## Behavioral Questions (4)

### B1. Tell me about a bug caused by an overloaded sentinel.
**Sample:** "A metrics field used `0` for 'never reported'. It dragged dashboard averages toward zero for nodes that had simply not checked in yet. We switched to `Optional<Double>` and excluded absent readings from the aggregate."

### B2. When did you keep a sentinel instead of `Optional`?
**Sample:** "A hot parser loop returned `-1` for 'no delimiter'. `Optional` there allocated in a tight inner loop; profiling showed it mattered, and `-1` is provably out of the index domain, so we kept it and documented the contract."

### B3. How do you decide between exception and `Optional`?
**Sample:** "Is absence *normal* or *exceptional*? A cache miss is normal → `Optional`/`(value, ok)`. A corrupt config file is exceptional → throw."

### B4. How do you protect a team from the `null` mistake?
**Sample:** "`Optional` at API boundaries, `@Nullable`/NullAway in CI, Null Object for behavioral absence, and a review rule: getters never return bare `null` for collections."

---

## Tips for Answering

1. **Lead with the collision test:** could a real value equal the marker?
2. **Separate sentinel *nodes* (good craft) from sentinel *values* (API decision).**
3. **Name the cures:** `Optional`, `(value, ok)`, `Result`/`error`, exception, Null Object.
4. **Cite the cardinal rule:** never overload a valid value to mean failure.
5. **Know the machine facts:** `null = 0`, `NaN != NaN`, `Optional` elision, Go nil-interface trap.

---

[← Professional](professional.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)

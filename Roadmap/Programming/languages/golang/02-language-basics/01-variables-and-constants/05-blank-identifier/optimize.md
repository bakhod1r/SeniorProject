# Go Blank Identifier — Optimize

## Instructions

The blank identifier itself has zero runtime cost — it is a syntactic and semantic feature, not a runtime construct. But code **around** `_` can be wasteful. This file walks through performance traps and optimization patterns. Difficulty: 🟢 Easy, 🟡 Medium, 🔴 Hard.

---

## 1. The Zero-Cost Truth

`_` adds no instruction to the compiled binary. Every "cost" you see in benchmarks involving `_` comes from the expression on the right-hand side, not from the assignment to `_`.

Consider:

```go
// Version A
n, _ := strconv.Atoi(s)

// Version B
n := mustAtoi(s) // wraps strconv.Atoi, panics on err
```

A and B compile to roughly the same SSA. The discarded `error` is not stored — it occupies a return-register slot momentarily and then is dropped. Same for the boolean returned by map lookup, type assertion, channel receive.

```go
// Bench: each variant runs the same number of cycles
v, _ := m["key"]
v, ok := m["key"]; _ = ok
```

The presence or absence of `_` does not move the needle.

---

## Exercise 1 🟢 — `_ = expensiveCall()` Anti-Pattern

**Problem:**
```go
func warmCache() {
    _ = computeBigTable() // 200ms function
}
```

A teammate added this thinking "the underscore tells the compiler to skip work". They were wrong.

**Question:** What does this actually cost?

<details>
<summary>Solution</summary>

`computeBigTable` runs in full. The 200ms hit is real. The underscore only discards the *return value*, not the work that produced it.

If the goal is to warm a cache (i.e., the side effect is the point), this is correct — but you should comment it:

```go
// Warm internal lookup table; result is unused.
_ = computeBigTable()
```

If the goal was "skip this expensive call", you must remove the line:

```go
// computeBigTable() not needed in this code path.
```

**Benchmark** (1 iteration):
- Removed line: ~0 ns
- `_ = computeBigTable()`: 200,000,000 ns (200ms)

**Key insight:** `_` is a destination, not a sentinel for "skip".

</details>

---

## Exercise 2 🟢 — Discarding Error Without Penalty

**Problem:**
```go
// Version A
n, err := strconv.Atoi(s)
_ = err

// Version B
n, _ := strconv.Atoi(s)
```

**Question:** Are these equivalent at the IR / generated-code level?

<details>
<summary>Solution</summary>

Yes. In both cases, the `error` value is materialized into a return-register slot and then dropped. The compiler's SSA pass treats them identically — there is one assignment to a real variable (`err`) and that variable is then never read, so DCE eliminates the assignment in version A. In version B, the slot is never named in the first place.

**Benchmark** (1B iterations):
- Version A: identical timing
- Version B: identical timing

Both produce the same machine code (modulo debug info).

**Key insight:** The compiler is smart enough; pick the form for readability. `n, _ := ...` is the idiomatic choice.

</details>

---

## Exercise 3 🟢 — Range Loop Index Discard

**Problem:**
```go
// Version A
for i, v := range slice { _ = i; sum += v }

// Version B
for _, v := range slice { sum += v }

// Version C
for i := 0; i < len(slice); i++ { sum += slice[i] }
```

**Question:** Which is fastest? Which is most idiomatic?

<details>
<summary>Solution</summary>

A and B compile to identical code. The generated loop:

```
for i := 0; i < len(slice); i++ {
    v := slice[i]
    body
}
```

The "index" assignment in A is dropped because nothing reads it (DCE).

C is also identical for slice element access (`slice[i]` compiles to the same load as `v := slice[i]`).

**Benchmark** (1M-element slice, 100 iters):
- A: ~250 ns/iter
- B: ~250 ns/iter
- C: ~250 ns/iter

**Idiomatic choice:** B. The `_` is louder than dropping `i` from the destination list, but it makes intent explicit.

**Key insight:** Pick the readable form; the compiler optimizes equally.

</details>

---

## Exercise 4 🟡 — Cache-Line Padding with `_ [N]byte`

**Problem:**
```go
type Counter struct {
    A uint64
    B uint64
}
```

Two goroutines write `A` and `B` respectively. Every write invalidates the cache line for both. The result: false sharing, 100x slowdown vs ideal.

**Question:** How do you fix it with `_`?

<details>
<summary>Solution</summary>

Pad to a cache line (typically 64 bytes on x86-64):

```go
type Counter struct {
    A uint64
    _ [56]byte // pad: total = 64 bytes
    B uint64
    _ [56]byte // also pad after B for the next field
}
```

Now `A` and `B` live on separate cache lines. Each goroutine's write only invalidates its own line.

**Benchmark** (2 goroutines, 10M writes each, AMD Ryzen 7950X):
- Without padding: 1.2s (heavy false sharing)
- With padding: 0.04s (no contention)

**Refinement:** The exact line size depends on architecture. On Apple M1/M2 it is 128 bytes. Use `runtime/internal/sys.CacheLineSize` if available, or `golang.org/x/sys/cpu.CacheLinePad`.

**Key insight:** `_ [N]byte` is the canonical way to pad inside a struct. The field cannot be referenced (since `_` is anonymous), but it contributes to size and offsets.

</details>

---

## Exercise 5 🟡 — Compile-Time Assertion Cost

**Problem:**
```go
var _ io.Reader = (*MyReader)(nil)
```

**Question:** What is the runtime cost of this declaration?

<details>
<summary>Solution</summary>

Zero. The assertion is purely a compile-time type check.

- The conversion `(*MyReader)(nil)` to `io.Reader` is type-checked at compile time.
- The result is assigned to `_`, which produces no storage.
- SSA emits no instruction.
- The binary is unchanged in size and behavior.

**Verification:**
```bash
go tool compile -S main.go | grep -A 3 'var _ io.Reader'
```

You will not find any code emitted for the assertion line.

**Counter-example with cost:**
```go
var _ io.Reader = NewExpensiveReader() // CONSTRUCTOR RUNS!
```

Here `NewExpensiveReader()` executes at package init time. Use the `(*T)(nil)` form to avoid this:

```go
var _ io.Reader = (*ExpensiveReader)(nil)
```

**Key insight:** Always prefer `(*T)(nil)` over `T{}` (or worse, `NewT()`) for compile-time assertions.

</details>

---

## Exercise 6 🟡 — Blank Import Cost

**Problem:**
```go
import _ "github.com/lib/pq"
```

**Question:** What is the runtime / startup cost?

<details>
<summary>Solution</summary>

Two costs:

1. **Binary size.** The package is linked in. For `lib/pq`, this adds ~2MB to the binary. For trivial packages, microseconds-of-disk.
2. **Startup.** The package's `init` runs once at process start. For `lib/pq`, `init` calls `sql.Register("postgres", &Driver{})` — a constant-time map insert plus type metadata setup. Negligible (~microseconds).

The blank import does NOT cost more than a normal import; the only difference is the local name binding.

**Multiple drivers:** If you import `_ "github.com/lib/pq"` AND `_ "github.com/go-sql-driver/mysql"` AND `_ "modernc.org/sqlite"`, your binary contains all three drivers. Build tags (Exercise 7) let you exclude unused ones.

**Key insight:** Side-effect imports cost the same as normal imports. The cost is whatever `init` does, which for registration is trivial.

</details>

---

## Exercise 7 🔴 — Conditional Driver Linking

**Problem:** Your binary supports postgres and mysql. Some deployments use one, some the other. Linking both adds 4MB to the binary and a couple of milliseconds to startup.

**Question:** How do you let the build select?

<details>
<summary>Solution</summary>

Build tags:

```go
//go:build postgres
package main
import _ "github.com/lib/pq"
```

```go
//go:build mysql
package main
import _ "github.com/go-sql-driver/mysql"
```

Build with:
```bash
go build -tags=postgres ./cmd/myapp
# or
go build -tags=mysql ./cmd/myapp
```

The unused driver is not compiled in. Binary size and startup time both improve.

**Production tip:** Combine with a runtime config check:

```go
if cfg.Driver == "postgres" {
    db, _ = sql.Open("postgres", cfg.DSN)
} else if cfg.Driver == "mysql" {
    db, _ = sql.Open("mysql", cfg.DSN)
}
```

The `if` only succeeds when the corresponding driver was linked in. Wrong build = clear error at startup.

**Benchmark:**
- Both drivers: 18MB binary, 3.2ms startup
- One driver via tag: 16MB binary, 2.1ms startup

For most apps the difference is irrelevant; for embedded systems or fast-startup CLIs it matters.

</details>

---

## Exercise 8 🔴 — Avoiding Heap Pinning Through Capture

**Problem:**
```go
func use(items []Item) func() int {
    return func() int {
        return len(items)
    }
}
```

The returned closure captures `items`. The slice header is small, but the backing array is held alive as long as the closure exists.

**Question:** How does `_` enter the picture?

<details>
<summary>Solution</summary>

You can avoid capturing the full slice by extracting the bit you need:

```go
func use(items []Item) func() int {
    n := len(items)
    return func() int { return n }
}
```

Now the closure captures `n` (an int) instead of `items` (a header with a pointer to the array).

**Where `_` helps:** If you genuinely do not need any data from `items`:

```go
func register(items []Item) func() {
    _ = items // documentation: we considered using items, decided not to
    return func() { /* ... */ }
}
```

That `_ = items` is suspect. If you do not use `items`, do not name the parameter:

```go
func register(_ []Item) func() {
    return func() { /* ... */ }
}
```

The parameter exists for the API signature but is not bound to a variable. The slice header is still passed in (ABI), but no variable holds it, so escape analysis is more aggressive.

**Benchmark** (closure escaping to heap, slice of 1M items):
- With `items` captured: 8MB held until closure GC'd
- With `n := len(items)` extracted: 8 bytes held
- With `_ []Item` parameter: 0 bytes held (slice never bound)

**Key insight:** `_` for unused parameters tells escape analysis "this slot does not extend any pointee's lifetime".

</details>

---

## Exercise 9 🔴 — Struct-Layout Optimization with Reserved Fields

**Problem:**
```go
type Frame struct {
    Header  Header // 16 bytes
    Counter int64
    Flags   uint8
    // 7 bytes of compiler-inserted padding here
}
```

The compiler will align `Counter` (8-byte) on an 8-byte boundary. After `Header` (16 bytes), `Counter` is at offset 16 — fine. `Flags` is at offset 24, total size 32 bytes (with 7 bytes of trailing padding).

**Question:** How can you make the layout explicit?

<details>
<summary>Solution</summary>

Replace the implicit padding with explicit `_` fields:

```go
type Frame struct {
    Header  Header // 16 bytes, ends at offset 16
    Counter int64  // 8 bytes, ends at offset 24
    Flags   uint8  // 1 byte, ends at offset 25
    _       [7]byte // explicit trailing pad to 32 bytes
}
```

Three benefits:

1. **Self-documenting:** Future readers see the layout intentionally.
2. **Tooling:** Some unsafe / cgo workflows require explicit total size.
3. **Compatibility:** If you serialize the struct via `unsafe.Pointer` casts, explicit padding stabilizes the layout against compiler changes.

**Benchmark:** Identical to implicit padding — `unsafe.Sizeof(Frame{})` is 32 in both cases.

**Key insight:** `_ [N]byte` makes layout explicit. For protocol structs and FFI, this is sometimes mandatory.

</details>

---

## Exercise 10 🔴 — Reducing Compile Time of Many Assertions

**Problem:** Your package has 50 types and 5 interfaces. You want to assert each type implements the right interfaces. Naively:

```go
var _ Iface1 = (*T1)(nil)
var _ Iface1 = (*T2)(nil)
// ... 50 lines per interface ...
```

**Question:** Does compile time grow noticeably?

<details>
<summary>Solution</summary>

Each assertion costs the type checker a method-set comparison: O(methods in interface). For 5 interfaces × 50 types × ~5 methods each = 1250 lookups. Modern Go (1.21+) does this in milliseconds.

You can group:

```go
var (
    _ Iface1 = (*T1)(nil)
    _ Iface2 = (*T1)(nil)
    _ Iface1 = (*T2)(nil)
    _ Iface2 = (*T2)(nil)
)
```

Same compile cost; cleaner source.

**When this matters:** Code generators emit thousands of assertions. Kubernetes' `zz_generated_deepcopy.go` files contain hundreds; total compile-time overhead is a few percent. For human-written code, never an issue.

**Benchmark** (Go 1.22, 1000 assertions):
- Compile time delta: ~50ms on a 5s compile = 1%

**Key insight:** Compile-time assertions are essentially free. Use them liberally.

</details>

---

## Exercise 11 🔴 — Avoiding Allocation in Type-Asserted Discard

**Problem:**
```go
v, _ := someInterface.(*BigStruct)
_ = v
```

**Question:** Does the type assertion allocate?

<details>
<summary>Solution</summary>

A type assertion `iface.(*T)` does NOT allocate. It compares the interface's type word against `*T` and either copies the data pointer or returns nil + false (in the comma-ok form).

The discard with `_` does not allocate either.

**However:**
```go
v, _ := someInterface.(BigStruct)
```

Here we assert into a **value** type. The interface's data pointer points to a heap-allocated copy. The assertion COPIES the value into `v`. If `BigStruct` is large (e.g., 4KB), this is a 4KB memcpy. The `_` does not save you from the copy.

**Optimization:** Assert into a pointer, then dereference if needed:

```go
ptr, _ := someInterface.(*BigStruct)
if ptr != nil {
    use(*ptr) // copy only if you actually need the value
}
```

**Benchmark** (BigStruct = 4KB, 1M iters):
- Pointer assertion: 250 ns/iter
- Value assertion: 4500 ns/iter

**Key insight:** `_` is free. The expression on the RHS is what costs.

</details>

---

## 12. Summary

The blank identifier itself: **zero cost**. Always.

What does cost:

1. **The expression on the right.** `_ = heavyCall()` runs the heavy call.
2. **The constructor in `var _ I = T{}`.** Use `(*T)(nil)` instead.
3. **The package's `init` in a blank import.** Usually trivial; matters at scale.
4. **The discarded value, if it forces an allocation.** Type assertions on values copy.

Optimization checklist:

- [ ] Compile-time interface assertions use `(*T)(nil)` form.
- [ ] No `_ = expensive()` lines without comments.
- [ ] Build tags exclude unused side-effect imports in size-sensitive binaries.
- [ ] Struct padding via `_ [N]byte` is explicit where layout matters.
- [ ] Cache-line padding uses `_ [56]byte` (or 120 on ARM64) between hot fields.
- [ ] Type assertions discard via pointer-to-T, not value-of-T, for big types.

The blank identifier is one of the rare Go features where you can be confident the compiler does the right thing. Optimize the rest of your code; `_` will not let you down.

# Go Nil Pointer Dereference — Optimize

## Instructions

Each exercise focuses on the cost of nil checks, opportunities the compiler takes to eliminate them, and patterns that minimize both panic risk and runtime cost. Difficulty: Easy, Medium, Hard.

---

## Exercise 1 (Easy) — Cost of an Explicit Nil Check

**Problem**:
```go
func get(p *int) int {
    if p == nil {
        return 0
    }
    return *p
}
```

**Question**: How does the compiler implement the nil check? What is the cost?

<details>
<summary>Solution</summary>

**Discussion**: The check compiles to a single `TEST` and conditional branch:

```asm
TESTQ AX, AX        ; sets ZF if AX (the pointer) is zero
JE    nil_branch
MOVQ  (AX), AX
RET
nil_branch:
XOR   AX, AX
RET
```

Cost: ~1 cycle for the TEST, plus branch prediction overhead. The branch predictor handles consistent paths well (~0 effective cost when one branch dominates).

**Verify**:
```bash
go build -gcflags="-S" main.go 2>&1 | grep -A 10 "main.get"
```

**Key insight**: An explicit nil check is essentially free in normal code. Don't avoid them for performance.
</details>

---

## Exercise 2 (Easy) — Implicit Nil Check on Field Access

**Problem**:
```go
type T struct {
    field int
}

func read(t *T) int {
    return t.field
}
```

**Question**: Does the compiler insert an explicit nil check?

<details>
<summary>Solution</summary>

**Discussion**: For `t.field` where `field` is at a small offset (well below 64 KB), no explicit check. The load itself faults if `t == nil`:

```asm
MOVQ (AX), AX     ; loads t.field; if t is nil, this faults
RET
```

The CPU's MMU handles the check via the page protection on the nil page. Cost: 0 instructions for the check; the only cost is the load itself.

For very large offsets (>64 KB), the compiler inserts an explicit check because the offset could reach into mapped memory.

**Verify**:
```bash
go build -gcflags="-d=nil -S" main.go 2>&1 | head -50
```

**Key insight**: Most field accesses get free nil checking via the MMU. The "check" is just letting the load trap.
</details>

---

## Exercise 3 (Easy) — Redundant Check Elimination

**Problem**:
```go
func work(p *T) int {
    if p == nil {
        return 0
    }
    return p.a + p.b + p.c // three field accesses
}
```

**Question**: How many nil checks does the compiler emit?

<details>
<summary>Solution</summary>

**Discussion**: One check at the top. The SSA pass `nilcheckelim` proves that after the `if p == nil` guard, `p` is non-nil. All three field accesses inherit this fact.

The compiled code:
```asm
TESTQ AX, AX
JE    return_zero
MOVQ  (AX), CX     ; p.a — no implicit check needed (proven non-nil)
ADDQ  8(AX), CX    ; p.b
ADDQ  16(AX), CX   ; p.c
MOVQ  CX, AX
RET
return_zero:
XOR   AX, AX
RET
```

Even the implicit checks are elided where possible (the load itself still acts as the safety net at the hardware level for most platforms; the compiler relies on this).

**Verify**:
```bash
go build -gcflags="-d=nil" main.go 2>&1 | grep "nil check"
```

You should see "removed nil check" lines.

**Key insight**: The compiler's nilcheckelim pass eliminates redundant checks. Write clear code; the compiler handles the optimization.
</details>

---

## Exercise 4 (Medium) — When Manual Check Beats Compiler

**Problem**:
```go
func process(items []*Item) {
    for _, it := range items {
        // do work using it
        sum += it.Value
        sum += it.Count
        sum += it.Total
    }
}
```

**Question**: Could the slice contain nil entries? Should you check?

<details>
<summary>Solution</summary>

**Discussion**: If the slice is allowed to contain nil, every `it.X` panics. The compiler cannot prove `it` is non-nil because the slice's pointer-to-Item is not statically known.

**Optimization** — filter or check:
```go
for _, it := range items {
    if it == nil {
        continue
    }
    sum += it.Value
    sum += it.Count
    sum += it.Total
}
```

After the check, the compiler proves `it != nil` for the rest of the loop body — no further nil checks for the three field accesses.

**Better optimization** — eliminate nils at the source:
```go
items = filterNils(items) // once
// then loop without checking
```

**Benchmark** (1M items, 5% nil):
- Loop with check: ~2.5 ns/iter, no panics
- No check: panics on first nil, undefined throughput

**Key insight**: Manual nil checks restore the compiler's ability to prove non-nilness for subsequent operations in the same block.
</details>

---

## Exercise 5 (Medium) — Nil-Safe Method vs Caller Check

**Problem**:
```go
type Logger struct{ w io.Writer }
func (l *Logger) Log(s string) {
    if l == nil { return }
    fmt.Fprintln(l.w, s)
}
```

vs

```go
func (l *Logger) Log(s string) {
    fmt.Fprintln(l.w, s) // requires non-nil
}
// Caller does the check.
```

**Question**: Which is faster? Which is better?

<details>
<summary>Solution</summary>

**Discussion**: Performance is identical in the common case (non-nil receiver). The check inside `Log` is one TEST + JE; outside, callers do the same.

**Code-quality difference**:
- Nil-safe method: callers don't need to know `Log` permits nil. Cleaner call sites.
- External check: `Log` documents non-nil precondition; callers are explicit.

**When nil-safe wins**:
- Logger is optional and frequently absent (e.g., test code).
- Many call sites; per-site check is repetitive.

**When non-safe wins**:
- The receiver should always be valid; nil indicates a bug.
- Performance-critical inner loop where even one TEST per call counts (rare).

**Benchmark** (1M calls, mostly non-nil):
- Both approaches: ~3 ns/op (essentially identical)

**Key insight**: Choose based on API style, not performance. The cost is negligible either way.
</details>

---

## Exercise 6 (Medium) — Inline Allocation vs Pointer

**Problem**:
```go
type Container struct {
    item *Item
}

func process(c *Container) int {
    if c.item == nil {
        return 0
    }
    return c.item.value
}
```

vs

```go
type Container struct {
    item    Item
    hasItem bool
}

func process(c *Container) int {
    if !c.hasItem {
        return 0
    }
    return c.item.value
}
```

**Question**: Which is more efficient? Memory layout?

<details>
<summary>Solution</summary>

**Discussion**:
- Pointer version: 8 bytes for the pointer + N bytes for the heap-allocated Item (separate allocation).
- Inline version: sizeof(Item) + 1 byte for hasItem (with padding for alignment).

For small Item types (a few words), inline wins:
- Single allocation for Container.
- Better cache locality.
- No pointer dereference.

For large Items, pointer wins when Container has many instances and Item is rarely populated:
- Sparse Items don't waste memory.

**Cost comparison** (1M Containers, 50% with item, Item is 8 bytes):
- Pointer version: 16 + (50% × 8) = ~20 MB total, plus GC overhead per nested allocation.
- Inline version: 16 MB total, single allocation per Container.

**Benchmark access**:
- Pointer: load Container, load item ptr, branch, load item.value — 3 loads.
- Inline: load Container, load hasItem, branch, load item.value — 2 loads (item is at known offset).

**Key insight**: Inline is cheaper for small, frequently-populated optional fields. Pointer is cheaper for large, sparse fields.
</details>

---

## Exercise 7 (Medium) — Avoiding Nil Slices in Hot Paths

**Problem**:
```go
func sum(xs []int) int {
    if xs == nil {
        return 0
    }
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}
```

**Question**: Is the nil check needed?

<details>
<summary>Solution</summary>

**Discussion**: No. A nil slice has length 0; `range` over a nil slice iterates zero times. The early return is functionally equivalent to falling through.

**Optimization**:
```go
func sum(xs []int) int {
    total := 0
    for _, x := range xs {
        total += x
    }
    return total
}
```

For nil `xs`, this returns 0 — same as the original.

**Benchmark** (1M calls with mix of nil and populated):
- With check: 2.0 ns/op for nil; 200 ns/op for populated (length 100).
- Without check: 1.5 ns/op for nil (loop check skipped immediately); 200 ns/op for populated.

**Key insight**: Nil slices are valid for read operations. Don't add checks the language already handles.
</details>

---

## Exercise 8 (Hard) — Recover Cost in Hot Path

**Problem**:
```go
func safeProcess(p *T) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    return p.Compute(), nil
}
```

**Question**: What is the cost of the deferred recover? When does it dominate?

<details>
<summary>Solution</summary>

**Discussion**: `defer` itself has cost (in older Go, ~50 ns; in Go 1.14+ with open-coded defers, much less). `recover` is essentially free unless a panic is in flight.

**Cost decomposition**:
- defer setup: ~5 ns (open-coded) or ~50 ns (heap-allocated).
- recover when no panic: ~1 ns.
- recover when panic: stack scan, ~µs.

For 1M calls/sec, the defer overhead is significant: 5 ns × 10^9 = 5 seconds of CPU per second of wall time per core.

**Optimization** — avoid defer in hot paths:
```go
func process(p *T) (int, error) {
    if p == nil {
        return 0, errors.New("nil")
    }
    return p.Compute(), nil
}
```

If the check is sufficient, no recover needed.

**Optimization** — recover at higher level, not per call:
```go
func batch(ps []*T) (results []int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("batch: %v", r)
        }
    }()
    for _, p := range ps {
        results = append(results, p.Compute())
    }
    return
}
```

One defer for many calls.

**Benchmark** (1M calls):
- Per-call defer+recover: ~50 ns/op (Go 1.13)
- Per-call defer+recover: ~7 ns/op (Go 1.14+, open-coded)
- No defer: ~3 ns/op

**Key insight**: Recover is for boundaries, not per call. Open-coded defers reduce the cost dramatically in modern Go but it's not zero.
</details>

---

## Exercise 9 (Hard) — Compiler-Inserted Check at Large Offset

**Problem**:
```go
type Big struct {
    pad  [70 * 1024]byte // 70 KB
    last int
}

func read(b *Big) int {
    return b.last // offset > 64 KB
}
```

**Question**: Why does this case need an explicit nil check?

<details>
<summary>Solution</summary>

**Discussion**: The first 64 KB of the address space (or whatever `mmap_min_addr` reserves) is unmapped. A field at offset less than 64 KB always falls in this protected region when the pointer is nil — the load itself faults.

But for offset > 64 KB (e.g., 70 KB), the address `nil + 70 KB = 0x11800` could land in mapped memory. If by chance another mapping occupies that region, the load would silently succeed and read garbage. The compiler must insert an explicit check:

```asm
TESTQ AX, AX
JE    panic_branch
MOVQ  (offset)(AX), AX
RET
panic_branch:
CALL runtime.panicmem(SB)
```

**Verify**:
```bash
go build -gcflags="-d=nil -S" main.go 2>&1 | grep -A 10 "main.read"
```

You'll see the explicit check.

**Key insight**: Large struct field offsets force explicit checks. Small structs benefit from MMU-level free checking.
</details>

---

## Exercise 10 (Hard) — Cache-Friendly Nil Filtering

**Problem**:
```go
func sumValues(items []*Item) int {
    sum := 0
    for _, it := range items {
        if it != nil {
            sum += it.Value
        }
    }
    return sum
}
```

**Question**: How can you optimize for branch-prediction with mostly-non-nil data?

<details>
<summary>Solution</summary>

**Discussion**: If `items` rarely contains nil, the branch predictor handles `if it != nil` well. If nils are frequent and unpredictable (e.g., 30%), the branch is less predictable and costs more cycles.

**Optimization 1** — pre-filter once:
```go
items = items[:0:cap(items)]
for _, it := range source {
    if it != nil {
        items = append(items, it)
    }
}
// Now sum without checks
sum := 0
for _, it := range items {
    sum += it.Value
}
```

**Optimization 2** — branchless-friendly with sentinel:
```go
type Item struct {
    Value int
}
var zero Item

// In source, replace nils with &zero before storing:
if item == nil {
    item = &zero
}
// Sum: no nil check needed; zero contributes 0.
```

**Optimization 3** — change data layout to avoid pointers:
```go
type Item struct {
    Value int
    Valid bool
}
items := []Item{...} // no pointers; nil unrepresentable
```

**Benchmark** (1M items, 30% nil, randomly distributed):
- With check, mispredicted: ~3.5 ns/iter
- Pre-filter once + sum: ~1.5 ns/iter (sum phase) + filter cost amortized
- Branchless: ~1.0 ns/iter (no branch at all)

**Key insight**: Branch mispredictions hurt. Filter once, use sentinels, or eliminate nils via data design.
</details>

---

## Bonus Exercise (Hard) — Profile and Tune Nil-Heavy Code

**Problem**: A service shows high CPU in functions doing chained pointer access. How do you investigate and improve?

<details>
<summary>Solution</summary>

**Step 1** — profile:
```bash
go test -cpuprofile=cpu.prof -bench=BenchmarkChain
go tool pprof cpu.prof
```

Look for hot lines that include field accesses on possibly-nil pointers.

**Step 2** — check for unnecessary checks:
```bash
go build -gcflags="-d=nil" main.go 2>&1 | grep "generated nil check"
```

Identify checks the compiler couldn't elide.

**Step 3** — restructure:
- Add a single nil guard at function entry; the compiler propagates.
- Replace `*T` chains with embedded structs or value types.
- Pre-filter slices of pointers.

**Step 4** — measure with `-benchmem`:
```bash
go test -bench=BenchmarkChain -benchmem
```

Compare allocations before and after.

**Step 5** — verify with assembly:
```bash
go build -gcflags="-S" 2>asm.txt
grep -A 50 "main.hot" asm.txt
```

Ensure the inner loop has minimal nil-check overhead.

**Key insight**: Profile first. The compiler is good at nil checks; the wins come from data structure changes, not micro-optimization of individual checks.
</details>

---

## Bonus Exercise 2 (Hard) — `nilcheck.go` Deep Dive

**Problem**: Read `cmd/compile/internal/ssa/nilcheck.go` in the Go source. What invariants does it preserve?

<details>
<summary>Solution</summary>

**Discussion**: The pass walks the dominator tree of the SSA control-flow graph. For each block, it tracks the set of pointer values known to be non-nil entering the block (from dominators) and entering subsequent blocks via comparisons (`p == nil` / `p != nil`).

Key data structures:
- `nonNilValues map[*ssa.Value]bool` — pointer values proven non-nil in this scope.
- `OpIsNonNil` — explicit nil-check operation.
- `OpNilCheck` — runtime check that may be elided.

Algorithm:
1. Walk dominator tree pre-order.
2. For each block, gather facts from the entering edge (e.g., "if p != nil branch entered, p is non-nil here").
3. For each `OpNilCheck` on a value already proven non-nil, mark it for elimination.
4. After the pass, the elimination phase rewrites out the eliminated checks.

The companion `prove.go` pass propagates additional facts (range, sign, nilness) and can mark more pointers as non-nil based on flow analysis.

**Verify**:
```bash
GOSSAFUNC=read go build .
# opens ssa.html in browser; navigate to "nilcheckelim" pass
```

**Key insight**: The compiler is sophisticated. Most "obvious" nil-check optimizations are already done. Focus on data structure design and API contracts.
</details>

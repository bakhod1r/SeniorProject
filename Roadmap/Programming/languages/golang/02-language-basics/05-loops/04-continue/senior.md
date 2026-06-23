# Go `continue` Statement — Senior Level

## 1. Compiler Internals: How `continue` is Lowered

The Go compiler (`cmd/compile`) processes `continue` in the `ssagen` (SSA generation) phase. It converts the high-level `continue` AST node into a `goto` in SSA (Static Single Assignment) form, targeting the loop's continuation block.

```
Source:
    for i := 0; i < n; i++ {
        if cond { continue }
        body()
    }

SSA (simplified):
    b1: // loop header
      v1 = LOAD i
      v2 = LESS v1, n
      If v2 → b2, b5

    b2: // loop body start
      v3 = CALL cond()
      If v3 → b4, b3

    b3: // rest of body
      CALL body()
      Goto b4

    b4: // loop post (i++)
      v4 = ADD v1, 1
      STORE i, v4
      Goto b1

    b5: // loop exit
```

`continue` generates a `Goto b4` — identical to reaching the end of the loop body naturally. The optimizer then may merge `b3` and `b4` if `body()` can be inlined.

---

## 2. Register Allocation and `continue`

Because `continue` is a simple jump to the post block, it does not affect register allocation significantly. The register allocator treats the loop as a single unit. Variables live across the `continue` point remain in registers.

This is relevant for hot loops where performance matters:

```go
// The compiler keeps 'sum' in a register across the continue jump
func sumOdd(data []int32) int64 {
    var sum int64
    for _, v := range data {
        if v&1 == 0 {
            continue // register for 'sum' is not spilled
        }
        sum += int64(v)
    }
    return sum
}
```

Run `go build -gcflags="-S"` to verify the assembly shows no memory spill around the branch.

---

## 3. Escape Analysis and `continue`

`continue` can interact with escape analysis when closures or interface values are created conditionally inside a loop:

```go
func processEvents(events []Event) {
    for _, e := range events {
        if e.Type == TypeIgnored {
            continue // escape analysis: Event value does NOT escape
        }
        // If we passed &e to a goroutine here, it would escape
        handle(e) // passing by value — no escape
    }
}
```

Use `go build -gcflags="-m"` to verify whether values escape to the heap inside your loop.

---

## 4. Loop Unrolling and `continue`

The Go compiler (and LLVM-based backends like TinyGo) may unroll loops. A `continue` in a loop that the compiler is unrolling adds a conditional branch in each unrolled copy. For tight inner loops with many `continue` statements, this can increase code size.

Mitigation: move filtering out of the hot path:

```go
// Before: continue inside hot loop
for _, v := range largeSlice {
    if v == 0 {
        continue
    }
    expensiveComputation(v)
}

// After: pre-filter (allocates, but branch-free in hot loop)
filtered := make([]int, 0, len(largeSlice))
for _, v := range largeSlice {
    if v != 0 {
        filtered = append(filtered, v)
    }
}
for _, v := range filtered {
    expensiveComputation(v)
}
```

---

## 5. Branch Prediction and `continue`

Modern CPUs predict branch outcomes. If `continue` is taken rarely (most items pass the filter), the CPU will predict "not taken" and execute correctly most of the time. If `continue` is taken frequently (most items are filtered out), consider restructuring the loop.

```go
// Profile: 90% of items are filtered — continue is taken often
// CPU's branch predictor will mostly predict correctly after warmup
// but the misprediction cost at boundary cases can add up in tight loops

func processFiltered(data []int32, result []int32) int {
    out := 0
    for _, v := range data {
        if v < threshold { // <-- this branch is taken 90% of the time
            continue
        }
        result[out] = v * 2
        out++
    }
    return out
}
```

For SIMD-friendly code, consider branchless alternatives using masking instead of `continue`.

---

## 6. `continue` in the Go Runtime Source

The Go runtime uses `continue` extensively. One notable example is the garbage collector's scan loops. In `runtime/mgcmark.go`:

```go
// Simplified representation of GC scan logic pattern
for _, obj := range scanQueue {
    if obj.marked {
        continue // already marked, skip
    }
    if !obj.inHeap() {
        continue // not a heap object
    }
    markObject(obj)
}
```

The runtime authors use `continue` deliberately to keep the GC scan loop readable while handling multiple skip conditions.

---

## 7. Postmortem 1: Infinite Loop from Misplaced `continue`

**Incident description:** A production service consumed 100% CPU and stopped processing messages.

**Root cause:**
```go
// Production code (simplified)
func consumeMessages(queue chan Message) {
    failures := 0
    for {
        msg, ok := <-queue
        if !ok {
            break
        }
        if !isValid(msg) {
            failures++
            if failures > 10 {
                log.Warn("too many failures")
                // BUG: developer intended to reset failures and continue
                // but wrote:
                failures = 0
                continue
                // The 'continue' here was correct, but in a previous version
                // the failures reset was AFTER the continue, so it never reset
            }
            continue
        }
        process(msg)
    }
}
```

**Lesson:** Always verify that `continue` does not bypass state that needs to be reset. Use a `defer` inside a closure or restructure the logic.

---

## 8. Postmortem 2: Memory Leak from `defer` inside Loop

**Incident:** Memory usage grew linearly over time in a file-processing service.

**Root cause:**
```go
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            log.Printf("skip %s: %v", p, err)
            continue
        }
        defer f.Close() // BUG: deferred, not closed per iteration
        if err := analyze(f); err != nil {
            continue // file handle accumulates
        }
    }
    return nil // ALL defers run here — too late
}
```

**Fix:**
```go
func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            log.Printf("skip %s: %v", p, err)
            continue
        }
    }
    return nil
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close() // runs when processOne returns — correct
    return analyze(f)
}
```

---

## 9. Postmortem 3: Wrong Label in Labeled `continue`

**Incident:** A CSV batch processor was silently skipping rows that should have been processed.

**Root cause:**
```go
Files:
    for _, file := range csvFiles {
        scanner := createScanner(file)
    Rows:
        for scanner.Scan() {
            fields := parse(scanner.Text())
            for _, f := range fields {
                if strings.TrimSpace(f) == "" {
                    continue Rows // developer intended to skip to next field
                    // BUG: this skips to next ROW, not next field
                }
                process(f)
            }
        }
    }
```

**Fix:**
```go
for _, file := range csvFiles {
    scanner := createScanner(file)
    for scanner.Scan() {
        fields := parse(scanner.Text())
        for _, f := range fields {
            if strings.TrimSpace(f) == "" {
                continue // no label — skips to next field only
            }
            process(f)
        }
    }
}
```

**Lesson:** Always verify which loop a labeled `continue` targets. Use minimal labels; only add them when truly needed.

---

## 10. Performance Optimization: Batch Processing with `continue`

For large datasets, filtering with `continue` before heavy computation is a key optimization:

```go
package main

import (
    "runtime"
    "sync"
)

func parallelFilter(data []Record, workers int) []Record {
    if workers == 0 {
        workers = runtime.NumCPU()
    }

    ch := make(chan Record, 256)
    out := make(chan Record, 256)
    var wg sync.WaitGroup

    // Producer
    go func() {
        for _, r := range data {
            ch <- r
        }
        close(ch)
    }()

    // Workers with continue for filtering
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for r := range ch {
                if !r.IsValid() {
                    continue // skip invalid records cheaply
                }
                if r.Score < minScore {
                    continue // skip low-score records
                }
                out <- r
            }
        }()
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    var results []Record
    for r := range out {
        results = append(results, r)
    }
    return results
}
```

---

## 11. SIMD-Friendly Alternative to `continue`

For data-parallel workloads, branchless code outperforms `continue`-based filtering on CPUs with SIMD capabilities:

```go
// Branch-based (uses continue implicitly via if-else)
func sumPositive(data []float64) float64 {
    sum := 0.0
    for _, v := range data {
        if v > 0 {
            sum += v
        }
    }
    return sum
}

// Branchless (may auto-vectorize on amd64)
func sumPositiveBranchless(data []float64) float64 {
    sum := 0.0
    for _, v := range data {
        // max(v, 0) branchlessly
        mask := v * float64(btoi(v > 0))
        sum += mask
    }
    return sum
}

func btoi(b bool) int {
    if b { return 1 }
    return 0
}
```

Benchmark both: for random data with 50% positives, the branchless version often wins by 20-40% on modern CPUs.

---

## 12. Static Analysis of `continue`

You can write a custom `go/analysis` pass to detect problematic `continue` usages:

```go
package main

import (
    "go/ast"
    "go/token"
    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "uselesscontinue",
    Doc:  "detects continue as the last statement in a loop body",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        ast.Inspect(file, func(n ast.Node) bool {
            forStmt, ok := n.(*ast.ForStmt)
            if !ok {
                return true
            }
            body := forStmt.Body.List
            if len(body) == 0 {
                return true
            }
            last := body[len(body)-1]
            branch, ok := last.(*ast.BranchStmt)
            if ok && branch.Tok == token.CONTINUE && branch.Label == nil {
                pass.Reportf(branch.Pos(), "useless continue: last statement in for body")
            }
            return true
        })
    }
    return nil, nil
}
```

---

## 13. `continue` in `go generate` and Code Generation

Generated code often uses `continue` in parser loops (e.g., `goyacc`-generated parsers). When writing a code generator, prefer `continue` in generated loops for clarity, but document the generated nature of the code:

```go
// Code generated by protoc-gen-go. DO NOT EDIT.
func (m *Message) unmarshal(b []byte) error {
    for len(b) > 0 {
        tag, n, err := consumeTag(b)
        if err != nil {
            return err
        }
        b = b[n:]

        switch tag.FieldNumber() {
        case fieldName:
            // ...
        case fieldAge:
            // ...
        default:
            // unknown field — skip
            n, err := consumeUnknown(tag.WireType(), b)
            if err != nil {
                return err
            }
            b = b[n:]
            continue // skip to next tag
        }
    }
    return nil
}
```

---

## 14. `continue` and Profiling: Identifying Hot Paths

Use `pprof` to identify whether the `continue` branch is on the hot path:

```bash
go test -bench=. -cpuprofile=cpu.prof ./...
go tool pprof -web cpu.prof
```

If the conditional before `continue` shows up as a hot spot, consider:
1. Moving expensive conditions after cheap ones
2. Pre-sorting data so the `continue` branch is taken less often
3. Using bitset/bitmap-based filtering instead of per-element branches

---

## 15. `continue` vs Early Return in Functional Pipeline Design

Senior engineers choose between `continue`-based iteration and functional pipelines based on composability needs:

```go
// Imperative: continue-based (single-pass, memory efficient)
func process(items []Item) []Result {
    results := make([]Result, 0, len(items))
    for _, item := range items {
        if !item.Valid() { continue }
        if item.Score < minScore { continue }
        results = append(results, transform(item))
    }
    return results
}

// Functional pipeline (composable, testable, reusable filters)
type Predicate[T any] func(T) bool
type Transform[T, U any] func(T) U

func Filter[T any](s []T, f Predicate[T]) []T { /* ... */ }
func Map[T, U any](s []T, f Transform[T, U]) []U { /* ... */ }

func process(items []Item) []Result {
    return Map(
        Filter(Filter(items, Item.Valid), func(i Item) bool { return i.Score >= minScore }),
        transform,
    )
}
```

The imperative `continue` approach is more efficient (one allocation, one pass). The functional approach is more composable and testable.

---

## 16. Concurrency Pattern: Fan-Out with `continue`-Based Filtering

```go
func fanOutWithFilter(ctx context.Context, input <-chan Task, workers int) <-chan Result {
    out := make(chan Result, workers)
    var wg sync.WaitGroup

    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case task, ok := <-input:
                    if !ok {
                        return
                    }
                    if task.Priority < priorityThreshold {
                        continue // filter low-priority tasks
                    }
                    result, err := task.Execute(ctx)
                    if err != nil {
                        log.Printf("task %v failed: %v", task.ID, err)
                        continue
                    }
                    out <- result
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

---

## 17. `continue` and the Scheduler: Goroutine Preemption

In long-running loops without function calls, the Go scheduler (since Go 1.14, using asynchronous preemption) can preempt goroutines even in tight loops. However, in older code you may still see `runtime.Gosched()` before `continue` in tight CPU-bound loops to yield voluntarily:

```go
for _, item := range massiveDataset {
    if !filter(item) {
        runtime.Gosched() // yield to other goroutines
        continue
    }
    process(item)
}
```

Since Go 1.14, this is generally unnecessary. The scheduler will preempt the goroutine at safe points (including loop back edges).

---

## 18. `continue` with `unsafe` — Edge Cases

In unsafe code manipulating pointers directly, the loop variable must be correctly handled around `continue`:

```go
import "unsafe"

func scanMemory(ptr unsafe.Pointer, count int) {
    base := uintptr(ptr)
    for i := 0; i < count; i++ {
        addr := base + uintptr(i)*8
        val := *(*int64)(unsafe.Pointer(addr))
        if val == 0 {
            continue // GC must not move ptr while we are inside the loop
        }
        process(val)
    }
}
```

Important: when using `unsafe` pointer arithmetic in loops with `continue`, ensure the GC cannot move the base pointer. Use `//go:noescape` or pin the pointer if needed.

---

## 19. Memory Layout Implications

Consider cache performance when using `continue` to skip elements in a large struct slice:

```go
// AoS (Array of Structs) — cache unfriendly if many skips
type Record struct {
    ID       int64
    Data     [1024]byte // large field
    IsActive bool
}

// continue skips ID check but still loads the full cache line with Data
for _, r := range records {
    if !r.IsActive {
        continue
    }
    process(r.Data)
}

// SoA (Struct of Arrays) — cache friendly with continue
type Records struct {
    IDs      []int64
    Data     [][1024]byte
    IsActive []bool
}

// continue only touches the IsActive slice — hot cache
for i, active := range records.IsActive {
    if !active {
        continue
    }
    process(records.Data[i]) // cold data only for active records
}
```

---

## 20. `continue` in Parser / Lexer Design

Lexers and parsers frequently use `continue` in their main scan loop:

```go
type TokenType int

const (
    WHITESPACE TokenType = iota
    NUMBER
    IDENT
    EOF
)

func lex(input string) []Token {
    var tokens []Token
    i := 0
    for i < len(input) {
        ch := input[i]

        // Skip whitespace
        if ch == ' ' || ch == '\t' || ch == '\n' {
            i++
            continue
        }

        // Skip comments
        if ch == '/' && i+1 < len(input) && input[i+1] == '/' {
            for i < len(input) && input[i] != '\n' {
                i++
            }
            continue
        }

        if ch >= '0' && ch <= '9' {
            start := i
            for i < len(input) && input[i] >= '0' && input[i] <= '9' {
                i++
            }
            tokens = append(tokens, Token{NUMBER, input[start:i]})
            continue
        }

        // ... more token types
        i++
    }
    return tokens
}
```

---

## 21. `continue` in Distributed Systems: Idempotency Checks

In distributed processing where items may arrive multiple times:

```go
func processEvents(events []Event, processedIDs *sync.Map) {
    for _, event := range events {
        // Idempotency: skip already-processed events
        if _, loaded := processedIDs.LoadOrStore(event.ID, struct{}{}); loaded {
            metrics.IncCounter("events.duplicate")
            continue
        }

        // Circuit breaker check
        if circuitBreaker.IsOpen() {
            requeueEvent(event)
            continue
        }

        if err := handleEvent(event); err != nil {
            if isRetryable(err) {
                requeueEvent(event)
                processedIDs.Delete(event.ID) // allow retry
            }
            continue
        }

        metrics.IncCounter("events.processed")
    }
}
```

---

## 22. `continue` in Batch Database Operations

```go
func batchInsert(db *sql.DB, records []Record) error {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer func() {
        if err != nil {
            tx.Rollback()
        }
    }()

    stmt, err := tx.Prepare(`INSERT INTO records (id, data) VALUES (?, ?)`)
    if err != nil {
        return err
    }
    defer stmt.Close()

    var skipped int
    for _, r := range records {
        if !r.IsValid() {
            skipped++
            continue // skip invalid — don't abort the whole batch
        }
        if _, err = stmt.Exec(r.ID, r.Data); err != nil {
            if isDuplicate(err) {
                skipped++
                continue // skip duplicates gracefully
            }
            return fmt.Errorf("insert record %v: %w", r.ID, err) // fatal error
        }
    }

    log.Printf("inserted %d records, skipped %d", len(records)-skipped, skipped)
    return tx.Commit()
}
```

---

## 23. Observability: Tracing Across `continue`

When adding distributed tracing to loops, be careful that spans are properly ended before `continue`:

```go
func processWithTracing(ctx context.Context, items []Item) {
    for _, item := range items {
        ctx, span := tracer.Start(ctx, "process.item",
            trace.WithAttributes(attribute.String("item.id", item.ID)),
        )

        if !item.IsReady() {
            span.SetStatus(codes.Ok, "skipped: not ready")
            span.End() // must end span before continue
            continue
        }

        if err := process(ctx, item); err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
            span.End() // must end span before continue
            continue
        }

        span.SetStatus(codes.Ok, "processed")
        span.End()
    }
}
```

---

## 24. Idiomatic Go: When Senior Engineers Avoid `continue`

Senior engineers sometimes choose NOT to use `continue` for these reasons:

1. **Short-circuit with function extraction** — If the guard logic is complex, extract to a function.
2. **Functional style** — When composability matters more than single-pass efficiency.
3. **Readability in short loops** — A simple `if v > 0 { sum += v }` is clearer than `if v <= 0 { continue } sum += v` for one-liners.

The rule: use `continue` when it makes the code **more** readable, not mechanically for all filters.

---

## 25. Benchmark: `continue` vs Pre-Filtering

```go
package bench_test

import "testing"

var data = generateData(100_000)

func BenchmarkContinue(b *testing.B) {
    for n := 0; n < b.N; n++ {
        sum := 0
        for _, v := range data {
            if v < 0 {
                continue
            }
            sum += v
        }
        _ = sum
    }
}

func BenchmarkPreFilter(b *testing.B) {
    for n := 0; n < b.N; n++ {
        pos := make([]int, 0, len(data))
        for _, v := range data {
            if v >= 0 {
                pos = append(pos, v)
            }
        }
        sum := 0
        for _, v := range pos {
            sum += v
        }
        _ = sum
    }
}

// Results (approximate, amd64):
// BenchmarkContinue-8    ~500ns/op   0 B/op   (no allocation)
// BenchmarkPreFilter-8   ~800ns/op   400 KB/op (allocation for pos slice)
// Continue wins for small predicates; pre-filter may win for complex downstream work
```

---

## 26. `continue` in the Effective Go Guide

The official Effective Go document mentions `continue` in the context of loop control. The key principle from Effective Go: "use `continue` when it makes the code clearer." The guide emphasizes that Go loops are flexible and that `continue` is one of the tools for keeping loop bodies linear and readable.

Reference: https://go.dev/doc/effective_go#control-structures

---

## 27. Final Summary: Senior-Level Principles

| Principle | Detail |
|-----------|--------|
| **Compilation** | `continue` → single `JMP`; same machine code as `if-else` |
| **Register allocation** | Live variables stay in registers across `continue` |
| **Escape analysis** | Values don't escape solely due to `continue` |
| **Branch prediction** | Frequent `continue` → predict "taken"; infrequent → predict "not taken" |
| **Cache locality** | SoA layout improves cache hit rate when `continue` filters many items |
| **Defer** | Never defer inside a loop expecting per-iteration cleanup |
| **Tracing** | Always end spans before `continue` |
| **Scheduler** | Go 1.14+ handles preemption at loop back edges automatically |
| **Postmortem** | Most `continue` bugs are: wrong label, missing increment, deferred inside loop |
| **Style** | Use `continue` when it reduces nesting; extract to function when logic is complex |

# Go `continue` Statement — Optimize

Each exercise has a difficulty rating:
- 🟢 Easy — straightforward improvement
- 🟡 Medium — requires understanding of Go idioms
- 🔴 Hard — performance or architectural optimization

---

## Exercise 1 🟢 — Remove Useless End-of-Loop `continue`

**Before:**
```go
func processNumbers(nums []int) []int {
    result := make([]int, 0)
    for _, n := range nums {
        if n > 0 {
            result = append(result, n*2)
            continue // pointless
        }
        continue // also pointless
    }
    return result
}
```

**Task:** Remove unnecessary `continue` statements and simplify.

<details>
<summary>Optimized Solution</summary>

```go
func processNumbers(nums []int) []int {
    result := make([]int, 0, len(nums)) // pre-allocate capacity
    for _, n := range nums {
        if n > 0 {
            result = append(result, n*2)
        }
        // no continue needed — loop naturally advances
    }
    return result
}
```

**Improvements:**
- Removed 2 useless `continue` statements
- Pre-allocated slice capacity (`make([]int, 0, len(nums))`) to avoid repeated reallocations
- Simpler, more idiomatic Go

</details>

---

## Exercise 2 🟢 — Flatten Nested `if` Using `continue`

**Before:**
```go
func processUsers(users []User) {
    for _, u := range users {
        if u.IsActive {
            if u.Age >= 18 {
                if u.Email != "" {
                    if u.Role != "banned" {
                        sendWelcomeEmail(u)
                        updateLastLogin(u)
                        logEvent("user.processed", u.ID)
                    }
                }
            }
        }
    }
}
```

**Task:** Refactor using guard clauses with `continue` to reduce nesting from 4 levels to 1.

<details>
<summary>Optimized Solution</summary>

```go
func processUsers(users []User) {
    for _, u := range users {
        if !u.IsActive { continue }
        if u.Age < 18 { continue }
        if u.Email == "" { continue }
        if u.Role == "banned" { continue }

        // Happy path — flat, readable
        sendWelcomeEmail(u)
        updateLastLogin(u)
        logEvent("user.processed", u.ID)
    }
}
```

**Improvements:**
- Nesting reduced from 4 levels to 0 (flat)
- Each guard clause is an independent, testable condition
- The happy path code is immediately visible
- Easier to add/remove conditions

</details>

---

## Exercise 3 🟢 — Combine Multiple `continue` Conditions

**Before:**
```go
func filterWords(words []string) []string {
    var result []string
    for _, w := range words {
        if w == "" {
            continue
        }
        if len(w) < 3 {
            continue
        }
        if len(w) > 20 {
            continue
        }
        result = append(result, w)
    }
    return result
}
```

**Task:** Combine the conditions into fewer guards where it improves readability without sacrificing clarity.

<details>
<summary>Optimized Solution</summary>

```go
func filterWords(words []string) []string {
    result := make([]string, 0, len(words))
    for _, w := range words {
        // Combine length bounds into one guard
        if len(w) < 3 || len(w) > 20 {
            continue
        }
        result = append(result, w)
    }
    return result
}
```

**Improvements:**
- Empty string check is redundant: `len("") == 0 < 3`, so the length check already covers it
- Two bounds checks combined into one condition
- Pre-allocated capacity for the result slice
- Same behavior, fewer lines

**Note:** Only combine conditions when the combined form is still clearly readable. Don't combine unrelated conditions.

</details>

---

## Exercise 4 🟡 — Replace Labeled `continue` with Function Extraction

**Before:**
```go
func processMatrix(matrix [][]int) {
    var results []int
Outer:
    for i, row := range matrix {
        if len(row) == 0 {
            fmt.Println("empty row at", i)
            continue Outer
        }
        for j, val := range row {
            if val < 0 {
                fmt.Printf("negative at [%d,%d], skipping row\n", i, j)
                continue Outer
            }
            if val == 0 {
                fmt.Printf("zero at [%d,%d], skipping value\n", i, j)
                continue // inner continue
            }
            results = append(results, val)
        }
    }
    fmt.Println(results)
}
```

**Task:** Refactor to extract the row-processing logic into a helper function, eliminating the labeled `continue`.

<details>
<summary>Optimized Solution</summary>

```go
func processRow(i int, row []int) ([]int, bool) {
    if len(row) == 0 {
        fmt.Println("empty row at", i)
        return nil, false // false = skip this row
    }
    var results []int
    for j, val := range row {
        if val < 0 {
            fmt.Printf("negative at [%d,%d], skipping row\n", i, j)
            return nil, false // skip entire row
        }
        if val == 0 {
            fmt.Printf("zero at [%d,%d], skipping value\n", i, j)
            continue
        }
        results = append(results, val)
    }
    return results, true
}

func processMatrix(matrix [][]int) {
    var results []int
    for i, row := range matrix {
        rowResults, ok := processRow(i, row)
        if !ok {
            continue // clean, no label needed
        }
        results = append(results, rowResults...)
    }
    fmt.Println(results)
}
```

**Improvements:**
- No labeled `continue` — reduced cognitive load
- `processRow` is independently testable
- `processMatrix` reads as a straightforward pipeline
- Row logic is encapsulated; adding new row validations doesn't affect the outer loop

</details>

---

## Exercise 5 🟡 — Optimize Hot-Loop Filter (Memory Efficiency)

**Before:**
```go
func filterAndTransform(data []Record) []Output {
    // First pass: filter
    var valid []Record
    for _, r := range data {
        if !r.IsValid() {
            continue
        }
        valid = append(valid, r)
    }
    // Second pass: transform
    result := make([]Output, len(valid))
    for i, r := range valid {
        result[i] = transform(r)
    }
    return result
}
```

**Task:** Combine into a single pass to eliminate the intermediate slice allocation.

<details>
<summary>Optimized Solution</summary>

```go
func filterAndTransform(data []Record) []Output {
    // Single pass: filter + transform together
    result := make([]Output, 0, len(data)) // pre-allocate with upper bound
    for _, r := range data {
        if !r.IsValid() {
            continue
        }
        result = append(result, transform(r))
    }
    return result
}
```

**Improvements:**
- One pass instead of two (50% fewer loop iterations)
- No intermediate `valid` slice allocation
- Pre-allocated result slice with `cap = len(data)` (upper bound, avoids reallocations)
- Same behavior, lower memory pressure

**Benchmark result (approximate):**
- Before: 2 allocations, O(n) extra memory for `valid`
- After: 1 allocation, O(1) extra memory overhead

</details>

---

## Exercise 6 🟡 — Avoid `continue` for Clarity: Functional Alternative

**Before:**
```go
func getActiveUserIDs(users []User) []int {
    var ids []int
    for _, u := range users {
        if !u.IsActive {
            continue
        }
        if u.ID == 0 {
            continue
        }
        ids = append(ids, u.ID)
    }
    return ids
}
```

**Task:** The function is used in many places. Refactor to use a generic `Filter` function for better reusability and testability, while keeping the simple inline version as a comment showing when `continue` is appropriate.

<details>
<summary>Optimized Solution</summary>

```go
// Generic filter — reusable, testable
func Filter[T any](s []T, keep func(T) bool) []T {
    result := make([]T, 0, len(s))
    for _, v := range s {
        if !keep(v) {
            continue
        }
        result = append(result, v)
    }
    return result
}

func Map[T, U any](s []T, f func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = f(v)
    }
    return result
}

func getActiveUserIDs(users []User) []int {
    activeUsers := Filter(users, func(u User) bool {
        return u.IsActive && u.ID != 0
    })
    return Map(activeUsers, func(u User) int { return u.ID })
}

// When to use inline continue instead (simpler cases):
func getActiveUserIDsSimple(users []User) []int {
    ids := make([]int, 0, len(users))
    for _, u := range users {
        if !u.IsActive || u.ID == 0 { continue }
        ids = append(ids, u.ID)
    }
    return ids
}
```

**When to choose each:**
- `continue` inline: simple filters, performance-critical paths (no extra allocation)
- Functional `Filter/Map`: composable pipelines, testable filters, shared across packages

</details>

---

## Exercise 7 🟡 — Prevent Tracing Span Leak with `continue`

**Before:**
```go
func processItems(ctx context.Context, items []Item) {
    for _, item := range items {
        span := startSpan(ctx, "process.item")

        if !item.IsReady() {
            continue // BUG: span never ended
        }
        if item.Value < 0 {
            continue // BUG: span never ended
        }

        process(item)
        endSpan(span)
    }
}
```

**Task:** Refactor to ensure spans are always ended, even when `continue` is taken.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: End span explicitly before each continue
func processItems(ctx context.Context, items []Item) {
    for _, item := range items {
        span := startSpan(ctx, "process.item")

        if !item.IsReady() {
            endSpan(span) // end before continue
            continue
        }
        if item.Value < 0 {
            endSpan(span) // end before continue
            continue
        }

        process(item)
        endSpan(span)
    }
}

// Option 2 (preferred): Extract to function, use defer
func processItems(ctx context.Context, items []Item) {
    for _, item := range items {
        processOne(ctx, item)
    }
}

func processOne(ctx context.Context, item Item) {
    span := startSpan(ctx, "process.item")
    defer endSpan(span) // always ends

    if !item.IsReady() {
        return // defer runs
    }
    if item.Value < 0 {
        return // defer runs
    }

    process(item)
}
```

**Why Option 2 is better:**
- `defer` guarantees span always ends, even on panic
- No risk of forgetting to call `endSpan` before a new `continue`
- Adding future early-exit conditions is safe — defer handles all of them

</details>

---

## Exercise 8 🔴 — Branch Prediction Optimization

**Before (branch-unfriendly for hot loops):**
```go
func sumFiltered(data []int32) int64 {
    var sum int64
    for _, v := range data {
        if v < 0 {
            continue
        }
        if v > 1000 {
            continue
        }
        if v%7 == 0 {
            continue
        }
        sum += int64(v)
    }
    return sum
}
```

**Task:** Profile this function on a dataset where 80% of values pass all filters. Reorder conditions for optimal branch prediction. Explain the reasoning.

<details>
<summary>Optimized Solution</summary>

```go
// Reorder conditions: cheapest + most frequently skipping first
func sumFiltered(data []int32) int64 {
    var sum int64
    for _, v := range data {
        // Most selective + cheapest check first
        // If 80% pass, "most frequently skipping" means:
        // - Order by: (fraction that triggers continue) descending
        // - Also order by: (cost of check) ascending for ties

        // Assume: v%7 == 0 is least common (~14% skip)
        //         v < 0 is medium (~10% skip)
        //         v > 1000 is most common skip (~30% skip based on data)
        // So order: most common skip first

        if v > 1000 { continue }  // cheap comparison, ~30% skip
        if v < 0 { continue }     // cheap comparison, ~10% skip
        if v%7 == 0 { continue }  // modulo is slower, ~14% skip
        sum += int64(v)
    }
    return sum
}

// Branchless alternative for SIMD-friendly code:
func sumFilteredBranchless(data []int32) int64 {
    var sum int64
    for _, v := range data {
        // All conditions in one expression — may auto-vectorize
        if v >= 0 && v <= 1000 && v%7 != 0 {
            sum += int64(v)
        }
    }
    return sum
}

// Benchmark to verify:
// go test -bench=BenchmarkSumFiltered -benchmem -count=5
```

**Key insight:**
- Put the condition that eliminates the most items FIRST — it saves evaluating other conditions
- Put cheaper checks (comparison) before expensive ones (division/modulo)
- For truly hot loops: consider branchless techniques or SIMD intrinsics via assembly

</details>

---

## Exercise 9 🔴 — Cache-Friendly Data Layout with `continue`

**Before:**
```go
type Record struct {
    ID       int64     // 8 bytes
    Metadata [256]byte // 256 bytes — large, cold data
    IsActive bool      // 1 byte
    Score    float64   // 8 bytes
}

func sumActiveScores(records []Record) float64 {
    var total float64
    for _, r := range records {
        if !r.IsActive {
            continue // still loads entire Record (265+ bytes) per iteration
        }
        if r.Score < 0 {
            continue
        }
        total += r.Score
    }
    return total
}
```

**Task:** Redesign the data layout to improve cache performance when most records are inactive (filtered by `continue`).

<details>
<summary>Optimized Solution</summary>

```go
// SoA (Struct of Arrays) — separates hot data from cold data
type Records struct {
    IDs      []int64
    IsActive []bool    // hot: checked in every iteration
    Scores   []float64 // warm: checked for active records
    Metadata [][256]byte // cold: only needed for processing
}

func sumActiveScores(records *Records) float64 {
    var total float64
    // Only IsActive and Scores are in hot cache lines
    for i, active := range records.IsActive {
        if !active {
            continue // cache miss only for IsActive — 1 byte per record
        }
        if records.Scores[i] < 0 {
            continue
        }
        total += records.Scores[i]
        // records.Metadata[i] is only accessed if needed, not here
    }
    return total
}

// Benchmark comparison:
// AoS: each iteration loads 272+ bytes (full Record) for the IsActive check
// SoA: each iteration loads 1 byte (IsActive), 64 cache lines cover 64 records
// For large record counts with many skips: SoA can be 10-50x faster due to cache efficiency
```

**Why this works:**
- `IsActive []bool` is 1 byte per element — 64 elements fit in one cache line
- With AoS, each element is 273 bytes — only 0.2 elements per cache line
- The `continue` in SoA is cache-friendly: 64x more IsActive checks per cache miss

</details>

---

## Exercise 10 🔴 — Eliminating `continue` with SIMD-Style Masking

**Before:**
```go
func addPositive(a, b []float32, result []float32) {
    for i := range a {
        if a[i] <= 0 || b[i] <= 0 {
            result[i] = 0
            continue
        }
        result[i] = a[i] + b[i]
    }
}
```

**Task:** Rewrite using branchless arithmetic so the Go compiler can auto-vectorize the loop (no branches = eligible for SIMD).

<details>
<summary>Optimized Solution</summary>

```go
// Branchless version — eligible for auto-vectorization
func addPositive(a, b []float32, result []float32) {
    n := len(result)
    if len(a) < n { n = len(a) }
    if len(b) < n { n = len(b) }

    for i := 0; i < n; i++ {
        // Branchless max(x, 0): if x > 0, use x; else 0
        // This avoids the conditional branch
        av := a[i]
        bv := b[i]
        // Both must be positive; otherwise result is 0
        // pos(x) = x * (x > 0 ? 1 : 0) — compiled to conditional move (CMOV)
        var aPos, bPos float32
        if av > 0 { aPos = av }
        if bv > 0 { bPos = bv }
        // If either was ≤0, aPos or bPos is 0, so product-based masking:
        if aPos > 0 && bPos > 0 {
            result[i] = aPos + bPos
        }
        // else result[i] = 0 (zero-initialized)
    }
}

// True branchless (relies on compiler generating CMOV, not conditional jump):
func addPositiveBranchless(a, b []float32, result []float32) {
    for i := range result {
        sum := a[i] + b[i]
        // If either is non-positive, zero out the result
        mask := float32(1.0)
        if a[i] <= 0 { mask = 0 }
        if b[i] <= 0 { mask = 0 }
        result[i] = sum * mask
    }
}

// Verify auto-vectorization:
// go build -gcflags="-d=ssa/check_bce/debug=1" ./...
// or check assembly for VADDPS / VMULPS (AVX) instructions
```

**Key insight:** Branches in loops prevent auto-vectorization. Replacing `if ... continue` with branchless arithmetic (using multiplication by 0/1 masks) allows the compiler to generate SIMD instructions, potentially processing 4-8 float32 values per clock cycle instead of 1.

</details>

---

## Exercise 11 🔴 — Concurrent Pipeline: Use `continue` to Avoid Goroutine Spawning

**Before:**
```go
func processAll(ctx context.Context, items []Item) []Result {
    resultCh := make(chan Result, len(items))
    var wg sync.WaitGroup

    for _, item := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            if !it.IsReady() {
                return // goroutine spawned but does nothing
            }
            result := process(ctx, it)
            resultCh <- result
        }(item)
    }

    wg.Wait()
    close(resultCh)

    var results []Result
    for r := range resultCh {
        results = append(results, r)
    }
    return results
}
```

**Task:** Use `continue` to filter items BEFORE spawning goroutines, reducing goroutine creation overhead.

<details>
<summary>Optimized Solution</summary>

```go
func processAll(ctx context.Context, items []Item) []Result {
    // Pre-filter: don't spawn goroutines for items that will be skipped
    ready := make([]Item, 0, len(items))
    for _, item := range items {
        if !item.IsReady() {
            continue // filter before goroutine creation
        }
        ready = append(ready, item)
    }

    if len(ready) == 0 {
        return nil
    }

    resultCh := make(chan Result, len(ready))
    var wg sync.WaitGroup

    for _, item := range ready {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            resultCh <- process(ctx, it)
        }(item)
    }

    wg.Wait()
    close(resultCh)

    results := make([]Result, 0, len(ready))
    for r := range resultCh {
        results = append(results, r)
    }
    return results
}
```

**Improvements:**
- Goroutines not spawned for non-ready items (goroutine creation costs ~2-8KB stack + scheduler overhead)
- `resultCh` sized exactly to ready items (no over-allocation)
- Pre-allocated `results` slice
- If 70% of items are not ready, this saves 70% goroutine creation cost

</details>

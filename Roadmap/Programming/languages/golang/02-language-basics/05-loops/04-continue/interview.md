# Go `continue` Statement — Interview Questions

## Junior Level Questions

---

### Q1. What does the `continue` statement do in Go?

**Answer:**
`continue` skips the remaining code in the current loop iteration and jumps to the next iteration. In a classic `for` loop, it goes to the post statement (e.g., `i++`). In a `for range` loop, it moves to the next element.

```go
for i := 0; i < 5; i++ {
    if i == 2 { continue }
    fmt.Println(i)
}
// Output: 0 1 3 4
```

---

### Q2. What is the difference between `continue` and `break`?

**Answer:**

| Statement | Effect |
|-----------|--------|
| `continue` | Ends the current iteration, starts the next |
| `break` | Exits the loop entirely |

```go
// continue: skips 3, continues with 4, 5...
for i := 1; i <= 5; i++ {
    if i == 3 { continue }
    fmt.Println(i) // 1 2 4 5
}

// break: stops at 3
for i := 1; i <= 5; i++ {
    if i == 3 { break }
    fmt.Println(i) // 1 2
}
```

---

### Q3. Can you use `continue` in a `switch` statement?

**Answer:**
Not directly. `continue` only works inside `for` loops. However, if a `switch` is inside a `for` loop, `continue` inside the `switch` applies to the enclosing `for` loop — it does NOT skip to the next `switch` case.

```go
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        continue // continues the FOR loop
    }
    fmt.Println(i) // prints 0, 1, 3, 4
}
```

Using `continue` outside any `for` loop is a compile error.

---

### Q4. What happens when `continue` is used in a `for range` loop?

**Answer:**
`continue` skips to the next element in the collection. The rest of the loop body for the current element is skipped.

```go
nums := []int{1, -2, 3, -4, 5}
for _, n := range nums {
    if n < 0 { continue }
    fmt.Println(n) // 1 3 5
}
```

---

### Q5. What is a labeled `continue`?

**Answer:**
A labeled `continue` skips to the next iteration of a **named outer loop**, not just the innermost loop. The label is placed before the outer `for` statement.

```go
Outer:
for i := 0; i < 3; i++ {
    for j := 0; j < 3; j++ {
        if j == 1 { continue Outer }
        fmt.Printf("(%d,%d) ", i, j)
    }
}
// Output: (0,0) (1,0) (2,0)
```

---

### Q6. What does `continue` do in a `for {}` (infinite loop)?

**Answer:**
In an infinite loop (no condition), `continue` jumps back to the top of the loop body. Be careful not to create an actual infinite loop by placing `continue` before the termination condition.

```go
i := 0
for {
    i++
    if i > 5 { break }
    if i == 3 { continue }
    fmt.Println(i) // 1 2 4 5
}
```

---

### Q7. Write a loop that prints only odd numbers from 1 to 10 using `continue`.

**Answer:**
```go
for i := 1; i <= 10; i++ {
    if i%2 == 0 {
        continue
    }
    fmt.Println(i)
}
```

---

### Q8. What is the "guard clause" pattern with `continue`?

**Answer:**
Guard clauses use `continue` at the top of a loop to filter out invalid cases early, keeping the main logic flat and readable.

```go
// Without guard clauses (nested)
for _, u := range users {
    if u.Active {
        if u.Age >= 18 {
            sendEmail(u)
        }
    }
}

// With guard clauses (flat)
for _, u := range users {
    if !u.Active { continue }
    if u.Age < 18 { continue }
    sendEmail(u)
}
```

---

## Middle Level Questions

---

### Q9. Explain what happens when `continue` is used inside a `switch` that is inside a `for` loop.

**Answer:**
`continue` inside a `switch` that is inside a `for` loop continues the `for` loop — not the `switch`. This is a common source of confusion. The `switch` does not have its own "continue" concept; only `break` ends a switch case.

```go
for i := 0; i < 5; i++ {
    switch i {
    case 2:
        fmt.Println("skipping 2")
        continue // skips the fmt.Println("done") below for i==2
    case 4:
        fmt.Println("skipping 4")
        continue
    }
    fmt.Println("done with", i)
}
// Output:
// done with 0
// done with 1
// skipping 2
// done with 3
// skipping 4
```

---

### Q10. What is the difference between `continue` and an inverted `if` condition?

**Answer:**
Both are logically equivalent. `continue` uses the guard clause style (check for bad condition first). The inverted `if` includes the happy path inside the `if` block. `continue` reduces nesting level.

```go
// inverted if — adds nesting
for _, v := range data {
    if v > 0 {
        process(v)
    }
}

// continue — flat
for _, v := range data {
    if v <= 0 { continue }
    process(v)
}
```

The `continue` version is generally preferred when there are multiple conditions, as it avoids deep nesting.

---

### Q11. What is the common pitfall with `continue` in a while-style loop?

**Answer:**
In a `for` loop without a post statement (while-style), if `continue` is reached before the loop variable is updated, you get an infinite loop.

```go
// BROKEN — infinite loop when i is even
i := 0
for i < 10 {
    if i%2 == 0 {
        continue // jumps back without incrementing i
    }
    fmt.Println(i)
    i++
}

// FIXED — increment before continue
i := 0
for i < 10 {
    i++
    if i%2 == 0 {
        continue
    }
    fmt.Println(i)
}
```

---

### Q12. How does `continue` interact with `defer` inside a loop?

**Answer:**
`defer` statements inside a loop are NOT triggered by `continue`. They accumulate and only run when the enclosing function returns. This is a common memory/resource leak pattern.

```go
// BUGGY
func processFiles(files []string) {
    for _, f := range files {
        fp, _ := os.Open(f)
        defer fp.Close() // NOT closed per iteration — leaks file handles
        if !valid(fp) { continue }
        process(fp)
    }
} // ALL defers run here

// CORRECT: extract to function
func processFiles(files []string) {
    for _, f := range files {
        processOne(f)
    }
}
func processOne(f string) {
    fp, _ := os.Open(f)
    defer fp.Close() // closes when processOne returns
    if !valid(fp) { return }
    process(fp)
}
```

---

### Q13. Can a label for `continue` be placed anywhere?

**Answer:**
No. A label used with `continue` must be attached directly to a `for` statement. Attaching it to anything else (an `if`, a block, etc.) and then using `continue label` is a compile error.

```go
MyLabel:
if x > 0 {
    continue MyLabel // compile error: invalid continue label MyLabel
}

MyLabel:
for i := 0; i < 10; i++ {
    continue MyLabel // valid — label is on a for statement
}
```

---

### Q14. How does `continue` work with goroutines and channels inside a loop?

**Answer:**
`continue` works normally — it skips to the next iteration. You must be careful about goroutines that capture loop variables. Use `continue` before launching goroutines when you want to filter items without spawning goroutines for them.

```go
for _, item := range items {
    if !item.IsValid() {
        continue // don't launch a goroutine for invalid items
    }
    go process(item) // safe: continue already handled invalid case
}
```

---

### Q15. How does `continue` compile differently from an `if-else` statement?

**Answer:**
They compile to essentially the same machine code. Both become a conditional jump (`Jcc` on amd64) to the post-statement block. The optimizer sees them as equivalent control flow. Benchmark results confirm zero performance difference.

---

### Q16. What does `go vet` say about `continue`?

**Answer:**
`go vet` does not flag `continue` itself as problematic. However, it may flag related issues like unreachable code after `continue`. Some linters (e.g., `staticcheck`) can be configured to flag specific patterns like labeled `continue` when it could be simplified.

---

## Senior Level Questions

---

### Q17. How is `continue` represented in Go's SSA intermediate representation?

**Answer:**
In `cmd/compile/internal/ssagen`, `continue` is lowered to a `Jump` (unconditional edge) to the loop's `continueTo` block. This `continueTo` block contains the post statement (for classic `for` loops) or the next-element fetching logic (for `for range` loops). The SSA optimizer then may eliminate the jump if the continuation block follows immediately in the block order.

---

### Q18. How does `continue` affect escape analysis?

**Answer:**
`continue` itself has no direct effect on escape analysis. What matters is what you do with values before or after `continue`. If you allocate a value, then take `continue` before passing it to a function that stores a pointer to it, the allocation does not escape. The escape analyzer performs reachability analysis on the full control flow graph including `continue` edges.

---

### Q19. In a concurrent pipeline using channels, how should `continue` interact with context cancellation?

**Answer:**
You should check `ctx.Done()` at the beginning of each iteration (or before expensive work), and use `continue` to skip remaining processing when the context is not yet canceled but an item-level filter applies. Do not use `continue` to bypass context checks — always check context first.

```go
for item := range input {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    if !item.IsValid() {
        continue // item-level skip, after context check
    }
    // process item
}
```

---

### Q20. What is the postmortem pattern for debugging infinite loops caused by `continue`?

**Answer:**
1. Add a counter or timer before the `continue` to detect if it's being hit repeatedly.
2. Add a `fmt.Println` / `log.Printf` with the loop variable to trace values.
3. Use Delve debugger: set a conditional breakpoint at the `continue` line.
4. Use `go test -race` to rule out race conditions.
5. Restructure to a classic `for i := 0; i < n; i++` loop temporarily to verify logic.

The root cause is almost always a missing increment before `continue` in a while-style loop.

---

### Q21. How does labeled `continue` interact with Go's goroutine scheduler?

**Answer:**
Labeled `continue` is a compile-time control flow construct — it has no runtime interaction with the scheduler. The scheduler uses asynchronous preemption (since Go 1.14) at loop back edges, which occurs at the loop header, not at `continue` itself. A labeled `continue` to an outer loop effectively creates a back edge to that outer loop's header, which is a valid preemption point.

---

## Scenario / Practical Questions

---

### Q22. You have a loop that processes user records. Some records are invalid. Some are expired. Some need skipping for business reasons. Show how to structure this with `continue`.

**Answer:**
```go
func processUsers(users []User) {
    for _, u := range users {
        // Guard 1: data integrity
        if u.ID == 0 || u.Email == "" {
            log.Printf("invalid user record: %+v", u)
            continue
        }

        // Guard 2: business rule
        if u.ExpiresAt.Before(time.Now()) {
            log.Printf("user %d account expired", u.ID)
            continue
        }

        // Guard 3: feature flag
        if !featureFlags.IsEnabled("new-flow", u.ID) {
            legacyProcess(u)
            continue
        }

        // Happy path
        newProcess(u)
    }
}
```

---

### Q23. A colleague wrote code with a `continue` that causes 100% CPU usage. Identify and fix the issue.

```go
// Buggy code:
func drain(ch chan int) {
    i := 0
    for i < 1000 {
        v := <-ch
        if v < 0 {
            continue // i never increments!
        }
        fmt.Println(v)
        i++
    }
}
```

**Answer:**
The `i` counter is only incremented for non-negative values. If the channel sends many negative values, `i` never reaches 1000, causing an effectively infinite loop. Fix:

```go
func drain(ch chan int) {
    processed := 0
    for processed < 1000 {
        v := <-ch
        processed++ // always increment
        if v < 0 {
            continue
        }
        fmt.Println(v)
    }
}
```

---

### Q24. What is the output of the following code?

```go
func main() {
Outer:
    for i := 0; i < 3; i++ {
        for j := 0; j < 3; j++ {
            if i == j {
                continue Outer
            }
            fmt.Printf("%d%d ", i, j)
        }
    }
}
```

**Answer:**
```
10 20 21
```

Explanation:
- i=0, j=0: i==j → `continue Outer` → skip to i=1
- i=1, j=0: 1!=0 → print `10`; j=1: 1==1 → `continue Outer` → skip to i=2
- i=2, j=0: 2!=0 → print `20`; j=1: 2!=1 → print `21`; j=2: 2==2 → `continue Outer` → i=3, loop ends

---

### Q25. How would you test a function that uses `continue` to filter a slice?

**Answer:**
Use table-driven tests covering: empty input, all items pass, all items filtered, mixed, edge cases (nil slice, single element):

```go
func TestFilterPositive(t *testing.T) {
    tests := []struct {
        name  string
        input []int
        want  []int
    }{
        {"nil", nil, nil},
        {"empty", []int{}, nil},
        {"all positive", []int{1, 2, 3}, []int{1, 2, 3}},
        {"all negative", []int{-1, -2, -3}, nil},
        {"mixed", []int{1, -2, 3, -4}, []int{1, 3}},
        {"zero", []int{0, 1}, []int{1}}, // 0 is not positive
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := filterPositive(tt.input)
            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("filterPositive(%v) = %v, want %v", tt.input, got, tt.want)
            }
        })
    }
}
```

---

## FAQ

---

### FAQ1. Is there a performance difference between `continue` and not using it?

No. `continue` compiles to the same machine code as the equivalent `if-else`. Both generate a conditional jump instruction (`Jcc` on amd64).

---

### FAQ2. Can `continue` be used with `select` statements?

Only if the `select` is inside a `for` loop. In that case, `continue` inside the `select` applies to the enclosing `for` loop.

```go
for {
    select {
    case v := <-ch:
        if v < 0 { continue } // continues the for loop
        process(v)
    }
}
```

---

### FAQ3. Does `continue` work with `for range` over a string?

Yes. When ranging over a string, Go iterates over Unicode code points (runes). `continue` skips to the next rune.

```go
for i, r := range "hello" {
    if r == 'l' { continue }
    fmt.Printf("%d:%c ", i, r) // 0:h 1:e 4:o
}
```

---

### FAQ4. Can you have multiple `continue` statements in one loop body?

Yes. Multiple `continue` statements in one loop body are valid and common. Each one handles a different skip condition (guard clause pattern).

---

### FAQ5. What does `golangci-lint` say about `continue`?

By default, `golangci-lint` does not flag `continue`. You can enable linters like `revive` which has rules around `continue` usage in specific patterns. The `wsl` (whitespace linter) may require blank lines around `continue` statements.

---

### FAQ6. Is `continue` the same as `goto` to the post statement?

Functionally yes — `continue` compiles to a jump to the post statement block. But semantically, `continue` is safer and more expressive. The compiler generates the same `JMP` instruction, but `continue` is constrained to loop boundaries, making it predictable and readable.

---

### FAQ7. Does `continue` work in Go generics?

Yes. `continue` works identically inside generic functions. There is no special behavior or restriction related to type parameters.

```go
func filterSlice[T any](s []T, keep func(T) bool) []T {
    var result []T
    for _, v := range s {
        if !keep(v) { continue }
        result = append(result, v)
    }
    return result
}
```

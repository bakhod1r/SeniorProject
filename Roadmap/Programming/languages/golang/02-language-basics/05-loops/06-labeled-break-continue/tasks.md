# Go Labeled Break and Continue — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use labels idiomatically; capitalize names; place labels on their own line. Where extraction is cleaner, comment why you chose the label form (or vice versa).

---

## Task 1 — Find First Match in 2-D Grid

**Difficulty**: Beginner
**Topic**: Labelled break for nested-loop early exit

**Description**: Implement `findFirst(grid [][]int, target int) (int, int, bool)` that returns the row, column, and `true` if `target` is found, or `(0, 0, false)` otherwise. Use a labelled break.

**Starter Code**:
```go
package main

import "fmt"

func findFirst(grid [][]int, target int) (int, int, bool) {
    // TODO: use a labelled break
    return 0, 0, false
}

func main() {
    g := [][]int{
        {1, 2, 3},
        {4, 5, 6},
        {7, 5, 9},
    }
    r, c, ok := findFirst(g, 5)
    fmt.Println(r, c, ok) // 1 1 true
    _, _, ok2 := findFirst(g, 99)
    fmt.Println(ok2) // false
}
```

**Expected Output**:
```
1 1 true
false
```

**Evaluation Checklist**:
- [ ] Uses a labelled break (e.g., `Search:` and `break Search`)
- [ ] Returns the FIRST match, not the last
- [ ] Returns `(0, 0, false)` when no match
- [ ] Capitalized label name

---

## Task 2 — Skip Group on Bad Item

**Difficulty**: Beginner
**Topic**: Labelled continue

**Description**: Implement `sumGoodGroups(groups [][]int) int` that returns the sum of all elements in groups that contain only non-negative numbers. Use a labelled continue to skip groups with any negative element.

**Starter Code**:
```go
package main

import "fmt"

func sumGoodGroups(groups [][]int) int {
    // TODO: continue Group on negative
    return 0
}

func main() {
    g := [][]int{
        {1, 2, 3},      // sum = 6
        {4, -1, 5},     // skipped
        {6, 7},         // sum = 13
    }
    fmt.Println(sumGoodGroups(g)) // 19
}
```

**Expected Output**:
```
19
```

**Evaluation Checklist**:
- [ ] Uses `continue Group` to skip groups with a negative
- [ ] Single labelled outer loop
- [ ] Inner loop has no special structure
- [ ] Total is correct

---

## Task 3 — For-Select Quit

**Difficulty**: Beginner
**Topic**: Labelled break in `for { select { } }`

**Description**: Implement `runUntilQuit(quit <-chan struct{}, work <-chan int) []int` that returns all received `work` values until `quit` is closed. Use `break Loop`.

**Starter Code**:
```go
package main

import "fmt"

func runUntilQuit(quit <-chan struct{}, work <-chan int) []int {
    var got []int
    // TODO: for-select with break Loop
    return got
}

func main() {
    quit := make(chan struct{})
    work := make(chan int, 3)
    work <- 1
    work <- 2
    work <- 3
    close(quit)
    fmt.Println(runUntilQuit(quit, work))
}
```

**Expected Output** (order may vary; quit and work cases race):
```
[1 2 3] // or shorter if quit wins early
```

**Evaluation Checklist**:
- [ ] Uses `Loop:` label and `break Loop`
- [ ] Reads from both `quit` and `work` in a `select`
- [ ] Exits cleanly on quit
- [ ] No flag variables

---

## Task 4 — Tic-Tac-Toe Win Detection

**Difficulty**: Intermediate
**Topic**: Labelled continue for skip-on-mismatch

**Description**: Implement `winner(b [3][3]string) string` that returns "X", "O", or "" by scanning rows, columns, and diagonals. Use `continue Rows` / `continue Cols` to skip non-matching scans efficiently.

**Starter Code**:
```go
package main

import "fmt"

func winner(b [3][3]string) string {
    // TODO: scan rows, cols, diagonals; use labels
    return ""
}

func main() {
    b := [3][3]string{
        {"X", "O", "X"},
        {"O", "X", "O"},
        {"O", "O", "X"},
    }
    fmt.Println("winner:", winner(b)) // X (diagonal)

    b2 := [3][3]string{
        {"X", "X", "X"},
        {"O", " ", "O"},
        {" ", "O", " "},
    }
    fmt.Println("winner:", winner(b2)) // X (row 0)
}
```

**Expected Output**:
```
winner: X
winner: X
```

**Evaluation Checklist**:
- [ ] Uses labelled continue to skip non-matching rows / cols
- [ ] Checks rows, columns, and both diagonals
- [ ] Returns "" when no winner
- [ ] Idiomatic label naming

---

## Task 5 — Two-Stream Common Element

**Difficulty**: Intermediate
**Topic**: Labelled break in nested loop

**Description**: Implement `firstCommon(a, b []int) (int, bool)` that returns the FIRST element of `a` that also appears in `b`. Use a labelled break to stop on match.

**Starter Code**:
```go
package main

import "fmt"

func firstCommon(a, b []int) (int, bool) {
    // TODO
    return 0, false
}

func main() {
    fmt.Println(firstCommon([]int{1, 3, 5, 7}, []int{2, 4, 5, 8})) // 5 true
    fmt.Println(firstCommon([]int{1, 2}, []int{3, 4}))             // 0 false
}
```

**Expected Output**:
```
5 true
0 false
```

**Evaluation Checklist**:
- [ ] Uses a labelled break to exit on match
- [ ] Returns the FIRST common element of `a`, not the last
- [ ] Returns `(0, false)` when no common element

---

## Task 6 — Validate-Or-Reject Pipeline

**Difficulty**: Intermediate
**Topic**: Labelled continue in batch processing

**Description**: Implement `processBatches(batches []Batch) (totals []float64, rejected int)`. For each batch, sum all item amounts. If any item has a negative amount, skip the entire batch (count as rejected) using `continue Batch`.

**Starter Code**:
```go
package main

import "fmt"

type Item struct {
    Amount float64
}

type Batch struct {
    ID    int
    Items []Item
}

func processBatches(batches []Batch) (totals []float64, rejected int) {
    // TODO: continue Batch on bad item
    return
}

func main() {
    bs := []Batch{
        {ID: 1, Items: []Item{{1}, {2}, {3}}},
        {ID: 2, Items: []Item{{4}, {-1}, {5}}},
        {ID: 3, Items: []Item{{6}, {7}}},
    }
    totals, rejected := processBatches(bs)
    fmt.Println(totals, rejected) // [6 13] 1
}
```

**Expected Output**:
```
[6 13] 1
```

**Evaluation Checklist**:
- [ ] Uses `Batch:` label and `continue Batch`
- [ ] Skips entire batch on negative
- [ ] Increments `rejected` once per skipped batch
- [ ] Includes valid batch totals

---

## Task 7 — Worker With Multiple Quit Reasons

**Difficulty**: Intermediate
**Topic**: Labelled break with reason tracking

**Description**: Implement `runWorker(ctx context.Context, jobs <-chan Job) (string, error)` that processes jobs until shutdown. Return the reason: "ctx" (ctx done), "channel" (jobs closed), or "error" (job processing error). Use a labelled break.

**Starter Code**:
```go
package main

import (
    "context"
    "errors"
    "fmt"
    "time"
)

type Job struct {
    ID  int
    Bad bool
}

func handle(j Job) error {
    if j.Bad {
        return errors.New("bad job")
    }
    return nil
}

func runWorker(ctx context.Context, jobs <-chan Job) (string, error) {
    var reason string
    var jobErr error
    // TODO: for { select { ... } } with break Loop and reason tracking
    _ = reason
    _ = jobErr
    return reason, jobErr
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
    defer cancel()
    jobs := make(chan Job)
    go func() {
        jobs <- Job{ID: 1}
        jobs <- Job{ID: 2, Bad: true}
        close(jobs)
    }()
    fmt.Println(runWorker(ctx, jobs))
}
```

**Expected Output** (reason depends on timing; error path likely):
```
error bad job
```

**Evaluation Checklist**:
- [ ] Uses `Loop:` and `break Loop`
- [ ] Three cases: ctx done, jobs closed, processing error
- [ ] Records the reason before breaking
- [ ] Returns reason and error

---

## Task 8 — Refactor: Replace Flag With Label

**Difficulty**: Advanced
**Topic**: Anti-pattern removal

**Description**: Refactor the given function to remove the flag variable and use a labelled break.

**Starter Code**:
```go
package main

import "fmt"

func findIndexOldStyle(matrix [][]int, target int) (int, int, bool) {
    var ri, ci int
    found := false
    for i, row := range matrix {
        for j, v := range row {
            if v == target {
                ri, ci = i, j
                found = true
                break
            }
        }
        if found {
            break
        }
    }
    return ri, ci, found
}

func findIndex(matrix [][]int, target int) (int, int, bool) {
    // TODO: rewrite using a labelled break OR an extracted helper with return
    return 0, 0, false
}

func main() {
    g := [][]int{{1, 2}, {3, 4}, {5, 6}}
    fmt.Println(findIndex(g, 4)) // 1 1 true
    fmt.Println(findIndex(g, 9)) // 0 0 false
}
```

**Expected Output**:
```
1 1 true
0 0 false
```

**Evaluation Checklist**:
- [ ] Removes the flag variable
- [ ] Uses either labelled break or direct `return`
- [ ] Same return contract as the original
- [ ] Comment explaining the choice (label vs. extraction)

---

## Task 9 — Multi-Label Function

**Difficulty**: Advanced
**Topic**: Multiple labels with distinct names

**Description**: Implement `scan3D(d [][][]int, target int) (int, int, int, bool)` over a 3-D grid. Use TWO labels: `Plane` (skip the rest of the current plane on negative) and `Search` (exit entirely on match).

**Starter Code**:
```go
package main

import "fmt"

func scan3D(d [][][]int, target int) (int, int, int, bool) {
    // TODO: use Plane and Search labels
    return 0, 0, 0, false
}

func main() {
    d := [][][]int{
        {{1, 2}, {-1, 3}}, // plane 0: contains -1, skipped
        {{4, 5}, {6, 7}},  // plane 1: target 7 found at [1][1][1]
    }
    fmt.Println(scan3D(d, 7)) // 1 1 1 true
}
```

**Expected Output**:
```
1 1 1 true
```

**Evaluation Checklist**:
- [ ] Two distinct labels: `Plane:` and `Search:`
- [ ] `continue Plane` skips planes containing a negative
- [ ] `break Search` exits on match
- [ ] Returns `(0, 0, 0, false)` if no match

---

## Task 10 — Replace `goto` With Label

**Difficulty**: Advanced
**Topic**: Conversion from `goto` to labelled break

**Description**: Refactor the function to use labelled break instead of `goto`.

**Starter Code**:
```go
package main

import "fmt"

func computeOldStyle(xs, ys []int) int {
    var total int
    for _, x := range xs {
        for _, y := range ys {
            if x+y == 0 {
                total = -1
                goto Done
            }
            total += x * y
        }
    }
Done:
    return total
}

func compute(xs, ys []int) int {
    // TODO: same logic, no goto
    return 0
}

func main() {
    fmt.Println(compute([]int{1, 2}, []int{3, 4}))   // 1*3 + 1*4 + 2*3 + 2*4 = 21
    fmt.Println(compute([]int{1, -1}, []int{1, 2}))  // 1*1=1, then 1+1=2 (no zero); 1*2=2; -1+1=0 → -1
}
```

**Expected Output**:
```
21
-1
```

**Evaluation Checklist**:
- [ ] No `goto` statement
- [ ] Uses a labelled break
- [ ] Same return values as the goto version
- [ ] Comment explaining why labelled break is preferred

---

## Task 11 — Stream With Comment Skipping

**Difficulty**: Advanced
**Topic**: Labelled continue in line-by-line scanning

**Description**: Implement `validateLines(r io.Reader) (int, error)`. Read each line; if the line starts with `#`, skip it via `continue Lines`; if it has fewer than 3 fields, return an error with the line number; otherwise validate each non-empty field.

**Starter Code**:
```go
package main

import (
    "bufio"
    "fmt"
    "io"
    "strings"
)

func validateLines(r io.Reader) (int, error) {
    sc := bufio.NewScanner(r)
    line := 0
    // TODO: Lines: label and continue Lines for comment lines
    return line, sc.Err()
}

func main() {
    data := "a,b,c\n#comment,line\nd,e,f\n"
    n, err := validateLines(strings.NewReader(data))
    fmt.Println(n, err)
}
```

**Expected Output**:
```
3 <nil>
```

**Evaluation Checklist**:
- [ ] Uses `Lines:` label and `continue Lines` on comment lines
- [ ] Returns line number and any error
- [ ] Handles EOF correctly
- [ ] Skips empty fields gracefully or treats as error per spec

---

## Task 12 — Test Labelled Exit Path

**Difficulty**: Advanced
**Topic**: Testing labelled-exit behavior

**Description**: Given a worker function with a labelled `for-select` quit, write a test that asserts the worker exits within 100 ms after `close(quit)`.

**Starter Code**:
```go
package main

import (
    "testing"
    "time"
)

func runWorker(quit <-chan struct{}, jobs <-chan int) {
Loop:
    for {
        select {
        case <-quit:
            break Loop
        case _, ok := <-jobs:
            if !ok {
                break Loop
            }
        }
    }
}

func TestWorkerExits(t *testing.T) {
    // TODO: launch runWorker in a goroutine, close quit, assert it exits
}
```

**Expected**: test passes; if the label is removed (replaced with plain break), the test should detect the leak via timeout.

**Evaluation Checklist**:
- [ ] Test launches `runWorker` in a goroutine
- [ ] Test closes `quit`
- [ ] Test asserts worker exits within 100 ms
- [ ] Test fails (timeout) if `break Loop` is replaced with `break`

---

## Bonus Task — Reproduce a Production Bug

**Difficulty**: Advanced
**Topic**: Real-world `for { select { } }` shutdown bug

**Description**: Write a function that demonstrates the shutdown-leak bug: a `for { select { } }` worker with a plain `break` instead of `break Loop`. Then write a fixed version. Compare CPU usage on shutdown.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func buggyWorker(quit <-chan struct{}) {
    for {
        select {
        case <-quit:
            break // BUG
        default:
            // simulate work
        }
    }
}

func fixedWorker(quit <-chan struct{}) {
Loop:
    for {
        select {
        case <-quit:
            break Loop
        default:
            // simulate work
        }
    }
}

func main() {
    quit := make(chan struct{})
    done := make(chan struct{})

    go func() {
        fixedWorker(quit)
        close(done)
    }()
    close(quit)

    select {
    case <-done:
        fmt.Println("fixed worker exited")
    case <-time.After(50 * time.Millisecond):
        fmt.Println("fixed worker LEAKED")
    }

    // Try the buggy worker — DON'T close `done2` because it would never finish.
    fmt.Println("(running buggy worker would consume CPU forever)")
}
```

**Expected Output**:
```
fixed worker exited
(running buggy worker would consume CPU forever)
```

**Evaluation Checklist**:
- [ ] `buggyWorker` uses plain `break` (the bug)
- [ ] `fixedWorker` uses `break Loop`
- [ ] Test demonstrates the fix exits cleanly
- [ ] Comment explains why the buggy version leaks

# Go `continue` Statement — Tasks

## Task 1: Print Odd Numbers (Beginner)

**Goal:** Use `continue` to print only odd numbers from 1 to 20.

**Requirements:**
- Use a `for` loop with `continue`
- Do not use `%` twice — compute once, store in a variable

```go
package main

import "fmt"

func main() {
    for i := 1; i <= 20; i++ {
        // TODO: use continue to skip even numbers
        fmt.Println(i)
    }
}
```

**Expected output:**
```
1
3
5
7
9
11
13
15
17
19
```

---

## Task 2: Filter a Slice (Beginner)

**Goal:** Write a function `filterPositive(nums []int) []int` that uses `continue` to skip non-positive numbers and returns a new slice of positive numbers.

```go
package main

import "fmt"

func filterPositive(nums []int) []int {
    var result []int
    for _, n := range nums {
        // TODO: use continue to skip non-positive numbers
        result = append(result, n)
    }
    return result
}

func main() {
    input := []int{3, -1, 4, -1, 5, -9, 2, 6}
    fmt.Println(filterPositive(input))
    // Expected: [3 4 5 2 6]
}
```

---

## Task 3: Skip Blank Lines (Beginner)

**Goal:** Process a slice of strings, skipping blank lines and lines that start with `#`. Print valid lines with their line number (1-indexed).

```go
package main

import (
    "fmt"
    "strings"
)

func main() {
    lines := []string{
        "Hello, World",
        "",
        "# This is a comment",
        "Go is awesome",
        "   ",
        "# Another comment",
        "Keep going",
    }

    lineNum := 0
    for _, line := range lines {
        // TODO: skip blank lines (empty or whitespace only)
        // TODO: skip comment lines (start with #)
        lineNum++
        fmt.Printf("Line %d: %s\n", lineNum, line)
    }
}
// Expected:
// Line 1: Hello, World
// Line 2: Go is awesome
// Line 3: Keep going
```

---

## Task 4: FizzBuzz with `continue` (Beginner–Intermediate)

**Goal:** Print numbers 1–30. Skip (do not print) multiples of 3 OR multiples of 5. For all others, print the number.

```go
package main

import "fmt"

func main() {
    for i := 1; i <= 30; i++ {
        // TODO: use continue to skip multiples of 3 or 5
        fmt.Println(i)
    }
}
// Expected: 1 2 4 7 8 11 13 14 16 17 19 22 23 26 28 29
```

---

## Task 5: Labeled `continue` — Matrix Diagonal (Intermediate)

**Goal:** Given a 4x4 matrix, print all non-diagonal elements. Use a labeled `continue` to skip to the next row when you hit a diagonal element.

Wait — actually: print all elements, but when `i == j` (diagonal), skip the **rest of that row** using `continue OuterLoop`.

```go
package main

import "fmt"

func main() {
    matrix := [4][4]int{
        {1, 2, 3, 4},
        {5, 6, 7, 8},
        {9, 10, 11, 12},
        {13, 14, 15, 16},
    }

OuterLoop:
    for i := 0; i < 4; i++ {
        for j := 0; j < 4; j++ {
            // TODO: when i == j, continue to next row using continue OuterLoop
            fmt.Printf("%3d", matrix[i][j])
        }
        fmt.Println()
    }
}
// Expected:
// (row 0: just the header before diagonal)
//   1
//   5  6
//   9 10 11
//  13 14 15 16
// Tip: element printed only if j < i (before the diagonal in each row)
```

---

## Task 6: Error-Tolerant Parser (Intermediate)

**Goal:** Parse a slice of `"key=value"` strings. Skip malformed entries (missing `=`, empty key, empty value) and collect valid pairs into a `map[string]string`. Log what was skipped.

```go
package main

import (
    "fmt"
    "strings"
)

func parseKV(lines []string) map[string]string {
    result := make(map[string]string)
    for i, line := range lines {
        // TODO: use continue to skip:
        // 1. Lines without '='
        // 2. Lines with empty key (before =)
        // 3. Lines with empty value (after =)
        // For each skip, print a message: "Line N: skipped: <reason>"
        parts := strings.SplitN(line, "=", 2)
        _ = i
        _ = parts
        // result[key] = value
    }
    return result
}

func main() {
    lines := []string{
        "name=Alice",
        "age=",
        "=orphaned",
        "city=New York",
        "noequalssign",
        "role=admin",
    }
    kv := parseKV(lines)
    fmt.Println(kv)
    // Expected: map[city:New York name:Alice role:admin]
}
```

---

## Task 7: Channel Pipeline Filter (Intermediate)

**Goal:** Create a pipeline where a producer sends integers 0–19 on a channel. A filter goroutine uses `continue` to skip multiples of 3 and sends the rest to an output channel. The main goroutine prints results.

```go
package main

import "fmt"

func producer(out chan<- int) {
    for i := 0; i < 20; i++ {
        out <- i
    }
    close(out)
}

func filter(in <-chan int, out chan<- int) {
    defer close(out)
    for v := range in {
        // TODO: use continue to skip multiples of 3
        out <- v
    }
}

func main() {
    ch1 := make(chan int, 5)
    ch2 := make(chan int, 5)

    go producer(ch1)
    go filter(ch1, ch2)

    for v := range ch2 {
        fmt.Print(v, " ")
    }
    fmt.Println()
    // Expected: 1 2 4 5 7 8 10 11 13 14 16 17 19
}
```

---

## Task 8: User Validation with Multiple Guards (Intermediate)

**Goal:** Process a slice of `User` structs. For each user, validate multiple conditions using guard clauses with `continue`. Count how many were processed, skipped for each reason.

```go
package main

import (
    "fmt"
    "strings"
)

type User struct {
    Name     string
    Email    string
    Age      int
    IsActive bool
    Role     string
}

func processUsers(users []User) {
    var (
        processed     int
        skippedInactive int
        skippedAge      int
        skippedEmail    int
        skippedRole     int
    )

    for _, u := range users {
        // Guard 1: skip inactive users
        // Guard 2: skip users under 18
        // Guard 3: skip users without valid email (must contain @)
        // Guard 4: skip users with role "guest"
        // TODO: implement guards with continue, increment the appropriate counters
        _ = strings.Contains // hint for email check
        processed++
        fmt.Printf("Processing: %s\n", u.Name)
    }

    fmt.Printf("\nProcessed: %d\n", processed)
    fmt.Printf("Skipped (inactive): %d\n", skippedInactive)
    fmt.Printf("Skipped (age<18): %d\n", skippedAge)
    fmt.Printf("Skipped (no email): %d\n", skippedEmail)
    fmt.Printf("Skipped (guest): %d\n", skippedRole)
}

func main() {
    users := []User{
        {"Alice", "alice@example.com", 25, true, "admin"},
        {"Bob", "bob@example.com", 16, true, "user"},
        {"Carol", "", 30, true, "user"},
        {"Dave", "dave@example.com", 28, false, "user"},
        {"Eve", "eve@example.com", 22, true, "guest"},
        {"Frank", "frank@example.com", 35, true, "user"},
    }
    processUsers(users)
}
```

---

## Task 9: Generics — Generic Filter Function (Advanced)

**Goal:** Implement a generic `Filter[T any]` function using `continue`. Then use it with three different types: `int`, `string`, and a custom struct.

```go
package main

import "fmt"

// TODO: implement Filter using continue
func Filter[T any](slice []T, keep func(T) bool) []T {
    // Your implementation here
    return nil
}

type Product struct {
    Name  string
    Price float64
    Stock int
}

func main() {
    // Test with int
    ints := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
    evens := Filter(ints, func(n int) bool { return n%2 == 0 })
    fmt.Println("Evens:", evens)

    // Test with string
    words := []string{"", "hello", "", "world", ""}
    nonEmpty := Filter(words, func(s string) bool { return s != "" })
    fmt.Println("Non-empty:", nonEmpty)

    // Test with struct
    products := []Product{
        {"Apple", 1.5, 100},
        {"Banana", 0.5, 0},
        {"Cherry", 3.0, 50},
        {"Date", 5.0, 0},
    }
    inStock := Filter(products, func(p Product) bool { return p.Stock > 0 })
    fmt.Println("In stock:", inStock)
}
```

---

## Task 10: Retry Loop with `continue` (Advanced)

**Goal:** Write a `retry` function that attempts an operation up to `maxAttempts` times. Use `continue` to proceed to the next attempt on failure. Track and return the number of attempts made.

```go
package main

import (
    "errors"
    "fmt"
    "math/rand"
)

// simulateWork randomly succeeds or fails
func simulateWork(attempt int) error {
    if rand.Float32() < 0.7 {
        return errors.New("temporary failure")
    }
    return nil
}

// retry runs op up to maxAttempts times.
// Returns (attempts made, final error)
func retry(maxAttempts int, op func(attempt int) error) (int, error) {
    // TODO: implement using a for loop and continue
    // - On each attempt, call op(attempt)
    // - If err is nil, return immediately (success)
    // - If err is not nil, log it and continue to next attempt
    // - After maxAttempts, return the last error
    return 0, errors.New("not implemented")
}

func main() {
    rand.Seed(42)
    attempts, err := retry(5, simulateWork)
    if err != nil {
        fmt.Printf("Failed after %d attempts: %v\n", attempts, err)
    } else {
        fmt.Printf("Succeeded on attempt %d\n", attempts)
    }
}
```

---

## Task 11: Nested Loop — Prime Sieve Simplified (Advanced)

**Goal:** Find all prime numbers up to 100 using a simplified trial division approach. Use labeled and unlabeled `continue` appropriately.

```go
package main

import (
    "fmt"
    "math"
)

func sieve(max int) []int {
    var primes []int

outer:
    for n := 2; n <= max; n++ {
        limit := int(math.Sqrt(float64(n)))
        for d := 2; d <= limit; d++ {
            if n%d == 0 {
                continue outer // n is not prime, skip to next n
            }
        }
        primes = append(primes, n)
    }

    return primes
}

func main() {
    primes := sieve(100)
    fmt.Println(primes)
    fmt.Printf("Found %d primes up to 100\n", len(primes))
    // Expected: 25 primes
}
```

---

## Task 12: Concurrent Worker Pool with Filtering (Advanced)

**Goal:** Implement a worker pool that processes a stream of tasks. Workers use `continue` to skip tasks that fail a pre-check. Collect results and errors separately.

```go
package main

import (
    "fmt"
    "sync"
)

type Task struct {
    ID    int
    Value int
}

type Result struct {
    TaskID int
    Output int
}

func workerPool(tasks []Task, numWorkers int) ([]Result, []error) {
    taskCh := make(chan Task, len(tasks))
    resultCh := make(chan Result, len(tasks))
    errCh := make(chan error, len(tasks))

    var wg sync.WaitGroup

    // Start workers
    for w := 0; w < numWorkers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for task := range taskCh {
                // TODO: use continue to skip tasks where Value < 0
                // For valid tasks: compute Output = Value * Value
                // Send Result to resultCh
                _ = task
            }
        }()
    }

    // Send tasks
    for _, t := range tasks {
        taskCh <- t
    }
    close(taskCh)

    // Wait and close result channels
    go func() {
        wg.Wait()
        close(resultCh)
        close(errCh)
    }()

    var results []Result
    var errs []error
    for r := range resultCh {
        results = append(results, r)
    }
    for e := range errCh {
        errs = append(errs, e)
    }
    return results, errs
}

func main() {
    tasks := []Task{
        {1, 5}, {2, -3}, {3, 7}, {4, -1}, {5, 9},
    }
    results, _ := workerPool(tasks, 3)
    fmt.Println("Results:", results)
}
```

---

*Solutions Hint: All tasks use `continue` as the primary control flow for filtering. Focus on guard clauses — check the "bad" condition first, `continue` early, and let the "happy path" fall through naturally.*

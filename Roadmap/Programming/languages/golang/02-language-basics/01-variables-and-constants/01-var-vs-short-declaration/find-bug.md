# var vs := — Find the Bug

> Practice finding and fixing bugs related to variable declarations in Go.

## How to Use
1. Read the buggy code carefully
2. Try to find the bug without looking at the hint
3. Fix it yourself before checking the solution
4. Read the explanation to understand *why* the bug happens

### Difficulty Levels
| Level | Description |
|:-----:|:-----------|
| Easy | Common beginner mistakes |
| Medium | Logic errors, shadowing |
| Hard | Subtle scoping, closures, concurrency |

---

## Bug 1: Package-Level Short Declaration (Easy)

**What the code should do:** Define a package-level counter and print it.

```go
package main

import "fmt"

counter := 0

func main() {
    counter++
    fmt.Println(counter)
}
```

**Expected output:** `1`

**Actual output / Error:**
```
./main.go:5:1: syntax error: non-declaration statement outside function body
```

<details>
<summary>Hint</summary>
Where is `counter` declared? What operator can only be used inside functions?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `:=` cannot be used at package level. It is only valid inside function bodies.

**Fixed code:**
```go
package main

import "fmt"

var counter = 0  // use var at package level

func main() {
    counter++
    fmt.Println(counter) // Output: 1
}
```

**Why:** The `:=` operator is syntactic sugar that exists only at the function level. Package-level declarations must use `var`, `const`, `type`, or `func`.
</details>

---

## Bug 2: Shadowed Error (Medium)

**What the code should do:** Parse two numbers and print their sum. Return an error if either fails.

```go
package main

import (
    "fmt"
    "strconv"
)

func parseAndSum(a, b string) (int, error) {
    x, err := strconv.Atoi(a)
    if err != nil {
        return 0, err
    }

    y, err := strconv.Atoi(b)
    if err != nil {
        return 0, err
    }

    return x + y, nil
}

func main() {
    result, err := parseAndSum("10", "abc")
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Sum:", result)
}
```

**Expected output:**
```
Error: strconv.Atoi: parsing "abc": invalid syntax
```

**Actual output:** (Same as expected — this code is correct. Read carefully... the bug is in the NEXT version below.)

```go
package main

import (
    "fmt"
    "strconv"
)

func parseAndSumBuggy(a, b string) (int, error) {
    x, err := strconv.Atoi(a)

    y, err := strconv.Atoi(b)
    // BUG: err from second call overwrites err from first call
    // before it is checked!

    if err != nil {
        return 0, err
    }

    _ = x
    return x + y, nil
}

func main() {
    result, err := parseAndSumBuggy("abc", "20")
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Sum:", result)
}
```

**Expected output:**
```
Error: strconv.Atoi: parsing "abc": invalid syntax
```

**Actual output:**
```
Sum: 20  (BUG: error from parsing "abc" was never checked!)
```

<details>
<summary>Hint</summary>
What happens to the error from the first `strconv.Atoi` call before it is checked?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** The error from parsing `"abc"` (first call) is overwritten by the result of the second call (which succeeds with `"20"`). Since the second call succeeds, `err` is nil when checked.

**Fixed code:**
```go
func parseAndSumFixed(a, b string) (int, error) {
    x, err := strconv.Atoi(a)
    if err != nil {  // check immediately
        return 0, err
    }

    y, err := strconv.Atoi(b)
    if err != nil {  // check immediately
        return 0, err
    }

    return x + y, nil
}
```

**Why:** Always check `err` immediately after the call that produces it. Do not let subsequent `:=` calls overwrite `err` before it is checked.
</details>

---

## Bug 3: Authorization Bypass via Shadowing (Medium)

**What the code should do:** Return true only if the user is an admin.

```go
package main

import "fmt"

type User struct {
    Name  string
    Role  string
}

func isAdmin(u *User) bool {
    result := false

    if u != nil {
        result := u.Role == "admin"
        _ = result
    }

    return result
}

func main() {
    admin := &User{Name: "Alice", Role: "admin"}
    guest := &User{Name: "Bob", Role: "guest"}

    fmt.Println(isAdmin(admin)) // Expected: true
    fmt.Println(isAdmin(guest)) // Expected: false
    fmt.Println(isAdmin(nil))   // Expected: false
}
```

**Expected output:**
```
true
false
false
```

**Actual output:**
```
false
false
false
```

<details>
<summary>Hint</summary>
Look at the `result :=` inside the `if` block. Is this the same `result` as the outer one?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `result := u.Role == "admin"` inside the `if` block creates a **new** local variable `result` that shadows the outer `result`. The outer `result` remains `false` forever.

**Fixed code:**
```go
func isAdminFixed(u *User) bool {
    result := false

    if u != nil {
        result = u.Role == "admin"  // = not :=
    }

    return result
}
```

**Why:** `:=` always creates a new variable in the current block scope. To update the outer `result`, use `=` (assignment, not declaration).
</details>

---

## Bug 4: Loop Variable Capture in Goroutines (Hard)

**What the code should do:** Launch 5 goroutines, each printing its own index (0-4).

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup

    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i)
        }()
    }

    wg.Wait()
}
```

**Expected output (some order):**
```
0
1
2
3
4
```

**Actual output (Go < 1.22):**
```
5
5
5
5
5
```
(or some combination of 4s and 5s — non-deterministic)

<details>
<summary>Hint</summary>
How many variables named `i` exist? All goroutines share the same one. What is its value when the goroutines actually run?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** All goroutines capture the same `i` variable (the loop variable). By the time the goroutines execute, the for loop has completed and `i` is `5` (the value that stopped the loop).

**Fix 1: Create a new variable per iteration (works all Go versions)**
```go
for i := 0; i < 5; i++ {
    i := i  // new variable per iteration
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(i)
    }()
}
```

**Fix 2: Pass as argument**
```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(n int) {
        defer wg.Done()
        fmt.Println(n)
    }(i)  // i is evaluated now, not later
}
```

**Fix 3: Go 1.22+** — loop variables are automatically per-iteration, no fix needed.

**Why:** The closure captures a reference to `i`, not a copy of its value. All goroutines share the same reference. Fix 1 creates a new variable per iteration; Fix 2 passes the current value as a function argument.
</details>

---

## Bug 5: init() Package-Level Shadowing (Hard)

**What the code should do:** Initialize a global database connection in `init()` and use it in `main()`.

```go
package main

import (
    "fmt"
)

type DB struct{ name string }

func openDB(dsn string) (*DB, error) {
    return &DB{name: dsn}, nil
}

var db *DB

func init() {
    db, err := openDB("postgres://localhost/mydb")
    if err != nil {
        panic(err)
    }
    _ = db
}

func main() {
    if db == nil {
        fmt.Println("ERROR: db is nil!")
        return
    }
    fmt.Println("Connected to:", db.name)
}
```

**Expected output:**
```
Connected to: postgres://localhost/mydb
```

**Actual output:**
```
ERROR: db is nil!
```

<details>
<summary>Hint</summary>
Inside `init()`, what does `db, err := ...` create? Is it the same `db` as the package-level `var db *DB`?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `db, err := openDB(...)` inside `init()` uses `:=`, which creates a **new local** variable `db` inside `init()`. The package-level `db` remains `nil`. The `_ = db` line silences the "declared and not used" compiler error, hiding the bug.

**Fixed code:**
```go
func init() {
    var err error
    db, err = openDB("postgres://localhost/mydb")  // = not :=
    if err != nil {
        panic(err)
    }
}
```

Or alternatively:
```go
func init() {
    var newDB *DB
    var err error
    newDB, err = openDB("postgres://localhost/mydb")
    if err != nil {
        panic(err)
    }
    db = newDB
}
```

**Why:** `:=` always creates new variables. To assign to an already-declared package-level variable, use `=` after declaring `err` separately with `var err error`.
</details>

---

## Bug 6: Redeclaration Compile Error (Easy)

**What the code should do:** Compute a result in two steps and print it.

```go
package main

import "fmt"

func compute(x int) (int, error) {
    return x * 2, nil
}

func main() {
    result, err := compute(5)
    if err != nil {
        fmt.Println(err)
        return
    }

    result, err := compute(result)  // BUG
    if err != nil {
        fmt.Println(err)
        return
    }

    fmt.Println(result)
}
```

**Expected output:** `20`

**Actual output / Error:**
```
./main.go:17:2: no new variables on left side of :=
```

<details>
<summary>Hint</summary>
Both `result` and `err` already exist from the first `:=`. What does `:=` require?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** On the second `result, err := compute(result)`, both `result` and `err` are already declared in the same scope. `:=` requires at least one NEW variable on the left side — there is none, so it is a compile error.

**Fixed code:**
```go
func main() {
    result, err := compute(5)
    if err != nil {
        fmt.Println(err)
        return
    }

    result, err = compute(result)  // use = not :=
    if err != nil {
        fmt.Println(err)
        return
    }

    fmt.Println(result) // Output: 20
}
```

**Why:** Once a variable is declared, you reassign it with `=`. `:=` is only for NEW declarations.
</details>

---

## Bug 7: Wrong Type Inferred (Medium)

**What the code should do:** Store a duration and use it for sleeping.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    delay := 5  // BUG: what type is this?

    fmt.Println("Waiting...")
    time.Sleep(time.Duration(delay)) // this will sleep for 5 nanoseconds!
    fmt.Println("Done")
}
```

**Expected behavior:** Sleep for 5 seconds.
**Actual behavior:** Sleeps for 5 nanoseconds (imperceptibly fast).

<details>
<summary>Hint</summary>
What type does `delay := 5` create? What unit does `time.Duration` use?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `delay := 5` infers type `int`. When converted to `time.Duration`, `5` means 5 nanoseconds (since `time.Duration` is `int64` measured in nanoseconds). So the sleep is 5ns, not 5 seconds.

**Fixed code (option 1 — explicit type):**
```go
var delay time.Duration = 5 * time.Second
time.Sleep(delay)
```

**Fixed code (option 2 — inline):**
```go
delay := 5 * time.Second  // delay is now time.Duration
time.Sleep(delay)
```

**Fixed code (option 3 — direct):**
```go
time.Sleep(5 * time.Second)
```

**Why:** The short declaration `:=` infers `int` from the literal `5`. When working with `time.Duration`, always use `time.Second`, `time.Millisecond`, etc., or declare with `var delay time.Duration = ...` to get the correct type.
</details>

---

## Bug 8: Nil Map Panic (Medium)

**What the code should do:** Count word frequencies in a string.

```go
package main

import (
    "fmt"
    "strings"
)

func wordCount(text string) map[string]int {
    var counts map[string]int  // nil map

    for _, word := range strings.Fields(text) {
        counts[word]++  // BUG: writing to nil map panics!
    }

    return counts
}

func main() {
    freq := wordCount("the quick brown fox jumps over the lazy dog the")
    fmt.Println(freq["the"])  // Expected: 3
}
```

**Expected output:** `3`

**Actual output:**
```
panic: assignment to entry in nil map
```

<details>
<summary>Hint</summary>
What is the zero value of a map? Can you write to a nil map?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `var counts map[string]int` creates a `nil` map. In Go, reading from a nil map returns the zero value (safe), but **writing to a nil map panics**.

**Fixed code (option 1 — initialize with make):**
```go
func wordCountFixed(text string) map[string]int {
    counts := make(map[string]int)  // non-nil, empty map

    for _, word := range strings.Fields(text) {
        counts[word]++
    }

    return counts
}
```

**Fixed code (option 2 — lazy init):**
```go
func wordCountLazy(text string) map[string]int {
    var counts map[string]int

    for _, word := range strings.Fields(text) {
        if counts == nil {
            counts = make(map[string]int)
        }
        counts[word]++
    }

    return counts
}
```

**Why:** Maps must be initialized with `make` before writing. Use `make(map[K]V)` or `make(map[K]V, hint)` to create a writable map. `var m map[K]V` creates a nil map — safe for reads, panics on writes.
</details>

---

## Bug 9: Defer in Loop Closes Wrong File (Hard)

**What the code should do:** Open and process multiple files, closing each after processing.

```go
package main

import (
    "fmt"
    "os"
)

func processFiles(names []string) error {
    for _, name := range names {
        f, err := os.Open(name)
        if err != nil {
            return fmt.Errorf("open %s: %w", name, err)
        }
        defer f.Close()  // BUG: all defers run at function end!

        // process file...
        fmt.Println("Processing:", name)
    }
    return nil
}

func main() {
    processFiles([]string{"a.txt", "b.txt", "c.txt"})
    // Files are closed here, not after each iteration
    // This leaks file descriptors during the loop
}
```

**Problem:** File descriptors are not released until `processFiles` returns. For large lists of files, this can exhaust the OS file descriptor limit.

<details>
<summary>Hint</summary>
`defer` in a loop defers until the surrounding *function* returns, not until the loop iteration ends. How can you ensure each file is closed after its iteration?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `defer f.Close()` inside a loop schedules all close calls to run when `processFiles` returns — not when each loop iteration ends. If processing 10,000 files, all 10,000 are open simultaneously.

**Fix 1: Wrap in anonymous function**
```go
func processFilesFixed(names []string) error {
    for _, name := range names {
        if err := processOneFile(name); err != nil {
            return err
        }
    }
    return nil
}

func processOneFile(name string) error {
    f, err := os.Open(name)
    if err != nil {
        return fmt.Errorf("open %s: %w", name, err)
    }
    defer f.Close()  // now deferred to processOneFile's return

    fmt.Println("Processing:", name)
    return nil
}
```

**Fix 2: Explicit close**
```go
for _, name := range names {
    f, err := os.Open(name)
    if err != nil {
        return fmt.Errorf("open %s: %w", name, err)
    }

    fmt.Println("Processing:", name)

    f.Close()  // explicit, not deferred
}
```

**Why:** `defer` is scoped to the enclosing function, not the enclosing block or loop iteration. Use helper functions or explicit `Close()` calls when you need per-iteration cleanup.
</details>

---

## Bug 10: Interface Nil Trap (Hard)

**What the code should do:** Return an error if validation fails, nil if it passes.

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Message string
}

func (e *ValidationError) Error() string {
    return e.Message
}

func validateAge(age int) error {
    var err *ValidationError  // nil pointer of type *ValidationError

    if age < 0 || age > 150 {
        err = &ValidationError{Message: "age out of range"}
    }

    return err  // BUG: returns non-nil interface even when err is nil!
}

func main() {
    err := validateAge(25)
    if err != nil {
        fmt.Println("Invalid:", err)
    } else {
        fmt.Println("Valid age")  // Expected: this should print
    }
}
```

**Expected output:** `Valid age`

**Actual output:** `Invalid: <nil>` or unexpected nil-check result.

<details>
<summary>Hint</summary>
What is the difference between a nil `*ValidationError` and a nil `error` interface? When you return a typed nil pointer as an interface, is the interface nil?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** In Go, an interface value is nil only if both its type and value are nil. When you return `err` (which is `(*ValidationError)(nil)` — a non-nil type, nil value), the `error` interface is NOT nil even though the pointer is nil.

```
err (interface): {type: *ValidationError, value: nil}  ← NOT nil!
```

**Fixed code (option 1 — return untyped nil)**
```go
func validateAgeFixed(age int) error {
    if age < 0 || age > 150 {
        return &ValidationError{Message: "age out of range"}
    }
    return nil  // untyped nil — the interface value is nil
}
```

**Fixed code (option 2 — keep var but change return)**
```go
func validateAgeFixed2(age int) error {
    var err *ValidationError

    if age < 0 || age > 150 {
        err = &ValidationError{Message: "age out of range"}
    }

    if err != nil {
        return err
    }
    return nil  // explicit nil return
}
```

**Why:** An interface value consists of (type, value) pair. A `(*ValidationError)(nil)` has type `*ValidationError` and value `nil` — the interface itself is non-nil. Only `return nil` (without a type) returns a truly nil interface.
</details>

---

## Bug 11: Wrong Variable Updated in Select (Hard)

**What the code should do:** Receive from two channels and store the last received value.

```go
package main

import (
    "fmt"
    "time"
)

func main() {
    ch1 := make(chan string, 1)
    ch2 := make(chan string, 1)

    ch1 <- "from ch1"
    ch2 <- "from ch2"

    var lastMsg string

    for i := 0; i < 2; i++ {
        select {
        case msg := <-ch1:
            lastMsg := msg  // BUG
            _ = lastMsg
        case msg := <-ch2:
            lastMsg := msg  // BUG
            _ = lastMsg
        }
    }

    fmt.Println("Last message:", lastMsg)
    _ = time.Second
}
```

**Expected output:** `Last message: from ch2` (or `from ch1` depending on timing)

**Actual output:** `Last message: ` (empty string — lastMsg never updated)

<details>
<summary>Hint</summary>
Look at `lastMsg := msg` inside the select cases. Where does `lastMsg` live?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `lastMsg := msg` inside each `case` creates a NEW local `lastMsg` that shadows the outer `lastMsg`. The outer variable declared with `var lastMsg string` is never updated.

**Fixed code:**
```go
for i := 0; i < 2; i++ {
    select {
    case msg := <-ch1:
        lastMsg = msg  // = not :=
    case msg := <-ch2:
        lastMsg = msg  // = not :=
    }
}
```

**Why:** `:=` inside a `case` block creates a new scope variable. To update the outer `lastMsg`, use `=` (simple assignment).
</details>

---

## Bug 12: Uninitialized Receiver in Method (Medium)

**What the code should do:** Use a counter that tracks its own call count.

```go
package main

import "fmt"

type Counter struct {
    value int
    calls int
}

func (c Counter) Increment() {  // BUG: value receiver
    c.value++
    c.calls++
    fmt.Printf("incremented to %d (call %d)\n", c.value, c.calls)
}

func main() {
    var c Counter
    c.Increment()
    c.Increment()
    c.Increment()
    fmt.Println("Final value:", c.value) // Expected: 3
}
```

**Expected output:**
```
incremented to 1 (call 1)
incremented to 2 (call 2)
incremented to 3 (call 3)
Final value: 3
```

**Actual output:**
```
incremented to 1 (call 1)
incremented to 1 (call 1)
incremented to 1 (call 1)
Final value: 0
```

<details>
<summary>Hint</summary>
The `Counter` is declared with `var c Counter` (zero value). But what kind of receiver does `Increment` use?
</details>

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `Increment` uses a **value receiver** `(c Counter)`. This means each call operates on a **copy** of `c`. Modifications to `c.value` and `c.calls` inside the method do not affect the original. The original `c` declared with `var c Counter` is never changed.

**Fixed code:**
```go
func (c *Counter) Increment() {  // pointer receiver
    c.value++
    c.calls++
    fmt.Printf("incremented to %d (call %d)\n", c.value, c.calls)
}
```

**Why:** Use pointer receivers (`*Counter`) when the method needs to modify the receiver's state. Value receivers work on copies. This bug is related to variable declaration in that `var c Counter` creates a zero-value struct — the bug would also appear if you used `c := Counter{}`.
</details>

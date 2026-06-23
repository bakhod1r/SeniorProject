# Go Multiple Return Values — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use idiomatic Go: check errors first, follow `(value, error)` and comma-ok conventions.

---

## Task 1 — `divmod` Returning Two Ints

**Difficulty**: Beginner
**Topic**: Multi-result basics

**Description**: Write `divmod(a, b int) (int, int)` returning `(a/b, a%b)`.

**Starter Code**:
```go
package main

import "fmt"

func divmod(a, b int) (int, int) {
    // TODO
    return 0, 0
}

func main() {
    q, r := divmod(17, 5)
    fmt.Printf("17 / 5 = %d remainder %d\n", q, r)
}
```

**Expected Output**:
```
17 / 5 = 3 remainder 2
```

**Evaluation Checklist**:
- [ ] Returns two ints in the correct order
- [ ] Uses parentheses around the result types
- [ ] Returns both values in a single `return` statement

---

## Task 2 — `parseAge` Following `(value, error)`

**Difficulty**: Beginner
**Topic**: Error returns, conventions

**Description**: Write `parseAge(s string) (int, error)` that:
- Returns the parsed int + nil error if `s` is a valid age (0-150).
- Returns 0 + an error otherwise.

**Starter Code**:
```go
package main

import (
    "fmt"
    "strconv"
)

func parseAge(s string) (int, error) {
    // TODO
    return 0, nil
}

func main() {
    for _, s := range []string{"30", "abc", "-5", "200"} {
        age, err := parseAge(s)
        if err != nil {
            fmt.Printf("parseAge(%q): error: %v\n", s, err)
            continue
        }
        fmt.Printf("parseAge(%q): %d\n", s, age)
    }
}
```

**Expected Output**:
```
parseAge("30"): 30
parseAge("abc"): error: parse: ...
parseAge("-5"): error: out of range
parseAge("200"): error: out of range
```

**Evaluation Checklist**:
- [ ] Returns 0 and an error when invalid
- [ ] Wraps the strconv error with `%w` for parse failures
- [ ] Has a separate error for out-of-range
- [ ] Successful parse returns the int + nil

---

## Task 3 — Map Lookup With Comma-Ok

**Difficulty**: Beginner
**Topic**: Comma-ok pattern

**Description**: Write `getName(id int) (string, bool)` that returns the name from a hardcoded map of users, or `("", false)` if not found.

**Starter Code**:
```go
package main

import "fmt"

var users = map[int]string{
    1: "Ada",
    2: "Linus",
    3: "Grace",
}

func getName(id int) (string, bool) {
    // TODO
    return "", false
}

func main() {
    for _, id := range []int{1, 2, 99} {
        if name, ok := getName(id); ok {
            fmt.Printf("user %d: %s\n", id, name)
        } else {
            fmt.Printf("user %d: not found\n", id)
        }
    }
}
```

**Expected Output**:
```
user 1: Ada
user 2: Linus
user 99: not found
```

**Evaluation Checklist**:
- [ ] Uses comma-ok internally
- [ ] Returns the actual name plus true on hit
- [ ] Returns "" plus false on miss
- [ ] No panics on missing keys

---

## Task 4 — `minMax` Returning Three Values

**Difficulty**: Intermediate
**Topic**: Multiple results with error

**Description**: Write `minMax(xs []int) (min, max int, err error)` using named returns. Returns an error if `xs` is empty.

**Starter Code**:
```go
package main

import (
    "fmt"
    "errors"
)

func minMax(xs []int) (min, max int, err error) {
    // TODO
    return
}

func main() {
    cases := [][]int{{3, 1, 4, 1, 5, 9, 2, 6}, {42}, {}}
    for _, c := range cases {
        lo, hi, err := minMax(c)
        if err != nil {
            fmt.Printf("minMax(%v): %v\n", c, err)
            continue
        }
        fmt.Printf("minMax(%v): min=%d max=%d\n", c, lo, hi)
    }
    _ = errors.New
}
```

**Expected Output**:
```
minMax([3 1 4 1 5 9 2 6]): min=1 max=9
minMax([42]): min=42 max=42
minMax([]): empty input
```

**Evaluation Checklist**:
- [ ] Uses named returns (`min, max int, err error`)
- [ ] Uses naked return at least once
- [ ] Handles single-element slice correctly
- [ ] Returns error for empty input

---

## Task 5 — Forwarding Multi-Result

**Difficulty**: Intermediate
**Topic**: Direct multi-result forwarding

**Description**: Write `triple() (int, int, int)` returning `(1, 2, 3)`. Then write `sum3(a, b, c int) int` returning their sum. In `main`, call `sum3(triple())` directly.

**Starter Code**:
```go
package main

import "fmt"

func triple() (int, int, int) {
    // TODO
    return 0, 0, 0
}

func sum3(a, b, c int) int {
    // TODO
    return 0
}

func main() {
    fmt.Println(sum3(triple()))
}
```

**Expected Output**:
```
6
```

**Evaluation Checklist**:
- [ ] `triple` returns three ints
- [ ] `sum3` accepts three ints
- [ ] `main` forwards directly: `sum3(triple())`
- [ ] No intermediate variables

---

## Task 6 — Type Assertion Comma-Ok

**Difficulty**: Intermediate
**Topic**: Comma-ok form for type assertion

**Description**: Write `describe(x any)` that prints:
- `"int N"` if x is an int
- `"string of length N"` if x is a string
- `"unknown"` otherwise

Use the comma-ok form of type assertion.

**Starter Code**:
```go
package main

import "fmt"

func describe(x any) {
    // TODO
}

func main() {
    describe(42)
    describe("hello")
    describe(3.14)
    describe(nil)
}
```

**Expected Output**:
```
int 42
string of length 5
unknown
unknown
```

**Evaluation Checklist**:
- [ ] Uses `n, ok := x.(int)` and `s, ok := x.(string)`
- [ ] Does NOT panic on unsupported types
- [ ] Handles nil correctly
- [ ] Uses ok flag to branch

---

## Task 7 — Wrapping Errors With `%w`

**Difficulty**: Intermediate
**Topic**: `errors.Is` with wrapped errors

**Description**: Define a sentinel `ErrNotFound`. Write `getUser(id int) error` that wraps `ErrNotFound` with context when not found. In main, demonstrate that `errors.Is` matches.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

func getUser(id int) error {
    // TODO: return wrapped ErrNotFound for id != 1
    return nil
}

func main() {
    err := getUser(99)
    fmt.Println(err)
    fmt.Println(errors.Is(err, ErrNotFound)) // should be true

    err = getUser(1)
    fmt.Println(err)
    fmt.Println(errors.Is(err, ErrNotFound)) // should be false
}
```

**Expected Output**:
```
getUser id=99: not found
true
<nil>
false
```

**Evaluation Checklist**:
- [ ] Uses `fmt.Errorf("...%w", ErrNotFound)`
- [ ] Returns nil when found
- [ ] `errors.Is` matches the wrapped sentinel
- [ ] Error message includes the id

---

## Task 8 — Custom Iterator With Comma-Ok

**Difficulty**: Advanced
**Topic**: Designing a comma-ok API

**Description**: Define a `LineIterator` type that holds a `[]string` and a position. Provide `Next() (string, bool)` returning the next line and `false` when exhausted. Use it in main with a typical `for` loop.

**Starter Code**:
```go
package main

import "fmt"

type LineIterator struct {
    lines []string
    pos   int
}

func NewLineIterator(lines []string) *LineIterator {
    return &LineIterator{lines: lines}
}

func (it *LineIterator) Next() (string, bool) {
    // TODO
    return "", false
}

func main() {
    it := NewLineIterator([]string{"a", "b", "c"})
    for line, ok := it.Next(); ok; line, ok = it.Next() {
        fmt.Println("line:", line)
    }
    fmt.Println("done")
}
```

**Expected Output**:
```
line: a
line: b
line: c
done
```

**Evaluation Checklist**:
- [ ] `Next` returns `("", false)` after the last line
- [ ] State is per-iterator (no globals)
- [ ] Multiple calls advance correctly
- [ ] Re-calling after exhaustion still returns false

---

## Task 9 — Closing Over Named Return

**Difficulty**: Advanced
**Topic**: defer + named return + close-error capture

**Description**: Write `processFile(path string) (count int, err error)` that opens a file, counts lines, and returns. Use named returns + a deferred Close that captures any close error if no read error occurred.

**Starter Code**:
```go
package main

import (
    "bufio"
    "fmt"
    "os"
)

func processFile(path string) (count int, err error) {
    f, err := os.Open(path)
    if err != nil {
        return 0, err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()

    scanner := bufio.NewScanner(f)
    for scanner.Scan() {
        // TODO: increment count
    }
    if serr := scanner.Err(); serr != nil {
        return 0, serr
    }
    return
}

func main() {
    n, err := processFile("/etc/hosts")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    fmt.Printf("%d lines\n", n)
}
```

**Expected Output** (varies by file):
```
N lines
```

**Evaluation Checklist**:
- [ ] Uses named returns
- [ ] defer Close captures err only if no other error
- [ ] Increments count correctly
- [ ] Handles scanner.Err() too

---

## Task 10 — `Must` Generic Helper

**Difficulty**: Advanced
**Topic**: Generic multi-result wrapping

**Description**: Implement a generic `Must[T any](v T, err error) T` that panics on error or returns v. Use it at package init.

**Starter Code**:
```go
package main

import (
    "fmt"
    "regexp"
)

func Must[T any](v T, err error) T {
    // TODO
    var zero T
    return zero
}

var emailRe = Must(regexp.Compile(`^[a-z]+@[a-z]+\.[a-z]+$`))

func main() {
    fmt.Println(emailRe.MatchString("ada@example.com"))
    fmt.Println(emailRe.MatchString("not-an-email"))
}
```

**Expected Output**:
```
true
false
```

**Evaluation Checklist**:
- [ ] Generic with type parameter `T any`
- [ ] Panics on non-nil error
- [ ] Returns v on nil error
- [ ] Used as init-time helper

---

## Bonus Task — `errors.Join` Imitation

**Difficulty**: Advanced
**Topic**: Variadic of error, join semantics

**Description**: Implement `joinErrs(errs ...error) error`:
- Returns nil if all are nil or no input.
- Returns the single non-nil error directly if exactly one.
- Otherwise returns a custom `*joinedErrors` whose `Error()` lists messages separated by `; ` and whose `Unwrap() []error` returns all non-nil errors.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

type joinedErrors struct {
    errs []error
}

func (j *joinedErrors) Error() string {
    msgs := make([]string, len(j.errs))
    for i, e := range j.errs {
        msgs[i] = e.Error()
    }
    return strings.Join(msgs, "; ")
}

func (j *joinedErrors) Unwrap() []error {
    return j.errs
}

func joinErrs(errs ...error) error {
    // TODO
    return nil
}

func main() {
    fmt.Println(joinErrs())
    fmt.Println(joinErrs(nil, nil))
    fmt.Println(joinErrs(errors.New("only")))
    e := joinErrs(errors.New("a"), nil, errors.New("b"))
    fmt.Println(e)
    fmt.Println(errors.Is(e, errors.New("a"))) // false (different instance)
}
```

**Expected Output**:
```
<nil>
<nil>
only
a; b
false
```

**Evaluation Checklist**:
- [ ] All-nil returns nil
- [ ] Single non-nil returns that error directly (not wrapped)
- [ ] Multiple non-nil returns *joinedErrors
- [ ] `Unwrap() []error` enables `errors.Is`/`errors.As` traversal
- [ ] Filters out nil from input

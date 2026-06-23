# errors.Join — Tasks

> Hands-on exercises. Each comes with a problem statement, hints, and a reference solution. Difficulty: easy → hard.

---

## Task 1 (Easy) — Join two errors

Write a program that joins two errors and prints the result.

**Hints**
- `errors.Join` accepts variadic `error` arguments.
- `fmt.Println` calls `Error()`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    a := errors.New("first")
    b := errors.New("second")
    err := errors.Join(a, b)
    fmt.Println(err)
}
```

Expected output:
```
first
second
```

---

## Task 2 (Easy) — All-nil returns nil

Write a program that calls `errors.Join` with three `nil` arguments and prints whether the result is `nil`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.Join(nil, nil, nil)
    fmt.Println(err == nil)
}
```

Expected output: `true`.

---

## Task 3 (Easy) — Filtered nil

Verify that nil arguments are filtered. Pass `(nil, err1, nil, err2, nil)` and print the result.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func main() {
    err := errors.Join(nil, errors.New("a"), nil, errors.New("b"), nil)
    fmt.Println(err)
}
```

Expected output:
```
a
b
```

---

## Task 4 (Easy) — `errors.Is` against a join

Demonstrate that `errors.Is` finds a sentinel inside a joined error.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "io/fs"
)

func main() {
    err := errors.Join(errors.New("network down"), fs.ErrNotExist)
    if errors.Is(err, fs.ErrNotExist) {
        fmt.Println("found ErrNotExist")
    }
}
```

---

## Task 5 (Easy) — Validate a struct

Write a `Validate` method on `User{Name, Email string, Age int}` that returns a joined error covering empty Name, missing `@` in Email, and Age < 0.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

type User struct {
    Name  string
    Email string
    Age   int
}

func (u User) Validate() error {
    var errs []error
    if u.Name == "" {
        errs = append(errs, errors.New("name is required"))
    }
    if !strings.Contains(u.Email, "@") {
        errs = append(errs, errors.New("email must contain @"))
    }
    if u.Age < 0 {
        errs = append(errs, errors.New("age must be non-negative"))
    }
    return errors.Join(errs...)
}

func main() {
    u := User{Email: "no-at"}
    if err := u.Validate(); err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 6 (Medium) — Custom multi-error type

Build a `ValidationErrors` type that:
- Embeds a `[]error`.
- Has a constructor `New() *ValidationErrors`.
- Has `Add(err error)` (skipping nil).
- Has `Error()` formatted as `"N errors: 1) ... 2) ..."`.
- Has `Unwrap() []error`.
- Has `AsError()` that returns `nil` if the list is empty.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

type ValidationErrors struct {
    Errs []error
}

func New() *ValidationErrors { return &ValidationErrors{} }

func (v *ValidationErrors) Add(err error) {
    if err == nil {
        return
    }
    v.Errs = append(v.Errs, err)
}

func (v *ValidationErrors) Error() string {
    var b strings.Builder
    fmt.Fprintf(&b, "%d errors:", len(v.Errs))
    for i, e := range v.Errs {
        fmt.Fprintf(&b, "\n  %d) %s", i+1, e.Error())
    }
    return b.String()
}

func (v *ValidationErrors) Unwrap() []error { return v.Errs }

func (v *ValidationErrors) AsError() error {
    if v == nil || len(v.Errs) == 0 {
        return nil
    }
    return v
}

var ErrEmpty = errors.New("field is empty")

func main() {
    v := New()
    v.Add(ErrEmpty)
    v.Add(errors.New("invalid format"))

    err := v.AsError()
    fmt.Println(err)
    fmt.Println("contains ErrEmpty:", errors.Is(err, ErrEmpty))
}
```

---

## Task 7 (Medium) — Defer-collect on close

Write `process(path string) error` that:
- Opens a file.
- Calls `doWork(f)`.
- Defers `f.Close()` and joins any close error with the work error.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "os"
)

func doWork(f *os.File) error {
    return errors.New("work failed")
}

func process(path string) (err error) {
    f, openErr := os.Open(path)
    if openErr != nil {
        return openErr
    }
    defer func() {
        if cerr := f.Close(); cerr != nil {
            err = errors.Join(err, fmt.Errorf("close: %w", cerr))
        }
    }()
    return doWork(f)
}

func main() {
    if err := process("/etc/hostname"); err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 8 (Medium) — Concurrent collect

Run 5 goroutines that each return an error or nil. Collect all into one joined error.

**Hints**
- Index-by-position writes; no mutex needed.
- `wg.Wait()` before `errors.Join`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

func main() {
    jobs := []func() error{
        func() error { return errors.New("job 0 failed") },
        func() error { return nil },
        func() error { return errors.New("job 2 failed") },
        func() error { return nil },
        func() error { return errors.New("job 4 failed") },
    }

    errs := make([]error, len(jobs))
    var wg sync.WaitGroup
    for i, j := range jobs {
        wg.Add(1)
        go func(i int, j func() error) {
            defer wg.Done()
            errs[i] = j()
        }(i, j)
    }
    wg.Wait()

    if err := errors.Join(errs...); err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 9 (Medium) — Multi-`%w` in `fmt.Errorf`

Combine two errors with a custom message using two `%w` verbs. Verify both are reachable via `errors.Is`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

var (
    ErrSave   = errors.New("save")
    ErrCommit = errors.New("commit")
)

func op() error {
    return fmt.Errorf("transaction: save: %w; commit: %w", ErrSave, ErrCommit)
}

func main() {
    err := op()
    fmt.Println(err)
    fmt.Println("is ErrSave:", errors.Is(err, ErrSave))
    fmt.Println("is ErrCommit:", errors.Is(err, ErrCommit))
}
```

---

## Task 10 (Medium) — Walk the tree

Write a `walk(err error, visit func(error))` that visits every node in the error tree (single-wrap and multi-wrap).

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func walk(err error, visit func(error)) {
    if err == nil {
        return
    }
    visit(err)
    switch x := err.(type) {
    case interface{ Unwrap() error }:
        walk(x.Unwrap(), visit)
    case interface{ Unwrap() []error }:
        for _, c := range x.Unwrap() {
            walk(c, visit)
        }
    }
}

func main() {
    inner := fmt.Errorf("ctx: %w", errors.New("leaf"))
    err := errors.Join(errors.New("a"), inner)

    walk(err, func(e error) {
        fmt.Printf("- %s\n", e.Error())
    })
}
```

---

## Task 11 (Hard) — Migrate from `multierror`

Reimplement a tiny `multierror`-style API in terms of `errors.Join`. The shim should expose `Append(*Error, error) *Error` and `(*Error).ErrorOrNil() error`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

type Error struct {
    errs []error
}

func Append(m *Error, err error) *Error {
    if err == nil {
        return m
    }
    if m == nil {
        m = &Error{}
    }
    m.errs = append(m.errs, err)
    return m
}

func (m *Error) ErrorOrNil() error {
    if m == nil {
        return nil
    }
    return errors.Join(m.errs...)
}

func main() {
    var m *Error
    m = Append(m, errors.New("a"))
    m = Append(m, nil)
    m = Append(m, errors.New("b"))
    fmt.Println(m.ErrorOrNil())
}
```

The behavior matches `hashicorp/multierror` for the common cases.

---

## Task 12 (Hard) — Bounded multi-error

Process a stream of items; if more than 5 fail, keep the first 5 and replace the 6th with a wrapped "and N more truncated" message.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

const maxErrs = 5

type Result struct {
    Item int
    Err  error
}

func collect(results []Result) error {
    var errs []error
    truncated := 0
    for _, r := range results {
        if r.Err == nil {
            continue
        }
        if len(errs) < maxErrs {
            errs = append(errs, fmt.Errorf("item %d: %w", r.Item, r.Err))
        } else {
            truncated++
        }
    }
    if truncated > 0 {
        errs = append(errs, fmt.Errorf("...and %d more errors truncated", truncated))
    }
    return errors.Join(errs...)
}

func main() {
    var rs []Result
    for i := 0; i < 20; i++ {
        rs = append(rs, Result{Item: i, Err: errors.New("boom")})
    }
    fmt.Println(collect(rs))
}
```

---

## Task 13 (Hard) — Flatten a nested join

Given `errors.Join(errors.Join(a, b), c, errors.Join(d, e))`, write a function that returns a flat slice `[a, b, c, d, e]`.

**Hints**
- Recurse into nested joinErrors via `Unwrap() []error`.
- Treat single-error wraps as leaves (do not flatten the chain).

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func flatten(err error) []error {
    if err == nil {
        return nil
    }
    if u, ok := err.(interface{ Unwrap() []error }); ok {
        var out []error
        for _, c := range u.Unwrap() {
            out = append(out, flatten(c)...)
        }
        return out
    }
    return []error{err}
}

func main() {
    a := errors.New("a")
    b := errors.New("b")
    c := errors.New("c")
    d := errors.New("d")
    e := errors.New("e")

    nested := errors.Join(errors.Join(a, b), c, errors.Join(d, e))
    for _, err := range flatten(nested) {
        fmt.Println(err)
    }
}
```

---

## Task 14 (Hard) — Goroutine pool with collect-all

Build a pool of workers (size N) that process items from a channel; collect every error using `errors.Join`.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
    "sync"
)

func work(item int) error {
    if item%3 == 0 {
        return fmt.Errorf("item %d failed", item)
    }
    return nil
}

func runPool(items []int, workers int) error {
    in := make(chan int)
    var (
        mu   sync.Mutex
        errs []error
        wg   sync.WaitGroup
    )

    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range in {
                if err := work(item); err != nil {
                    mu.Lock()
                    errs = append(errs, err)
                    mu.Unlock()
                }
            }
        }()
    }

    for _, it := range items {
        in <- it
    }
    close(in)
    wg.Wait()

    return errors.Join(errs...)
}

func main() {
    items := make([]int, 10)
    for i := range items {
        items[i] = i
    }
    if err := runPool(items, 4); err != nil {
        fmt.Println(err)
    }
}
```

---

## Task 15 (Boss-level) — Sentinel-aware `Is` matcher

Write a function `MatchAny(err error, sentinels ...error) error` that returns the *first* sentinel found in the error tree, or `nil` if none match.

**Hints**
- Walk the tree pre-order.
- Use `errors.Is` for each sentinel.

**Solution**
```go
package main

import (
    "errors"
    "fmt"
)

func MatchAny(err error, sentinels ...error) error {
    if err == nil {
        return nil
    }
    var found error
    var visit func(error)
    visit = func(e error) {
        if found != nil || e == nil {
            return
        }
        for _, s := range sentinels {
            if errors.Is(e, s) {
                found = s
                return
            }
        }
        switch x := e.(type) {
        case interface{ Unwrap() error }:
            visit(x.Unwrap())
        case interface{ Unwrap() []error }:
            for _, c := range x.Unwrap() {
                visit(c)
            }
        }
    }
    visit(err)
    return found
}

var (
    ErrA = errors.New("A")
    ErrB = errors.New("B")
    ErrC = errors.New("C")
)

func main() {
    err := errors.Join(
        errors.New("other"),
        fmt.Errorf("step: %w", ErrB),
    )
    if found := MatchAny(err, ErrA, ErrB, ErrC); found != nil {
        fmt.Println("matched:", found)
    } else {
        fmt.Println("no match")
    }
}
```

The function is useful when you have many possible sentinels and want to know which one fired first.

---

## Task 16 (Boss-level) — Round-trip a multi-error through JSON

Encode a joined error into a JSON array of strings and decode back into an `errors.Join` of `errors.New` values. Verify `errors.Is` no longer matches sentinels (they are recreated).

**Solution**
```go
package main

import (
    "encoding/json"
    "errors"
    "fmt"
)

func encode(err error) ([]byte, error) {
    var msgs []string
    if u, ok := err.(interface{ Unwrap() []error }); ok {
        for _, c := range u.Unwrap() {
            msgs = append(msgs, c.Error())
        }
    } else if err != nil {
        msgs = append(msgs, err.Error())
    }
    return json.Marshal(msgs)
}

func decode(data []byte) error {
    var msgs []string
    if err := json.Unmarshal(data, &msgs); err != nil {
        return err
    }
    var errs []error
    for _, m := range msgs {
        errs = append(errs, errors.New(m))
    }
    return errors.Join(errs...)
}

var ErrA = errors.New("A")

func main() {
    orig := errors.Join(ErrA, errors.New("B"))
    data, _ := encode(orig)
    fmt.Println("wire:", string(data))

    decoded := decode(data)
    fmt.Println("decoded:")
    fmt.Println(decoded)

    fmt.Println("Is ErrA in original:", errors.Is(orig, ErrA))   // true
    fmt.Println("Is ErrA in decoded:", errors.Is(decoded, ErrA)) // false (different instance)
}
```

The lesson: `errors.Is` works on identity, not on text. Crossing a serialization boundary breaks identity. To preserve "kind" across the wire, encode a kind code alongside the message and reconstruct typed errors on the other side.

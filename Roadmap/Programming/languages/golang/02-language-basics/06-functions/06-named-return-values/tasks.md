# Go Named Return Values — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use named returns deliberately — for documentation, naked returns, or defer modification.

---

## Task 1 — Naked Return Basics

**Difficulty**: Beginner
**Topic**: Named results + naked return

**Description**: Implement `splitAt(s string, i int) (a, b string)` that splits a string at index `i`. Use a naked return.

**Starter Code**:
```go
package main

import "fmt"

func splitAt(s string, i int) (a, b string) {
    // TODO
    return
}

func main() {
    fmt.Println(splitAt("hello", 2)) // he llo
    fmt.Println(splitAt("abc", 0))   //  abc
    fmt.Println(splitAt("abc", 3))   // abc
}
```

**Expected Output**:
```
he llo
 abc
abc 
```

**Evaluation Checklist**:
- [ ] Uses named results `(a, b string)`
- [ ] Uses naked return
- [ ] Handles `i = 0` (a is empty)
- [ ] Handles `i = len(s)` (b is empty)

---

## Task 2 — Defer Modify Named Result

**Difficulty**: Beginner
**Topic**: defer + named return

**Description**: Implement `tryWork() (n int)` that always returns 99 by using `n = 5` then `defer` that sets `n = 99`.

**Starter Code**:
```go
package main

import "fmt"

func tryWork() (n int) {
    // TODO: use defer to override
    n = 5
    return
}

func main() {
    fmt.Println(tryWork()) // 99
}
```

**Expected Output**:
```
99
```

**Evaluation Checklist**:
- [ ] Uses defer to set `n = 99`
- [ ] Body initially sets `n = 5`
- [ ] Naked return; defer overrides

---

## Task 3 — Panic to Error

**Difficulty**: Beginner
**Topic**: defer + recover + named error

**Description**: Implement `safeDivide(a, b int) (result int, err error)` that returns the division result, OR catches a panic and returns it as an error.

**Starter Code**:
```go
package main

import "fmt"

func safeDivide(a, b int) (result int, err error) {
    defer func() {
        // TODO: recover and set err
    }()
    return a / b, nil
}

func main() {
    fmt.Println(safeDivide(10, 2))
    fmt.Println(safeDivide(10, 0))
}
```

**Expected Output**:
```
5 <nil>
0 recovered: runtime error: integer divide by zero
```

**Evaluation Checklist**:
- [ ] Uses `defer func() { ... recover() ... }()`
- [ ] Sets `err` if panic recovered
- [ ] Result is 0 on panic
- [ ] Normal divide works correctly

---

## Task 4 — Cleanup Error Capture

**Difficulty**: Intermediate
**Topic**: defer + named return + close error

**Description**: Implement `readAll(r ReadCloser) (data []byte, err error)` that reads everything from `r` and ensures `r.Close()` errors are propagated if no read error occurred.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "io"
)

type ReadCloser interface {
    io.Reader
    io.Closer
}

type fakeReader struct {
    data    []byte
    pos     int
    closeErr error
}

func (r *fakeReader) Read(p []byte) (int, error) {
    if r.pos >= len(r.data) { return 0, io.EOF }
    n := copy(p, r.data[r.pos:])
    r.pos += n
    return n, nil
}

func (r *fakeReader) Close() error { return r.closeErr }

func readAll(r ReadCloser) (data []byte, err error) {
    defer func() {
        // TODO: capture close error if no other error
    }()
    return io.ReadAll(r)
}

func main() {
    r := &fakeReader{data: []byte("hello"), closeErr: errors.New("close failed")}
    data, err := readAll(r)
    fmt.Printf("data=%q err=%v\n", data, err)
}
```

**Expected Output**:
```
data="hello" err=close failed
```

**Evaluation Checklist**:
- [ ] Uses named result `(data []byte, err error)`
- [ ] Defer calls `r.Close()`
- [ ] Captures close error only if `err == nil`
- [ ] Returns data even when close fails (data was successfully read)

---

## Task 5 — Documentation Value

**Difficulty**: Intermediate
**Topic**: Named returns as documentation

**Description**: Implement `parseURL(s string) (scheme, host, path string, err error)` with each result name documenting its meaning. Parse format `scheme://host/path` (simplified).

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

func parseURL(s string) (scheme, host, path string, err error) {
    // TODO
    err = errors.New("not implemented")
    return
}

func main() {
    fmt.Println(parseURL("https://example.com/index"))
    fmt.Println(parseURL("invalid"))
}
```

**Expected Output**:
```
https example.com /index <nil>
   invalid format
```

**Evaluation Checklist**:
- [ ] Each result is named
- [ ] Successful parse returns all three parts + nil err
- [ ] Failed parse returns zero values + error
- [ ] Names document the meaning (no comment needed for the signature)

---

## Task 6 — Auto-Rollback Transaction

**Difficulty**: Intermediate
**Topic**: defer + named err + commit/rollback

**Description**: Implement `withTransaction(fn func() error) (err error)` that simulates a transaction. If `fn` returns an error, "rollback"; otherwise "commit". Use defer.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

func withTransaction(fn func() error) (err error) {
    fmt.Println("BEGIN")
    defer func() {
        // TODO: rollback if err, else commit
    }()
    err = fn()
    return
}

func main() {
    err := withTransaction(func() error { return nil })
    fmt.Println("err1:", err)
    err = withTransaction(func() error { return errors.New("fail") })
    fmt.Println("err2:", err)
}
```

**Expected Output**:
```
BEGIN
COMMIT
err1: <nil>
BEGIN
ROLLBACK
err2: fail
```

**Evaluation Checklist**:
- [ ] Defer prints ROLLBACK if err != nil
- [ ] Defer prints COMMIT if err == nil
- [ ] Original error is preserved
- [ ] Works with both success and failure cases

---

## Task 7 — Trace Helper

**Difficulty**: Intermediate
**Topic**: defer + named results for instrumentation

**Description**: Implement `trace(name string, fn func() (string, error)) (result string, dur time.Duration, err error)` that times `fn` and captures all three results.

**Starter Code**:
```go
package main

import (
    "fmt"
    "time"
)

func trace(name string, fn func() (string, error)) (result string, dur time.Duration, err error) {
    start := time.Now()
    defer func() {
        // TODO: set dur
    }()
    result, err = fn()
    return
}

func main() {
    r, d, err := trace("query", func() (string, error) {
        time.Sleep(20 * time.Millisecond)
        return "ok", nil
    })
    fmt.Printf("result=%s dur=%v err=%v\n", r, d, err)
}
```

**Expected Output** (timing varies):
```
result=ok dur=20ms err=<nil>
```

**Evaluation Checklist**:
- [ ] Records start with `time.Now()`
- [ ] Defer sets `dur = time.Since(start)`
- [ ] All three named results work correctly
- [ ] err propagates from `fn`

---

## Task 8 — Multi-Defer Order

**Difficulty**: Advanced
**Topic**: LIFO defer + named result modification

**Description**: Write `compute() (n int)` that:
- Sets `n = 5` in body.
- Has 3 deferred functions: defer1 doubles, defer2 adds 1, defer3 prints n at start.
- Print the call order to demonstrate LIFO.

**Starter Code**:
```go
package main

import "fmt"

func compute() (n int) {
    // TODO: register 3 defers
    n = 5
    return
}

func main() {
    fmt.Println("returned:", compute())
}
```

**Expected Output**:
```
defer3 (sees n=5 at start of LIFO chain)
defer2 (after defer3, n=5; adds 1, n=6)
defer1 (after defer2, n=6; doubles, n=12)
returned: 12
```

**Evaluation Checklist**:
- [ ] Three defers registered in order: defer3 LAST? Wait, LIFO order depends on registration order. To run defer3 FIRST in LIFO, register it LAST.
- [ ] Output shows LIFO behavior
- [ ] Final returned value reflects all modifications

```go
func compute() (n int) {
    defer func() { n *= 2; fmt.Println("defer1 doubled, n =", n) }()       // registered first, runs LAST
    defer func() { n += 1; fmt.Println("defer2 added 1, n =", n) }()       // registered second, runs SECOND
    defer func() { fmt.Println("defer3 prints n =", n) }()                  // registered last, runs FIRST
    n = 5
    return
}
```

Output (with the above):
```
defer3 prints n = 5
defer2 added 1, n = 6
defer1 doubled, n = 12
returned: 12
```

---

## Task 9 — Generic Named Return

**Difficulty**: Advanced
**Topic**: Generics + named results

**Description**: Implement `Default[T any](v T, ok bool) (result T)` that returns `v` if `ok` is true, otherwise the zero value of `T`. Use a named return.

**Starter Code**:
```go
package main

import "fmt"

func Default[T any](v T, ok bool) (result T) {
    // TODO
    return
}

func main() {
    fmt.Println(Default(42, true))     // 42
    fmt.Println(Default(42, false))    // 0
    fmt.Println(Default("hi", true))   // hi
    fmt.Println(Default("hi", false))  // ""
}
```

**Expected Output**:
```
42
0
hi

```

**Evaluation Checklist**:
- [ ] Generic over `T any`
- [ ] Named return `(result T)`
- [ ] If `ok`, sets `result = v`
- [ ] If not ok, naked return uses zero value

---

## Task 10 — Recover-and-Convert in Library

**Difficulty**: Advanced
**Topic**: Defer + recover for library robustness

**Description**: Implement `safeRun(fn func())(err error)` that runs `fn` and converts any panic to an error. If `fn` returns normally, `safeRun` returns nil.

**Starter Code**:
```go
package main

import "fmt"

func safeRun(fn func()) (err error) {
    defer func() {
        // TODO: recover and convert to err
    }()
    fn()
    return nil
}

func main() {
    fmt.Println(safeRun(func() { fmt.Println("normal") }))
    fmt.Println(safeRun(func() { panic("boom") }))
    fmt.Println(safeRun(func() {
        var p *int
        _ = *p // nil pointer dereference
    }))
}
```

**Expected Output**:
```
normal
<nil>
panic: boom
panic: runtime error: invalid memory address or nil pointer dereference
```

**Evaluation Checklist**:
- [ ] Uses `defer + recover`
- [ ] Sets `err` from panic value
- [ ] Returns nil on normal completion
- [ ] Handles both manual `panic("...")` and runtime panics

---

## Bonus Task — Cleanup Multi-Resource

**Difficulty**: Advanced
**Topic**: Multiple defers, named err, cleanup chain

**Description**: Implement `processBoth(path1, path2 string) (lines int, err error)` that:
1. Opens path1.
2. Opens path2.
3. Counts total lines.
4. Closes both files; if either close fails AND no other error, propagates it.

**Starter Code**:
```go
package main

import (
    "bufio"
    "fmt"
    "os"
)

func processBoth(path1, path2 string) (lines int, err error) {
    f1, err := os.Open(path1)
    if err != nil { return 0, err }
    defer func() {
        // TODO: capture close error
    }()
    f2, err := os.Open(path2)
    if err != nil { return 0, err }
    defer func() {
        // TODO: capture close error
    }()
    
    for _, f := range []*os.File{f1, f2} {
        s := bufio.NewScanner(f)
        for s.Scan() {
            lines++
        }
    }
    return
}

func main() {
    n, err := processBoth("/etc/hosts", "/etc/services")
    fmt.Printf("%d lines, err=%v\n", n, err)
}
```

**Evaluation Checklist**:
- [ ] Both defers registered after their respective Open
- [ ] Each defer captures its file's close error if `err == nil`
- [ ] LIFO order: f2 closes first (registered second)
- [ ] Lines counted across both files
- [ ] Error from any operation correctly propagates

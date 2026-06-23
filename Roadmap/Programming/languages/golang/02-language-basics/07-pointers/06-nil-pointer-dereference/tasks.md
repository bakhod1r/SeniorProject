# Go Nil Pointer Dereference — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Practice writing nil-safe code, designing APIs that prevent nil panics, and recovering at the right boundaries.

---

## Task 1 — Nil-Safe Counter

**Difficulty**: Beginner
**Topic**: Methods on nil receivers

**Description**: Implement a `Counter` type with `Get`, `Add`, and `String` methods that all behave reasonably on a nil receiver. `Get` returns 0, `Add` returns a new counter starting from 0+x if the receiver is nil, and `String` returns "<nil counter>".

**Starter Code**:
```go
package main

import "fmt"

type Counter struct {
    n int
}

func (c *Counter) Get() int {
    // TODO
    return 0
}

func (c *Counter) Add(x int) *Counter {
    // TODO
    return nil
}

func (c *Counter) String() string {
    // TODO
    return ""
}

func main() {
    var c *Counter
    fmt.Println(c.Get())     // 0
    c2 := c.Add(5)
    fmt.Println(c2.Get())    // 5
    fmt.Println(c.String())  // <nil counter>
    fmt.Println(c2.String()) // 5
}
```

**Expected Output**:
```
0
5
<nil counter>
5
```

**Evaluation Checklist**:
- [ ] `Get` handles nil receiver, returns 0
- [ ] `Add` handles nil receiver, returns a new non-nil counter
- [ ] `String` handles nil, returns sentinel string
- [ ] No panics for any method called on nil

---

## Task 2 — Constructor That Cannot Return Nil-Without-Error

**Difficulty**: Beginner
**Topic**: Constructor invariants

**Description**: Write `NewUser(name string) (*User, error)` such that on success, the returned pointer is guaranteed non-nil; on failure, the pointer is nil and the error is non-nil.

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
)

type User struct {
    Name string
}

func NewUser(name string) (*User, error) {
    // TODO
    return nil, errors.New("not implemented")
}

func main() {
    if u, err := NewUser(""); err != nil {
        fmt.Println("err:", err)
    } else {
        fmt.Println("u:", u.Name)
    }
    if u, err := NewUser("alice"); err != nil {
        fmt.Println("err:", err)
    } else {
        fmt.Println("u:", u.Name)
    }
}
```

**Expected Output**:
```
err: empty name
u: alice
```

**Evaluation Checklist**:
- [ ] Empty name produces an error and nil pointer
- [ ] Valid name produces a non-nil pointer and nil error
- [ ] Function never returns both non-nil
- [ ] Function never returns both nil

---

## Task 3 — Avoid Typed Nil Error

**Difficulty**: Beginner
**Topic**: Typed-nil-in-interface bug

**Description**: Refactor `compute(x int) error` so it never returns a typed nil. The current implementation returns a `*ComputeErr` that may be nil.

**Starter Code**:
```go
package main

import "fmt"

type ComputeErr struct {
    code int
    msg  string
}

func (e *ComputeErr) Error() string {
    return fmt.Sprintf("[%d] %s", e.code, e.msg)
}

func compute(x int) error {
    var e *ComputeErr
    if x < 0 {
        e = &ComputeErr{code: 1, msg: "negative"}
    }
    return e // BUG: returns typed nil for x >= 0
}

func main() {
    err := compute(5)
    if err == nil {
        fmt.Println("no error")
    } else {
        fmt.Println("error:", err)
    }
}
```

**Expected Output (after fix)**:
```
no error
```

**Evaluation Checklist**:
- [ ] Returning bare `nil` for the success case
- [ ] Returning the typed pointer only for the failure case
- [ ] `err == nil` correctly identifies success

---

## Task 4 — Safe Map of Pointers

**Difficulty**: Intermediate
**Topic**: Map lookup with nil safety

**Description**: Implement `Get(id string) (*User, bool)` over a `map[string]*User`. Return `(nil, false)` for missing keys and `(u, true)` for present keys (asserting `u != nil` since the design forbids storing nil values).

**Starter Code**:
```go
package main

import "fmt"

type User struct {
    Name string
}

type Store struct {
    users map[string]*User
}

func (s *Store) Get(id string) (*User, bool) {
    // TODO
    return nil, false
}

func (s *Store) Add(u *User) error {
    // TODO: forbid nil and empty Name
    return nil
}

func main() {
    s := &Store{users: map[string]*User{}}
    _ = s.Add(&User{Name: "alice"})
    _ = s.Add(nil) // should error
    if u, ok := s.Get("alice"); ok {
        fmt.Println("found:", u.Name)
    }
    if _, ok := s.Get("bob"); !ok {
        fmt.Println("missing")
    }
}
```

**Expected Output**:
```
found: alice
missing
```

**Evaluation Checklist**:
- [ ] `Add(nil)` returns an error
- [ ] `Add(&User{})` (empty name) returns an error
- [ ] `Get` returns `(nil, false)` for missing
- [ ] `Get` never returns `(nil, true)`
- [ ] Stored pointers are never nil

---

## Task 5 — Boundary Recovery for Goroutines

**Difficulty**: Intermediate
**Topic**: Recover at goroutine boundary

**Description**: Implement `safeGo(fn func())` that runs `fn` in a goroutine, recovering from any panic and logging it. The main goroutine should be unaffected.

**Starter Code**:
```go
package main

import (
    "fmt"
    "sync"
)

func safeGo(fn func(), wg *sync.WaitGroup) {
    // TODO
}

func main() {
    var wg sync.WaitGroup
    wg.Add(2)
    safeGo(func() {
        var p *int
        _ = *p
    }, &wg)
    safeGo(func() {
        fmt.Println("hello from goroutine")
    }, &wg)
    wg.Wait()
    fmt.Println("main done")
}
```

**Expected Output (panic message may vary in format)**:
```
hello from goroutine
recovered: runtime error: invalid memory address or nil pointer dereference
main done
```

(Order of first two lines may swap.)

**Evaluation Checklist**:
- [ ] Goroutine panic is recovered, not propagated
- [ ] WaitGroup `Done` is always called (even on panic)
- [ ] Other goroutine continues
- [ ] Main goroutine completes normally

---

## Task 6 — Detect Typed Nil with Reflection

**Difficulty**: Intermediate
**Topic**: Reflection-based nil detection

**Description**: Implement `IsNil(v any) bool` that returns true if `v` is nil OR a typed nil (a non-nil interface wrapping a nil pointer/map/slice/chan/func/interface).

**Starter Code**:
```go
package main

import (
    "fmt"
    "reflect"
)

func IsNil(v any) bool {
    // TODO
    return false
}

func main() {
    var p *int
    var i any = p
    fmt.Println(i == nil)  // false (typed nil)
    fmt.Println(IsNil(i))  // should be true

    fmt.Println(IsNil(nil))    // true
    fmt.Println(IsNil(42))     // false
    fmt.Println(IsNil("hi"))   // false

    var m map[string]int
    fmt.Println(IsNil(m)) // true
}
```

**Expected Output**:
```
false
true
true
false
false
true
```

**Evaluation Checklist**:
- [ ] Returns true for bare nil
- [ ] Returns true for typed-nil pointer wrapped in interface
- [ ] Returns true for nil map / slice / chan / func
- [ ] Returns false for non-nil values
- [ ] Uses `reflect.Value.IsNil` correctly per kind

---

## Task 7 — Linked List with Nil-Safe Methods

**Difficulty**: Intermediate
**Topic**: Recursive nil safety

**Description**: Implement a singly-linked list with `Len`, `Append`, `String` methods. All should be safe when called on a nil list.

**Starter Code**:
```go
package main

import "fmt"

type Node struct {
    Val  int
    Next *Node
}

type List struct {
    Head *Node
    n    int
}

func (l *List) Len() int {
    // TODO: nil-safe
    return 0
}

func (l *List) Append(v int) *List {
    // TODO: nil-safe; return new or modified list
    return l
}

func (l *List) String() string {
    // TODO: nil-safe
    return ""
}

func main() {
    var l *List
    fmt.Println(l.Len())     // 0
    fmt.Println(l.String())  // []
    l = l.Append(1)
    l = l.Append(2)
    l = l.Append(3)
    fmt.Println(l.Len())     // 3
    fmt.Println(l.String())  // [1 2 3]
}
```

**Expected Output**:
```
0
[]
3
[1 2 3]
```

**Evaluation Checklist**:
- [ ] `Len` returns 0 on nil receiver
- [ ] `Append` creates a new list when called on nil
- [ ] `String` returns "[]" on nil
- [ ] No panics

---

## Task 8 — HTTP Recovery Middleware

**Difficulty**: Advanced
**Topic**: HTTP boundary recovery

**Description**: Write middleware that wraps an `http.Handler` to recover from panics, log the stack, and return a 500 response.

**Starter Code**:
```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "net/http/httptest"
    "runtime/debug"
)

func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // TODO: defer + recover; on panic, log debug.Stack() and 500
        next.ServeHTTP(w, r)
    })
}

type buggy struct{}

func (buggy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    var p *int
    fmt.Fprintln(w, *p)
}

func main() {
    h := recoverMiddleware(buggy{})
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    h.ServeHTTP(rec, req)
    fmt.Println("status:", rec.Code)
    log.SetFlags(0)
    _ = debug.Stack
}
```

**Expected Output (status; log on stderr)**:
```
status: 500
```

**Evaluation Checklist**:
- [ ] Panic does not propagate to caller
- [ ] Response status is 500
- [ ] Stack trace is logged
- [ ] Non-panicking requests pass through normally

---

## Task 9 — Recover and Categorize

**Difficulty**: Advanced
**Topic**: Distinguishing nil panic from other panics

**Description**: Write `categorize(fn func()) string` that runs `fn`, recovers any panic, and returns one of: "ok", "nil-deref", or "other-panic" based on the panic value's type.

**Starter Code**:
```go
package main

import (
    "fmt"
    "runtime"
)

func categorize(fn func()) string {
    // TODO: defer + recover; check for *runtime.PanicNilError
    fn()
    return "ok"
}

func main() {
    fmt.Println(categorize(func() {})) // ok
    fmt.Println(categorize(func() {
        var p *int
        _ = *p
    })) // nil-deref
    fmt.Println(categorize(func() {
        panic("custom")
    })) // other-panic

    _ = runtime.NumGoroutine
}
```

**Expected Output**:
```
ok
nil-deref
other-panic
```

**Evaluation Checklist**:
- [ ] Returns "ok" when fn does not panic
- [ ] Returns "nil-deref" for `*runtime.PanicNilError`
- [ ] Returns "other-panic" for other panic kinds
- [ ] Uses Go 1.21+ typed panic value

---

## Task 10 — Defensive Filter

**Difficulty**: Advanced
**Topic**: Slice-of-pointers cleanup

**Description**: Given `[]*Item`, write `FilterValid` that returns a new slice with all nil entries removed.

**Starter Code**:
```go
package main

import "fmt"

type Item struct {
    Value int
}

func FilterValid(items []*Item) []*Item {
    // TODO
    return nil
}

func main() {
    items := []*Item{
        {Value: 1},
        nil,
        {Value: 2},
        nil,
        {Value: 3},
    }
    cleaned := FilterValid(items)
    fmt.Println(len(cleaned)) // 3
    for _, it := range cleaned {
        fmt.Println(it.Value)
    }
}
```

**Expected Output**:
```
3
1
2
3
```

**Evaluation Checklist**:
- [ ] Removes all nil entries
- [ ] Preserves order of non-nil
- [ ] Returns a new slice (does not modify input)
- [ ] Handles empty input (returns empty)
- [ ] Handles all-nil input (returns empty)

---

## Task 11 — Method Value on Nil

**Difficulty**: Advanced
**Topic**: Method values and nil receivers

**Description**: Demonstrate the difference between calling a method on a nil pointer directly versus capturing a method value first. Write tests showing when each panics.

**Starter Code**:
```go
package main

import "fmt"

type T struct {
    v int
}

func (t *T) Read() int {
    return t.v // touches field
}

func (t *T) Type() string {
    return "T" // does not touch field
}

func main() {
    var t *T

    // Direct call:
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("direct Read panic:", r)
        }
    }()

    // TODO: demonstrate
    // 1. Direct call to t.Type() — should print "T"
    // 2. Direct call to t.Read() — should panic
    // 3. Method value m := t.Type; m() — should print "T"
    // 4. Method value r := t.Read; r() — should panic
}
```

**Expected Output**:
```
T
T
direct Read panic: runtime error: invalid memory address or nil pointer dereference
```

(Recovery only catches one panic in the example above; structure your code to demonstrate all four cases.)

**Evaluation Checklist**:
- [ ] Direct nil-safe method call works
- [ ] Direct field-touching method call panics
- [ ] Method value of nil-safe method works when called later
- [ ] Method value of field-touching method panics when called later
- [ ] Each demonstration is wrapped in its own recover

---

## Task 12 — Build a Simple Optional Type

**Difficulty**: Advanced
**Topic**: Avoiding `*T` for "optional" data

**Description**: Implement a generic `Option[T]` with methods `Some(v T)`, `None()`, `Get() (T, bool)`, `OrElse(default T) T`. Use it instead of `*T` in a small example.

**Starter Code**:
```go
package main

import "fmt"

type Option[T any] struct {
    value T
    has   bool
}

func Some[T any](v T) Option[T] {
    // TODO
    return Option[T]{}
}

func None[T any]() Option[T] {
    // TODO
    return Option[T]{}
}

func (o Option[T]) Get() (T, bool) {
    // TODO
    var zero T
    return zero, false
}

func (o Option[T]) OrElse(def T) T {
    // TODO
    return def
}

func main() {
    a := Some(42)
    b := None[int]()
    if v, ok := a.Get(); ok {
        fmt.Println("a:", v)
    }
    if _, ok := b.Get(); !ok {
        fmt.Println("b: none")
    }
    fmt.Println("b or 0:", b.OrElse(0))
}
```

**Expected Output**:
```
a: 42
b: none
b or 0: 0
```

**Evaluation Checklist**:
- [ ] `Some(v)` produces an Option that has a value
- [ ] `None[T]()` produces an Option without a value
- [ ] `Get` returns `(value, true)` or `(zero, false)`
- [ ] `OrElse` returns the value or the default
- [ ] No nil pointers involved

---

## Bonus Task — Postmortem Analyzer

**Difficulty**: Advanced
**Topic**: Stack trace parsing

**Description**: Given a multi-line panic output as a string, write `extractPanicLine(s string) (string, error)` that returns the file:line of the function that originated the panic (the frame just below `runtime.sigpanic`).

**Starter Code**:
```go
package main

import (
    "errors"
    "fmt"
    "strings"
)

const sample = `panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x1234]

goroutine 1 [running]:
main.(*User).Greet(...)
        /home/user/code/main.go:15 +0x12
main.main()
        /home/user/code/main.go:25 +0x18
`

func extractPanicLine(s string) (string, error) {
    // TODO: find the first frame after the panic header
    return "", errors.New("not implemented")
}

func main() {
    line, err := extractPanicLine(sample)
    if err != nil {
        fmt.Println("err:", err)
        return
    }
    fmt.Println("first frame:", line)
    _ = strings.SplitN
}
```

**Expected Output**:
```
first frame: /home/user/code/main.go:15
```

**Evaluation Checklist**:
- [ ] Finds the first frame's file:line after the goroutine header
- [ ] Returns an error for malformed input
- [ ] Handles multiple frames (finds the topmost)
- [ ] Uses standard string parsing (no regex required)

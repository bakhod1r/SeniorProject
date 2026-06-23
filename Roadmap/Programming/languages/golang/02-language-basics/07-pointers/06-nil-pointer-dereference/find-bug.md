# Go Nil Pointer Dereference — Find the Bug

## Instructions

Each exercise contains buggy Go code involving nil pointers. Identify the bug, explain why it panics, and provide the corrected code. Difficulty: Easy, Medium, Hard.

---

## Bug 1 (Easy) — Chained Field Access Without Check

```go
package main

import "fmt"

type Address struct {
    City string
}

type Profile struct {
    Address *Address
}

type User struct {
    Profile *Profile
}

func main() {
    u := &User{}
    fmt.Println(u.Profile.Address.City)
}
```

<details>
<summary>Solution</summary>

**Bug**: `u.Profile` is nil (the zero value of `*Profile`). The expression `u.Profile.Address.City` reads `u.Profile`, then attempts to dereference it for `.Address` — panic on the first nil link.

Output:
```
panic: runtime error: invalid memory address or nil pointer dereference
```

**Fix** (option A — guards at each level):
```go
if u != nil && u.Profile != nil && u.Profile.Address != nil {
    fmt.Println(u.Profile.Address.City)
} else {
    fmt.Println("(no city)")
}
```

**Fix** (option B — helper method):
```go
func (u *User) City() string {
    if u == nil || u.Profile == nil || u.Profile.Address == nil {
        return ""
    }
    return u.Profile.Address.City
}
```

**Fix** (option C — flatten the data):
```go
type User struct {
    Name string
    City string // pulled up
}
```

**Key lesson**: Chained pointer field access (`a.b.c.d.e`) panics on any nil link. Refactor data, or guard each level.
</details>

---

## Bug 2 (Easy) — Map of Pointers, Missing Key

```go
package main

import "fmt"

type User struct {
    Name string
}

func main() {
    users := map[string]*User{
        "alice": {Name: "Alice"},
    }
    bob := users["bob"] // not present
    fmt.Println(bob.Name)
}
```

<details>
<summary>Solution</summary>

**Bug**: `users["bob"]` returns `nil` because "bob" is not in the map. The zero value of the value type `*User` is `nil`. `bob.Name` then dereferences nil — panic.

Output:
```
panic: runtime error: invalid memory address or nil pointer dereference
```

**Fix** (option A — comma-ok form):
```go
bob, ok := users["bob"]
if !ok || bob == nil {
    fmt.Println("user not found")
    return
}
fmt.Println(bob.Name)
```

**Fix** (option B — store values, not pointers):
```go
users := map[string]User{ // value type
    "alice": {Name: "Alice"},
}
bob := users["bob"] // returns zero User, not nil
fmt.Println(bob.Name) // empty string, no panic
```

**Key lesson**: Reading a missing key from a map of pointers returns nil. Use comma-ok or store values.
</details>

---

## Bug 3 (Easy) — Unset Pointer Field

```go
package main

import "fmt"

type Box struct {
    p *int
}

func main() {
    b := Box{}
    fmt.Println(*b.p)
}
```

<details>
<summary>Solution</summary>

**Bug**: `Box{}` creates a Box with `p` defaulting to `nil` (the zero value of `*int`). `*b.p` then dereferences nil — panic.

**Fix** (option A — initialize):
```go
v := 42
b := Box{p: &v}
fmt.Println(*b.p)
```

**Fix** (option B — guard):
```go
if b.p != nil {
    fmt.Println(*b.p)
} else {
    fmt.Println("p unset")
}
```

**Fix** (option C — change the field type):
```go
type Box struct {
    v int // zero value 0; no nil possible
}
```

**Key lesson**: Pointer fields default to nil. Either initialize them or check before use.
</details>

---

## Bug 4 (Easy) — Typed Nil Returned as Error

```go
package main

import "fmt"

type MyErr struct{ msg string }

func (e *MyErr) Error() string {
    return e.msg
}

func validate(x int) error {
    var e *MyErr
    if x < 0 {
        e = &MyErr{msg: "negative"}
    }
    return e
}

func main() {
    err := validate(5)
    if err != nil {
        fmt.Println("error:", err.Error())
    } else {
        fmt.Println("ok")
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: When `x = 5`, the function does NOT assign `e`. The variable stays as a nil `*MyErr`. Returning it wraps a nil pointer in the `error` interface — the interface is non-nil because it carries the type tag `*MyErr`.

`err != nil` is true. `err.Error()` dispatches to `(*MyErr).Error` with a nil receiver, which then reads `e.msg` — panic.

Output:
```
panic: runtime error: invalid memory address or nil pointer dereference
```

**Fix** (return bare nil):
```go
func validate(x int) error {
    if x < 0 {
        return &MyErr{msg: "negative"}
    }
    return nil // bare interface nil
}
```

**Fix** (alternative — nil-safe Error method):
```go
func (e *MyErr) Error() string {
    if e == nil {
        return "<nil MyErr>"
    }
    return e.msg
}
```

This avoids the panic, but `err != nil` is still misleadingly true. Always prefer returning bare nil.

**Key lesson**: Never return a typed nil pointer when the function signature is an interface. Return `nil` directly.
</details>

---

## Bug 5 (Medium) — Method on Nil Pointer Reading Field

```go
package main

import "fmt"

type Counter struct {
    n int
}

func (c *Counter) Add(x int) {
    c.n += x
}

func main() {
    var c *Counter
    c.Add(5)
    fmt.Println(c.n)
}
```

<details>
<summary>Solution</summary>

**Bug**: `c` is nil. The method call `c.Add(5)` does not panic at the call site (pointer receiver methods can be invoked on nil receivers). But `Add`'s body says `c.n += x`, which reads and writes the field — panic.

**Fix** (option A — initialize):
```go
c := &Counter{}
c.Add(5)
fmt.Println(c.n)
```

**Fix** (option B — nil-safe method):
```go
func (c *Counter) Add(x int) {
    if c == nil {
        // can't really mutate a nil; might log or no-op
        return
    }
    c.n += x
}
```

A nil-safe `Add` is awkward (you can't mutate the unbacked struct). For setters, prefer to require non-nil and document.

**Fix** (option C — return new Counter for "absent" case):
```go
func (c *Counter) Add(x int) *Counter {
    if c == nil {
        c = &Counter{}
    }
    c.n += x
    return c
}
c = c.Add(5)
```

**Key lesson**: Pointer-receiver methods invoked on nil panic when the body touches fields. Either initialize or make the method nil-safe.
</details>

---

## Bug 6 (Medium) — Nil Slice Index vs Nil Pointer

```go
package main

import "fmt"

func main() {
    var s []int
    fmt.Println(s[0])
}
```

<details>
<summary>Solution</summary>

**Bug**: `s` is a nil slice — its length is 0. Indexing with `s[0]` is **out of range**, not a nil pointer dereference. The panic message differs:

```
panic: runtime error: index out of range [0] with length 0
```

This is related to nil but distinct. A nil slice header has nil pointer + 0 len + 0 cap; iterating with `range` is fine, but indexing is bounds-checked.

**Fix** (option A — guard length):
```go
if len(s) > 0 {
    fmt.Println(s[0])
} else {
    fmt.Println("empty")
}
```

**Fix** (option B — initialize):
```go
s := []int{1, 2, 3}
fmt.Println(s[0])
```

**Key lesson**: Nil slices are valid for `len`, `range`, `append`, but not for indexing. The error message is "index out of range", not "nil pointer dereference".
</details>

---

## Bug 7 (Medium) — Nil Function Variable Called

```go
package main

import "fmt"

type Server struct {
    onStart func()
}

func (s *Server) Start() {
    fmt.Println("starting")
    s.onStart()
}

func main() {
    s := &Server{}
    s.Start()
}
```

<details>
<summary>Solution</summary>

**Bug**: `s.onStart` was never assigned. Its value is `nil`. Calling a nil function value panics with the same message as nil pointer deref:

```
panic: runtime error: invalid memory address or nil pointer dereference
```

(Internally, the call loads the funcval's code pointer, which is reading from address 0 — same fault.)

**Fix** (option A — guard):
```go
func (s *Server) Start() {
    fmt.Println("starting")
    if s.onStart != nil {
        s.onStart()
    }
}
```

**Fix** (option B — default in constructor):
```go
func NewServer() *Server {
    return &Server{
        onStart: func() {}, // no-op default
    }
}
```

**Key lesson**: Calling a nil function variable panics. Set a no-op default or guard.
</details>

---

## Bug 8 (Medium) — Defer with Nil-Safe Wrapping

```go
package main

import (
    "errors"
    "fmt"
)

type WrapErr struct {
    inner error
    op    string
}

func (w *WrapErr) Error() string {
    if w == nil {
        return "<nil>"
    }
    return w.op + ": " + w.inner.Error()
}

func work() (err error) {
    defer func() {
        var w *WrapErr
        if err != nil {
            w = &WrapErr{op: "work", inner: err}
        }
        err = w
    }()
    return errors.New("boom")
}

func main() {
    err := work()
    if err != nil {
        fmt.Println(err.Error())
    } else {
        fmt.Println("ok")
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: When `errors.New("boom")` is returned, the deferred function sets `w` to a real `&WrapErr{...}` and assigns it to `err`. That works fine.

But — change the function to `return nil`:
```go
func work() (err error) {
    defer func() {
        var w *WrapErr
        if err != nil {
            w = &WrapErr{op: "work", inner: err}
        }
        err = w // BUG: when err was nil, w is nil *WrapErr; now err is typed-nil
    }()
    return nil
}
```

In this version, `work` returns nil but the caller's `err != nil` is true (typed nil interface). If `WrapErr.Error` were not nil-safe, calling `err.Error()` would panic.

**Fix** — only assign `w` to err if it's actually non-nil:
```go
defer func() {
    if err != nil {
        err = &WrapErr{op: "work", inner: err}
    }
}()
```

**Key lesson**: A deferred wrapper that always assigns its result back to `err` can introduce typed-nil bugs. Only wrap real errors; leave nil as bare nil.
</details>

---

## Bug 9 (Medium) — Pointer-Receiver Method NOT Nil-Safe

```go
package main

import "fmt"

type List struct {
    head *Node
    n    int
}

type Node struct {
    val  int
    next *Node
}

func (l *List) First() int {
    return l.head.val
}

func main() {
    var l *List
    fmt.Println(l.First())
}
```

<details>
<summary>Solution</summary>

**Bug**: `l` is nil. Calling `l.First()` is fine until the body executes. Then `l.head` requires reading the field through the nil receiver — panic.

Even if `l` were non-nil but had `head == nil`, the body would dereference nil head and panic.

**Fix**:
```go
func (l *List) First() (int, bool) {
    if l == nil || l.head == nil {
        return 0, false
    }
    return l.head.val, true
}
```

**Key lesson**: Pointer-receiver methods that read fields are NOT nil-safe by default. Add the guard explicitly.
</details>

---

## Bug 10 (Hard) — Database Pointer Used Without Check

```go
package main

import (
    "database/sql"
    "log"
)

var db *sql.DB

func init() {
    var err error
    db, err = sql.Open("sqlite3", "file:test.db")
    if err != nil {
        log.Println(err)
        return
    }
}

func Query(id string) (string, error) {
    var name string
    err := db.QueryRow("SELECT name FROM users WHERE id = ?", id).Scan(&name)
    return name, err
}

func main() {
    name, err := Query("1")
    if err != nil {
        log.Println(err)
    }
    log.Println(name)
}
```

<details>
<summary>Solution</summary>

**Bug 1**: If `sql.Open` fails (rare but possible), `init` logs the error but does NOT panic and does NOT prevent later use of `db`. `db` becomes nil. `db.QueryRow` panics.

**Bug 2**: Even when `sql.Open` "succeeds", it does not actually connect — the connection is lazy. So discovery of "wrong driver" / "bad DSN" happens later. But for THIS specific bug, the `db` pointer is non-nil even on misconfiguration; the panic moves to `db.Ping()` or query time with a real driver error.

**Bug 3**: The `init` function is called automatically; if `sqlite3` driver is not registered (e.g., not imported), `sql.Open` returns `(nil, err)`. The if-block runs, prints the error, returns. `db` remains nil. Subsequent `db.QueryRow` panics.

**Fix** (option A — fatal init):
```go
func init() {
    var err error
    db, err = sql.Open("sqlite3", "...")
    if err != nil {
        log.Fatal(err) // hard fail; process won't start
    }
}
```

**Fix** (option B — explicit nil check):
```go
func Query(id string) (string, error) {
    if db == nil {
        return "", errors.New("db not initialized")
    }
    // ...
}
```

**Fix** (option C — encapsulate, no global):
```go
type Repo struct {
    db *sql.DB
}

func NewRepo(dsn string) (*Repo, error) {
    db, err := sql.Open("sqlite3", dsn)
    if err != nil {
        return nil, err
    }
    return &Repo{db: db}, nil
}
```

**Key lesson**: Lazy global pointers initialized in `init` are nil panic factories. Either fail-fast in init or check before use. Better: avoid globals.
</details>

---

## Bug 11 (Hard) — Slice of Pointers with Nil Entries

```go
package main

import "fmt"

type Item struct {
    Value int
}

func newItems(n int) []*Item {
    items := make([]*Item, n)
    for i := 0; i < n; i++ {
        if i%3 == 0 {
            items[i] = &Item{Value: i}
        }
        // else: leave nil
    }
    return items
}

func sum(items []*Item) int {
    total := 0
    for _, it := range items {
        total += it.Value
    }
    return total
}

func main() {
    items := newItems(10)
    fmt.Println(sum(items))
}
```

<details>
<summary>Solution</summary>

**Bug**: `newItems` only populates 1 in every 3 slots; the rest are nil. `sum` iterates all and dereferences `it.Value` — panics on the first nil.

**Fix** (option A — guard in sum):
```go
func sum(items []*Item) int {
    total := 0
    for _, it := range items {
        if it == nil {
            continue
        }
        total += it.Value
    }
    return total
}
```

**Fix** (option B — fix newItems to only return non-nils):
```go
func newItems(n int) []*Item {
    items := make([]*Item, 0, n)
    for i := 0; i < n; i++ {
        if i%3 == 0 {
            items = append(items, &Item{Value: i})
        }
    }
    return items
}
```

**Fix** (option C — use values, not pointers):
```go
type Item struct {
    Value int
    Valid bool
}
items := make([]Item, n) // pre-zeroed; .Valid distinguishes
```

**Key lesson**: Slices of pointers can carry nil entries. Either filter at construction or guard at use.
</details>

---

## Bug 12 (Hard) — Nil-Aware Wrapping with Sentinels

```go
package main

import (
    "errors"
    "fmt"
)

var ErrNotFound = errors.New("not found")

type ContextErr struct {
    cause error
    op    string
}

func (e *ContextErr) Error() string {
    return fmt.Sprintf("%s: %v", e.op, e.cause)
}

func (e *ContextErr) Unwrap() error {
    return e.cause
}

func fetch(id string) error {
    var ctx *ContextErr
    if id == "" {
        ctx = &ContextErr{op: "fetch", cause: ErrNotFound}
    }
    return ctx
}

func main() {
    err := fetch("123")
    if err != nil {
        fmt.Println("got error:", err)
    } else {
        fmt.Println("ok")
    }

    if errors.Is(err, ErrNotFound) {
        fmt.Println("specifically not found")
    }
}
```

<details>
<summary>Solution</summary>

**Bug**: `fetch("123")` does NOT enter the `if id == ""` branch, so `ctx` remains a nil `*ContextErr`. Returning it as `error` creates a typed-nil interface. `err != nil` is true.

The "got error" path is taken even though no error occurred. `err` prints something like `<nil>` because `fmt`'s formatter calls `Error()` on a nil receiver — which itself may panic if `Error` reads fields. (In this code, it does read `e.op` and `e.cause`, so it panics.)

**Fix**:
```go
func fetch(id string) error {
    if id == "" {
        return &ContextErr{op: "fetch", cause: ErrNotFound}
    }
    return nil // bare nil
}
```

**Key lesson**: Sentinel-wrapped errors must return bare nil for the success case. Combining typed-nil assignment with `Error()` that reads fields produces a panic surprise.
</details>

---

## Bonus Bug (Hard) — Pre-Initialized Map of Pointers, Sometimes Modified

```go
package main

import (
    "fmt"
    "sync"
)

type Cache struct {
    mu    sync.RWMutex
    items map[string]*Item
}

type Item struct {
    Value int
}

func NewCache() *Cache {
    return &Cache{items: map[string]*Item{}}
}

func (c *Cache) Get(k string) *Item {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.items[k]
}

func (c *Cache) Set(k string, v *Item) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[k] = v
}

func (c *Cache) Delete(k string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[k] = nil
}

func main() {
    c := NewCache()
    c.Set("a", &Item{Value: 1})
    c.Delete("a")
    if v := c.Get("a"); v != nil {
        fmt.Println(v.Value)
    } else {
        fmt.Println("absent")
    }
    fmt.Println("size:", len(c.items))
}
```

<details>
<summary>Solution</summary>

**Bug**: `Delete` sets the value to nil instead of removing the key. The map still has the key, but its value is nil.

The user code checks `if v != nil` before using, so no panic — but consider another caller:

```go
func (c *Cache) GetValue(k string) int {
    return c.Get(k).Value // assumes non-nil
}
```

After `Delete("a")`, `Get("a")` returns nil; `GetValue` panics.

Also, `len(c.items)` reports 1, not 0 — the key is still there.

**Fix**:
```go
func (c *Cache) Delete(k string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    delete(c.items, k) // proper removal
}
```

**Key lesson**: Setting a map entry to nil is not the same as deleting it. Subsequent code that assumes "Get returns nil only if key absent" gets confused by stored nils.
</details>

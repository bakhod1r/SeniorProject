# Structs — Find the Bug

Each exercise contains a bug. Identify it, explain the problem, and provide the fix.

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Bug 1 🟢 — The Copy Mutation

```go
package main

import "fmt"

type Rectangle struct {
    Width  float64
    Height float64
}

func doubleSize(r Rectangle) {
    r.Width *= 2
    r.Height *= 2
    fmt.Println("Inside:", r.Width, r.Height)
}

func main() {
    rect := Rectangle{Width: 5, Height: 3}
    doubleSize(rect)
    fmt.Println("Outside:", rect.Width, rect.Height)
    // Expected: Outside: 10 6
    // Got: ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `doubleSize` takes a value receiver (copy). Modifications to `r` inside the function don't affect the original `rect`. The caller's struct is unchanged.

**Output:**
```
Inside:  10 6
Outside: 5 3  ← original unchanged!
```

**Fix:**
```go
// Option 1: pointer receiver
func doubleSize(r *Rectangle) {
    r.Width *= 2
    r.Height *= 2
}

func main() {
    rect := Rectangle{Width: 5, Height: 3}
    doubleSize(&rect)
    fmt.Println("Outside:", rect.Width, rect.Height) // 10 6
}

// Option 2: return new value (functional style)
func doubleSize(r Rectangle) Rectangle {
    r.Width *= 2
    r.Height *= 2
    return r
}

func main() {
    rect := Rectangle{Width: 5, Height: 3}
    rect = doubleSize(rect) // explicitly reassign
    fmt.Println(rect.Width, rect.Height) // 10 6
}
```
</details>

---

## Bug 2 🟢 — The Nil Pointer Dereference

```go
package main

import "fmt"

type Node struct {
    Value int
    Next  *Node
}

func printList(n *Node) {
    for n != nil {
        fmt.Println(n.Value)
        n = n.Next
    }
}

func main() {
    n1 := Node{Value: 1}
    n2 := Node{Value: 2}
    n1.Next = &n2

    // Add third node
    n3 := &Node{Value: 3}
    n2.Next = n3

    // Try to print 4th value
    fmt.Println(n3.Next.Value) // BUG
    printList(&n1)
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `n3.Next` is `nil` (n3 has no next node). Accessing `n3.Next.Value` is a nil pointer dereference — **panic at runtime**.

**Fix:**
```go
// Always check before dereferencing
if n3.Next != nil {
    fmt.Println(n3.Next.Value)
} else {
    fmt.Println("no fourth node")
}

// Or use the recursive/iterative pattern with nil guard:
// printList already handles this correctly with for n != nil
```

**General rule:** Always check `*T != nil` before accessing fields through a pointer, especially for user-provided data or linked data structures.
</details>

---

## Bug 3 🟢 — Positional Struct Literal Breakage

```go
package main

import "fmt"

// Version 1 of the struct
type Config struct {
    Host string
    Port int
}

func newDefaultConfig() Config {
    return Config{"localhost", 8080}  // positional initialization
}

// Later, someone adds a field:
// type Config struct {
//     Host    string
//     Port    int
//     Timeout int  // NEW FIELD
// }

func main() {
    cfg := newDefaultConfig()
    fmt.Println(cfg.Host, cfg.Port)
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** Using positional struct literals (`Config{"localhost", 8080}`) is fragile. When a new field `Timeout` is added, `Config{"localhost", 8080}` becomes `Config{Host: "localhost", Port: 8080, Timeout: 0}` — but the compile error appears because the literal now has too few arguments for the positional form. Worse: if fields are reordered, `Port` gets "localhost" (a compile error if types differ, but a silent bug if compatible).

**Fix: Always use named field initialization**
```go
func newDefaultConfig() Config {
    return Config{
        Host:    "localhost",
        Port:    8080,
        Timeout: 30, // explicitly handle the new field
    }
}
```

Named literals are immune to field additions and reordering. The `go vet` tool warns about composite literal using fields from a different type definition.
</details>

---

## Bug 4 🟡 — The Shared Slice in Copied Struct

```go
package main

import "fmt"

type Team struct {
    Name    string
    Members []string
}

func main() {
    team1 := Team{
        Name:    "Alpha",
        Members: []string{"Alice", "Bob"},
    }

    // Create team2 as a copy of team1, then rename it
    team2 := team1
    team2.Name = "Beta"
    team2.Members = append(team2.Members, "Carol")

    fmt.Println("Team1:", team1.Name, team1.Members)
    fmt.Println("Team2:", team2.Name, team2.Members)
    // Expected:
    // Team1: Alpha [Alice Bob]
    // Team2: Beta [Alice Bob Carol]
    // Actual: ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** When `team2 := team1`, the `Members` slice header is copied — but both headers point to the SAME underlying array. The `append` in `team2.Members = append(team2.Members, "Carol")` may or may not cause a problem:

- If the underlying array has capacity: `Carol` is written to the shared array, `team1.Members` is unaffected in terms of its length/pointer, but the data at `team1.Members[2]` (beyond team1's length) now exists. No visible bug here since team1's length is still 2.
- BUT: if the slice had capacity 2 (len=cap=2), `append` allocates a new array — team2 gets its own copy, team1 is unaffected. This works correctly.

The actual bug is more subtle: `team2.Members[0] = "Eve"` would modify team1's members too:

```go
team2.Members[0] = "Eve" // modifies shared underlying array!
fmt.Println(team1.Members[0]) // "Eve" — team1 is affected!
```

**Fix: Deep copy the slice**
```go
team2 := Team{
    Name:    team1.Name,
    Members: make([]string, len(team1.Members)),
}
copy(team2.Members, team1.Members)
team2.Name = "Beta"
team2.Members = append(team2.Members, "Carol")
```
</details>

---

## Bug 5 🟡 — The Value Method Trying to Modify State

```go
package main

import "fmt"

type Counter struct {
    count int
    name  string
}

func (c Counter) Increment() {
    c.count++ // tries to increment
}

func (c Counter) GetCount() int {
    return c.count
}

func main() {
    c := Counter{name: "page_views"}
    c.Increment()
    c.Increment()
    c.Increment()
    fmt.Println(c.name, ":", c.GetCount()) // Expected: 3, Got: ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `Increment` uses a value receiver — it receives a copy of `Counter`. `c.count++` increments the copy, which is discarded when the method returns. The original `c.count` is never changed.

**Output:** `page_views : 0` — always 0!

**Fix:**
```go
func (c *Counter) Increment() {
    c.count++ // modifies the original
}

func (c *Counter) GetCount() int {
    return c.count
}

func main() {
    c := &Counter{name: "page_views"} // use pointer
    c.Increment()
    c.Increment()
    c.Increment()
    fmt.Println(c.name, ":", c.GetCount()) // page_views : 3
}
```

**Rule:** If a method modifies fields, it MUST use a pointer receiver.
</details>

---

## Bug 6 🟡 — The Typed Nil Return

```go
package main

import "fmt"

type DBError struct {
    Code    int
    Message string
}

func (e *DBError) Error() string {
    return fmt.Sprintf("DB[%d]: %s", e.Code, e.Message)
}

func queryUser(id int) *DBError {
    if id <= 0 {
        return &DBError{Code: 400, Message: "invalid id"}
    }
    // success — no error
    return nil
}

func main() {
    var err error = queryUser(1) // assign *DBError to error interface
    if err != nil {
        fmt.Println("Error:", err) // Does this print?
    } else {
        fmt.Println("Success")
    }
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `queryUser(1)` returns `nil` (typed `*DBError`). When this is assigned to `var err error`, the interface value becomes `{type: *DBError, value: nil}` — which is **NOT a nil interface**.

So `err != nil` is `true`, and `fmt.Println("Error:", err)` prints `"Error: <nil>"`.

**Fix:** Change the function signature to return `error`:
```go
func queryUser(id int) error {
    if id <= 0 {
        return &DBError{Code: 400, Message: "invalid id"}
    }
    return nil // returns nil interface, not typed nil
}

func main() {
    err := queryUser(1)
    if err != nil {
        fmt.Println("Error:", err)
    } else {
        fmt.Println("Success") // correctly reaches here
    }
}
```

**Golden rule:** At interface boundaries, always return `nil` (untyped), never a typed nil pointer.
</details>

---

## Bug 7 🟡 — The Mutex Copy

```go
package main

import (
    "fmt"
    "sync"
)

type SafeMap struct {
    mu   sync.Mutex
    data map[string]int
}

func NewSafeMap() SafeMap {
    return SafeMap{data: make(map[string]int)}
}

func (sm SafeMap) Set(key string, val int) {
    sm.mu.Lock()
    defer sm.mu.Unlock()
    sm.data[key] = val
}

func (sm SafeMap) Get(key string) (int, bool) {
    sm.mu.Lock()
    defer sm.mu.Unlock()
    v, ok := sm.data[key]
    return v, ok
}

func main() {
    m := NewSafeMap()
    m.Set("a", 1)
    v, ok := m.Get("a")
    fmt.Println(v, ok) // Expected: 1 true — but what actually happens?
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** Three issues:
1. `Set` uses a value receiver — receives a COPY of SafeMap including the mutex. Modifications to `sm.data["a"] = val` modify the copied map header... but `sm.data` and `m.data` share the same underlying hash table, so the write works. However, the mutex protection is on a COPY — the original mutex `m.mu` is never locked!
2. `Get` has the same value receiver problem with mutex.
3. `go vet` reports: "Set passes lock by value: SafeMap contains sync.Mutex"

The real danger: two goroutines calling `Set` concurrently will both use different copies of the mutex — both can Lock() simultaneously, causing data race on the map.

**Fix:**
```go
type SafeMap struct {
    mu   sync.Mutex
    data map[string]int
}

func NewSafeMap() *SafeMap {        // return pointer!
    return &SafeMap{data: make(map[string]int)}
}

func (sm *SafeMap) Set(key string, val int) { // pointer receiver
    sm.mu.Lock()
    defer sm.mu.Unlock()
    sm.data[key] = val
}

func (sm *SafeMap) Get(key string) (int, bool) { // pointer receiver
    sm.mu.Lock()
    defer sm.mu.Unlock()
    v, ok := sm.data[key]
    return v, ok
}
```
</details>

---

## Bug 8 🟡 — Map Value Not Addressable

```go
package main

import "fmt"

type Stats struct {
    Count int
    Total float64
}

func (s *Stats) AddSample(v float64) {
    s.Count++
    s.Total += v
}

func main() {
    statsByKey := map[string]Stats{
        "requests": {Count: 0, Total: 0},
    }

    // Record some requests
    statsByKey["requests"].AddSample(1.5)
    statsByKey["requests"].AddSample(2.0)

    fmt.Println(statsByKey["requests"])
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `statsByKey["requests"]` returns a non-addressable value. You cannot call a pointer-receiver method on it. This is a **compile error**:
```
cannot call pointer method AddSample on Stats
```

Even if you could get a pointer, any modification wouldn't persist back to the map.

**Fix 1: Store pointers in the map**
```go
statsByKey := map[string]*Stats{
    "requests": {Count: 0, Total: 0},
}

statsByKey["requests"].AddSample(1.5)
statsByKey["requests"].AddSample(2.0)
fmt.Println(*statsByKey["requests"])
```

**Fix 2: Read-modify-write**
```go
s := statsByKey["requests"]
s.Count++
s.Total += 1.5
statsByKey["requests"] = s // put back
```

**Fix 3: Make AddSample a value receiver that returns a new value**
```go
func (s Stats) AddSample(v float64) Stats {
    s.Count++
    s.Total += v
    return s
}

statsByKey["requests"] = statsByKey["requests"].AddSample(1.5)
```
</details>

---

## Bug 9 🔴 — The Struct Embedding Method Shadow

```go
package main

import "fmt"

type Base struct {
    ID int
}

func (b Base) Describe() string {
    return fmt.Sprintf("Base{ID: %d}", b.ID)
}

type Extended struct {
    Base
    Name string
}

func (e Extended) Describe() string {
    return fmt.Sprintf("Extended{ID: %d, Name: %s}", e.ID, e.Name)
}

type Printer interface {
    Describe() string
}

func printAll(items []Printer) {
    for _, item := range items {
        fmt.Println(item.Describe())
    }
}

func main() {
    items := []Printer{
        Base{ID: 1},
        Extended{Base: Base{ID: 2}, Name: "Alice"},
    }
    printAll(items)

    // Now something subtle:
    bases := []Base{
        {ID: 10},
        Extended{Base: Base{ID: 20}, Name: "Bob"}.Base, // extract just the Base
    }
    for _, b := range bases {
        fmt.Println(b.Describe()) // What does this print for both?
    }
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug/Tricky behavior:** This isn't a compile error, but demonstrates a subtle Go behavior.

`Extended{...}.Base` extracts just the `Base` part of the Extended struct. When you iterate `bases` and call `b.Describe()`, you always call `Base.Describe()` — not `Extended.Describe()` — because the slice holds `Base` values, not `Extended`.

This is **Go's non-polymorphic value semantics**. Unlike Java/Python, Go does NOT have virtual dispatch. When you extract `Extended.Base`, you lose the `Extended` type information.

**Output:**
```
Base{ID: 10}
Base{ID: 20}  // NOT "Extended{ID: 20, Name: Bob}" — lost Name!
```

**Fix for polymorphic behavior: use interfaces**
```go
describeables := []Printer{
    Base{ID: 10},
    Extended{Base: Base{ID: 20}, Name: "Bob"},
}
for _, d := range describeables {
    fmt.Println(d.Describe()) // virtual dispatch via interface
}
// Base{ID: 10}
// Extended{ID: 20, Name: Bob}  // correct!
```

**Key insight:** In Go, "polymorphism" only happens through interfaces, not through struct embedding.
</details>

---

## Bug 10 🔴 — The Field Alignment Panic on 32-bit

```go
package main

import (
    "fmt"
    "sync/atomic"
)

type Metrics struct {
    name    string
    counter int64 // needs 8-byte alignment
    active  bool
}

type Server struct {
    host    string
    metrics Metrics // metrics.counter may not be 8-byte aligned!
}

func (m *Metrics) Increment() {
    atomic.AddInt64(&m.counter, 1)
}

func main() {
    s := Server{
        host: "localhost",
        metrics: Metrics{name: "requests"},
    }
    s.metrics.Increment()
    fmt.Println("Count:", s.metrics.counter)
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** On 32-bit platforms (ARM, x86), `atomic.AddInt64` requires the `int64` field to be 8-byte aligned. The actual offset of `metrics.counter` within `Server` depends on the layout:

```
Server.host:             offset 0  (string: ptr+len = 8 bytes on 32-bit)
Server.metrics:          offset 8
  metrics.name:          offset 8  (ptr+len = 8 bytes)
  metrics.counter:       offset 16 (8-byte aligned — OK on this layout)
  metrics.active:        offset 24
```

The alignment may be fine here, but if `name` (string = 8 bytes on 32-bit) and `counter` are at offset 8+8=16 (divisible by 8), it works. But if `bool` fields appear before `int64` in nested structs, alignment can break.

The safe fix: always put `int64` fields first in any struct that uses atomic operations, especially when the struct is embedded.

**Fix:**
```go
// Place int64 field first — guaranteed 8-byte aligned
type Metrics struct {
    counter int64 // FIRST — always 8-byte aligned
    name    string
    active  bool
}

// Or: use sync/atomic.Int64 (Go 1.19+) which handles alignment internally
import "sync/atomic"

type Metrics struct {
    counter atomic.Int64 // built-in alignment guarantee
    name    string
    active  bool
}

func (m *Metrics) Increment() {
    m.counter.Add(1)
}
```
</details>

---

## Bug 11 🔴 — The Interface Embedding Nil Panic

```go
package main

import (
    "fmt"
    "io"
)

type BufferedReader struct {
    io.Reader // embedded interface — nil by default!
    buf       []byte
}

func NewBufferedReader(r io.Reader) *BufferedReader {
    if r == nil {
        return &BufferedReader{} // forgot to set Reader field!
    }
    return &BufferedReader{Reader: r, buf: make([]byte, 4096)}
}

func (br *BufferedReader) ReadAll() ([]byte, error) {
    if len(br.buf) == 0 {
        br.buf = make([]byte, 4096)
    }
    n, err := br.Read(br.buf) // calls embedded Reader.Read()
    if err == io.EOF {
        return br.buf[:n], nil
    }
    return br.buf[:n], err
}

func main() {
    // Case 1: valid reader
    br := NewBufferedReader(strings.NewReader("hello"))
    data, err := br.ReadAll()
    fmt.Println(string(data), err)

    // Case 2: nil reader passed
    br2 := NewBufferedReader(nil) // creates BufferedReader with nil Reader
    data2, err2 := br2.ReadAll() // PANIC
    fmt.Println(string(data2), err2)
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** When `r == nil`, `NewBufferedReader` returns `&BufferedReader{}` with the embedded `io.Reader` field as `nil`. Calling `br.Read(br.buf)` (promoted from embedded Reader) panics with "nil pointer dereference" because it tries to call the `Read` method on a nil interface.

**Fix:**
```go
func NewBufferedReader(r io.Reader) (*BufferedReader, error) {
    if r == nil {
        return nil, errors.New("reader must not be nil")
    }
    return &BufferedReader{Reader: r, buf: make([]byte, 4096)}, nil
}

// Or: add a nil guard in ReadAll
func (br *BufferedReader) ReadAll() ([]byte, error) {
    if br.Reader == nil {
        return nil, errors.New("no reader configured")
    }
    if len(br.buf) == 0 {
        br.buf = make([]byte, 4096)
    }
    n, err := br.Read(br.buf)
    if err == io.EOF {
        return br.buf[:n], nil
    }
    return br.buf[:n], err
}
```

**Key lesson:** When embedding an interface, the field starts as `nil`. Always initialize it or guard against nil access.
</details>

---

## Bug 12 🔴 — The Concurrent Map Struct with Wrong Mutex Scope

```go
package main

import (
    "fmt"
    "sync"
)

type UserCache struct {
    users map[string]User
    mu    sync.RWMutex
}

type User struct {
    Name  string
    Email string
}

func (c *UserCache) GetOrCreate(name string) *User {
    c.mu.RLock()
    if u, ok := c.users[name]; ok {
        c.mu.RUnlock()
        return &u // BUG: returning pointer to local variable!
    }
    c.mu.RUnlock()

    newUser := User{Name: name, Email: name + "@example.com"}

    c.mu.Lock()
    // BUG: double-check missing — another goroutine may have inserted between RUnlock and Lock!
    c.users[name] = newUser
    c.mu.Unlock()

    return &newUser // BUG: returning pointer to local variable!
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug 1:** `return &u` — `u` is a local copy of the map value (struct copy). The pointer `&u` points to a stack variable that is invalid after the function returns.

**Bug 2:** After `c.mu.RUnlock()` and before `c.mu.Lock()`, another goroutine may have already inserted the same user. Without a double-check under the write lock, we'll overwrite the existing user.

**Bug 3:** `return &newUser` — same issue as Bug 1: returning pointer to local variable.

**Fix:**
```go
type UserCache struct {
    users map[string]*User  // store pointers to avoid copy issues
    mu    sync.RWMutex
}

func (c *UserCache) GetOrCreate(name string) *User {
    // Check with read lock first
    c.mu.RLock()
    if u, ok := c.users[name]; ok {
        c.mu.RUnlock()
        return u // safe: returning stored pointer
    }
    c.mu.RUnlock()

    // Upgrade to write lock with double-check
    c.mu.Lock()
    defer c.mu.Unlock()
    // Double-check: another goroutine may have added it
    if u, ok := c.users[name]; ok {
        return u
    }
    u := &User{Name: name, Email: name + "@example.com"}
    c.users[name] = u
    return u // safe: storing and returning the same pointer
}
```
</details>

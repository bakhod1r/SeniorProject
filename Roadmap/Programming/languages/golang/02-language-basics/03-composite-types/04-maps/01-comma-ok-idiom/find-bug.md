# Comma-Ok Idiom — Find the Bug

Each exercise contains a bug. Identify it, explain the problem, and provide the fix.

Difficulty: 🟢 Easy | 🟡 Medium | 🔴 Hard

---

## Bug 1 🟢 — The Missing Check

```go
package main

import "fmt"

func getUserAge(users map[string]int, name string) int {
    age, _ := users[name]
    if age == 0 {
        return -1 // -1 means "user not found"
    }
    return age
}

func main() {
    users := map[string]int{
        "Alice": 30,
        "Bob":   0,  // Bob exists but age is unknown
    }
    fmt.Println(getUserAge(users, "Bob"))   // Expected: 0, Got: ???
    fmt.Println(getUserAge(users, "Carol")) // Expected: -1, Got: ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** The function treats `age == 0` as "not found", but Bob legitimately has `age=0`. This conflates the zero value with absence.

**What happens:**
- `getUserAge(users, "Bob")` → age=0, which hits `if age == 0` → returns -1 (WRONG — Bob exists!)
- `getUserAge(users, "Carol")` → age=0, returns -1 (accidentally correct but for the wrong reason)

**Fix:**
```go
func getUserAge(users map[string]int, name string) (int, bool) {
    age, ok := users[name]
    return age, ok
}

func main() {
    users := map[string]int{
        "Alice": 30,
        "Bob":   0,
    }

    if age, ok := getUserAge(users, "Bob"); ok {
        fmt.Println("Bob's age:", age) // Bob's age: 0
    }

    if _, ok := getUserAge(users, "Carol"); !ok {
        fmt.Println("Carol not found")
    }
}
```

The fix: use `(T, bool)` return and properly propagate the `ok` value.
</details>

---

## Bug 2 🟢 — The Double Lookup

```go
package main

import "fmt"

var priceDB = map[string]float64{
    "apple":  1.5,
    "banana": 0.75,
}

func getPrice(item string) float64 {
    if _, ok := priceDB[item]; ok {
        return priceDB[item] // second lookup
    }
    return 0.0
}

func main() {
    fmt.Println(getPrice("apple"))
    fmt.Println(getPrice("mango"))
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** The function performs two map lookups — one to check existence, one to retrieve the value. This is both wasteful and (in concurrent code) a race condition.

**Problem:** The map could theoretically be modified between the two lookups in a concurrent program. In single-threaded code, it's just inefficient.

**Fix:**
```go
func getPrice(item string) float64 {
    if price, ok := priceDB[item]; ok {
        return price // use the value from the single lookup
    }
    return 0.0
}
```

Rule: **Always use the value from the same lookup that checks existence.**
</details>

---

## Bug 3 🟢 — The Unsafe Assertion

```go
package main

import "fmt"

func process(data interface{}) {
    numbers := data.([]int)
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    fmt.Println("Sum:", sum)
}

func main() {
    process([]int{1, 2, 3})       // works
    process([]string{"a", "b"})   // ???
    process(nil)                   // ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** Using unsafe type assertion `data.([]int)` without comma-ok. Both `process([]string{...})` and `process(nil)` will **panic** at runtime with "interface conversion" error.

**Fix:**
```go
func process(data interface{}) {
    numbers, ok := data.([]int)
    if !ok {
        fmt.Printf("expected []int, got %T\n", data)
        return
    }
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    fmt.Println("Sum:", sum)
}
```

Or even better, return an error:
```go
func process(data interface{}) error {
    numbers, ok := data.([]int)
    if !ok {
        return fmt.Errorf("process: expected []int, got %T", data)
    }
    sum := 0
    for _, n := range numbers {
        sum += n
    }
    fmt.Println("Sum:", sum)
    return nil
}
```
</details>

---

## Bug 4 🟡 — The Nil Map Write

```go
package main

import "fmt"

type Cache struct {
    data map[string]int
}

func (c *Cache) Increment(key string) {
    c.data[key]++
}

func (c *Cache) Get(key string) (int, bool) {
    v, ok := c.data[key]
    return v, ok
}

func main() {
    c := Cache{} // Zero value — data map is nil!
    c.Increment("hits")
    v, ok := c.Get("hits")
    fmt.Println(v, ok)
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `Cache{}` creates a Cache with a nil `data` map. The `Get` method is safe (reading nil map returns zero), but `Increment` writes to a nil map — **panic: assignment to entry in nil map**.

Note: The comma-ok in `Get` is fine — nil map reads are safe. The bug is in the lack of initialization.

**Fix:**
```go
// Option 1: Constructor
func NewCache() *Cache {
    return &Cache{data: make(map[string]int)}
}

// Option 2: Lazy initialization in Increment
func (c *Cache) Increment(key string) {
    if c.data == nil {
        c.data = make(map[string]int)
    }
    c.data[key]++
}

// Option 3: Initialize at struct literal
func main() {
    c := Cache{data: make(map[string]int)}
    c.Increment("hits")
    v, ok := c.Get("hits")
    fmt.Println(v, ok) // 1 true
}
```
</details>

---

## Bug 5 🟡 — The Typed Nil Interface

```go
package main

import "fmt"

type DBError struct {
    Code    int
    Message string
}

func (e *DBError) Error() string {
    return fmt.Sprintf("DB error %d: %s", e.Code, e.Message)
}

func queryDB(fail bool) error {
    var dbErr *DBError
    if fail {
        dbErr = &DBError{Code: 500, Message: "connection lost"}
    }
    return dbErr // always returns dbErr
}

func main() {
    err := queryDB(false)
    if err != nil {
        fmt.Println("Error occurred:", err) // Does this print?
    } else {
        fmt.Println("No error") // Or this?
    }
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `queryDB(false)` returns a `*DBError` typed nil wrapped in an `error` interface. The interface is **not nil** because it has a type component (`*DBError`), even though the value is nil.

Result: "Error occurred: <nil>" is printed — the error check passes even though there's no error!

**Why this happens:**
```
Interface value of (error): { type=*DBError, data=nil }
This is NOT equal to nil interface { type=nil, data=nil }
```

**Fix:**
```go
func queryDB(fail bool) error {
    if fail {
        return &DBError{Code: 500, Message: "connection lost"}
    }
    return nil // returns untyped nil interface
}
```

**Golden rule:** Never return a typed nil at an interface boundary. Either return the concrete type, or return untyped nil.
</details>

---

## Bug 6 🟡 — The Channel Close Race

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    ch := make(chan int, 10)
    var wg sync.WaitGroup

    // Two producers
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 5; j++ {
                ch <- id*10 + j
            }
            close(ch) // Each producer closes the channel
        }(i)
    }

    go func() {
        wg.Wait()
    }()

    for v := range ch {
        fmt.Println(v)
    }
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** Two goroutines both call `close(ch)`. **Closing a channel twice panics**: "close of closed channel".

Also, `close(ch)` is called inside each producer goroutine, so the receiver (range loop) may get closed before all producers finish sending.

**Fix:**
```go
func main() {
    ch := make(chan int, 10)
    var wg sync.WaitGroup

    // Producers send but don't close
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 5; j++ {
                ch <- id*10 + j
            }
        }(i)
    }

    // A separate goroutine waits for all producers, then closes once
    go func() {
        wg.Wait()
        close(ch) // closed exactly once
    }()

    for v := range ch {
        fmt.Println(v)
    }
}
```

**Rule:** Only one goroutine should close a channel. Use `sync.Once` if ownership is unclear.
</details>

---

## Bug 7 🟡 — The Goroutine Leak

```go
package main

import (
    "fmt"
    "time"
)

func worker(jobs <-chan string) {
    for {
        job := <-jobs // no comma-ok!
        fmt.Println("Processing:", job)
        time.Sleep(10 * time.Millisecond)
    }
}

func main() {
    jobs := make(chan string, 5)
    jobs <- "job1"
    jobs <- "job2"
    close(jobs)

    go worker(jobs)
    time.Sleep(100 * time.Millisecond)
    fmt.Println("Done")
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `job := <-jobs` without comma-ok. When the channel is closed and drained, the receive returns the zero value (`""`) immediately, forever. The goroutine loops indefinitely processing empty strings — a **goroutine leak** that also busy-loops, consuming CPU.

**Fix:**
```go
func worker(jobs <-chan string) {
    for {
        job, ok := <-jobs
        if !ok {
            fmt.Println("No more jobs, worker exiting")
            return
        }
        fmt.Println("Processing:", job)
        time.Sleep(10 * time.Millisecond)
    }
}

// Or more idiomatically:
func worker(jobs <-chan string) {
    for job := range jobs {
        fmt.Println("Processing:", job)
        time.Sleep(10 * time.Millisecond)
    }
    fmt.Println("Worker done")
}
```
</details>

---

## Bug 8 🟡 — The Context Type Confusion

```go
package main

import (
    "context"
    "fmt"
)

type userKey string

func WithUser(ctx context.Context, user string) context.Context {
    return context.WithValue(ctx, "user", user) // string key!
}

func GetUser(ctx context.Context) (string, bool) {
    user, ok := ctx.Value(userKey("user")).(string) // userKey type!
    return user, ok
}

func main() {
    ctx := context.Background()
    ctx = WithUser(ctx, "alice")

    user, ok := GetUser(ctx)
    fmt.Printf("user=%q, ok=%v\n", user, ok) // Expected: user="alice", ok=true
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `WithUser` stores the value with a plain `string` key `"user"`, but `GetUser` retrieves with a `userKey("user")` key. In Go's context, keys are compared by type AND value. A `string` key and a `userKey` (custom type) key are **different** even if they have the same underlying value.

Result: `GetUser` returns `("", false)` — the type assertion succeeds on `nil`, returning `ok=false`.

**Fix:** Use the same key type everywhere:
```go
type userKey string

const userCtxKey userKey = "user"

func WithUser(ctx context.Context, user string) context.Context {
    return context.WithValue(ctx, userCtxKey, user)
}

func GetUser(ctx context.Context) (string, bool) {
    user, ok := ctx.Value(userCtxKey).(string)
    return user, ok
}
```

Or use an unexported struct type as the key (best practice):
```go
type userKeyType struct{}

var userCtxKey = userKeyType{}

func WithUser(ctx context.Context, user string) context.Context {
    return context.WithValue(ctx, userCtxKey, user)
}
```
</details>

---

## Bug 9 🔴 — The Select Deadlock

```go
package main

import "fmt"

func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for {
            select {
            case v := <-a: // no comma-ok
                out <- v
            case v := <-b: // no comma-ok
                out <- v
            }
        }
    }()
    return out
}

func main() {
    a := make(chan int, 2)
    b := make(chan int, 2)

    a <- 1
    a <- 2
    b <- 3
    b <- 4

    close(a)
    close(b)

    merged := merge(a, b)
    for v := range merged {
        fmt.Println(v)
    }
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** When `a` and `b` are both closed and drained, `v := <-a` and `v := <-b` return zero values immediately and forever. The goroutine enters a busy loop sending `0, 0, 0, ...` to `out`. The `range merged` loop never ends because `out` is never closed.

Also: `for v := range merged` at the end — `merged` is never closed, so this blocks forever after receiving all real values.

**Fix:**
```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out) // close out when both inputs are done
        for a != nil || b != nil {
            select {
            case v, ok := <-a:
                if !ok {
                    a = nil // disable this case
                    continue
                }
                out <- v
            case v, ok := <-b:
                if !ok {
                    b = nil // disable this case
                    continue
                }
                out <- v
            }
        }
    }()
    return out
}
```

Setting a channel to `nil` in a select prevents it from being selected again — a crucial pattern for merging channels.
</details>

---

## Bug 10 🔴 — The Concurrent Map Race

```go
package main

import (
    "fmt"
    "sync"
)

var counters = map[string]int{}

func increment(key string, wg *sync.WaitGroup) {
    defer wg.Done()
    v, ok := counters[key]
    if ok {
        counters[key] = v + 1
    } else {
        counters[key] = 1
    }
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go increment("hits", &wg)
    }
    wg.Wait()
    fmt.Println("Total hits:", counters["hits"]) // Should be 1000
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** Concurrent read and write to a shared map without synchronization. This is a **data race** that will be caught by `go test -race`. In Go, concurrent map access causes undefined behavior and can panic: "concurrent map read and map write."

The comma-ok pattern itself is not wrong here, but the map access is completely unprotected.

**Fix 1: sync.Mutex**
```go
var (
    counters = map[string]int{}
    mu       sync.Mutex
)

func increment(key string, wg *sync.WaitGroup) {
    defer wg.Done()
    mu.Lock()
    defer mu.Unlock()
    counters[key]++
}
```

**Fix 2: sync.Map**
```go
var counters sync.Map

func increment(key string, wg *sync.WaitGroup) {
    defer wg.Done()
    for {
        v, _ := counters.LoadOrStore(key, 1)
        n := v.(int)
        if counters.CompareAndSwap(key, n, n+1) {
            return
        }
    }
}
```

**Fix 3: atomic (for simple int counting)**
```go
var hits int64

func increment(wg *sync.WaitGroup) {
    defer wg.Done()
    atomic.AddInt64(&hits, 1)
}
```
</details>

---

## Bug 11 🔴 — The Interface Method Dispatch Bug

```go
package main

import "fmt"

type Sizer interface {
    Size() int
}

func printSize(v interface{}) {
    size := v.(Sizer).Size() // unsafe assertion
    fmt.Println("Size:", size)
}

type MySlice []int

func (s MySlice) Size() int { return len(s) }

type Config struct {
    entries map[string]string
}

// Config does NOT implement Sizer

func main() {
    printSize(MySlice{1, 2, 3})      // works
    printSize(Config{})               // ???
    printSize("hello")                // ???
    printSize(nil)                    // ???
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** `v.(Sizer)` panics for any type that doesn't implement `Sizer`. `Config{}`, `"hello"`, and `nil` all cause panics.

**Fix:**
```go
func printSize(v interface{}) {
    sizer, ok := v.(Sizer)
    if !ok {
        fmt.Printf("%T does not implement Sizer\n", v)
        return
    }
    fmt.Println("Size:", sizer.Size())
}
```

**Even better** — use a type switch for multiple fallback behaviors:
```go
func printSize(v interface{}) {
    switch s := v.(type) {
    case Sizer:
        fmt.Println("Size:", s.Size())
    case string:
        fmt.Println("Size (string len):", len(s))
    case nil:
        fmt.Println("Size: nil")
    default:
        fmt.Printf("Cannot determine size of %T\n", v)
    }
}
```
</details>

---

## Bug 12 🔴 — The Stale Cache

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type TTLCache struct {
    mu      sync.RWMutex
    data    map[string]string
    expiry  map[string]time.Time
    ttl     time.Duration
}

func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()

    val, ok := c.data[key]
    if !ok {
        return "", false
    }
    // BUG: Check expiry but still return ok=true if expired
    if exp, hasExp := c.expiry[key]; hasExp && time.Now().After(exp) {
        return val, true // BUG: should return false for expired entries!
    }
    return val, ok
}

func (c *TTLCache) Set(key, val string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = val
    c.expiry[key] = time.Now().Add(c.ttl)
}

func main() {
    cache := &TTLCache{
        data:   make(map[string]string),
        expiry: make(map[string]time.Time),
        ttl:    50 * time.Millisecond,
    }

    cache.Set("token", "abc123")
    time.Sleep(100 * time.Millisecond) // token should be expired

    val, ok := cache.Get("token")
    fmt.Printf("val=%q, ok=%v\n", val, ok) // Expected: val="", ok=false
}
```

<details>
<summary>Bug Explanation & Fix</summary>

**Bug:** The `Get` method returns `(val, true)` even for expired entries. The expiry check sets `ok=true` when the entry is expired — the logic is inverted.

**Fix:**
```go
func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()

    val, ok := c.data[key]
    if !ok {
        return "", false // key doesn't exist
    }

    if exp, hasExp := c.expiry[key]; hasExp && time.Now().After(exp) {
        return "", false // key exists but expired → treat as missing
    }

    return val, true // key exists and is valid
}
```

**Better fix:** Add a cleanup goroutine or use lazy deletion that also removes the key:
```go
func (c *TTLCache) Get(key string) (string, bool) {
    c.mu.Lock() // Need write lock to delete expired
    defer c.mu.Unlock()

    val, ok := c.data[key]
    if !ok {
        return "", false
    }

    if exp, hasExp := c.expiry[key]; hasExp && time.Now().After(exp) {
        delete(c.data, key)
        delete(c.expiry, key)
        return "", false
    }

    return val, true
}
```
</details>

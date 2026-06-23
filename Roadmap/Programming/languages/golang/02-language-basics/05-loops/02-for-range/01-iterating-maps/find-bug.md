# Iterating Maps — Find the Bug

---

## Bug 1 🟢 — Assuming Map Order

```go
package main

import "fmt"

func main() {
    days := map[int]string{
        1: "Monday", 2: "Tuesday", 3: "Wednesday",
        4: "Thursday", 5: "Friday",
    }
    fmt.Println("Week schedule:")
    for day, name := range days {
        fmt.Printf("Day %d: %s\n", day, name)
    }
    // Expected: Day 1 Mon, Day 2 Tue, etc. in order
}
```

<details>
<summary>Solution</summary>

Map iteration is random. Days will print in unpredictable order.

**Fix:**
```go
import "sort"
keys := make([]int, 0, len(days))
for k := range days { keys = append(keys, k) }
sort.Ints(keys)
for _, day := range keys {
    fmt.Printf("Day %d: %s\n", day, days[day])
}
```
</details>

---

## Bug 2 🟢 — Modifying Struct Value via Range Variable

```go
package main

import "fmt"

type Account struct {
    Balance float64
}

func applyInterest(accounts map[string]Account, rate float64) {
    for name, acc := range accounts {
        acc.Balance *= (1 + rate)
        _ = name // "applied" but not saved!
    }
}

func main() {
    accounts := map[string]Account{
        "Alice": {1000.0},
        "Bob":   {2000.0},
    }
    applyInterest(accounts, 0.05)
    fmt.Println(accounts["Alice"].Balance) // expected 1050, gets 1000
}
```

<details>
<summary>Solution</summary>

`acc` is a copy. Modifying it does not affect the map.

**Fix:**
```go
func applyInterest(accounts map[string]Account, rate float64) {
    for name := range accounts {
        acc := accounts[name]
        acc.Balance *= (1 + rate)
        accounts[name] = acc
    }
}
// Or use map[string]*Account to avoid this issue entirely
```
</details>

---

## Bug 3 🟢 — nil Map Write Panic

```go
package main

import "fmt"

func countWords(text string, freq map[string]int) {
    words := splitWords(text)
    for _, w := range words {
        freq[w]++ // PANIC if freq is nil!
    }
}

func splitWords(s string) []string {
    return []string{"hello", "world"}
}

func main() {
    var freq map[string]int // nil map
    countWords("hello world", freq)
    fmt.Println(freq)
}
```

<details>
<summary>Solution</summary>

Writing to a nil map causes a panic: `assignment to entry in nil map`. Reading from nil map is fine (returns zero value), but writing panics.

**Fix:**
```go
freq := make(map[string]int) // initialize first
countWords("hello world", freq)
// Or inside countWords:
// if freq == nil { freq = make(map[string]int) } // but this won't affect caller
```
</details>

---

## Bug 4 🟡 — Deleting Keys Not Found in Range Variable

```go
package main

import "fmt"

func removeExpired(cache map[string]int, expired []string) {
    for key := range cache {
        for _, exp := range expired {
            if key == exp {
                delete(cache, exp) // safe, but...
            }
        }
    }
    // Alternative attempt that's wrong:
    for _, exp := range expired {
        for k := range cache {
            if k == exp {
                // Works but O(n*m) — quadratic!
                delete(cache, k)
            }
        }
    }
}

func main() {
    cache := map[string]int{"a": 1, "b": 2, "c": 3, "d": 4}
    removeExpired(cache, []string{"b", "d"})
    fmt.Println(cache) // expected: map[a:1 c:3]
}
```

<details>
<summary>Solution</summary>

The implementation is O(n×m) — for each cache key, it scans all expired keys. This is quadratic.

**Fix:** Build a set of expired keys first:
```go
func removeExpired(cache map[string]int, expired []string) {
    expSet := make(map[string]struct{}, len(expired))
    for _, k := range expired {
        expSet[k] = struct{}{}
    }
    for k := range cache {
        if _, ok := expSet[k]; ok {
            delete(cache, k) // O(1) lookup — total O(n+m)
        }
    }
}
```
</details>

---

## Bug 5 🟡 — Range Variable Capture in Closures

```go
package main

import "fmt"

func main() {
    actions := map[string]func(){
        "a": nil,
        "b": nil,
        "c": nil,
    }

    for key := range actions {
        key := key // OOPS: re-declared here but then ignored below
        actions[key] = func() {
            fmt.Println(key) // actually uses OUTER key (pre-1.22)
        }
    }
    // ...wait, key := key does shadow. But the issue is:
    // All closures were originally created without the shadow in a common mistake:

    handlers := map[string]func(){}
    for k := range actions {
        handlers[k] = func() {
            fmt.Println(k) // captures k by reference — prints last value
        }
    }
    for _, h := range handlers {
        h() // pre-1.22: all print the same (last) k
    }
}
```

<details>
<summary>Solution</summary>

In pre-Go 1.22, `k` is shared across all closure captures. All closures print the same value (whichever bucket was last).

**Fix:**
```go
for k := range actions {
    k := k // per-iteration copy
    handlers[k] = func() {
        fmt.Println(k) // captures its own k
    }
}
// In Go 1.22+: per-iteration semantics fix this automatically
```
</details>

---

## Bug 6 🟡 — Concurrent Map Write During Range

```go
package main

import (
    "fmt"
    "sync"
)

func updateAll(m map[string]int) {
    var wg sync.WaitGroup
    for k := range m {
        wg.Add(1)
        go func(key string) {
            defer wg.Done()
            m[key]++ // concurrent map write while main goroutine may still be ranging!
        }(k)
    }
    wg.Wait()
    fmt.Println(m)
}

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}
    updateAll(m)
}
```

<details>
<summary>Solution</summary>

The goroutines write to `m` concurrently while the main goroutine might still be ranging over it (or while other goroutines are also writing). This is a data race — fatal `concurrent map read and map write` panic.

**Fix:**
```go
func updateAll(m map[string]int) {
    var mu sync.Mutex
    var wg sync.WaitGroup
    for k := range m {
        k := k
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            m[k]++
            mu.Unlock()
        }()
    }
    wg.Wait()
    fmt.Println(m)
}
```
</details>

---

## Bug 7 🟡 — Adding Keys During Range (Infinite-Like Loop)

```go
package main

import "fmt"

func expandMap(m map[string]int, depth int) {
    for k, v := range m {
        if depth > 0 {
            m[k+"_child"] = v + 1 // adds keys — may iterate them!
        }
    }
}

func main() {
    m := map[string]int{"root": 0}
    expandMap(m, 1)
    fmt.Println(len(m)) // expected 2, may get 2, 3, or more!
}
```

<details>
<summary>Solution</summary>

Newly added keys may or may not be visited during the current range. The function may visit `"root_child"` and add `"root_child_child"`, etc. The behavior is non-deterministic.

**Fix:**
```go
func expandMap(m map[string]int, depth int) {
    toAdd := make(map[string]int)
    for k, v := range m {
        if depth > 0 {
            toAdd[k+"_child"] = v + 1
        }
    }
    for k, v := range toAdd {
        m[k] = v
    }
}
```
</details>

---

## Bug 8 🔴 — Map Used as Cache Key (Non-Deterministic)

```go
package main

import (
    "fmt"
    "strings"
)

var cache = map[string]string{}

func getResult(params map[string]string) string {
    // Build cache key from params
    var sb strings.Builder
    for k, v := range params { // RANDOM ORDER
        sb.WriteString(k + "=" + v + "&")
    }
    key := sb.String()

    if cached, ok := cache[key]; ok {
        return cached
    }
    result := expensiveCompute(params)
    cache[key] = result
    return result
}

func expensiveCompute(p map[string]string) string { return "result" }

func main() {
    params := map[string]string{"a": "1", "b": "2", "c": "3"}
    r1 := getResult(params)
    r2 := getResult(params) // may generate DIFFERENT key!
    fmt.Println(r1 == r2)  // may be false — cache miss!
}
```

<details>
<summary>Solution</summary>

The cache key built from map iteration is non-deterministic. The same params map produces different keys on different calls, making the cache useless.

**Fix:**
```go
import "sort"
func buildKey(params map[string]string) string {
    keys := make([]string, 0, len(params))
    for k := range params { keys = append(keys, k) }
    sort.Strings(keys)
    var sb strings.Builder
    for _, k := range keys {
        sb.WriteString(k + "=" + params[k] + "&")
    }
    return sb.String()
}
```
</details>

---

## Bug 9 🔴 — Snapshot Not Taken, Stale Data

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type Store struct {
    mu   sync.RWMutex
    data map[string]int
}

func (s *Store) ProcessAll() {
    s.mu.RLock()
    keys := make([]string, 0, len(s.data))
    for k := range s.data {
        keys = append(keys, k)
    }
    s.mu.RUnlock()

    // Lock released! Data may change between here and processing
    for _, k := range keys {
        s.mu.RLock()
        v := s.data[k] // k might have been deleted!
        s.mu.RUnlock()
        time.Sleep(1 * time.Millisecond) // simulate processing
        fmt.Println(k, v)
    }
}
```

<details>
<summary>Solution</summary>

Between collecting keys and looking up values, the map can be modified. Keys collected may no longer exist, or values may have changed.

**Fix:** Take a full snapshot under the lock:
```go
func (s *Store) ProcessAll() {
    s.mu.RLock()
    snap := make(map[string]int, len(s.data))
    for k, v := range s.data { // snapshot entire map
        snap[k] = v
    }
    s.mu.RUnlock()

    // Process snapshot — consistent view, no lock needed
    for k, v := range snap {
        fmt.Println(k, v)
    }
}
```
</details>

---

## Bug 10 🔴 — Map Value Pointer Aliasing

```go
package main

import "fmt"

func buildPtrMap(keys []string) map[string]*int {
    m := map[string]*int{}
    shared := 0
    for _, k := range keys {
        m[k] = &shared // ALL entries point to the SAME variable!
        shared++
    }
    return m
}

func main() {
    m := buildPtrMap([]string{"a", "b", "c"})
    for k, v := range m {
        fmt.Printf("%s -> %d\n", k, *v) // all print same value!
    }
}
```

<details>
<summary>Solution</summary>

`shared` is a single variable. All map values point to the same memory location (`&shared`). After the loop, `*v` is `3` (final value of shared) for all entries.

**Fix:**
```go
func buildPtrMap(keys []string) map[string]*int {
    m := map[string]*int{}
    for i, k := range keys {
        val := i // new variable per iteration
        m[k] = &val
    }
    return m
}
// Or:
func buildPtrMap(keys []string) map[string]*int {
    m := map[string]*int{}
    for i, k := range keys {
        i := i // shadow
        m[k] = &i
    }
    return m
}
```
</details>

---

## Bug 11 🔴 — Race in Map Inside Struct Without Embedded Mutex

```go
package main

import (
    "fmt"
    "sync"
)

type EventLog struct {
    events map[string]int
}

var log = &EventLog{events: map[string]int{}}
var wg sync.WaitGroup

func logEvent(name string) {
    wg.Add(1)
    go func() {
        defer wg.Done()
        log.events[name]++ // no protection!
    }()
}

func main() {
    for _, event := range []string{"login", "logout", "login", "purchase"} {
        logEvent(event)
    }
    wg.Wait()
    for event, count := range log.events {
        fmt.Printf("%s: %d\n", event, count)
    }
}
```

<details>
<summary>Solution</summary>

Multiple goroutines write to `log.events` concurrently without any synchronization. This causes a data race and potential fatal panic.

**Fix:**
```go
type EventLog struct {
    mu     sync.Mutex
    events map[string]int
}

func (l *EventLog) Log(name string) {
    l.mu.Lock()
    l.events[name]++
    l.mu.Unlock()
}

// Or use sync.Map:
type EventLog struct {
    events sync.Map
}
func (l *EventLog) Log(name string) {
    actual, _ := l.events.LoadOrStore(name, new(int))
    // ... use atomic for counting
}
```
</details>

---

## Bug 12 🔴 — Incorrect Nil Check for Map Value

```go
package main

import "fmt"

func findUser(db map[string]*User, name string) *User {
    user, _ := db[name]
    if user == nil {
        return nil
    }
    return user
}

type User struct{ Name string }

func main() {
    db := map[string]*User{
        "alice": {Name: "Alice"},
        "bob":   nil, // explicit nil value
    }

    u := findUser(db, "charlie") // key doesn't exist
    fmt.Println(u == nil)        // true — correct

    u2 := findUser(db, "bob")   // key exists, value is nil
    fmt.Println(u2 == nil)      // true — but is this correct? Key EXISTS!
}
```

<details>
<summary>Solution</summary>

The function cannot distinguish between "key not found" and "key found with nil value". Both return `nil`. This can mask bugs where a key was explicitly set to nil.

**Fix:** Use the two-value form:
```go
func findUser(db map[string]*User, name string) (*User, bool) {
    user, ok := db[name]
    return user, ok
}
// Now: findUser(db, "charlie") -> (nil, false) "not found"
//      findUser(db, "bob")     -> (nil, true)  "found, value is nil"
```
</details>

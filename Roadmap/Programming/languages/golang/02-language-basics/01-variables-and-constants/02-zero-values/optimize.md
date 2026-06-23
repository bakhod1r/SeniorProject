# Zero Values — Optimization Exercises

Each exercise presents code that works but can be improved. Your goal is to refactor it to better leverage Go's zero value semantics, reduce allocations, improve performance, or write cleaner code.

---

## Exercise 1: Remove Redundant Zero Initialization

**Problem**: The following code has unnecessary explicit initialization to zero values. Clean it up.

```go
package main

import "fmt"

type GameState struct {
    Score     int
    Lives     int
    Level     int
    Paused    bool
    GameOver  bool
    Player    string
    Inventory []string
    Bonuses   []int
}

func newGame(playerName string) GameState {
    return GameState{
        Score:     0,           // redundant
        Lives:     3,           // meaningful non-zero
        Level:     1,           // meaningful non-zero
        Paused:    false,       // redundant
        GameOver:  false,       // redundant
        Player:    playerName,  // meaningful
        Inventory: []string{},  // possibly redundant (depends on use)
        Bonuses:   []int{},     // possibly redundant (depends on use)
    }
}

func main() {
    state := newGame("Alice")
    fmt.Printf("Score: %d, Lives: %d, Level: %d\n",
        state.Score, state.Lives, state.Level)
}
```

<details>
<summary>Hint</summary>

Which fields have the zero value as their intended starting value? Which genuinely need non-zero initialization? What's the difference between `nil` slice and `[]string{}`?

</details>

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

type GameState struct {
    Score    int
    Lives    int
    Level    int
    Paused   bool
    GameOver bool
    Player   string
    Inventory []string
    Bonuses   []int
}

func newGame(playerName string) GameState {
    return GameState{
        Lives:  3,           // explicitly non-zero
        Level:  1,           // explicitly non-zero
        Player: playerName,  // explicitly set
        // Score:     0     → omit (zero value is correct)
        // Paused:    false  → omit (zero value is correct)
        // GameOver:  false  → omit (zero value is correct)
        // Inventory: nil   → omit (nil slice works with append)
        // Bonuses:   nil   → omit (nil slice works with append)
    }
}

func main() {
    state := newGame("Alice")
    fmt.Printf("Score: %d, Lives: %d, Level: %d\n",
        state.Score, state.Lives, state.Level)
}
```

**Key improvements**:
1. `Score: 0` removed — zero is the correct initial score
2. `Paused: false` removed — zero is the correct initial state
3. `GameOver: false` removed — zero is the correct initial state
4. `Inventory: []string{}` → `nil` — use nil slice instead of empty slice unless JSON `[]` is required
5. `Bonuses: []int{}` → `nil` — same reason

**Impact**: Cleaner code, fewer allocations (nil slice vs `[]string{}` avoids a small allocation per field), clearer intent.

</details>

---

## Exercise 2: Replace Unnecessary Constructor with Zero Value Pattern

**Problem**: This mutex wrapper requires a constructor when it doesn't need one.

```go
package main

import (
    "fmt"
    "sync"
)

type SafeString struct {
    mu  *sync.Mutex  // pointer — unnecessary
    val string
}

func NewSafeString(initial string) *SafeString {
    return &SafeString{
        mu:  &sync.Mutex{},  // unnecessary allocation
        val: initial,
    }
}

func (s *SafeString) Set(val string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.val = val
}

func (s *SafeString) Get() string {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.val
}

func main() {
    s := NewSafeString("hello")
    s.Set("world")
    fmt.Println(s.Get())
}
```

<details>
<summary>Hint</summary>

`sync.Mutex` has a usable zero value (unlocked). Should it be a pointer? Can you remove the `NewSafeString` constructor entirely?

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

// SafeString is a thread-safe string wrapper.
// Zero value is an empty string. No constructor needed.
// A SafeString must not be copied after first use.
type SafeString struct {
    mu  sync.Mutex  // value type — zero = unlocked, ready to use
    val string
}

func (s *SafeString) Set(val string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.val = val
}

func (s *SafeString) Get() string {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.val
}

func main() {
    // No constructor needed!
    var s SafeString
    s.Set("hello")
    s.Set("world")
    fmt.Println(s.Get())  // world

    // Or with initial value directly:
    s2 := SafeString{val: "initial"}
    fmt.Println(s2.Get())  // initial
}
```

**Improvements**:
1. `mu *sync.Mutex` → `mu sync.Mutex`: removes one heap allocation per `SafeString` creation
2. Removed `NewSafeString` constructor: one less function, cleaner API
3. Better cache behavior: mutex is co-located with data (same struct, same cache line)
4. API is now "zero value is usable" — consistent with Go standard library patterns

</details>

---

## Exercise 3: Optimize Counter with sync.Mutex Zero Value

**Problem**: This counter uses unnecessary allocation and an anti-pattern for mutex.

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu    *sync.Mutex
    count map[string]int64
}

func NewCounter() Counter {
    return Counter{
        mu:    new(sync.Mutex),
        count: make(map[string]int64),
    }
}

func (c *Counter) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count[key]++
}

func (c *Counter) Get(key string) int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count[key]
}

func main() {
    c := NewCounter()
    c.Inc("requests")
    c.Inc("requests")
    c.Inc("errors")
    fmt.Println(c.Get("requests"), c.Get("errors"))
}
```

<details>
<summary>Hint</summary>

Embed mutex by value. Use lazy initialization for the map. Remove the constructor.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

// Counter is a thread-safe named counter.
// Zero value is immediately usable.
// A Counter must not be copied after first use.
type Counter struct {
    mu    sync.Mutex      // value type, zero = unlocked
    count map[string]int64 // nil map — initialized lazily
}

func (c *Counter) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if c.count == nil {
        c.count = make(map[string]int64)
    }
    c.count[key]++
}

func (c *Counter) Get(key string) int64 {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count[key]  // safe: nil map read returns 0
}

func main() {
    var c Counter  // no constructor needed
    c.Inc("requests")
    c.Inc("requests")
    c.Inc("errors")
    fmt.Println(c.Get("requests"), c.Get("errors"))  // 2 1
}
```

**Improvements**:
1. `*sync.Mutex` → `sync.Mutex`: eliminates one heap allocation
2. Map initialized lazily: no allocation until first `Inc` call
3. Removed `NewCounter()`: callers can use `var c Counter`
4. `Get` from nil map: safe — returns 0, no panic

**Performance**: In tests where Counter is embedded in a struct, removing the pointer mutex reduces pointer chasing and may improve cache performance.

</details>

---

## Exercise 4: Use bytes.Buffer Zero Value Pattern

**Problem**: Unnecessary initialization of bytes.Buffer.

```go
package main

import (
    "bytes"
    "fmt"
    "strings"
)

func buildQuery(params map[string]string) string {
    buf := bytes.NewBuffer(make([]byte, 0, 256))  // over-engineered
    first := true
    for k, v := range params {
        if !first {
            buf.WriteByte('&')
        }
        buf.WriteString(k)
        buf.WriteByte('=')
        buf.WriteString(v)
        first = false
    }
    return buf.String()
}

type HTMLBuilder struct {
    buf *bytes.Buffer  // pointer — unnecessary
}

func NewHTMLBuilder() *HTMLBuilder {
    return &HTMLBuilder{buf: &bytes.Buffer{}}
}

func (h *HTMLBuilder) Tag(name, content string) *HTMLBuilder {
    fmt.Fprintf(h.buf, "<%s>%s</%s>", name, content, name)
    return h
}

func (h *HTMLBuilder) Build() string {
    return h.buf.String()
}

func main() {
    q := buildQuery(map[string]string{"a": "1", "b": "2"})
    fmt.Println(q)

    html := NewHTMLBuilder().
        Tag("h1", "Hello").
        Tag("p", "World").
        Build()
    fmt.Println(html)
    _ = strings.Contains
}
```

<details>
<summary>Hint</summary>

`bytes.Buffer` zero value is an empty, ready-to-use buffer. You don't need `bytes.NewBuffer`, `new(bytes.Buffer)`, or `&bytes.Buffer{}` — just `var buf bytes.Buffer`.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "bytes"
    "fmt"
)

func buildQuery(params map[string]string) string {
    var buf bytes.Buffer  // zero value = empty buffer, ready to use!
    first := true
    for k, v := range params {
        if !first {
            buf.WriteByte('&')
        }
        buf.WriteString(k)
        buf.WriteByte('=')
        buf.WriteString(v)
        first = false
    }
    return buf.String()
}

// HTMLBuilder uses bytes.Buffer zero value pattern.
// Zero value of HTMLBuilder is ready to use.
// An HTMLBuilder must not be copied after first use.
type HTMLBuilder struct {
    buf bytes.Buffer  // value type, zero = empty buffer
}

func (h *HTMLBuilder) Tag(name, content string) *HTMLBuilder {
    fmt.Fprintf(&h.buf, "<%s>%s</%s>", name, content, name)
    return h
}

func (h *HTMLBuilder) Build() string {
    return h.buf.String()
}

func main() {
    q := buildQuery(map[string]string{"a": "1", "b": "2"})
    fmt.Println(q)

    var html HTMLBuilder
    html.Tag("h1", "Hello").Tag("p", "World")
    fmt.Println(html.Build())
    // <h1>Hello</h1><p>World</p>
}
```

**Improvements**:
1. `bytes.NewBuffer(make([]byte, 0, 256))` → `var buf bytes.Buffer`: no allocation, buffer grows lazily
2. `*bytes.Buffer` (pointer field) → `bytes.Buffer` (value field): removes one heap allocation
3. Removed `NewHTMLBuilder()` constructor: `var html HTMLBuilder` works
4. `fmt.Fprintf(h.buf, ...)` → `fmt.Fprintf(&h.buf, ...)`: using pointer to value (required for interface)

</details>

---

## Exercise 5: Lazy Initialization Instead of Always-Allocate

**Problem**: This service always allocates a map even when it might not be used.

```go
package main

import (
    "fmt"
    "sync"
)

type MetricsService struct {
    mu       sync.Mutex
    counters map[string]int64  // always allocated in constructor
    gauges   map[string]float64 // always allocated in constructor
    timers   map[string][]int64 // always allocated in constructor
}

func NewMetricsService() *MetricsService {
    return &MetricsService{
        counters: make(map[string]int64),
        gauges:   make(map[string]float64),
        timers:   make(map[string][]int64),
    }
}

func (m *MetricsService) IncrCounter(name string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.counters[name]++
}

func (m *MetricsService) GetCounter(name string) int64 {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.counters[name]
}

func main() {
    svc := NewMetricsService()
    svc.IncrCounter("requests")
    fmt.Println(svc.GetCounter("requests"))
}
```

<details>
<summary>Hint</summary>

Initialize each map lazily on first write. Use the zero value of the struct directly. Consider: some programs might only use counters and never use timers — why allocate all maps upfront?

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
)

// MetricsService tracks application metrics.
// Zero value is immediately usable.
// Metrics maps are initialized lazily — only when first used.
type MetricsService struct {
    mu       sync.Mutex
    counters map[string]int64
    gauges   map[string]float64
    timers   map[string][]int64
}

func (m *MetricsService) IncrCounter(name string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.counters == nil {
        m.counters = make(map[string]int64)
    }
    m.counters[name]++
}

func (m *MetricsService) GetCounter(name string) int64 {
    m.mu.Lock()
    defer m.mu.Unlock()
    return m.counters[name]  // safe: nil map read = 0
}

func (m *MetricsService) SetGauge(name string, val float64) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.gauges == nil {
        m.gauges = make(map[string]float64)
    }
    m.gauges[name] = val
}

func (m *MetricsService) RecordTimer(name string, ms int64) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if m.timers == nil {
        m.timers = make(map[string][]int64)
    }
    m.timers[name] = append(m.timers[name], ms)
}

func main() {
    var svc MetricsService  // no constructor needed
    svc.IncrCounter("requests")
    svc.IncrCounter("requests")
    fmt.Println(svc.GetCounter("requests"))  // 2
    // gauges and timers maps never allocated (not used)
}
```

**Benefits**:
1. Programs that only use counters never allocate gauge/timer maps
2. Zero constructor: simpler API
3. Lazy init: reduces memory footprint for partial use
4. Read from nil map is free (returns 0) — no overhead for `GetCounter` on unused metric

</details>

---

## Exercise 6: Avoid Allocation for Optional Return

**Problem**: This function allocates when returning an optional value.

```go
package main

import "fmt"

// findFirst returns the first element matching predicate,
// or an error if not found.
func findFirst(items []int, pred func(int) bool) (*int, error) {
    for _, item := range items {
        if pred(item) {
            v := item  // allocates on heap
            return &v, nil
        }
    }
    return nil, fmt.Errorf("not found")
}

func main() {
    items := []int{1, 2, 3, 4, 5}
    v, err := findFirst(items, func(x int) bool { return x > 3 })
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Found:", *v)
}
```

<details>
<summary>Hint</summary>

Using `(T, bool)` instead of `(*T, error)` avoids an allocation. The zero value of `bool` (false) serves as the "not found" indicator. This is the same pattern as map lookup: `v, ok := m[key]`.

</details>

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

// findFirst returns the first element matching predicate.
// Returns (value, true) if found, (0, false) if not found.
// Uses Go's comma-ok idiom — no allocation.
func findFirst(items []int, pred func(int) bool) (int, bool) {
    for _, item := range items {
        if pred(item) {
            return item, true  // no heap allocation!
        }
    }
    return 0, false  // zero value of int, false = not found
}

func main() {
    items := []int{1, 2, 3, 4, 5}

    v, found := findFirst(items, func(x int) bool { return x > 3 })
    if !found {
        fmt.Println("Not found")
        return
    }
    fmt.Println("Found:", v)  // Found: 4

    // Not found case:
    v2, found2 := findFirst(items, func(x int) bool { return x > 10 })
    fmt.Println("v2:", v2, "found:", found2)  // v2: 0 found: false
}
```

**Improvements**:
1. No heap allocation: return by value instead of pointer
2. Simpler API: `(int, bool)` vs `(*int, error)` — same pattern as map lookup
3. Zero value as sentinel: `0, false` clearly means "not found"
4. Callers don't need to dereference a pointer

**Note**: This pattern works well for value types. For large structs where copying is expensive, returning a pointer may still be appropriate. Always benchmark before optimizing.

</details>

---

## Exercise 7: Replace sync.Once + flag with Atomic

**Problem**: This code uses an unnecessary bool flag alongside sync.Once.

```go
package main

import (
    "fmt"
    "sync"
)

type Config struct {
    once     sync.Once
    loaded   bool    // redundant — sync.Once already tracks this
    mu       sync.Mutex
    settings map[string]string
}

func (c *Config) Load() {
    c.once.Do(func() {
        // Simulate loading config
        c.mu.Lock()
        c.settings = map[string]string{
            "host": "localhost",
            "port": "8080",
        }
        c.loaded = true  // redundant
        c.mu.Unlock()
    })
}

func (c *Config) IsLoaded() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.loaded  // sync.Once already knows this
}

func (c *Config) Get(key string) string {
    c.Load()  // ensure loaded
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.settings[key]
}

func main() {
    var cfg Config
    fmt.Println("Loaded:", cfg.IsLoaded())
    cfg.Load()
    fmt.Println("Loaded:", cfg.IsLoaded())
    fmt.Println("Host:", cfg.Get("host"))
}
```

<details>
<summary>Hint</summary>

`sync.Once` already tracks whether the function has been called. The `loaded bool` flag is redundant. `sync.Once.Do` only calls the function once — the first call runs it, subsequent calls are no-ops.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

// Config loads settings once and provides thread-safe access.
// Zero value is usable — settings are loaded on first Get.
type Config struct {
    once     sync.Once
    mu       sync.Mutex
    settings map[string]string
    // loaded bool  ← REMOVED: redundant with sync.Once
}

func (c *Config) load() {
    c.once.Do(func() {
        c.settings = map[string]string{
            "host": "localhost",
            "port": "8080",
        }
    })
}

func (c *Config) Get(key string) string {
    c.load()  // once.Do ensures this runs only once
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.settings[key]
}

// If you truly need IsLoaded, use atomic:
type ConfigV2 struct {
    once     sync.Once
    loaded   atomic.Bool  // atomic.Bool zero value = false
    mu       sync.Mutex
    settings map[string]string
}

func (c *ConfigV2) load() {
    c.once.Do(func() {
        c.settings = map[string]string{"host": "localhost"}
        c.loaded.Store(true)  // atomic write
    })
}

func (c *ConfigV2) IsLoaded() bool {
    return c.loaded.Load()  // atomic read, no mutex needed
}

func main() {
    var cfg Config
    fmt.Println("Host:", cfg.Get("host"))  // lazy load on first access
    fmt.Println("Port:", cfg.Get("port"))  // returns from cache
}
```

**Improvements**:
1. Removed `loaded bool`: `sync.Once` already tracks this — don't double-track
2. Made `load()` private: callers don't need to call `Load()` explicitly, `Get()` does it
3. If `IsLoaded()` needed: use `atomic.Bool` (zero value = false, no mutex needed for the bool itself)

</details>

---

## Exercise 8: Use nil Slice Return for "No Results"

**Problem**: This code returns an allocated empty slice when there are no results.

```go
package main

import (
    "fmt"
    "strings"
)

func searchUsers(users []string, query string) []string {
    results := make([]string, 0)  // allocates even when no results

    for _, u := range users {
        if strings.Contains(strings.ToLower(u), strings.ToLower(query)) {
            results = append(results, u)
        }
    }

    return results  // returns [] when no matches (allocated empty slice)
}

func main() {
    users := []string{"Alice", "Bob", "Charlie", "David"}

    found := searchUsers(users, "ali")
    fmt.Println("Found:", found)         // [Alice]

    notFound := searchUsers(users, "xyz")
    fmt.Println("Not found:", notFound)  // []
    fmt.Println("Is nil:", notFound == nil)  // false — but costs an allocation
}
```

<details>
<summary>Hint</summary>

Use `var results []string` instead of `make([]string, 0)`. A nil return for "no results" is idiomatic Go. Callers should use `len(results) == 0` to check for empty, not `results == nil`.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "strings"
)

// searchUsers returns matching users, or nil if none found.
// Callers should use len(results) == 0 to check for no results.
func searchUsers(users []string, query string) []string {
    var results []string  // nil slice — no allocation until first match

    lq := strings.ToLower(query)
    for _, u := range users {
        if strings.Contains(strings.ToLower(u), lq) {
            results = append(results, u)  // allocates on first match
        }
    }

    return results  // nil if no matches, slice if some matches
}

func main() {
    users := []string{"Alice", "Bob", "Charlie", "David"}

    found := searchUsers(users, "ali")
    fmt.Println("Found:", found)         // [Alice]

    notFound := searchUsers(users, "xyz")
    fmt.Println("Not found:", notFound)  // []
    fmt.Println("Is nil:", notFound == nil)  // true — no allocation!

    // Correct check (works for both nil and empty):
    if len(notFound) == 0 {
        fmt.Println("No results")
    }
}
```

**Improvements**:
1. `make([]string, 0)` → `var results []string`: no allocation when there are no matches
2. For common case of "no results," this saves an allocation + GC pressure
3. Idiom: return nil for "no results" — the caller uses `len() == 0` not `== nil`

**Benchmark insight**: If 90% of searches return no results, this optimization eliminates 90% of the allocations in `searchUsers`.

</details>

---

## Exercise 9: Reduce Allocations with Zero Value Struct Pattern

**Problem**: This code allocates a struct on the heap when it doesn't need to.

```go
package main

import (
    "fmt"
    "strings"
)

type TextProcessor struct {
    separator   string
    trimSpaces  bool
    toLowerCase bool
    maxLength   int
}

func NewTextProcessor() *TextProcessor {
    return &TextProcessor{  // heap allocation
        separator:   ",",
        trimSpaces:  false,  // redundant
        toLowerCase: false,  // redundant
        maxLength:   0,      // redundant
    }
}

func (p *TextProcessor) WithSeparator(s string) *TextProcessor {
    p.separator = s
    return p
}

func (p *TextProcessor) WithTrim() *TextProcessor {
    p.trimSpaces = true
    return p
}

func (p *TextProcessor) Process(text string) []string {
    parts := strings.Split(text, p.separator)
    var result []string
    for _, part := range parts {
        if p.trimSpaces {
            part = strings.TrimSpace(part)
        }
        if p.toLowerCase {
            part = strings.ToLower(part)
        }
        if p.maxLength > 0 && len(part) > p.maxLength {
            part = part[:p.maxLength]
        }
        if part != "" {
            result = append(result, part)
        }
    }
    return result
}

func main() {
    p := NewTextProcessor()
    result := p.WithSeparator(",").WithTrim().Process("hello , world , go")
    fmt.Println(result)
}
```

<details>
<summary>Hint</summary>

The `separator` field has a non-zero default (","). Can you handle this in the `Process` method? The other fields have correct zero defaults. Can you make the struct's zero value directly usable?

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "strings"
)

// TextProcessor splits and transforms text.
// Zero value uses "," as separator and performs no transformations.
// Use as value type (no pointer needed for most cases).
type TextProcessor struct {
    Separator   string  // "" = use "," (zero value normalized in Process)
    TrimSpaces  bool
    ToLowerCase bool
    MaxLength   int     // 0 = no limit
}

func (p TextProcessor) Process(text string) []string {
    sep := p.Separator
    if sep == "" {
        sep = ","  // normalize zero value
    }

    parts := strings.Split(text, sep)
    var result []string
    for _, part := range parts {
        if p.TrimSpaces {
            part = strings.TrimSpace(part)
        }
        if p.ToLowerCase {
            part = strings.ToLower(part)
        }
        if p.MaxLength > 0 && len(part) > p.MaxLength {
            part = part[:p.MaxLength]
        }
        if part != "" {
            result = append(result, part)
        }
    }
    return result
}

func main() {
    // Zero value usable directly:
    var p TextProcessor
    result := p.Process("hello,world,go")
    fmt.Println(result)  // [hello world go]

    // Struct literal (no constructor needed):
    p2 := TextProcessor{TrimSpaces: true}
    result2 := p2.Process("hello , world , go")
    fmt.Println(result2)  // [hello world go]

    // Value semantics (no pointer):
    p3 := TextProcessor{Separator: "|", ToLowerCase: true}
    result3 := p3.Process("Hello|World|Go")
    fmt.Println(result3)  // [hello world go]
}
```

**Improvements**:
1. Removed `NewTextProcessor()` — zero value struct is directly usable
2. `separator` normalized in `Process()` — zero value ("") means "use comma"
3. Value receiver for `Process` — `TextProcessor` is a small value type, no need for pointer
4. Method chaining replaced with struct literal — more idiomatic Go
5. No heap allocation for the struct itself when used as local variable

</details>

---

## Exercise 10: Proper Use of sync.WaitGroup Zero Value

**Problem**: Unnecessarily wrapping sync.WaitGroup in a struct with a constructor.

```go
package main

import (
    "fmt"
    "sync"
)

type TaskRunner struct {
    wg   *sync.WaitGroup  // pointer — unnecessary
    done bool
}

func NewTaskRunner() *TaskRunner {
    return &TaskRunner{
        wg:   &sync.WaitGroup{},  // unnecessary allocation
        done: false,              // redundant
    }
}

func (r *TaskRunner) Run(f func()) {
    r.wg.Add(1)
    go func() {
        defer r.wg.Done()
        f()
    }()
}

func (r *TaskRunner) Wait() {
    r.wg.Wait()
    r.done = true
}

func (r *TaskRunner) IsDone() bool {
    return r.done
}

func main() {
    runner := NewTaskRunner()

    results := make([]string, 3)
    for i := 0; i < 3; i++ {
        i := i
        runner.Run(func() {
            results[i] = fmt.Sprintf("task-%d", i)
        })
    }

    runner.Wait()
    fmt.Println("Done:", runner.IsDone())
    fmt.Println("Results:", results)
}
```

<details>
<summary>Hint</summary>

`sync.WaitGroup` has a usable zero value. Embed it by value. The `done bool` field can be replaced by simply tracking completion differently, or removed if not needed.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sync"
    "sync/atomic"
)

// TaskRunner runs functions concurrently and waits for completion.
// Zero value is immediately usable.
// A TaskRunner must not be copied after first use.
type TaskRunner struct {
    wg       sync.WaitGroup  // value type — zero = no goroutines pending
    taskCount atomic.Int64   // atomic: no mutex needed for reads
}

func (r *TaskRunner) Run(f func()) {
    r.wg.Add(1)
    r.taskCount.Add(1)
    go func() {
        defer r.wg.Done()
        f()
    }()
}

func (r *TaskRunner) Wait() {
    r.wg.Wait()
}

func (r *TaskRunner) TaskCount() int64 {
    return r.taskCount.Load()
}

func main() {
    var runner TaskRunner  // no constructor needed!

    results := make([]string, 3)
    for i := 0; i < 3; i++ {
        i := i
        runner.Run(func() {
            results[i] = fmt.Sprintf("task-%d", i)
        })
    }

    runner.Wait()
    fmt.Println("Tasks run:", runner.TaskCount())  // 3
    fmt.Println("Results:", results)
}
```

**Improvements**:
1. `*sync.WaitGroup` → `sync.WaitGroup`: removes one heap allocation
2. Removed `NewTaskRunner()`: zero value works
3. `done bool` removed: not needed for the common use case
4. Used `atomic.Int64` for task count (zero value = 0, thread-safe without mutex)
5. Added `TaskCount()` as a useful metric replacement

</details>

---

## Exercise 11: Optimize append Pattern for Known-Size Results

**Problem**: Using nil slice append when the result size is known upfront.

```go
package main

import "fmt"

func doubleAll(nums []int) []int {
    var result []int  // nil slice, will be reallocated multiple times
    for _, n := range nums {
        result = append(result, n*2)
    }
    return result
}

func zipCombine(a, b []int) []string {
    var result []string  // nil slice, reallocated as it grows
    min := len(a)
    if len(b) < min {
        min = len(b)
    }
    for i := 0; i < min; i++ {
        result = append(result, fmt.Sprintf("%d:%d", a[i], b[i]))
    }
    return result
}

func main() {
    nums := make([]int, 10000)
    for i := range nums {
        nums[i] = i
    }

    doubled := doubleAll(nums)
    fmt.Println(len(doubled))  // 10000
}
```

<details>
<summary>Hint</summary>

When you know the output size upfront, use `make([]T, 0, n)` to pre-allocate capacity. This avoids multiple `append`-triggered reallocations. Use nil slice only when size is unknown.

</details>

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

// doubleAll: output size = input size — pre-allocate
func doubleAll(nums []int) []int {
    if len(nums) == 0 {
        return nil  // zero case: return nil (idiomatic)
    }
    result := make([]int, len(nums))  // exact size known: no reallocation
    for i, n := range nums {
        result[i] = n * 2  // direct index assignment (faster than append)
    }
    return result
}

// zipCombine: output size = min(len(a), len(b)) — pre-allocate
func zipCombine(a, b []int) []string {
    min := len(a)
    if len(b) < min {
        min = len(b)
    }
    if min == 0 {
        return nil  // zero case
    }
    result := make([]string, 0, min)  // pre-allocate capacity
    for i := 0; i < min; i++ {
        result = append(result, fmt.Sprintf("%d:%d", a[i], b[i]))
    }
    return result
}

// For filtering (size unknown): nil slice is correct
func filterPositive(nums []int) []int {
    var result []int  // size unknown: nil slice is appropriate
    for _, n := range nums {
        if n > 0 {
            result = append(result, n)
        }
    }
    return result
}

func main() {
    nums := make([]int, 10000)
    for i := range nums {
        nums[i] = i
    }

    doubled := doubleAll(nums)
    fmt.Println(len(doubled))  // 10000

    a := []int{1, 2, 3}
    b := []int{4, 5, 6, 7}
    combined := zipCombine(a, b)
    fmt.Println(combined)  // [1:4 2:5 3:6]
}
```

**When to use nil slice vs pre-allocated:**
| Scenario | Use |
|----------|-----|
| Size unknown, may be 0 | `var result []T` (nil slice) |
| Size unknown, usually > 0 | `make([]T, 0, estimatedSize)` |
| Size exactly known | `make([]T, size)` + index assignment |
| Max size known | `make([]T, 0, maxSize)` |

**Performance**: For `doubleAll` with 10,000 elements, pre-allocation eliminates ~13 reallocation+copy operations (since slice doubles: 1, 2, 4, 8, ..., 8192).

</details>

---

## Exercise 12: Remove Unnecessary nil Checks on Slices

**Problem**: Code has redundant nil checks before operations that already handle nil slices.

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

func processNames(names []string) string {
    // Unnecessary nil check before len
    if names == nil {
        return ""
    }
    if len(names) == 0 {
        return ""
    }

    // Unnecessary nil check before range
    if names != nil {
        for i, n := range names {
            names[i] = strings.TrimSpace(n)
        }
    }

    // Unnecessary nil check before sort
    if names != nil && len(names) > 0 {
        sort.Strings(names)
    }

    // Unnecessary nil check before strings.Join
    if names == nil {
        return ""
    }
    return strings.Join(names, ", ")
}

func countItems(items []int) (sum, count int) {
    if items == nil {
        return 0, 0
    }
    for _, item := range items {
        sum += item
        count++
    }
    return
}

func main() {
    names := []string{"  Charlie  ", "Alice", "  Bob  "}
    fmt.Println(processNames(names))

    var empty []string
    fmt.Println(processNames(empty))

    s, c := countItems(nil)
    fmt.Println(s, c)
}
```

<details>
<summary>Hint</summary>

`len(nil)`, `range nil`, `sort.Strings(nil)`, `strings.Join(nil, sep)` all handle nil slices correctly. Redundant nil checks add noise without benefit.

</details>

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

func processNames(names []string) string {
    // len handles nil: len(nil) == 0
    if len(names) == 0 {
        return ""
    }

    // range handles nil: range nil iterates 0 times
    for i, n := range names {
        names[i] = strings.TrimSpace(n)
    }

    // sort.Strings handles nil: no-op on nil/empty
    sort.Strings(names)

    // strings.Join handles nil: returns "" for nil/empty
    return strings.Join(names, ", ")
}

func countItems(items []int) (sum, count int) {
    // range handles nil: range nil iterates 0 times
    for _, item := range items {
        sum += item
        count++
    }
    return  // sum=0, count=0 if nil (zero values)
}

func main() {
    names := []string{"  Charlie  ", "Alice", "  Bob  "}
    fmt.Println(processNames(names))  // Alice, Bob, Charlie

    var empty []string
    fmt.Println(processNames(empty))  // ""

    s, c := countItems(nil)
    fmt.Println(s, c)  // 0 0
}
```

**Operations that handle nil slices safely:**
| Operation | nil behavior |
|-----------|-------------|
| `len(nil)` | Returns 0 |
| `cap(nil)` | Returns 0 |
| `range nil` | Iterates 0 times |
| `append(nil, x)` | Allocates and appends |
| `copy(dst, nil)` | Copies 0 elements |
| `sort.Strings(nil)` | No-op |
| `strings.Join(nil, sep)` | Returns "" |
| `json.Marshal(nil)` | Returns `null` (not safe to assume!) |

**Exception**: `json.Marshal` of nil produces `null` not `[]` — keep nil checks when JSON behavior matters.

</details>

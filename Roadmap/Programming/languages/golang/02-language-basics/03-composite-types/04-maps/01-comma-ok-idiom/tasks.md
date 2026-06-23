# Comma-Ok Idiom — Practice Tasks

## Task 1: Word Frequency Counter (Beginner)

**Objective:** Use comma-ok to correctly count word frequencies, including words that might appear zero times.

**Requirements:**
- Build a frequency map from a slice of words
- Use comma-ok to safely increment counts
- Implement a `GetCount(word string) (int, bool)` method that returns the count and whether the word was seen at all

**Starter Code:**
```go
package main

import "fmt"

type WordCounter struct {
    freq map[string]int
}

// TODO: Implement NewWordCounter() *WordCounter
// TODO: Implement Add(word string)
// TODO: Implement GetCount(word string) (int, bool)
// TODO: Implement TopN(n int) []string — return top N most frequent words

func main() {
    wc := NewWordCounter()
    words := []string{"go", "is", "great", "go", "is", "fast", "go"}
    for _, w := range words {
        wc.Add(w)
    }

    count, ok := wc.GetCount("go")
    fmt.Printf("'go': count=%d, seen=%v\n", count, ok)    // 3, true

    count, ok = wc.GetCount("python")
    fmt.Printf("'python': count=%d, seen=%v\n", count, ok) // 0, false
}
```

---

## Task 2: Safe Type Converter (Beginner)

**Objective:** Write a function that safely converts `interface{}` values to common types using comma-ok.

**Requirements:**
- Implement `ToString(v interface{}) (string, bool)`
- Implement `ToInt(v interface{}) (int, bool)` — also converts float64 to int
- Implement `ToBool(v interface{}) (bool, bool)`
- Handle nil input gracefully

**Starter Code:**
```go
package main

import "fmt"

// TODO: Implement ToString(v interface{}) (string, bool)
// TODO: Implement ToInt(v interface{}) (int, bool)
// TODO: Implement ToBool(v interface{}) (bool, bool)

func main() {
    values := []interface{}{
        "hello",
        42,
        3.14,
        true,
        nil,
        []byte("bytes"),
    }

    for _, v := range values {
        if s, ok := ToString(v); ok {
            fmt.Printf("string: %q\n", s)
        } else if n, ok := ToInt(v); ok {
            fmt.Printf("int: %d\n", n)
        } else if b, ok := ToBool(v); ok {
            fmt.Printf("bool: %v\n", b)
        } else {
            fmt.Printf("unknown: %T\n", v)
        }
    }
}
```

---

## Task 3: Configuration Manager (Beginner-Intermediate)

**Objective:** Build a type-safe configuration store using the comma-ok idiom.

**Requirements:**
- Store values of any type under string keys
- Implement typed getters: `GetString`, `GetInt`, `GetBool`, `GetFloat64`
- Each getter returns `(T, bool)` — `false` if key missing OR wrong type
- Implement `Set(key string, value interface{})` and `Delete(key string)`

**Starter Code:**
```go
package main

import "fmt"

type Config struct {
    // TODO: add fields
}

// TODO: Implement NewConfig() *Config
// TODO: Implement Set(key string, value interface{})
// TODO: Implement GetString(key string) (string, bool)
// TODO: Implement GetInt(key string) (int, bool)
// TODO: Implement GetBool(key string) (bool, bool)
// TODO: Implement Delete(key string)

func main() {
    cfg := NewConfig()
    cfg.Set("host", "localhost")
    cfg.Set("port", 8080)
    cfg.Set("debug", true)

    if host, ok := cfg.GetString("host"); ok {
        fmt.Println("Host:", host)
    }

    if port, ok := cfg.GetInt("port"); ok {
        fmt.Println("Port:", port)
    }

    // Type mismatch
    if _, ok := cfg.GetString("port"); !ok {
        fmt.Println("port is not a string") // should print this
    }

    // Missing key
    if _, ok := cfg.GetInt("timeout"); !ok {
        fmt.Println("timeout not set") // should print this
    }
}
```

---

## Task 4: Channel Pipeline with Close Detection (Intermediate)

**Objective:** Build a three-stage pipeline using channels with proper close detection.

**Requirements:**
- Stage 1 `generate(nums ...int) <-chan int` — sends numbers, closes when done
- Stage 2 `double(in <-chan int) <-chan int` — doubles each value
- Stage 3 `filter(in <-chan int, pred func(int) bool) <-chan int` — filters values
- Use comma-ok in at least one stage (not range)
- The main goroutine should drain the final channel

**Starter Code:**
```go
package main

import "fmt"

// TODO: Implement generate(nums ...int) <-chan int
// TODO: Implement double(in <-chan int) <-chan int  — use comma-ok NOT range
// TODO: Implement filter(in <-chan int, pred func(int) bool) <-chan int

func main() {
    nums := generate(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    doubled := double(nums)
    evens := filter(doubled, func(n int) bool { return n%2 == 0 })

    for v := range evens {
        fmt.Println(v) // 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
    }
}
```

---

## Task 5: LRU Cache with Comma-Ok Interface (Intermediate)

**Objective:** Implement a simple LRU cache where `Get` uses comma-ok semantics.

**Requirements:**
- `New(capacity int) *LRUCache`
- `Get(key string) (interface{}, bool)` — returns value and whether it was found
- `Put(key string, value interface{})`
- When capacity is exceeded, evict the least recently used entry

**Starter Code:**
```go
package main

import (
    "container/list"
    "fmt"
)

type LRUCache struct {
    cap   int
    list  *list.List
    items map[string]*list.Element
}

type entry struct {
    key   string
    value interface{}
}

// TODO: Implement New(capacity int) *LRUCache
// TODO: Implement Get(key string) (interface{}, bool)
// TODO: Implement Put(key string, value interface{})

func main() {
    cache := New(3)
    cache.Put("a", 1)
    cache.Put("b", 2)
    cache.Put("c", 3)

    if v, ok := cache.Get("a"); ok {
        fmt.Println("a:", v) // a: 1
    }

    cache.Put("d", 4) // evicts "b" (LRU)

    if _, ok := cache.Get("b"); !ok {
        fmt.Println("b was evicted") // should print
    }

    if v, ok := cache.Get("d"); ok {
        fmt.Println("d:", v) // d: 4
    }
}
```

---

## Task 6: Registry with Interface Discovery (Intermediate)

**Objective:** Build a plugin registry that uses type assertions to discover optional capabilities.

**Interfaces:**
```go
type Plugin interface {
    Name() string
    Run() error
}

type Configurable interface {
    Configure(map[string]string) error
}

type HealthChecker interface {
    HealthCheck() error
}
```

**Requirements:**
- `Register(name string, p Plugin)` — register a plugin
- `Get(name string) (Plugin, bool)` — retrieve with comma-ok
- `Configure(name string, cfg map[string]string) error` — configure if Configurable
- `HealthCheckAll() map[string]error` — health check all HealthChecker plugins

**Starter Code:**
```go
package main

import "fmt"

type Plugin interface {
    Name() string
    Run() error
}

type Configurable interface {
    Configure(map[string]string) error
}

type HealthChecker interface {
    HealthCheck() error
}

type Registry struct {
    // TODO: add fields
}

// TODO: Implement all methods

// Sample plugins for testing:
type BasicPlugin struct{ name string }
func (p *BasicPlugin) Name() string  { return p.name }
func (p *BasicPlugin) Run() error    { fmt.Println(p.name, "running"); return nil }

type FullPlugin struct{ name string; config map[string]string }
func (p *FullPlugin) Name() string                          { return p.name }
func (p *FullPlugin) Run() error                            { fmt.Println(p.name, "running"); return nil }
func (p *FullPlugin) Configure(cfg map[string]string) error { p.config = cfg; return nil }
func (p *FullPlugin) HealthCheck() error                    { return nil }

func main() {
    reg := &Registry{}
    reg.Register("basic", &BasicPlugin{name: "basic"})
    reg.Register("full", &FullPlugin{name: "full"})

    if p, ok := reg.Get("basic"); ok {
        p.Run()
    }

    if err := reg.Configure("full", map[string]string{"env": "prod"}); err != nil {
        fmt.Println("config error:", err)
    }

    results := reg.HealthCheckAll()
    for name, err := range results {
        if err != nil {
            fmt.Printf("%s: unhealthy: %v\n", name, err)
        } else {
            fmt.Printf("%s: healthy\n", name)
        }
    }
}
```

---

## Task 7: Event Bus with Type-Safe Subscribers (Intermediate-Advanced)

**Objective:** Build an event bus where subscribers use type assertions to handle specific event types.

**Requirements:**
- Define a base `Event` interface with `Type() string`
- Implement at least 2 concrete event types
- Subscribers receive `interface{}` and use type assertion + comma-ok to handle their events
- `Subscribe(eventType string, handler func(interface{}))` — register handlers
- `Publish(event Event)` — dispatch to matching handlers

**Starter Code:**
```go
package main

import "fmt"

type Event interface {
    Type() string
}

type UserCreatedEvent struct {
    UserID   int
    Username string
}
func (e UserCreatedEvent) Type() string { return "user.created" }

type OrderPlacedEvent struct {
    OrderID int
    Amount  float64
}
func (e OrderPlacedEvent) Type() string { return "order.placed" }

type EventBus struct {
    // TODO
}

// TODO: Implement Subscribe(eventType string, handler func(interface{}))
// TODO: Implement Publish(event Event)

func main() {
    bus := &EventBus{}

    bus.Subscribe("user.created", func(e interface{}) {
        if evt, ok := e.(UserCreatedEvent); ok {
            fmt.Printf("New user: %s (id=%d)\n", evt.Username, evt.UserID)
        }
    })

    bus.Subscribe("order.placed", func(e interface{}) {
        if evt, ok := e.(OrderPlacedEvent); ok {
            fmt.Printf("Order #%d: $%.2f\n", evt.OrderID, evt.Amount)
        }
    })

    bus.Publish(UserCreatedEvent{UserID: 1, Username: "alice"})
    bus.Publish(OrderPlacedEvent{OrderID: 100, Amount: 49.99})
}
```

---

## Task 8: Concurrent Rate Limiter with Channel (Advanced)

**Objective:** Build a token bucket rate limiter using channels with comma-ok for graceful shutdown.

**Requirements:**
- `NewRateLimiter(rps int) *RateLimiter` — tokens per second
- `Allow() bool` — returns true if request is allowed
- `Stop()` — stop the limiter (closes refill channel)
- Use a goroutine that refills tokens on a ticker
- Detect the stop signal using comma-ok on the done channel

**Starter Code:**
```go
package main

import (
    "fmt"
    "time"
)

type RateLimiter struct {
    tokens chan struct{}
    done   chan struct{}
}

// TODO: Implement NewRateLimiter(rps int) *RateLimiter
// TODO: Implement Allow() bool
// TODO: Implement Stop()

func main() {
    rl := NewRateLimiter(5) // 5 requests per second
    defer rl.Stop()

    allowed := 0
    denied := 0
    start := time.Now()

    for time.Since(start) < 1*time.Second {
        if rl.Allow() {
            allowed++
        } else {
            denied++
        }
        time.Sleep(50 * time.Millisecond)
    }

    fmt.Printf("Allowed: %d, Denied: %d\n", allowed, denied)
    // Should allow ~5, deny the rest
}
```

---

## Task 9: JSON Field Extractor (Advanced)

**Objective:** Write a function that safely extracts nested fields from a JSON-decoded `map[string]interface{}` using dot notation, using comma-ok at each step.

**Requirements:**
- `Extract(data map[string]interface{}, path string) (interface{}, bool)` — uses dot-notation like `"user.address.city"`
- Each step uses comma-ok
- Returns `false` if any part of the path is missing or not a nested map

**Starter Code:**
```go
package main

import (
    "encoding/json"
    "fmt"
    "strings"
)

// TODO: Implement Extract(data map[string]interface{}, path string) (interface{}, bool)

func main() {
    raw := `{
        "user": {
            "name": "Alice",
            "address": {
                "city": "NYC",
                "zip": "10001"
            }
        },
        "version": 2
    }`

    var data map[string]interface{}
    json.Unmarshal([]byte(raw), &data)

    if city, ok := Extract(data, "user.address.city"); ok {
        fmt.Println("City:", city) // City: NYC
    }

    if _, ok := Extract(data, "user.phone"); !ok {
        fmt.Println("phone not found") // should print
    }

    if v, ok := Extract(data, "version"); ok {
        fmt.Println("Version:", v) // Version: 2
    }
}
```

---

## Task 10: Bidirectional Map (Advanced)

**Objective:** Implement a bidirectional map (bimap) that allows lookup by key or by value using comma-ok.

**Requirements:**
- `New[K, V comparable]() *BiMap[K, V]`
- `Put(key K, value V) bool` — returns false if key or value already exists
- `GetByKey(key K) (V, bool)`
- `GetByValue(value V) (K, bool)`
- `DeleteByKey(key K) bool`
- Both maps must stay in sync

**Starter Code:**
```go
package main

import "fmt"

type BiMap[K, V comparable] struct {
    // TODO: forward and reverse maps
}

// TODO: Implement all methods

func main() {
    m := New[string, int]()
    m.Put("one", 1)
    m.Put("two", 2)
    m.Put("three", 3)

    if v, ok := m.GetByKey("two"); ok {
        fmt.Println("two →", v) // two → 2
    }

    if k, ok := m.GetByValue(3); ok {
        fmt.Println("3 →", k) // 3 → three
    }

    m.DeleteByKey("one")
    if _, ok := m.GetByKey("one"); !ok {
        fmt.Println("one removed") // should print
    }
    if _, ok := m.GetByValue(1); !ok {
        fmt.Println("1 also removed") // should print
    }
}
```

---

## Task 11: State Machine with Type-Asserted Transitions (Expert)

**Objective:** Implement a state machine where transitions are events that use type assertion to carry payload.

**Requirements:**
- States: `Idle`, `Running`, `Paused`, `Stopped`
- Events: `StartEvent{goroutines int}`, `PauseEvent{}`, `ResumeEvent{}`, `StopEvent{reason string}`
- `Transition(event interface{}) error` — uses type switch internally
- `Current() string` — returns current state name
- Invalid transitions return an error

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
)

type StartEvent  struct{ Goroutines int }
type PauseEvent  struct{}
type ResumeEvent struct{}
type StopEvent   struct{ Reason string }

type state int
const (
    Idle state = iota
    Running
    Paused
    Stopped
)

type StateMachine struct {
    current state
}

// TODO: Implement Current() string
// TODO: Implement Transition(event interface{}) error using type switch

func main() {
    sm := &StateMachine{}
    fmt.Println(sm.Current()) // Idle

    if err := sm.Transition(StartEvent{Goroutines: 4}); err != nil {
        fmt.Println("error:", err)
    }
    fmt.Println(sm.Current()) // Running

    sm.Transition(PauseEvent{})
    fmt.Println(sm.Current()) // Paused

    if err := sm.Transition(StartEvent{Goroutines: 1}); err != nil {
        fmt.Println("invalid:", err) // cannot start from Paused
    }

    sm.Transition(ResumeEvent{})
    fmt.Println(sm.Current()) // Running

    sm.Transition(StopEvent{Reason: "shutdown"})
    fmt.Println(sm.Current()) // Stopped
}
```

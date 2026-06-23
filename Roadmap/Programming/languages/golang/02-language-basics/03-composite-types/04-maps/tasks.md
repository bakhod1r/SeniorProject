# Go Maps — Practice Tasks

## Overview
10 progressive tasks from beginner to advanced. Each task includes starter code, requirements, and an evaluation checklist.

---

## Task 1 — Word Frequency Counter (Beginner)

**Goal:** Count how many times each word appears in a text.

**Requirements:**
- Use `strings.Fields()` to split text
- Words should be case-insensitive (`"The"` and `"the"` count as same)
- Return a `map[string]int` of word → count
- Print the top 3 most frequent words

```go
package main

import (
    "fmt"
    "strings"
    // add more imports as needed
)

func wordFrequency(text string) map[string]int {
    // TODO: implement
    return nil
}

func topN(freq map[string]int, n int) []string {
    // TODO: return top-n words by frequency
    return nil
}

func main() {
    text := `Go is an open source programming language that makes it easy
             to build simple reliable and efficient software Go is great`

    freq := wordFrequency(text)
    fmt.Println("Frequency map:", freq)
    fmt.Println("Top 3:", topN(freq, 3))
}
```

**Evaluation Checklist:**
- [ ] `wordFrequency` correctly counts all words
- [ ] Case-insensitive comparison (`strings.ToLower`)
- [ ] `topN` returns exactly `n` words (or fewer if total < n)
- [ ] Top words are actually the most frequent
- [ ] Function handles empty string input
- [ ] No panic on any input

---

## Task 2 — Phone Book (Beginner)

**Goal:** Build an in-memory phone book with CRUD operations.

**Requirements:**
- `Add(name, number string) error` — error if name already exists
- `Get(name string) (string, bool)` — returns number and existence flag
- `Update(name, number string) error` — error if name doesn't exist
- `Delete(name string)` — no-op if not found
- `List() []string` — all names sorted alphabetically

```go
package main

import (
    "errors"
    "fmt"
    "sort"
)

type PhoneBook struct {
    // TODO: choose appropriate field(s)
}

func NewPhoneBook() *PhoneBook {
    // TODO
    return nil
}

func (pb *PhoneBook) Add(name, number string) error {
    // TODO
    return nil
}

func (pb *PhoneBook) Get(name string) (string, bool) {
    // TODO
    return "", false
}

func (pb *PhoneBook) Update(name, number string) error {
    // TODO
    return nil
}

func (pb *PhoneBook) Delete(name string) {
    // TODO
}

func (pb *PhoneBook) List() []string {
    // TODO
    return nil
}

func main() {
    pb := NewPhoneBook()
    pb.Add("Alice", "555-0100")
    pb.Add("Bob", "555-0200")

    num, ok := pb.Get("Alice")
    fmt.Println(num, ok) // 555-0100 true

    err := pb.Add("Alice", "555-9999")
    fmt.Println(err) // error: already exists

    pb.Update("Bob", "555-0202")
    pb.Delete("Alice")
    fmt.Println(pb.List()) // [Bob]

    _ = errors.New("") // use import
    _ = sort.Strings
}
```

**Evaluation Checklist:**
- [ ] `Add` returns an error when name already exists
- [ ] `Get` returns correct (value, true) for existing and ("", false) for missing
- [ ] `Update` returns error when name doesn't exist
- [ ] `Delete` is safe for missing keys
- [ ] `List` returns names in alphabetical order
- [ ] All operations work on an initially empty phone book

---

## Task 3 — Grouping and Aggregation (Intermediate)

**Goal:** Group a list of sales records by region and compute total and average per region.

**Requirements:**
- Use `map[string][]float64` internally for grouping
- Return `map[string]RegionStats` with total, average, min, max
- Handle edge case: region with single sale

```go
package main

import (
    "fmt"
    "math"
)

type Sale struct {
    Region string
    Amount float64
}

type RegionStats struct {
    Count   int
    Total   float64
    Average float64
    Min     float64
    Max     float64
}

func analyzeByRegion(sales []Sale) map[string]RegionStats {
    // TODO: implement
    return nil
}

func main() {
    sales := []Sale{
        {"North", 100.0}, {"South", 200.0}, {"North", 150.0},
        {"East", 300.0}, {"South", 250.0}, {"North", 120.0},
        {"East", 180.0},
    }

    stats := analyzeByRegion(sales)
    for region, s := range stats {
        fmt.Printf("%s: count=%d total=%.2f avg=%.2f min=%.2f max=%.2f\n",
            region, s.Count, s.Total, s.Average, s.Min, s.Max)
    }

    _ = math.MaxFloat64 // hint: useful for initializing Min
}
```

**Evaluation Checklist:**
- [ ] Correctly groups sales by region
- [ ] Count is accurate
- [ ] Total, Average, Min, Max are all correct
- [ ] Min is correctly initialized (not 0)
- [ ] Works with single-element regions
- [ ] Handles empty sales slice

---

## Task 4 — Graph Adjacency List (Intermediate)

**Goal:** Implement a directed graph using `map[string][]string` and BFS traversal.

**Requirements:**
- `AddEdge(from, to string)`
- `Neighbors(node string) []string`
- `BFS(start string) []string` — breadth-first traversal in order visited

```go
package main

import "fmt"

type Graph struct {
    // TODO
}

func NewGraph() *Graph {
    // TODO
    return nil
}

func (g *Graph) AddEdge(from, to string) {
    // TODO
}

func (g *Graph) Neighbors(node string) []string {
    // TODO
    return nil
}

func (g *Graph) BFS(start string) []string {
    // TODO: use a queue (slice as queue)
    // Keep a visited set to avoid revisiting nodes
    return nil
}

func main() {
    g := NewGraph()
    g.AddEdge("A", "B")
    g.AddEdge("A", "C")
    g.AddEdge("B", "D")
    g.AddEdge("C", "D")
    g.AddEdge("D", "E")

    fmt.Println(g.BFS("A")) // [A B C D E] or [A C B D E] (order within same level may vary)
    fmt.Println(g.Neighbors("A")) // [B C] or [C B]
}
```

**Evaluation Checklist:**
- [ ] `AddEdge` correctly stores directed edges
- [ ] `Neighbors` returns all connected nodes
- [ ] `BFS` visits every reachable node exactly once
- [ ] `BFS` doesn't infinite loop on cycles
- [ ] Uses a map-based visited set
- [ ] Returns empty slice for isolated node, not nil panic

---

## Task 5 — Cache with TTL (Intermediate)

**Goal:** Implement a simple in-memory cache where entries expire after a given duration.

**Requirements:**
- `Set(key string, value interface{}, ttl time.Duration)`
- `Get(key string) (interface{}, bool)` — returns false if expired or missing
- `Delete(key string)`
- `Cleanup()` — remove all expired entries
- Thread-safe

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type cacheEntry struct {
    value   interface{}
    expires time.Time
}

type Cache struct {
    // TODO
}

func NewCache() *Cache {
    // TODO
    return nil
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
    // TODO
}

func (c *Cache) Get(key string) (interface{}, bool) {
    // TODO: return false if expired
    return nil, false
}

func (c *Cache) Delete(key string) {
    // TODO
}

func (c *Cache) Cleanup() {
    // TODO: remove expired entries
}

func main() {
    c := NewCache()
    c.Set("user:1", "Alice", 100*time.Millisecond)
    c.Set("user:2", "Bob", 1*time.Second)

    v, ok := c.Get("user:1")
    fmt.Println(v, ok) // Alice true

    time.Sleep(150 * time.Millisecond)

    v, ok = c.Get("user:1")
    fmt.Println(v, ok) // nil false (expired)

    v, ok = c.Get("user:2")
    fmt.Println(v, ok) // Bob true (not expired)

    _ = sync.RWMutex{}
}
```

**Evaluation Checklist:**
- [ ] `Set` stores entry with expiration time
- [ ] `Get` returns false for expired entries
- [ ] `Get` returns false for missing entries
- [ ] `Delete` removes entry
- [ ] `Cleanup` removes all expired entries
- [ ] Protected with `sync.RWMutex`
- [ ] Multiple goroutines can call simultaneously without race

---

## Task 6 — Inverted Index (Intermediate)

**Goal:** Build an inverted index for a document collection — given a word, find all documents containing it.

**Requirements:**
- `IndexDocument(id string, text string)` — tokenizes and indexes the document
- `Search(word string) []string` — returns sorted list of document IDs containing word
- `SearchAll(words []string) []string` — returns IDs containing ALL given words (intersection)

```go
package main

import (
    "fmt"
    "sort"
    "strings"
)

type InvertedIndex struct {
    // TODO: map from word to set of doc IDs
}

func NewInvertedIndex() *InvertedIndex {
    // TODO
    return nil
}

func (idx *InvertedIndex) IndexDocument(id, text string) {
    // TODO: split text, normalize, store word→{id}
}

func (idx *InvertedIndex) Search(word string) []string {
    // TODO: return sorted list of doc IDs
    return nil
}

func (idx *InvertedIndex) SearchAll(words []string) []string {
    // TODO: intersection of all word results
    return nil
}

func main() {
    idx := NewInvertedIndex()
    idx.IndexDocument("doc1", "the quick brown fox")
    idx.IndexDocument("doc2", "the fox ran away")
    idx.IndexDocument("doc3", "quick brown dog")

    fmt.Println(idx.Search("fox"))         // [doc1 doc2]
    fmt.Println(idx.Search("quick"))       // [doc1 doc3]
    fmt.Println(idx.SearchAll([]string{"the", "fox"})) // [doc1 doc2] (both contain "the" and "fox"... check)
    // Actually: doc1 has both "the" and "fox" → [doc1 doc2 have the, doc1 doc2 have fox] → intersection = [doc1 doc2]

    _ = strings.ToLower
    _ = sort.Strings
}
```

**Evaluation Checklist:**
- [ ] Words are stored case-insensitively
- [ ] Each word maps to a set of unique doc IDs (no duplicates)
- [ ] `Search` returns sorted result
- [ ] `SearchAll` returns correct intersection
- [ ] `SearchAll` with empty words returns empty
- [ ] Re-indexing same doc doesn't duplicate entries

---

## Task 7 — Rate Limiter (Advanced)

**Goal:** Implement a per-key rate limiter using the token bucket algorithm backed by a map.

**Requirements:**
- `Allow(key string) bool` — returns true if request is allowed, false if rate-limited
- Rate: 5 requests per second per key
- Each call adds tokens at the fill rate
- Max 5 tokens per bucket
- Thread-safe

```go
package main

import (
    "fmt"
    "sync"
    "time"
)

type bucket struct {
    tokens    float64
    lastRefill time.Time
}

type RateLimiter struct {
    mu       sync.Mutex
    buckets  map[string]*bucket
    rate     float64 // tokens per second
    capacity float64 // max tokens
}

func NewRateLimiter(rate, capacity float64) *RateLimiter {
    // TODO
    return nil
}

func (r *RateLimiter) Allow(key string) bool {
    // TODO:
    // 1. Get or create bucket for key
    // 2. Refill tokens based on elapsed time
    // 3. If tokens >= 1: consume 1 token, return true
    // 4. Else: return false
    return false
}

func main() {
    limiter := NewRateLimiter(5, 5) // 5 req/sec, max burst 5

    // Burst of 5 should succeed
    for i := 0; i < 5; i++ {
        fmt.Println(limiter.Allow("user:1")) // true, true, true, true, true
    }
    // 6th should fail (rate limited)
    fmt.Println(limiter.Allow("user:1")) // false

    // Different key has its own bucket
    fmt.Println(limiter.Allow("user:2")) // true

    // After 1 second, bucket refills
    time.Sleep(1 * time.Second)
    fmt.Println(limiter.Allow("user:1")) // true
}
```

**Evaluation Checklist:**
- [ ] First 5 calls for a key return true (burst up to capacity)
- [ ] 6th call returns false
- [ ] Different keys have independent buckets
- [ ] After waiting, tokens refill proportionally to elapsed time
- [ ] Thread-safe (no data race with `-race`)
- [ ] Tokens never exceed capacity

---

## Task 8 — Registry with Middleware (Advanced)

**Goal:** Build a handler registry that supports middleware chains using maps.

**Requirements:**
- `Register(name string, handler Handler)` — register a named handler
- `Use(middleware Middleware)` — add global middleware
- `Execute(name string, input string) (string, error)` — run handler through middleware chain
- Middleware should wrap the handler (e.g., logging, timing)

```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type Handler func(input string) (string, error)
type Middleware func(Handler) Handler

type Registry struct {
    handlers    map[string]Handler
    middlewares []Middleware
}

func NewRegistry() *Registry {
    // TODO
    return nil
}

func (r *Registry) Register(name string, h Handler) {
    // TODO
}

func (r *Registry) Use(m Middleware) {
    // TODO
}

func (r *Registry) Execute(name string, input string) (string, error) {
    // TODO: wrap handler with all middleware, then call
    return "", nil
}

// Example middleware implementations:
func LoggingMiddleware(next Handler) Handler {
    return func(input string) (string, error) {
        fmt.Printf("[LOG] input: %q\n", input)
        result, err := next(input)
        fmt.Printf("[LOG] output: %q, err: %v\n", result, err)
        return result, err
    }
}

func TimingMiddleware(next Handler) Handler {
    return func(input string) (string, error) {
        start := time.Now()
        result, err := next(input)
        fmt.Printf("[TIME] elapsed: %v\n", time.Since(start))
        return result, err
    }
}

func main() {
    reg := NewRegistry()
    reg.Use(LoggingMiddleware)
    reg.Use(TimingMiddleware)

    reg.Register("echo", func(s string) (string, error) {
        return s, nil
    })
    reg.Register("fail", func(s string) (string, error) {
        return "", errors.New("deliberate failure")
    })

    result, err := reg.Execute("echo", "hello world")
    fmt.Println(result, err) // hello world <nil>

    _, err = reg.Execute("fail", "test")
    fmt.Println(err) // deliberate failure

    _, err = reg.Execute("missing", "test")
    fmt.Println(err) // error: handler not found
}
```

**Evaluation Checklist:**
- [ ] `Register` stores handlers by name
- [ ] `Use` adds middleware to the chain
- [ ] `Execute` applies all middleware in order
- [ ] `Execute` returns error for missing handler
- [ ] Middleware wraps correctly (inner → outer pattern)
- [ ] Multiple middleware don't interfere

---

## Task 9 — LRU Cache (Advanced)

**Goal:** Implement an LRU (Least Recently Used) cache using a map and doubly linked list.

**Requirements:**
- `Get(key int) (int, bool)` — O(1), marks as recently used
- `Put(key, value int)` — O(1), evicts LRU if at capacity
- Capacity specified at construction

```go
package main

import "fmt"

type node struct {
    key, val   int
    prev, next *node
}

type LRUCache struct {
    cap        int
    cache      map[int]*node
    head, tail *node // sentinel nodes
}

func NewLRUCache(capacity int) *LRUCache {
    // TODO: initialize sentinel head and tail
    // head <-> tail (empty list)
    return nil
}

func (c *LRUCache) Get(key int) (int, bool) {
    // TODO: find in map, move to front, return value
    return 0, false
}

func (c *LRUCache) Put(key, value int) {
    // TODO: insert or update; if at capacity, evict tail.prev
}

// Helper: move a node to front (most recently used)
func (c *LRUCache) moveToFront(n *node) {
    // TODO
}

// Helper: remove a node from the list
func (c *LRUCache) remove(n *node) {
    // TODO
}

// Helper: insert a node after head
func (c *LRUCache) insertFront(n *node) {
    // TODO
}

func main() {
    cache := NewLRUCache(3)
    cache.Put(1, 10)
    cache.Put(2, 20)
    cache.Put(3, 30)

    v, ok := cache.Get(1)
    fmt.Println(v, ok) // 10 true (1 is now MRU)

    cache.Put(4, 40) // evicts 2 (LRU is now 2 because 1 was accessed)
    _, ok = cache.Get(2)
    fmt.Println(ok) // false (evicted)

    v, ok = cache.Get(3)
    fmt.Println(v, ok) // 30 true

    v, ok = cache.Get(4)
    fmt.Println(v, ok) // 40 true
}
```

**Evaluation Checklist:**
- [ ] `Get` returns correct value for existing key
- [ ] `Get` returns false for missing/evicted key
- [ ] `Get` moves accessed node to MRU position
- [ ] `Put` inserts new key
- [ ] `Put` updates existing key without eviction
- [ ] `Put` evicts correct LRU entry when at capacity
- [ ] O(1) for both Get and Put (map + linked list)
- [ ] Sentinel nodes simplify list operations

---

## Task 10 — Concurrent Event Bus (Expert)

**Goal:** Implement a type-safe event bus where handlers are registered and invoked by event name.

**Requirements:**
- `Subscribe(event string, handler func(data interface{}))` — register handler
- `Unsubscribe(event string, handler func(data interface{}))` — remove specific handler (hint: use function IDs)
- `Publish(event string, data interface{})` — invoke all handlers asynchronously
- `PublishSync(event string, data interface{})` — invoke synchronously
- Thread-safe

```go
package main

import (
    "fmt"
    "sync"
)

type HandlerID uint64

type EventBus struct {
    mu       sync.RWMutex
    handlers map[string]map[HandlerID]func(interface{})
    nextID   HandlerID
}

func NewEventBus() *EventBus {
    // TODO
    return nil
}

func (eb *EventBus) Subscribe(event string, handler func(interface{})) HandlerID {
    // TODO: assign ID, store handler
    return 0
}

func (eb *EventBus) Unsubscribe(event string, id HandlerID) {
    // TODO: remove handler by ID
}

func (eb *EventBus) Publish(event string, data interface{}) {
    // TODO: invoke all handlers in separate goroutines
}

func (eb *EventBus) PublishSync(event string, data interface{}) {
    // TODO: invoke all handlers synchronously
}

func main() {
    bus := NewEventBus()
    var wg sync.WaitGroup

    id1 := bus.Subscribe("user.created", func(data interface{}) {
        fmt.Println("Handler 1:", data)
        wg.Done()
    })

    id2 := bus.Subscribe("user.created", func(data interface{}) {
        fmt.Println("Handler 2:", data)
        wg.Done()
    })

    wg.Add(2)
    bus.Publish("user.created", map[string]string{"name": "Alice"})
    wg.Wait()

    // Unsubscribe handler 2
    bus.Unsubscribe("user.created", id2)

    bus.PublishSync("user.created", map[string]string{"name": "Bob"})
    // Only handler 1 receives "Bob"

    _ = id1
}
```

**Evaluation Checklist:**
- [ ] `Subscribe` returns unique IDs
- [ ] `Unsubscribe` removes only the specified handler
- [ ] `Publish` invokes all handlers asynchronously
- [ ] `PublishSync` waits for all handlers before returning
- [ ] Multiple handlers for same event all receive data
- [ ] Thread-safe (passes `-race`)
- [ ] Unsubscribed handlers do not receive subsequent publishes
- [ ] Publishing to event with no handlers is a no-op

---

## Solution Notes

All tasks can be run with:
```bash
go run task1.go
go test -race ./...  # for concurrent tasks
```

**Difficulty guide:**
- Tasks 1–2: Junior (map basics)
- Tasks 3–5: Intermediate (patterns, thread-safety)
- Tasks 6–8: Advanced (algorithms + design patterns)
- Tasks 9–10: Expert (data structures + concurrency)

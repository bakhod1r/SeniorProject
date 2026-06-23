# Pointer Receivers — Tasks

## Easy 🟢

### Task 1 — First pointer receiver
Add `Inc()` (pointer receiver) to `Counter`.

### Task 2 — Reset
Add a `Reset()` method to `Counter` — set `n` back to 0.

### Task 3 — Self-referencing return
`func (c *Counter) IncAndGet() int` — increment and return.

### Task 4 — Nil-safe Logger
`Logger.Log(msg)` — do nothing if nil.

### Task 5 — Constructor
Write `NewCounter() *Counter`.

---

## Medium 🟡

### Task 6 — Stack
Push, Pop, Len methods (all pointer receiver).

### Task 7 — Builder
SQL query builder — method-chain.

### Task 8 — Solving the map problem
The given code fails to compile:
```go
m := map[string]Counter{"k": {}}
m["k"].Inc()
```
Write two solutions.

### Task 9 — Embedded pointer
Have `User` struct embed `*Profile` so methods are promoted.

### Task 10 — Cache (single-threaded)
`Cache.Get(k)`, `Cache.Set(k, v)`, `Cache.Delete(k)` — pointer receiver.

---

## Hard 🔴

### Task 11 — Concurrent SafeCounter
Concurrent-safe counter using a mutex.

### Task 12 — RWMutex Cache
Cache with `sync.RWMutex` — Read methods use RLock, Write methods use Lock.

### Task 13 — Resource cleanup
`Resource` type — `Acquire()`, `Release()`. `Release` should be idempotent.

### Task 14 — Linked list reverse
Reverse a singly-linked list with a pointer receiver.

### Task 15 — Worker pool
`Pool` struct — Submit(Job), Stop(). With internal goroutines.

---

## Expert 🟣

### Task 16 — Lock-free counter
With `atomic.Int64`, no mutex.

### Task 17 — Circuit breaker
Closed/Open/Half-open state machine.

### Task 18 — Event emitter
Observable pattern — Subscribe, Emit, Unsubscribe.

### Task 19 — Buffered channel server
Server struct — works via channels, graceful shutdown.

### Task 20 — Lazy initialization
Lazy-initialized resource using `sync.Once`.

---

## Solutions

### Solution 1
```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
```

### Solution 2
```go
func (c *Counter) Reset() { c.n = 0 }
```

### Solution 3
```go
func (c *Counter) IncAndGet() int { c.n++; return c.n }
```

### Solution 4
```go
type Logger struct{ prefix string }
func (l *Logger) Log(msg string) {
    if l == nil { return }
    fmt.Println(l.prefix, msg)
}
```

### Solution 5
```go
func NewCounter() *Counter { return &Counter{} }
```

### Solution 6
```go
type Stack struct{ items []int }
func (s *Stack) Push(x int) { s.items = append(s.items, x) }
func (s *Stack) Pop() (int, bool) {
    if len(s.items) == 0 { return 0, false }
    x := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return x, true
}
func (s *Stack) Len() int { return len(s.items) }
```

### Solution 7
```go
type SQLBuilder struct{ parts []string }
func (b *SQLBuilder) Select(cols ...string) *SQLBuilder {
    b.parts = append(b.parts, "SELECT "+strings.Join(cols, ", "))
    return b
}
func (b *SQLBuilder) From(t string) *SQLBuilder {
    b.parts = append(b.parts, "FROM "+t); return b
}
func (b *SQLBuilder) Where(c string) *SQLBuilder {
    b.parts = append(b.parts, "WHERE "+c); return b
}
func (b *SQLBuilder) Build() string { return strings.Join(b.parts, " ") }
```

### Solution 8
**Solution 1 — temporary var:**
```go
m := map[string]Counter{"k": {}}
v := m["k"]
v.Inc()
m["k"] = v
```

**Solution 2 — `map[K]*V`:**
```go
m := map[string]*Counter{"k": {}}
m["k"].Inc()  // OK — m["k"] is *Counter
```

### Solution 9
```go
type Profile struct{ name string }
func (p *Profile) Name() string         { return p.name }
func (p *Profile) Rename(n string)      { p.name = n }

type User struct {
    *Profile
    email string
}

u := User{Profile: &Profile{name: "Alice"}, email: "a@b.c"}
fmt.Println(u.Name())    // Alice (promoted)
u.Rename("Alicia")
fmt.Println(u.Name())    // Alicia
```

### Solution 10
```go
type Cache struct{ m map[string]string }
func NewCache() *Cache { return &Cache{m: map[string]string{}} }
func (c *Cache) Get(k string) (string, bool) { v, ok := c.m[k]; return v, ok }
func (c *Cache) Set(k, v string) { c.m[k] = v }
func (c *Cache) Delete(k string) { delete(c.m, k) }
```

### Solution 11
```go
type SafeCounter struct {
    mu sync.Mutex
    n  int
}
func (c *SafeCounter) Inc() {
    c.mu.Lock(); defer c.mu.Unlock()
    c.n++
}
func (c *SafeCounter) Value() int {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.n
}
```

### Solution 12
```go
type RWCache struct {
    mu sync.RWMutex
    m  map[string]string
}
func NewRWCache() *RWCache { return &RWCache{m: map[string]string{}} }
func (c *RWCache) Get(k string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    v, ok := c.m[k]
    return v, ok
}
func (c *RWCache) Set(k, v string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[k] = v
}
```

### Solution 13
```go
type Resource struct{ released bool }
func (r *Resource) Acquire() error {
    if r.released { return errors.New("already released") }
    return nil
}
func (r *Resource) Release() {
    if r.released { return }  // idempotent
    r.released = true
}
```

### Solution 14
```go
type Node struct{ Value int; Next *Node }
type List struct{ Head *Node }

func (l *List) Reverse() {
    var prev *Node
    curr := l.Head
    for curr != nil {
        next := curr.Next
        curr.Next = prev
        prev = curr
        curr = next
    }
    l.Head = prev
}
```

### Solution 15
```go
type Job func()
type Pool struct {
    in   chan Job
    quit chan struct{}
    wg   sync.WaitGroup
}

func NewPool(workers int) *Pool {
    p := &Pool{in: make(chan Job), quit: make(chan struct{})}
    for i := 0; i < workers; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case j := <-p.in:
            j()
        case <-p.quit:
            return
        }
    }
}

func (p *Pool) Submit(j Job) { p.in <- j }
func (p *Pool) Stop() {
    close(p.quit)
    p.wg.Wait()
}
```

### Solution 16
```go
type AtomicCounter struct{ n atomic.Int64 }
func (c *AtomicCounter) Inc()       { c.n.Add(1) }
func (c *AtomicCounter) Value() int64 { return c.n.Load() }
```

### Solution 17 (abbreviated)
```go
type Breaker struct {
    mu        sync.Mutex
    state     string  // "closed", "open", "half-open"
    failures  int
    threshold int
}

func (b *Breaker) Call(fn func() error) error {
    b.mu.Lock()
    if b.state == "open" {
        b.mu.Unlock()
        return errors.New("circuit open")
    }
    b.mu.Unlock()

    err := fn()
    b.mu.Lock(); defer b.mu.Unlock()
    if err != nil {
        b.failures++
        if b.failures >= b.threshold { b.state = "open" }
    } else {
        b.failures = 0
        b.state = "closed"
    }
    return err
}
```

### Solution 18
```go
type Emitter struct {
    mu        sync.RWMutex
    handlers  map[string][]func(any)
}

func NewEmitter() *Emitter {
    return &Emitter{handlers: map[string][]func(any){}}
}

func (e *Emitter) Subscribe(event string, h func(any)) {
    e.mu.Lock(); defer e.mu.Unlock()
    e.handlers[event] = append(e.handlers[event], h)
}

func (e *Emitter) Emit(event string, payload any) {
    e.mu.RLock()
    handlers := e.handlers[event]
    e.mu.RUnlock()
    for _, h := range handlers { h(payload) }
}
```

### Solution 19 (abbreviated)
```go
type Server struct {
    in    chan Request
    quit  chan struct{}
    done  chan struct{}
}

func NewServer() *Server {
    s := &Server{
        in:   make(chan Request, 100),
        quit: make(chan struct{}),
        done: make(chan struct{}),
    }
    go s.run()
    return s
}

func (s *Server) run() {
    defer close(s.done)
    for {
        select {
        case req := <-s.in:
            handle(req)
        case <-s.quit:
            return
        }
    }
}

func (s *Server) Submit(r Request) { s.in <- r }
func (s *Server) Shutdown() {
    close(s.quit)
    <-s.done
}
```

### Solution 20
```go
type LazyDB struct {
    once sync.Once
    db   *sql.DB
    err  error
}

func (l *LazyDB) DB() (*sql.DB, error) {
    l.once.Do(func() {
        l.db, l.err = sql.Open("postgres", "...")
    })
    return l.db, l.err
}
```

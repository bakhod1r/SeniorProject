# Go Pointers with Structs — Tasks

## Instructions

Each task has a description, starter code, expected output, and an evaluation checklist. Use `*Struct` patterns idiomatically.

---

## Task 1 — Constructor + Pointer Receiver

**Difficulty**: Beginner

**Description**: Implement `NewCounter()` returning `*Counter` and methods `Inc()`, `Get()`.

```go
type Counter struct{ n int }

func NewCounter() *Counter {
    // TODO
    return nil
}

// TODO: Inc, Get methods

func main() {
    c := NewCounter()
    c.Inc(); c.Inc(); c.Inc()
    fmt.Println(c.Get()) // 3
}
```

**Evaluation**:
- [ ] Returns *Counter
- [ ] Pointer-receiver methods
- [ ] Mutation persists

---

## Task 2 — Field Access via Pointer

**Difficulty**: Beginner

**Description**: Take address of a field, modify through it.

```go
type Point struct{ X, Y int }

func main() {
    p := &Point{X: 1, Y: 2}
    xp := &p.X
    *xp = 99
    fmt.Println(p.X) // 99
}
```

Verify the mutation propagates.

---

## Task 3 — Linked List

**Difficulty**: Intermediate

**Description**: Build a list with `Push`, `Pop`, `Len`.

```go
type Node struct{ V int; Next *Node }
type List struct{ head *Node; size int }

func (l *List) Push(v int)    { /* TODO */ }
func (l *List) Pop() (int, bool) { /* TODO */ }
func (l *List) Len() int      { /* TODO */ return 0 }

func main() {
    l := &List{}
    l.Push(1); l.Push(2); l.Push(3)
    fmt.Println(l.Len()) // 3
    v, ok := l.Pop()
    fmt.Println(v, ok)  // 3 true
}
```

---

## Task 4 — Builder Pattern

**Difficulty**: Intermediate

**Description**: Implement `ServerBuilder` with chainable methods.

```go
type Server struct{ Addr string; Port int; Timeout int }

func NewServerBuilder() *Server {
    return &Server{Port: 8080, Timeout: 30}
}

func (s *Server) WithAddr(a string) *Server { /* TODO */; return s }
func (s *Server) WithPort(p int) *Server     { /* TODO */; return s }
func (s *Server) WithTimeout(t int) *Server  { /* TODO */; return s }

func main() {
    s := NewServerBuilder().WithAddr(":9000").WithPort(443).WithTimeout(60)
    fmt.Printf("%+v\n", s)
}
```

---

## Task 5 — Embedded Pointer

**Difficulty**: Intermediate

**Description**: Embed `*Logger` in `Service`. Use the promoted method.

```go
type Logger struct{ Prefix string }
func (l *Logger) Log(msg string) { fmt.Println("["+l.Prefix+"]", msg) }

type Service struct {
    *Logger
    Name string
}

func main() {
    s := &Service{Logger: &Logger{Prefix: "SVC"}, Name: "auth"}
    s.Log("started") // promoted method
}
```

---

## Task 6 — Tree Insert

**Difficulty**: Advanced

**Description**: BST insert, traverse in-order.

```go
type Tree struct{ V int; Left, Right *Tree }

func (t *Tree) Insert(v int) *Tree {
    // TODO
    return t
}

func (t *Tree) InOrder() {
    // TODO: print in sorted order
}

func main() {
    var root *Tree
    for _, v := range []int{5, 3, 8, 1, 4, 7, 9} {
        root = root.Insert(v)
    }
    root.InOrder() // 1 3 4 5 7 8 9
}
```

---

## Task 7 — `sync.Pool` for Allocation Reduction

**Difficulty**: Advanced

**Description**: Reuse `*Buffer` instances via pool.

```go
import "sync"

type Buffer struct{ Data [1024]byte }
func (b *Buffer) Reset() { for i := range b.Data { b.Data[i] = 0 } }

var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer func() { b.Reset(); pool.Put(b) }()
    // ... use b ...
}
```

---

## Task 8 — Atomic Pointer Swap

**Difficulty**: Advanced

**Description**: Use `atomic.Pointer[Config]` for hot-reload config.

```go
import "sync/atomic"

type Config struct{ Verbose bool }

var configPtr atomic.Pointer[Config]

func reload() {
    configPtr.Store(&Config{Verbose: true})
}

func use() {
    cfg := configPtr.Load()
    fmt.Println(cfg.Verbose)
}
```

---

## Task 9 — Defensive Copy in Constructor

**Difficulty**: Advanced

**Description**: Constructor that takes a slice and stores an independent copy.

```go
type Buffer struct{ data []int }

func NewBuffer(initial []int) *Buffer {
    // TODO: copy initial
    return nil
}
```

Caller mutates `initial`; Buffer should be unaffected.

---

## Task 10 — Method on Nil Receiver (Safe Default)

**Difficulty**: Advanced

**Description**: Logger that's safe to call on nil:

```go
type Logger struct{ Prefix string }

func (l *Logger) Log(msg string) {
    if l == nil { return }
    fmt.Println("["+l.Prefix+"]", msg)
}

func main() {
    var l *Logger
    l.Log("ignored") // no panic
    l = &Logger{Prefix: "OK"}
    l.Log("printed")
}
```

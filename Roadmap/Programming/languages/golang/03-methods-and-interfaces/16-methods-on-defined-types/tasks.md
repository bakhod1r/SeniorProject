# Methods on Defined Types — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Sortable slice receiver
Define `type IntList []int` and implement `sort.Interface` (`Len`, `Less`, `Swap`) directly on the slice type — without wrapping it in a struct.

```go
type IntList []int
// Write: Len, Less, Swap so that sort.Sort(IntList{...}) works
```

### Task 2 — UserID domain primitive
Define `type UserID string` and add `Validate() error`. The ID must be non-empty and start with the `"u_"` prefix.

```go
type UserID string
// Write: func (u UserID) Validate() error
```

### Task 3 — Stringer on a named int
Define `type Weekday int` (0..6) and add `String() string` returning `"Mon"`, `"Tue"`, ..., `"Sun"`.

### Task 4 — Method on a named bool
Define `type Flag bool` and add `Toggle() Flag` that returns the inverted value (value receiver).

### Task 5 — Method on a named float
Define `type Celsius float64` and add `Fahrenheit() float64` returning `c*9/5 + 32`.

---

## Medium 🟡

### Task 6 — HandlerFunc adapter
Define a `Handler` interface with one method `Handle(req string) string`. Then define `type HandlerFunc func(string) string` and add `Handle(req string) string` so that any plain function satisfies the interface — the same trick `http.HandlerFunc` uses.

```go
type Handler interface { Handle(req string) string }
type HandlerFunc func(string) string
// Write: func (f HandlerFunc) Handle(req string) string
```

### Task 7 — Counter on a named int
Define `type Counter int` and add `Inc()`, `Dec()`, `Reset()`, plus `Value() int`. Pick the receiver kind that allows mutation and explain in a comment.

### Task 8 — Custom error code
Define `type ErrCode int` with constants `ErrNotFound`, `ErrConflict`, `ErrInternal`. Implement the `error` interface so each value formats to its own message.

```go
type ErrCode int
const ( ErrNotFound ErrCode = iota + 1; ErrConflict; ErrInternal )
// Write: func (e ErrCode) Error() string
```

### Task 9 — Method on a named map
Define `type Headers map[string]string` and add `Get(key string) string` — return `""` when the key is missing — and `Set(key, value string)`.

### Task 10 — Method on a named function
Define `type Predicate[T any] func(T) bool` style without generics first: `type IntPred func(int) bool`. Add `And(other IntPred) IntPred` and `Or(other IntPred) IntPred`.

### Task 11 — Method on a named channel
Define `type Signal chan struct{}` and add `Fire()` (sends one value, non-blocking via `select`) and `Wait()` (blocks until a value is received).

---

## Hard 🔴

### Task 12 — Generic Set type
Define `type Set[T comparable] map[T]struct{}` and add `Add(x T)`, `Has(x T) bool`, `Remove(x T)`, plus `Len() int`. Methods must be defined directly on the named map type — no wrapping struct.

```go
type Set[T comparable] map[T]struct{}
// Write: Add, Has, Remove, Len
```

### Task 13 — Currency arithmetic
Define `type Currency int64` (stores the amount in cents). Add `Add(o Currency) Currency`, `Sub(o Currency) Currency`, `Mul(n int64) Currency`, and `String() string` formatting like `"$12.34"`.

### Task 14 — Type alias vs defined type
Show that methods defined on `type MyInt int` do **not** transfer to `type AliasInt = int`. Provide a small program that compiles and one that fails to compile, with a comment explaining why.

```go
type MyInt int
type AliasInt = int
func (m MyInt) Double() MyInt { return m * 2 }
// Demonstrate: AliasInt(3).Double() — does this compile?
```

### Task 15 — StringList utilities
Define `type StringList []string` and add:
- `Distinct() StringList` — remove duplicates, keep first-seen order
- `Sort() StringList` — return a sorted copy without mutating the receiver
- `Join(sep string) string`

### Task 16 — Method on a named pointer type
Define `type NodePtr *Node` (where `Node` is a tree node) and add `Walk(visit func(int))`. Show why you almost never want this in real code — the pointer indirection complicates nil checks and embedding.

### Task 17 — Bitset on a named uint64
Define `type BitSet uint64` and add `Set(bit uint)`, `Clear(bit uint)`, `Has(bit uint) bool`, `Count() int` (popcount). All methods take a value receiver and return a new `BitSet` for `Set`/`Clear` — keep it immutable.

---

## Expert 🟣

### Task 18 — Generic stack with method
Define `type Stack[T any] []T` directly on a slice and add `Push(x T) Stack[T]`, `Pop() (T, Stack[T], bool)`, `Peek() (T, bool)`. The stack is a defined slice type, not a struct wrapper — show the pure functional shape where `Push` returns a new slice header.

### Task 19 — Method set on a generic named map
Define `type Cache[K comparable, V any] map[K]V` and add `GetOr(key K, fallback V) V` plus `Keys() []K`. Demonstrate calling `Keys()` on `Cache[string, int]`.

### Task 20 — Tagged union via named int + dispatch table
Define `type Op int` with constants `OpAdd`, `OpMul`, `OpSub`, `OpDiv` and add `Apply(a, b float64) (float64, error)`. Internally use a method-expression dispatch table keyed by the `Op` value — no `switch` statement in `Apply`.

---

## Solutions

### Solution 1

```go
type IntList []int

func (l IntList) Len() int           { return len(l) }
func (l IntList) Less(i, j int) bool { return l[i] < l[j] }
func (l IntList) Swap(i, j int)      { l[i], l[j] = l[j], l[i] }

// sort.Sort(IntList{3, 1, 4, 1, 5}) sorts in place.
```

### Solution 2

```go
type UserID string

func (u UserID) Validate() error {
    if u == "" {
        return errors.New("user id is empty")
    }
    if !strings.HasPrefix(string(u), "u_") {
        return fmt.Errorf("user id %q must start with 'u_'", string(u))
    }
    return nil
}
```

### Solution 3

```go
type Weekday int

const (
    Mon Weekday = iota
    Tue
    Wed
    Thu
    Fri
    Sat
    Sun
)

func (w Weekday) String() string {
    names := [...]string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
    if w < 0 || int(w) >= len(names) {
        return "unknown"
    }
    return names[w]
}
```

### Solution 4

```go
type Flag bool

func (f Flag) Toggle() Flag { return !f }

// Value receiver — Flag is a tiny value, and Toggle returns a new value
// instead of mutating the receiver. This makes the API immutable-friendly.
```

### Solution 5

```go
type Celsius float64

func (c Celsius) Fahrenheit() float64 {
    return float64(c)*9/5 + 32
}
```

### Solution 6

```go
type Handler interface {
    Handle(req string) string
}

type HandlerFunc func(string) string

func (f HandlerFunc) Handle(req string) string {
    return f(req)
}

// Any plain function with the right signature now satisfies Handler:
// var h Handler = HandlerFunc(func(s string) string { return "echo: " + s })
// fmt.Println(h.Handle("hi"))  // echo: hi
// Same adapter pattern net/http uses for HandlerFunc.
```

### Solution 7

```go
type Counter int

// Pointer receiver — we mutate the underlying int value.
// A value receiver would only mutate the local copy.
func (c *Counter) Inc()   { *c++ }
func (c *Counter) Dec()   { *c-- }
func (c *Counter) Reset() { *c = 0 }
func (c Counter) Value() int { return int(c) }
```

### Solution 8

```go
type ErrCode int

const (
    ErrNotFound ErrCode = iota + 1
    ErrConflict
    ErrInternal
)

func (e ErrCode) Error() string {
    switch e {
    case ErrNotFound:
        return "not found"
    case ErrConflict:
        return "conflict"
    case ErrInternal:
        return "internal error"
    }
    return "unknown error"
}

// ErrCode satisfies error directly — no wrapping struct needed.
```

### Solution 9

```go
type Headers map[string]string

func (h Headers) Get(key string) string {
    return h[key] // missing key returns the zero value ""
}

func (h Headers) Set(key, value string) {
    h[key] = value
}

// Note: maps in Go are reference types, so a value receiver still mutates
// the underlying map. We do NOT need a pointer receiver here.
```

### Solution 10

```go
type IntPred func(int) bool

func (p IntPred) And(other IntPred) IntPred {
    return func(x int) bool { return p(x) && other(x) }
}

func (p IntPred) Or(other IntPred) IntPred {
    return func(x int) bool { return p(x) || other(x) }
}

// positive := IntPred(func(x int) bool { return x > 0 })
// even     := IntPred(func(x int) bool { return x%2 == 0 })
// positive.And(even)(4) == true
```

### Solution 11

```go
type Signal chan struct{}

func (s Signal) Fire() {
    select {
    case s <- struct{}{}:
    default: // non-blocking — drop the fire if no receiver is ready
    }
}

func (s Signal) Wait() {
    <-s
}

// done := make(Signal, 1); go func() { done.Fire() }(); done.Wait()
```

### Solution 12

```go
type Set[T comparable] map[T]struct{}

func (s Set[T]) Add(x T)       { s[x] = struct{}{} }
func (s Set[T]) Has(x T) bool  { _, ok := s[x]; return ok }
func (s Set[T]) Remove(x T)    { delete(s, x) }
func (s Set[T]) Len() int      { return len(s) }

// s := Set[string]{}; s.Add("a"); s.Add("b"); s.Add("a")
// s.Len() == 2, s.Has("a") == true
```

### Solution 13

```go
type Currency int64 // amount in cents

func (c Currency) Add(o Currency) Currency { return c + o }
func (c Currency) Sub(o Currency) Currency { return c - o }
func (c Currency) Mul(n int64) Currency    { return c * Currency(n) }

func (c Currency) String() string {
    sign := ""
    v := int64(c)
    if v < 0 {
        sign = "-"
        v = -v
    }
    dollars := v / 100
    cents := v % 100
    return fmt.Sprintf("%s$%d.%02d", sign, dollars, cents)
}

// price := Currency(1234) // $12.34
// price.Add(Currency(50)).Mul(3) // $37.02
```

### Solution 14

```go
type MyInt int
type AliasInt = int // alias — NOT a new type, just another name for int

func (m MyInt) Double() MyInt { return m * 2 }

// Compiles:     MyInt(3).Double()       // 6
// Fails:        AliasInt(3).Double()    // AliasInt has no method Double
//
// Why: an alias (= int) is the same type as int — and `int` has no
// methods. Only a defined type (`type MyInt int`) creates a fresh
// method set. Aliases share the underlying type's method set verbatim.
```

### Solution 15

```go
type StringList []string

func (s StringList) Distinct() StringList {
    seen := make(map[string]struct{}, len(s))
    out := make(StringList, 0, len(s))
    for _, v := range s {
        if _, ok := seen[v]; ok {
            continue
        }
        seen[v] = struct{}{}
        out = append(out, v)
    }
    return out
}

func (s StringList) Sort() StringList {
    cp := append(StringList(nil), s...)
    sort.Strings(cp)
    return cp
}

func (s StringList) Join(sep string) string {
    return strings.Join(s, sep)
}

// StringList{"b","a","b","c","a"}.Distinct().Sort().Join(",") == "a,b,c"
```

### Solution 16

```go
type Node struct {
    Value    int
    Children []*Node
}

type NodePtr *Node

// Go forbids defining methods where the receiver is itself a named
// pointer type. We hang the method on Node and call it through NodePtr.
func (n *Node) Walk(visit func(int)) {
    if n == nil {
        return
    }
    visit(n.Value)
    for _, c := range n.Children {
        c.Walk(visit)
    }
}

// var p NodePtr = &Node{Value: 1}
// p.Walk(func(v int) { fmt.Println(v) })
//
// Lesson: named pointer types rarely buy anything — methods must live
// on the underlying struct anyway, and embedding stops working.
```

### Solution 17

```go
type BitSet uint64

func (b BitSet) Set(bit uint) BitSet   { return b | (1 << bit) }
func (b BitSet) Clear(bit uint) BitSet { return b &^ (1 << bit) }
func (b BitSet) Has(bit uint) bool     { return b&(1<<bit) != 0 }

func (b BitSet) Count() int {
    return bits.OnesCount64(uint64(b))
}

// Usage:
// var s BitSet
// s = s.Set(3).Set(7).Set(15)
// fmt.Println(s.Has(7), s.Count())  // true 3
// s = s.Clear(7)
// fmt.Println(s.Has(7), s.Count())  // false 2
```

### Solution 18

```go
type Stack[T any] []T

func (s Stack[T]) Push(x T) Stack[T] {
    return append(s, x)
}

func (s Stack[T]) Pop() (T, Stack[T], bool) {
    var zero T
    if len(s) == 0 {
        return zero, s, false
    }
    last := len(s) - 1
    return s[last], s[:last], true
}

func (s Stack[T]) Peek() (T, bool) {
    var zero T
    if len(s) == 0 {
        return zero, false
    }
    return s[len(s)-1], true
}

// var st Stack[int]; st = st.Push(1).Push(2).Push(3)
// top, st, _ := st.Pop() // 3, [1 2]
```

### Solution 19

```go
type Cache[K comparable, V any] map[K]V

func (c Cache[K, V]) GetOr(key K, fallback V) V {
    if v, ok := c[key]; ok {
        return v
    }
    return fallback
}

func (c Cache[K, V]) Keys() []K {
    keys := make([]K, 0, len(c))
    for k := range c {
        keys = append(keys, k)
    }
    return keys
}

// c := Cache[string, int]{"a": 1, "b": 2}
// c.GetOr("a", 0) == 1; c.GetOr("z", -1) == -1; c.Keys() // [a b]
```

### Solution 20

```go
type Op int

const (
    OpAdd Op = iota
    OpMul
    OpSub
    OpDiv
)

// Method-expression dispatch table — no switch in Apply.
// Each entry is the unbound form of a method (Op, float64, float64) -> result.
var opTable = map[Op]func(Op, float64, float64) (float64, error){
    OpAdd: Op.add,
    OpMul: Op.mul,
    OpSub: Op.sub,
    OpDiv: Op.div,
}

func (Op) add(a, b float64) (float64, error) { return a + b, nil }
func (Op) mul(a, b float64) (float64, error) { return a * b, nil }
func (Op) sub(a, b float64) (float64, error) { return a - b, nil }
func (Op) div(a, b float64) (float64, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

func (o Op) Apply(a, b float64) (float64, error) {
    fn, ok := opTable[o]
    if !ok {
        return 0, fmt.Errorf("unknown op %d", int(o))
    }
    return fn(o, a, b)
}

// OpAdd.Apply(2, 3) == 5; OpMul.Apply(4, 5) == 20
// OpDiv.Apply(1, 0)  -> err: division by zero
```

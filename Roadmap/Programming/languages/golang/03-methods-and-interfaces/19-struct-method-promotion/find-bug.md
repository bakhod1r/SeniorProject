# Struct Method Promotion — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

Method promotion happens when a struct embeds another type — the embedded type's
methods are accessible directly on the outer struct, as if they were defined on
it. This is one of Go's most useful composition tools, but it creates a number
of subtle traps. The bugs below cover the most common ones.

---

## Bug 1 — Silent shadowing of a promoted method

```go
type Animal struct{ name string }
func (a Animal) Speak() string { return a.name + " makes a sound" }

type Dog struct {
    Animal
}
func (d Dog) Speak() string { return "Woof!" }

func describe(a Animal) string { return a.Speak() }

func main() {
    d := Dog{Animal: Animal{name: "Rex"}}
    fmt.Println(d.Speak())       // "Woof!"
    fmt.Println(describe(d.Animal)) // ?
}
```

**Hint:** What happens when you pass `d.Animal` instead of `d`?

**Bug:** `Dog` defines its own `Speak`, which **shadows** the promoted `Animal.Speak`.
The caller assumes `Speak` is polymorphic, but Go has no virtual dispatch on
embedded values. When `describe` receives a plain `Animal`, only `Animal.Speak`
is visible — output: `Rex makes a sound`. The `Dog`-specific override is lost.

This is a classic "embedding is not inheritance" bug — newcomers from Java or
Python expect the override to follow the value, but it does not.

**Fix:** If polymorphism is desired, use an interface, not a value parameter:

```go
type Speaker interface{ Speak() string }
func describe(s Speaker) string { return s.Speak() }

describe(d) // dispatches through Dog.Speak — prints "Woof!"
```

---

## Bug 2 — Ambiguous selector after refactor

```go
type Logger struct{}
func (Logger) Log(msg string) { fmt.Println("log:", msg) }

type Auditor struct{}
func (Auditor) Log(msg string) { fmt.Println("audit:", msg) }

type Service struct {
    Logger
    Auditor
}

func main() {
    s := Service{}
    s.Logger.Log("started")  // explicit — works
    s.Log("started")         // ?
}
```

**Hint:** Two embedded types each provide `Log`.

**Bug:** Both `Logger` and `Auditor` are embedded at the same depth and both
have a method called `Log`. The selector `s.Log` is **ambiguous** at compile
time. Compile error: `ambiguous selector s.Log`.

The danger is real-world: imagine the code originally had only one embed, and
someone added the second later. Every implicit `s.Log(...)` call across the
codebase suddenly stops compiling.

**Fix:** Either disambiguate at every call site, or define `Log` on the outer
type to break the tie:

```go
func (s Service) Log(msg string) {
    s.Logger.Log(msg)
    s.Auditor.Log(msg)
}
```

The outer method shadows both embedded ones, restoring an unambiguous selector.

---

## Bug 3 — Missing pointer embed loses interface

```go
type Counter struct{ n int }
func (c *Counter) Inc()       { c.n++ }
func (c *Counter) Value() int { return c.n }

type Incrementer interface {
    Inc()
    Value() int
}

type Stats struct {
    Counter // embed by value
}

func main() {
    s := Stats{}
    var i Incrementer = s // ?
    i.Inc()
    fmt.Println(i.Value())
}
```

**Hint:** Method set rules apply to promoted methods, too.

**Bug:** `Inc` and `Value` have **pointer receivers** on `Counter`. Promotion
preserves receiver kind. The method set of `Stats` (value) only includes
methods with value receivers on its embedded fields — so `Stats` does NOT
satisfy `Incrementer`. Compile error: `Stats does not implement Incrementer
(Inc method has pointer receiver)`.

**Fix:** Either pass a pointer, or embed the pointer directly:

```go
var i Incrementer = &s          // pointer satisfies the interface
```

```go
type Stats struct{ *Counter }    // embed pointer
s := Stats{Counter: &Counter{}}  // must initialize the pointer
var i Incrementer = s            // works
```

Embedding `*Counter` makes the method set of `Stats` (value) include both the
value and pointer methods of `Counter`.

---

## Bug 4 — Pointer method called through a value embed

```go
type Buffer struct{ data []byte }
func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }

type Logger struct {
    Buffer // embed by value
}

func makeLogger() Logger {
    return Logger{}
}

func main() {
    makeLogger().Write([]byte("hi")) // ?
}
```

**Hint:** What is the addressability of the return value?

**Bug:** `Write` has a pointer receiver. When promoted, `Logger.Write` is
effectively a method with a pointer receiver. To call it, Go must take the
address of the embedded `Buffer`. But `makeLogger()` returns a temporary
value — temporaries are NOT addressable. Compile error: `cannot call
pointer method Write on Logger`.

The same code works fine if you assign to a variable first, which makes
the bug feel inconsistent and confusing:

```go
l := makeLogger()
l.Write([]byte("hi")) // OK — l is addressable
```

**Fix:** Return a pointer (the idiomatic choice for types whose methods
mutate state), or embed `*Buffer`:

```go
func makeLogger() *Logger { return &Logger{} }
```

---

## Bug 5 — Embedded sync.Mutex copied

```go
type SafeCount struct {
    sync.Mutex
    n int
}

func (s SafeCount) Inc() { // value receiver
    s.Lock()
    defer s.Unlock()
    s.n++
}

func main() {
    s := SafeCount{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); s.Inc() }()
    }
    wg.Wait()
    fmt.Println(s.n)
}
```

**Hint:** Run with `-race`.

**Bug:** Two layered problems:

1. `Inc` is a value receiver. Calling `s.Inc()` copies the entire `SafeCount`,
   including the embedded `sync.Mutex`. Each goroutine locks its own private
   copy of the mutex — there is no synchronization. `go vet` reports
   `Inc passes lock by value: SafeCount contains sync.Mutex`.
2. `s.n++` writes to a copy, so the original `s.n` never changes. Output:
   `0`, with a race condition flagged by `-race`.

This is the most common embedding bug because `sync.Mutex.Lock` and `Unlock`
have pointer receivers, but the promoted call `s.Lock()` silently takes the
address of the local copy — looking correct while doing nothing useful.

**Fix:** Use a pointer receiver, and never copy a struct that contains a
mutex:

```go
func (s *SafeCount) Inc() {
    s.Lock()
    defer s.Unlock()
    s.n++
}
```

For added safety, keep the mutex unexported and not embedded so callers cannot
accidentally `Lock` from the outside.

---

## Bug 6 — Promoted Read on a nil embed

```go
type Decoder struct {
    io.Reader
}

func (d *Decoder) Decode() ([]byte, error) {
    buf := make([]byte, 16)
    _, err := d.Read(buf)
    return buf, err
}

func main() {
    d := &Decoder{} // forgot to set Reader
    out, err := d.Decode()
    fmt.Println(out, err)
}
```

**Hint:** What is `d.Reader` when not initialized?

**Bug:** `io.Reader` is an interface. The embedded interface field's zero
value is `nil`. The promoted `d.Read(buf)` call resolves to `d.Reader.Read(buf)`,
which is a method call on a nil interface value. Runtime panic:
`invalid memory address or nil pointer dereference` (specifically: calling a
method on nil interface).

This is especially nasty because the code compiles cleanly and looks complete
— the embed silently provides a `Read` method that crashes the moment it is
invoked.

**Fix:** Always initialize the embedded interface, ideally via a constructor:

```go
func NewDecoder(r io.Reader) *Decoder {
    if r == nil {
        r = bytes.NewReader(nil)
    }
    return &Decoder{Reader: r}
}
```

Or guard the call:

```go
if d.Reader == nil {
    return nil, errors.New("decoder: nil reader")
}
```

---

## Bug 7 — Embedded interface vs embedded concrete type

```go
type Writer interface {
    Write(p []byte) (int, error)
}

type Tee struct {
    Writer    // embedded interface
    bytes.Buffer
}

func main() {
    t := Tee{Buffer: bytes.Buffer{}}
    t.Write([]byte("hi")) // ?
}
```

**Hint:** Two embedded fields each contribute a `Write` — at the same depth.

**Bug:** Embedding the interface `Writer` and the concrete struct `bytes.Buffer`
both promote a `Write` method. Even though one comes from an interface and the
other from a struct, Go treats them as **two methods at the same depth**, so
the selector `t.Write` is ambiguous. Compile error:
`ambiguous selector t.Write`.

A common misconception is "the concrete one wins" — it does not. Go's promotion
rules look at depth, not at concrete-vs-interface distinction.

A second danger: even if only `Writer` were embedded, the field is `nil` until
assigned. Calling `t.Write(...)` on the zero value would panic at runtime.

**Fix:** Pick one — either rename, qualify, or define `Write` on `Tee`:

```go
type Tee struct {
    primary   Writer        // ordinary named field, not embedded
    secondary bytes.Buffer
}

func (t *Tee) Write(p []byte) (int, error) {
    n, err := t.primary.Write(p)
    if err != nil { return n, err }
    return t.secondary.Write(p)
}
```

---

## Bug 8 — Promoted method through interface — receiver is wrong type

```go
type Base struct{ id int }
func (b *Base) ID() int { return b.id }

type Cached struct {
    *Base
    cachedID int
}
func (c *Cached) ID() int {
    if c.cachedID != 0 { return c.cachedID }
    c.cachedID = c.Base.ID()
    return c.cachedID
}

type IDer interface{ ID() int }

func main() {
    var ider IDer = &Cached{Base: &Base{id: 42}}
    _ = ider.ID()

    // later refactor — someone "simplifies":
    var ider2 IDer = (&Cached{Base: &Base{id: 42}}).Base
    _ = ider2.ID()
}
```

**Hint:** Which receiver runs in each case?

**Bug:** Both `Base` and `Cached` define `ID`. Through the interface `IDer`,
dispatch is determined by the **dynamic type stored in the interface**, not by
the variable name.

- `ider` holds a `*Cached` — `ider.ID()` runs `Cached.ID` (with caching).
- `ider2` holds a `*Base` (after the `.Base` selector) — `ider2.ID()` runs
  `Base.ID`, completely bypassing the caching layer.

The "simplification" looks innocent (still implements `IDer`, still returns
the right number), but it silently disables the cache. There is no compile
error, no runtime error, and likely no failing test — just a performance
regression that may go unnoticed for months.

**Fix:** Always pass the outer type (`*Cached`), and resist the urge to
"reach in" to embedded fields when the wrapping type adds behavior:

```go
var ider IDer = &Cached{Base: &Base{id: 42}}
```

If you really only need the `Base`, store one directly — do not pretend it is
the same as the wrapping type.

---

## Bug 9 — Field name collision with outer struct

```go
type Inner struct {
    name string
}
func (i Inner) Greet() string { return "Hi " + i.name }

type Outer struct {
    Inner
    name string // same name as Inner.name
}

func main() {
    o := Outer{Inner: Inner{name: "Alice"}, name: "Bob"}
    fmt.Println(o.name)         // ?
    fmt.Println(o.Greet())      // ?
}
```

**Hint:** Selector resolution by depth.

**Bug:** Both `Outer.name` (depth 0) and `Inner.name` (depth 1) exist. The
promoted name `Inner.name` is **shadowed** by the outer field. So:

- `o.name` → `Outer.name` → `"Bob"` (often surprising — the user assumed
  promotion meant alias).
- `o.Greet()` runs on `o.Inner`, which has its own `name = "Alice"` — output:
  `"Hi Alice"`.

The two reads of `o.name` and `o.Greet()` use **different** `name` fields,
violating the principle of least surprise. Renaming becomes a minefield because
removing `Outer.name` silently changes what `o.name` refers to.

**Fix:** Avoid duplicate names across embed boundaries. If the outer type really
needs its own `name`, do not embed `Inner` — store it as a regular named field
and forward explicitly:

```go
type Outer struct {
    inner Inner
    name  string
}
func (o Outer) Greet() string { return "Hi " + o.name }
```

---

## Bug 10 — Generics + embedding promotion

```go
type Container[T any] struct {
    items []T
}
func (c *Container[T]) Add(v T) { c.items = append(c.items, v) }
func (c *Container[T]) Len() int { return len(c.items) }

type Stack[T any] struct {
    Container // ?
}

func main() {
    s := &Stack[int]{}
    s.Add(1)
    fmt.Println(s.Len())
}
```

**Hint:** Embedding a generic type requires its type arguments.

**Bug:** `Container` is a generic type — it cannot be embedded without type
arguments. Compile error: `cannot use generic type Container[T any] without
instantiation`.

A second mistake people often make is embedding `Container[T]` and then
expecting the outer type's `T` to be inferred from usage. It does not — the
outer struct must declare its own type parameter and forward it:

**Fix:**

```go
type Stack[T any] struct {
    Container[T]
}

func main() {
    s := &Stack[int]{}
    s.Add(1)
    fmt.Println(s.Len()) // 1
}
```

Note: as of Go 1.22, you cannot define **new generic methods** on `Stack[T]`
that introduce additional type parameters — methods may only use the type
parameters of the receiver. This is a separate restriction worth remembering
when designing embedded generic containers.

---

## Bug 11 — Embedded value with pointer-only method set in slice

```go
type Worker struct{ id int }
func (w *Worker) Run() { fmt.Println("worker", w.id) }

type Pool struct {
    Worker
}

func main() {
    pools := []Pool{{Worker{1}}, {Worker{2}}, {Worker{3}}}
    for _, p := range pools {
        p.Run() // ?
    }
}
```

**Hint:** Range loop variables in Go 1.21 vs 1.22 — and addressability.

**Bug:** Two layered issues:

1. `p` is a copy of each pool — `p.Run()` takes the address of the loop-local
   copy. The pointer receiver mutates that local copy, not the slice element.
2. In Go 1.21 and earlier, `p` is the **same variable** reused each iteration.
   So `&p` is the same address three times — fine for printing, but if
   `Run` stored `w` somewhere (e.g. into a callback list), all three callbacks
   would point to the same `Worker`, holding the value of the last iteration.

In Go 1.22+, point (2) is fixed — each iteration gets a fresh `p`. Point (1)
remains.

**Fix:** Iterate by index when you need stable addresses, or use pointer
embedding so the pointer is shared:

```go
for i := range pools {
    pools[i].Run() // address of the slice element, not the loop var
}
```

```go
type Pool struct{ *Worker }
pools := []Pool{{&Worker{1}}, {&Worker{2}}, {&Worker{3}}}
```

---

## Bug 12 — Promoted method satisfies interface, but interface guard hides it

```go
type Closer interface{ Close() error }

type File struct{ /* ... */ }
func (f *File) Close() error { return nil }

type Wrapped struct {
    *File
}

func (w *Wrapped) Close() error {
    // outer Close — wants to do extra cleanup, then forward
    return w.Close() // ?
}
```

**Hint:** Inside `Wrapped.Close`, what does `w.Close` refer to?

**Bug:** Inside `Wrapped.Close`, the selector `w.Close` resolves to `Wrapped`'s
own method (depth 0 wins over the promoted `*File.Close` at depth 1). So
`return w.Close()` is **infinite recursion** — stack overflow at runtime.

This is one of the most common embedding bugs in real Go code, and it is
particularly insidious because the IDE auto-complete cheerfully suggests
`w.Close()` and the code looks like a clean delegation pattern.

**Fix:** Always call the embedded method via its explicit field name when
overriding:

```go
func (w *Wrapped) Close() error {
    // ... extra cleanup ...
    return w.File.Close()
}
```

If `w.File` may be nil, guard it:

```go
if w.File == nil {
    return nil
}
return w.File.Close()
```

---

## Cheat Sheet

```
COMMON METHOD-PROMOTION BUGS
────────────────────────────
1.  Override expected via value param      → no virtual dispatch on values
2.  Two embeds, same method name           → ambiguous selector
3.  Pointer-receiver methods + value embed → interface not satisfied
4.  Pointer method on temporary value      → cannot take address
5.  Embedded sync.Mutex + value receiver   → lock copied, race
6.  Embedded io.Reader left nil            → nil interface panic
7.  Interface embed + concrete embed       → ambiguous selector
8.  Reaching in to embedded for interface  → wrong dispatch
9.  Field name collision on embed          → shadowed selector
10. Generic type embedded without args     → compile error
11. Pointer methods on value-embedded      → loop-var copy + addressability
12. Outer override calls itself recursively→ stack overflow

WHAT PROMOTION DOES NOT GIVE YOU
────────────────────────────
- Inheritance (no virtual dispatch)
- Type identity (Outer is NOT an Inner)
- Automatic interface satisfaction across pointer/value boundaries

GO TOOLS THAT HELP
────────────────────────────
go vet ./...        # passes-lock-by-value, copylocks
go run -race ./...  # races from copied mutexes
staticcheck ./...   # SA1019, SA4006, more
go build ./...      # ambiguous selector errors are compile-time
```

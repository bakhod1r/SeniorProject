# Method Values and Expressions — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

Method values (`t.M`) and method expressions (`T.M`, `(*T).M`) look almost identical
at the call site, but they bind the receiver at very different moments and have
different signatures. Most bugs here come from confusing those two — or from the
receiver going stale, racing, or being copied behind the scenes.

---

## Bug 1 — Stale captured receiver in pre-Go 1.22 loop

```go
type Job struct{ id int }

func (j Job) Run() { fmt.Println("job", j.id) }

func main() {
    jobs := []Job{{1}, {2}, {3}}
    callbacks := []func(){}

    for _, j := range jobs {
        callbacks = append(callbacks, j.Run) // method value
    }
    for _, cb := range callbacks {
        cb()
    }
}
```

**Hint:** When does the method value capture `j`? And which `j` is it?

**Bug:** `j.Run` is a method value — it evaluates the receiver `j` at binding
time and stores a copy with the bound function. In Go 1.21 and earlier, `j` is
the same variable reused across iterations. With a value receiver the captured
copy preserves the id correctly. But change to `func (j *Job) Run()` (pointer
receiver), and the method value now binds `&j`, the address of the loop
variable. Every callback in the slice points to the same memory cell, which
by the end of the loop holds `Job{3}`. Output (pre-1.22, pointer receiver):
`job 3` three times.

**Fix:**

```go
for _, j := range jobs {
    j := j // shadow — fresh variable per iteration
    callbacks = append(callbacks, j.Run)
}
```

Or build for Go 1.22+ where each iteration has its own `j` automatically.

---

## Bug 2 — Goroutine + method value with mutable receiver

```go
type Counter struct{ n int }

func (c *Counter) Inc() { c.n++ }

func main() {
    c := &Counter{}
    inc := c.Inc // method value — captures c

    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            inc()
        }()
    }
    wg.Wait()
    fmt.Println(c.n) // ?
}
```

**Hint:** A method value binds the receiver, but does it synchronize anything?

**Bug:** People sometimes assume that because `inc` is "bound" to `c`, calling
it is somehow safer than `c.Inc()`. It is not. A method value is just a closure
over the receiver — same data-race characteristics as the direct call. 1000
goroutines all race on `c.n++`. `go run -race` reports the race; the final
count is non-deterministic.

**Fix:**

```go
type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc() { c.n.Add(1) }
// ...
fmt.Println(c.n.Load())
```

Or guard the increment with a `sync.Mutex`. The point: binding a method value
does **not** introduce synchronization.

---

## Bug 3 — Assuming `t.M` re-evaluates `t`

```go
type Config struct{ host string }

func (c Config) URL() string { return "http://" + c.host }

func main() {
    cfg := Config{host: "old.example.com"}
    getURL := cfg.URL // method value, captured NOW

    cfg.host = "new.example.com"

    fmt.Println(getURL()) // ?
}
```

**Hint:** Does `getURL` look up `cfg` again at call time, or did it copy it earlier?

**Bug:** A method value evaluates its receiver expression **once**, at the
binding moment, and stores the result. Because `Config.URL` has a value
receiver, the entire `cfg` was copied into the closure when `cfg.URL` was
written. Later mutation of `cfg.host` has no effect on `getURL`. Output:
`http://old.example.com`.

This is the binding-moment confusion: `cfg.URL` does **not** mean "look up `cfg`
each time you call me." It means "snapshot `cfg` now, and remember to call
`URL` on that snapshot."

**Fix (re-bind explicitly, or use a method expression):**

```go
// Re-bind after mutating:
cfg.host = "new.example.com"
getURL = cfg.URL

// Or use a method expression and pass the receiver each time:
getURL2 := Config.URL
fmt.Println(getURL2(cfg)) // always uses the current cfg
```

---

## Bug 4 — Method expression called with wrong receiver type

```go
type Animal struct{ name string }
type Dog    struct{ Animal }

func (a Animal) Speak() string { return a.name + " makes a sound" }

func main() {
    speak := Animal.Speak // method expression: func(Animal) string

    d := Dog{Animal: Animal{name: "Rex"}}
    fmt.Println(speak(d)) // ?
}
```

**Hint:** What is the exact static type of `speak`?

**Bug:** A method expression `Animal.Speak` has type `func(Animal) string` —
the receiver is the first parameter and its type is fixed to `Animal`.
Although `Dog` embeds `Animal` and `d.Speak()` works, you cannot pass `d`
where an `Animal` is required without explicit promotion. Compile error:
`cannot use d (type Dog) as type Animal in argument to speak`. Selector
promotion does not apply to method expressions — their signature is rigid.

**Fix:**

```go
fmt.Println(speak(d.Animal)) // pass the embedded Animal explicitly
```

Or use a method value, which honors selector promotion:

```go
speakD := d.Speak
fmt.Println(speakD())
```

---

## Bug 5 — `(*T).M` confused with `T.M`

```go
type Buffer struct{ data []byte }

func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }

func main() {
    write := Buffer.Write // ?
    _ = write
}
```

**Hint:** Which method set does `Write` belong to?

**Bug:** `Write` has a pointer receiver, so it belongs to `(*Buffer)`'s
method set, not `Buffer`'s. Method expressions are spelled with the type whose
method set you are reaching into. `Buffer.Write` is therefore a compile error:
`Buffer.Write undefined (type Buffer has no method Write)`. Go's automatic
addressing for selectors does not apply here — method expressions are a
purely static construct.

**Fix:**

```go
write := (*Buffer).Write // type: func(*Buffer, []byte)

b := &Buffer{}
write(b, []byte("hello"))
```

If you want a `func(Buffer, []byte)` you have to wrap it yourself:

```go
write := func(b Buffer, p []byte) { (&b).Write(p) } // mutates the copy — usually wrong
```

— which by itself is almost always a bug, exactly because the mutation is lost.

---

## Bug 6 — sort.Slice closure leaking a method-value variable

```go
type Item struct {
    name string
    rank int
}

type Catalog struct{ items []Item }

func (c *Catalog) lessByRank(i, j int) bool {
    return c.items[i].rank < c.items[j].rank
}

func (c *Catalog) Sort() {
    less := c.lessByRank
    c = nil // simulate later reassignment / scope churn
    sort.Slice(c.items, less)
}
```

**Hint:** What does the method value capture? And what did we just do to `c`?

**Bug:** Two problems stack. `c.lessByRank` is a method value that captures
the current value of `c` (a `*Catalog` pointer). Reassigning the local `c =
nil` does **not** unbind the closure — `less` still holds the original
pointer. But then the code calls `sort.Slice(c.items, less)` through the
now-nil `c`, panicking on nil-pointer deref before sorting starts. The
method-value abstraction hides the bug behind a wrong mental model ("`less`
will use whatever `c` is at call time").

**Fix (don't shadow / nil out the receiver, and prefer a method expression
when you really want late binding):**

```go
func (c *Catalog) Sort() {
    sort.Slice(c.items, c.lessByRank) // method value, c stays valid
}
```

Or, when you genuinely need to defer choosing the receiver:

```go
less := (*Catalog).lessByRank // method expression
sort.Slice(c.items, func(i, j int) bool { return less(c, i, j) })
```

---

## Bug 7 — Storing a method value in a struct retains the receiver

```go
type Session struct {
    user *User // big object; should be GC'd when session ends
}

type User struct {
    name string
    blob [1 << 20]byte // 1 MiB
}

func (u *User) Name() string { return u.name }

type Hook struct {
    OnTick func() string
}

func newHook(s *Session) *Hook {
    return &Hook{OnTick: s.user.Name} // method value
}
```

**Hint:** What does `OnTick` keep alive?

**Bug:** `s.user.Name` is a method value. The closure holds a copy of the
receiver — here, the `*User` pointer. Storing it in `Hook.OnTick` keeps that
`*User` reachable for as long as the hook lives, so the GC cannot collect
the 1 MiB `User` even after the `Session` is done. This shape of leak is
common in long-lived event buses and observer registries.

**Fix (capture only what you need):**

```go
func newHook(s *Session) *Hook {
    name := s.user.name // copy the small string
    return &Hook{OnTick: func() string { return name }}
}
```

Or store the user's name on `Session` directly and reference that, so the
closure doesn't drag the whole `User` along.

---

## Bug 8 — Method value vs method expression sent over a channel

```go
type Worker struct{ id int }

func (w *Worker) Do() { fmt.Println("worker", w.id) }

func dispatch(jobs chan func(*Worker)) {
    w1 := &Worker{id: 1}
    w2 := &Worker{id: 2}

    jobs <- w1.Do // method value
    jobs <- w2.Do
}

func runner(jobs chan func(*Worker)) {
    pool := &Worker{id: 99}
    for f := range jobs {
        f(pool) // call with the pool's worker
    }
}
```

**Hint:** What is the type of `w1.Do`, and what is the type of the channel?

**Bug:** The channel is `chan func(*Worker)` — that's the signature of the
method *expression* `(*Worker).Do`, which takes the receiver as its first
argument. But `w1.Do` is a method *value*, whose type is `func()` (receiver
already bound). Compile error: `cannot use w1.Do (type func()) as type
func(*Worker) in send`. The author conflated two designs: send a pre-bound
callback (`func()`), or send the method itself and pick the receiver on the
consumer side (`func(*Worker)`).

**Fix A — pre-bound callbacks:**

```go
jobs := make(chan func())
jobs <- w1.Do
jobs <- w2.Do
// runner: for f := range jobs { f() }
```

**Fix B — late-bound, runner picks the receiver:**

```go
jobs := make(chan func(*Worker))
jobs <- (*Worker).Do
// runner: for f := range jobs { f(pool) }
```

---

## Bug 9 — Generics + method value: type parameter erased at call site

```go
type Stringer interface{ String() string }

type Tagged[T Stringer] struct{ v T }

func (t Tagged[T]) Render() string { return "<" + t.v.String() + ">" }

func collect[T Stringer](items []Tagged[T]) []func() string {
    out := make([]func() string, 0, len(items))
    for _, it := range items {
        out = append(out, it.Render) // method value on a generic type
    }
    return out
}

type ID int
func (i ID) String() string { return strconv.Itoa(int(i)) }

func main() {
    items := []Tagged[ID]{{v: 1}, {v: 2}, {v: 3}}
    fns := collect(items)
    for _, f := range fns {
        fmt.Println(f())
    }
}
```

**Hint:** Apart from the generic decoration, what classic loop-variable trap
is this?

**Bug:** People look at the generics and assume something exotic must be wrong.
It is not — the type parameter `T` is fully resolved by the time `it.Render`
runs, and the method value's signature is just `func() string`. The actual
bug is the same loop-variable capture from Bug 1, dressed up with generics:
in Go 1.21 and earlier, `it` is reused across iterations and `it.Render`
re-binds against the same variable. Pre-1.22, all callbacks return the last
item's rendering.

The lesson: generics do not change the rules for method values. The receiver
expression is still evaluated at binding time, and loop-variable capture
still bites if the receiver is the loop variable.

**Fix:**

```go
for _, it := range items {
    it := it // pre-1.22 fresh binding
    out = append(out, it.Render)
}
```

Or compile under Go 1.22+. Either way, the generic decoration is a red herring.

---

## Bug 10 — `reflect.Value.Method` index drift after refactor

```go
type API struct{}

func (API) Get()    {}
func (API) Post()   {}
func (API) Delete() {}

func callPost(v reflect.Value) {
    v.Method(2).Call(nil) // "Post is the third method"
}
```

The refactor (alphabetical order is not what the author thought):

```go
// Methods in source order: Get, Post, Delete
// Method indices in reflect (LEXICOGRAPHIC by name): Delete=0, Get=1, Post=2
```

Then someone renames `Post` to `Send`:

```go
func (API) Get()    {}
func (API) Send()   {} // was Post
func (API) Delete() {}
```

Now `v.Method(2)` returns... what?

**Hint:** How does `reflect` order methods, and is your hard-coded index stable
across renames?

**Bug:** `reflect.Type.Method(i)` returns methods in lexicographic order of
method name, not source order. Before the rename: `Delete=0, Get=1, Post=2`,
so `v.Method(2)` called `Post` for the wrong reason. After renaming `Post`
to `Send`: `Delete=0, Get=1, Send=2`, and `v.Method(2)` now calls `Send`.
The behavior silently changed. Adding `Put` would shift indices again. Treat
a method as a first-class value, identify it by something stable — an integer
index into a sorted-by-name list is not stable.

**Fix — look up by name:**

```go
func callPost(v reflect.Value) {
    m := v.MethodByName("Post") // stable, fails loudly if renamed
    if !m.IsValid() {
        panic("API.Post not found")
    }
    m.Call(nil)
}
```

Even better, avoid `reflect` for known method names; a method expression is
checked at compile time:

```go
post := API.Post // *checked* at compile time
post(API{})
```

---

## Bug 11 — Method value bound to a soon-to-be-stale slice element

```go
type Sensor struct {
    id    int
    read  func() int
}

func (s *Sensor) Read() int { return s.id * 10 }

func main() {
    sensors := []Sensor{
        {id: 1}, {id: 2}, {id: 3},
    }
    for i := range sensors {
        sensors[i].read = sensors[i].Read // bind method value
    }

    // Grow the slice — may reallocate the backing array.
    sensors = append(sensors, Sensor{id: 4})

    for _, s := range sensors[:3] {
        fmt.Println(s.read()) // ?
    }
}
```

**Hint:** What does `sensors[i].Read` capture, and what happens when `append`
reallocates?

**Bug:** `sensors[i].Read` is a method value with a *pointer receiver*. The
receiver expression `&sensors[i]` is evaluated immediately and stored in the
closure. If the later `append` causes the backing array to be reallocated,
`sensors` now points to fresh memory — but the bound method values still
point to the old, abandoned array. The values they print may be correct *by
accident* (the old array is still alive because the closures keep it
reachable), but any subsequent mutation through `sensors[i]` will not be
visible to `s.read()`, and vice versa. Two parallel realities with the same
data.

**Fix:** Don't bind method values to slice elements that may move. Either
finish growing the slice before binding, or store `*Sensor` pointers from a
stable allocation:

```go
sensors := []*Sensor{{id: 1}, {id: 2}, {id: 3}}
for _, s := range sensors {
    s.read = s.Read // pointer is stable; backing array of pointers may move freely
}
sensors = append(sensors, &Sensor{id: 4})
```

---

## Bug 12 — Interface method value loses dispatch dynamism? (No, but…)

```go
type Greeter interface{ Greet() string }

type EN struct{}
func (EN) Greet() string { return "hello" }

type ES struct{}
func (ES) Greet() string { return "hola" }

func main() {
    var g Greeter = EN{}
    greet := g.Greet // method value on an interface

    g = ES{} // change the interface's underlying value

    fmt.Println(greet()) // ?
}
```

**Hint:** When `g.Greet` is taken, what exactly does the closure remember?

**Bug:** A method value on an interface captures the interface value (its type
descriptor + underlying data) at binding time. Reassigning `g` afterwards
does not affect the previously bound `greet`. Output: `hello`, even though
"clearly `g` is now `ES{}`."

This is a frequent misunderstanding: people assume `g.Greet` will dispatch
through `g` *each call*, the way `g.Greet()` does when written inline. It
will not — it dispatches through the snapshot. The dispatch itself is still
dynamic (it correctly called `EN.Greet`, not some erased function), but the
*receiver* is frozen.

**Fix — keep the call dynamic by either calling through `g` directly or using
a method expression:**

```go
greet := func() string { return g.Greet() } // re-reads g each call
g = ES{}
fmt.Println(greet()) // hola
```

Or, if you really want a method expression on an interface:

```go
greet := Greeter.Greet // type: func(Greeter) string
g = ES{}
fmt.Println(greet(g)) // hola
```

---

## Cheat Sheet

```
METHOD VALUES vs METHOD EXPRESSIONS
─────────────────────────────────────────────
t.M   (method value)
    - signature: same as M, receiver pre-bound
    - receiver evaluated ONCE, at binding time
    - copies value receivers, captures pointer receivers
    - useful as a callback: matches func(args...) shapes

T.M   (method expression, value receiver method)
    - signature: func(T, args...) ret
    - receiver is the first parameter, supplied at each call
    - no implicit addressing; receiver type is rigid

(*T).M (method expression, pointer receiver method)
    - signature: func(*T, args...) ret
    - same: receiver is first parameter, no auto-address-taking

COMMON BUGS
─────────────────────────────────────────────
1.  Loop variable + method value (pre-1.22)        → all callbacks see last item
2.  Method value + goroutines + mutable receiver    → race; binding is not sync
3.  Assuming t.M re-reads t                          → it doesn't; snapshot only
4.  T.M called with subtype of T                    → no promotion; compile error
5.  Buffer.Write when Write has *Buffer receiver    → must spell (*Buffer).Write
6.  Method value on slice element across append     → backing array may move
7.  Method value stored in long-lived struct        → receiver leaks, GC blocked
8.  func() vs func(*T) confusion on channels        → method value vs expression
9.  Generic loop binding method values              → same loop-var trap as #1
10. reflect.Method(i) hard-coded index              → use MethodByName
11. Method value on an interface, then reassign     → snapshot, not dynamic ref
12. Pointer-method via T.M                          → undefined; need (*T).M

HEURISTICS
─────────────────────────────────────────────
- Need a no-arg callback that knows its target?     → method value
- Need to choose the receiver later, per call?      → method expression
- Receiver is mutable AND callback outlives loop?   → think about capture
- Reflecting?                                       → identify methods by name
- Generic types?                                    → same rules apply, no magic
```

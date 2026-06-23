# Method Sets Deep — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

---

## Bug 1 — Interface assignment with a value of `T`

```go
type Stringer interface{ String() string }

type Color struct{ R, G, B uint8 }
func (c *Color) String() string {
    return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B)
}

func main() {
    var s Stringer = Color{R: 255}
    fmt.Println(s)
}
```

**Hint:** Inspect the receiver of `String` and the operand type of the assignment.

**Bug:** `String` lives on `*Color`. `MethodSet(Color) = {}` for the relevant interface — it does not contain `String`. Interface satisfaction is a method-set check on the operand's type and never auto-addresses, so the assignment fails: `Color does not implement Stringer (String method has pointer receiver)`.

**Fix:**

```go
var s Stringer = &Color{R: 255}
```

Or change the receiver to value form: `func (c Color) String() string`.

---

## Bug 2 — Map element pointer-receiver call

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func main() {
    m := map[string]Counter{"a": {}}
    m["a"].Inc()
    fmt.Println(m["a"].n)
}
```

**Hint:** Map index expression addressability.

**Bug:** Map elements are not addressable — Go reserves the right to relocate them on rehash. The auto-address shortcut for `*Counter`'s `Inc` cannot fire. Compile error: `cannot call pointer method on m["a"]`.

**Fix:**

```go
c := m["a"]
c.Inc()
m["a"] = c
```

Or store pointers: `map[string]*Counter`, then `m["a"].Inc()` works because the index expression is already a pointer.

---

## Bug 3 — Composite literal as call target

```go
type Box struct{ size int }
func (b *Box) Resize(n int) { b.size = n }

func main() {
    Box{size: 1}.Resize(2)
}
```

**Hint:** A bare composite literal cannot be addressed in this position.

**Bug:** `Box{size: 1}` is a composite literal. As the receiver of a `*Box` method, it would need to be addressable so the compiler can pass `&Box{size: 1}`. The literal is not addressable in this position. Compile error: `cannot call pointer method on Box literal`.

**Fix:**

```go
b := Box{size: 1}
b.Resize(2)
```

Or use the special address-of-literal form:

```go
(&Box{size: 1}).Resize(2)
```

---

## Bug 4 — Interface variable holding a value, then mutating

```go
type Bumper interface{ Bump() }
type Counter struct{ n int }
func (c *Counter) Bump() { c.n++ }

func main() {
    c := Counter{}
    var b Bumper = c
    b.Bump()
    fmt.Println(c.n)
}
```

**Hint:** Two things go wrong; the compiler stops you at the first.

**Bug:** Even before the call, `var b Bumper = c` fails — `Counter`'s method set lacks `Bump`. If we "fix" it by writing `var b Bumper = &c`, the program compiles, but the second issue surfaces: even via the interface, `c` itself is mutated only because the interface holds `&c` directly. Storing a `Counter` value in `b` would have hidden the mutation behind a copy. The general rule: an interface dynamic value of type `T` is **not addressable** through the interface.

**Fix:**

```go
c := Counter{}
var b Bumper = &c
b.Bump()
fmt.Println(c.n)   // 1
```

---

## Bug 5 — Embedding by pointer with a nil zero value

```go
type Logger struct{}
func (l *Logger) Log(s string) { fmt.Println(l, s) }

type Service struct{ *Logger }

func main() {
    var s Service
    s.Log("hello")
}
```

**Hint:** What is `s.Logger` for the zero value?

**Bug:** Embedding `*Logger` makes the field a pointer that defaults to nil. `s.Log("hello")` calls `s.Logger.Log("hello")`, which is a method call on a nil `*Logger`. If the method dereferences (or, as written here, prints the receiver), the program runs because `Println` accepts a nil pointer, but the moment any field is touched it panics. The deeper issue: the zero value of `Service` is not usable.

**Fix:**

```go
type Service struct{ Logger Logger }   // value embedding, zero usable
```

Or initialize through a constructor:

```go
func NewService() *Service { return &Service{Logger: &Logger{}} }
```

---

## Bug 6 — Embedding by value, then expecting pointer-set parity on the outer value

```go
type Inner struct{}
func (i *Inner) P() {}

type Outer struct{ Inner }

func main() {
    var o Outer
    f := Outer.P     // method expression
    f(o)
}
```

**Hint:** What method set does the outer value type have?

**Bug:** `MethodSet(Outer)` is `{}` for promoted pointer methods of `Inner` — `P` lives only in `MethodSet(*Outer)` because the embedded `Inner` field needs to be addressable to form `&inner`. The method expression `Outer.P` does not exist. Compile error: `Outer.P undefined`.

**Fix:**

```go
f := (*Outer).P
f(&o)
```

---

## Bug 7 — Loop-captured method value (pre-1.22)

```go
type W struct{ id int }
func (w *W) Print() { fmt.Println(w.id) }

func main() {
    ws := []W{{1}, {2}, {3}}
    var fns []func()
    for _, w := range ws {
        fns = append(fns, w.Print)
    }
    for _, f := range fns { f() }
}
```

**Hint:** Which Go version are you compiling with?

**Bug:** Pre-Go 1.22, `w` is one variable across iterations. `w.Print` is a method value that binds `&w`. By the time the second loop runs, every captured `&w` points at the same final `w`, so the program prints `3 3 3`. Worse, because `Print` has a pointer receiver, the address itself is the captured state — not a per-iteration copy.

**Fix (works on any Go version):**

```go
for _, w := range ws {
    w := w   // shadow, fresh per iteration
    fns = append(fns, w.Print)
}
```

Or upgrade the module to `go 1.22` or later, which scopes the variable per iteration.

---

## Bug 8 — Method-value capture of a slice element

```go
type Job struct{ id int }
func (j *Job) Run() { fmt.Println(j.id) }

func main() {
    jobs := []Job{{1}, {2}, {3}}
    var fns []func()
    for i := range jobs {
        fns = append(fns, jobs[i].Run)
    }

    jobs = append(jobs, Job{99})
    for _, f := range fns { f() }
}
```

**Hint:** What does `jobs[i].Run` capture, and what does `append` do to the backing array?

**Bug:** `jobs[i].Run` captures `&jobs[i]`, a pointer into the slice's current backing array. `append` may allocate a new backing array, leaving the captured pointers dangling against the old array. The captured pointers still point at valid memory (the old array is kept alive by the closures), but mutations to the new `jobs` are invisible to the captured method values, and a future grow could orphan the old data unexpectedly. Output is `1 2 3` here, but the design is fragile — change one detail and bugs appear.

**Fix:**

```go
for i := range jobs {
    j := jobs[i]    // copy by value, the method binds &j (a fresh local)
    fns = append(fns, j.Run)
}
```

Or store pointers in the slice from the start: `[]*Job`.

---

## Bug 9 — Type assertion expecting pointer when value was stored

```go
type Greeter interface{ Hello() string }
type P struct{}
func (p P) Hello() string { return "hi" }

func main() {
    var g Greeter = P{}
    if pp, ok := g.(*P); ok {
        fmt.Println(pp.Hello())
    } else {
        fmt.Println("no *P")
    }
}
```

**Hint:** What is the dynamic type stored in `g`?

**Bug:** The dynamic type is `P`, not `*P`. Type assertions match the exact dynamic type — they do not perform method-set widening. The else branch fires, printing `no *P`. Programmers often expect `*P` to "win" because its method set is a superset of `P`'s, but that intuition does not match the runtime check.

**Fix:**

```go
if pp, ok := g.(P); ok {
    fmt.Println(pp.Hello())
}
```

Or store a pointer in the interface from the start: `var g Greeter = &P{}`.

---

## Bug 10 — Adding a method on an alias of a non-local type

```go
type Time = time.Time

func (t Time) IsLeap() bool {
    return t.Year()%4 == 0
}
```

**Hint:** Defined type vs alias.

**Bug:** `type Time = time.Time` is an alias (the `=`). Aliases share their method set with the aliased type — they cannot be the receiver of new methods, especially when the original type is in another package. Compile error: `cannot define new methods on non-local type time.Time`.

**Fix:**

```go
type MyTime time.Time   // defined type, no '='

func (t MyTime) IsLeap() bool {
    return time.Time(t).Year()%4 == 0
}
```

Note: defined types do not inherit methods from their underlying type, so you must convert (`time.Time(t)`) to call existing methods.

---

## Bug 11 — Forgetting that interfaces never auto-address

```go
type Mutator interface{ Mut() }
type S struct{ n int }
func (s *S) Mut() { s.n = 1 }

func use(m Mutator) { m.Mut() }

func main() {
    s := S{}
    use(s)
    fmt.Println(s.n)
}
```

**Hint:** Auto-addressing rule limits.

**Bug:** `use(s)` is an interface conversion. Even though `s` is addressable in `main`, the conversion happens at the call site by **copying** `s` into the interface as a value of type `S`. `S`'s method set lacks `Mut`. Compile error: `S does not implement Mutator`. Even if the conversion went through (it doesn't), mutation would happen on the interface's internal copy, not on `main`'s `s`.

**Fix:**

```go
use(&s)
fmt.Println(s.n)   // 1
```

---

## Bug 12 — Nested embedding and ambiguous selector

```go
type A struct{}
func (A) Name() string { return "A" }

type B struct{}
func (B) Name() string { return "B" }

type C struct {
    A
    B
}

func main() {
    var c C
    fmt.Println(c.Name())
}
```

**Hint:** Promotion at the same depth.

**Bug:** Both `A.Name` and `B.Name` are promoted to `C` at depth 1. Neither shadows the other, so `c.Name()` is ambiguous. Compile error: `ambiguous selector c.Name`. Method sets of `C` therefore do not include either `Name`.

**Fix:**

```go
fmt.Println(c.A.Name())   // explicit path
```

Or define `func (c C) Name() string { return c.A.Name() }` to disambiguate at depth 0, which shadows both.

---

## Bug 13 — Method value retains receiver across resizes

```go
type Buf struct{ s []byte }
func (b *Buf) Write(p []byte) (int, error) {
    b.s = append(b.s, p...)
    return len(p), nil
}

func collect(b Buf) func([]byte) {
    return func(p []byte) { b.Write(p) }
}

func main() {
    var b Buf
    write := collect(b)
    write([]byte("hi"))
    fmt.Println(string(b.s))
}
```

**Hint:** Where does the captured receiver live?

**Bug:** `collect` takes `b` **by value**, then captures `b.Write`. The method value binds `&b` — a pointer to the local parameter, not to `main`'s `b`. The append happens on the local copy, which is discarded when `collect` returns (kept alive only by the closure). `main`'s `b.s` stays nil. Output: empty string.

**Fix:**

```go
func collect(b *Buf) func([]byte) {
    return func(p []byte) { b.Write(p) }
}
// caller: write := collect(&b)
```

---

## Bug 14 — Method expression on the wrong receiver kind

```go
type T struct{}
func (t *T) M() {}

func main() {
    f := T.M
    f(T{})
}
```

**Hint:** What method expressions does `T` expose?

**Bug:** `T.M` would require `M` to be in `MethodSet(T)`. Since `M` has a pointer receiver, only `(*T).M` exists. Compile error: `T.M undefined`.

**Fix:**

```go
f := (*T).M
f(&T{})
```

---

## Cheat Sheet

```
RECURRING METHOD-SET BUGS
─────────────────────────────────
1. var i I = X{}   when *X has the method      → use &X{}
2. m["k"].PointerMethod()                       → copy out, mutate, copy back
3. Box{size: 1}.PointerMethod()                 → use (&Box{...}).M() or temp var
4. interface holding T, expecting mutation      → store *T from the start
5. embed *T with nil zero value                 → embed T or use constructor
6. embed T, expect Outer to have *T methods     → use *Outer
7. pre-1.22 loop captures of method values      → shadow w := w
8. slice grows after capturing &slice[i]        → copy by value before capture
9. type assertion to *T when stored T (or vv.)  → match the dynamic type exactly
10. method on alias of cross-package type       → use a defined type
11. ambiguous embed at same depth               → shadow at outer or qualify
12. method value escaping with stack receiver   → expect heap allocation

ADDRESSABILITY DECIDES EVERYTHING
─────────────────────────────────
addressable:     variables, fields of addressable structs,
                 slice/array elements, *p
NOT addressable: map elements, function returns, composite literals,
                 dynamic value inside an interface

INTERFACE ASSIGNMENT NEVER AUTO-ADDRESSES
─────────────────────────────────
- The compiler does not turn  T  into  *T  to fit an interface.
- Use the pointer explicitly, or move the method to the value receiver.

EMBEDDING METHOD-SET TABLE
─────────────────────────────────
embed T (value):
  Outer  inherits T's value methods
  *Outer inherits T's value AND pointer methods
embed *T (pointer):
  Outer  inherits T's value AND pointer methods
  *Outer inherits T's value AND pointer methods

GO 1.22 LOOP-VARIABLE CHANGE
─────────────────────────────────
< 1.22: range variable is reused; method-value captures share state.
≥ 1.22: range variable is per-iteration; captures are independent.
Verify with `go.mod`: `go 1.22` enables the new semantics.

TOOLING
─────────────────────────────────
go vet ./...          # passes-lock-by-value, copylocks, etc.
go build -gcflags='-m' # escape analysis output
staticcheck ./...     # SA-* checks for receiver consistency
```

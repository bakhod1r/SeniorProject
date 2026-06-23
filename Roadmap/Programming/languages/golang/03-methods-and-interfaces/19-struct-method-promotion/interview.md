# Struct Method Promotion - Interview Questions

> Scope note: This file is about **STRUCT method promotion** - methods of an embedded struct field becoming part of the outer struct's method set. The companion topic `06-embedding-interfaces` covers **interface embedding**, where one interface lists another. Several questions below highlight the distinction explicitly.

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What is struct method promotion?

**Answer:** When a struct contains an **embedded field** (a field declared with a type but no explicit name), the methods of that field's type are accessible directly on the outer struct as if they belonged to it.

```go
type Inner struct{}
func (Inner) Hello() string { return "hi" }

type Outer struct{ Inner }

var o Outer
fmt.Println(o.Hello()) // "hi" - Inner.Hello promoted
```

### Q2: How do you write an embedded field?

**Answer:** Just put the type name without giving it a field name.

```go
type Outer struct {
    Inner       // embedded value
    *Logger     // embedded pointer
    Name string // regular named field
}
```

### Q3: Is this inheritance like in Java?

**Answer:** No. Go uses **composition**, not inheritance. The Go FAQ says explicitly: "embedding is not subclassing." There is no `super`, no virtual dispatch, and the inner type has no awareness of being embedded.

### Q4: How do you call the inner method explicitly?

**Answer:** Use the inner type name as a field qualifier.

```go
o.Inner.Hello()  // explicit
o.Hello()        // promoted shortcut
```

Both reach the same method.

### Q5: What is the difference between `struct { Inner }` and `struct { Inner Inner }`?

**Answer:** The first is **embedded** (anonymous) - methods of `Inner` are promoted to the outer struct. The second is a **named field** - methods are not promoted; you must call `o.Inner.Method()` explicitly.

### Q6: Can you embed a built-in type like `int`?

**Answer:** Yes, but only via a defined type, since `int` itself has no methods. Usually you embed a defined type like `time.Time` or a custom type.

```go
type Counter struct {
    int  // legal but unusual - field name is "int"
}
```

### Q7: How is this different from interface embedding (topic 06)?

**Answer:**
- **Struct method promotion** (this topic): an outer struct embeds an inner **struct** (or pointer to struct) and inherits its **concrete methods**.
- **Interface embedding** (topic 06): an interface declaration includes another interface and inherits its **method signatures**.

The first creates concrete types with implementations; the second creates abstract types with method requirements.

### Q8: Can two different fields use the same embedded type?

**Answer:** No, because the field name is the unqualified type name. Two embedded fields with the same name produce a duplicate-field compile error.

```go
// type Bad struct {
//     Inner
//     Inner   // compile error - duplicate field
// }
```

---

## Middle-Level Questions

### Q9: What is the method-set rule for embedding a value `T`?

**Answer:**
- Method set of `Outer` (value) gains `T`'s value methods.
- Method set of `*Outer` gains `T`'s value methods AND `*T`'s pointer methods (because `*Outer` lets the compiler take the address of the embedded value).

```go
type Inner struct{}
func (i  Inner) V() {}
func (i *Inner) P() {}

type Outer struct{ Inner }

var o Outer
o.V()   // OK
o.P()   // OK if o is addressable - compiler takes &o.Inner
```

### Q10: What is the method-set rule for embedding a pointer `*T`?

**Answer:** Both `Outer` and `*Outer` gain the full method set of `T` (value methods plus pointer methods), because the embedded pointer is already addressable through one level of indirection.

```go
type Outer struct{ *Inner }
// Both Outer and *Outer have V() and P()
```

### Q11: Why does `o.P()` fail when `o` is the result of a function call?

**Answer:** Function results are **not addressable**. `P()` has a pointer receiver and the compiler needs to take `&o.Inner` to call it. The address-of operator only works on addressable expressions: named variables, dereferenced pointers, slice indices, struct fields of addressable structs.

```go
func makeOuter() Outer { return Outer{} }
makeOuter().P() // compile error
o := makeOuter()
o.P()           // OK
```

### Q12: What happens when two embedded fields have a method with the same name?

**Answer:** It is a **compile error at the use site** - "ambiguous selector". Go does not pick a winner.

```go
type A struct{}; func (A) M() {}
type B struct{}; func (B) M() {}
type C struct{ A; B }

var c C
// c.M() // compile error: ambiguous selector c.M
c.A.M()   // explicit qualification
c.B.M()   // explicit qualification
```

The error is reported only when `c.M` is actually used, not when `C` is declared. The mere existence of `C` is fine.

### Q13: How is shadowing different from override?

**Answer:** Shadowing in Go is **purely lexical** - the outer type's method at depth 0 wins over the promoted method at depth 1. There is no runtime polymorphism. The promoted method is still reachable via `o.Inner.M()`.

```go
type Inner struct{}
func (Inner) Greet() string { return "inner" }

type Outer struct{ Inner }
func (Outer) Greet() string { return "outer" }

o := Outer{}
o.Greet()       // "outer"
o.Inner.Greet() // "inner"
```

This is unlike Java, where calling the inner version requires `super.greet()`.

### Q14: Does the inner method know it has been embedded?

**Answer:** No. The receiver of a promoted method is the inner value, not the outer struct. There is no way for the inner method to access fields of the outer struct.

```go
type Inner struct{ N int }
func (i Inner) Show() string { return fmt.Sprint(i.N) }

type Outer struct {
    Inner
    N int
}

o := Outer{Inner: Inner{N: 1}, N: 99}
fmt.Println(o.Show()) // "1" - reads Inner.N, not Outer.N
```

### Q15: Why is embedding `sync.Mutex` a common pattern?

**Answer:** Because the methods `Lock` and `Unlock` are then promoted to the outer type, callers can write `c.Lock()` instead of `c.mu.Lock()`. The trade-off is that the locking API becomes part of the outer struct's public method set.

```go
type Counter struct {
    sync.Mutex
    n int
}

func (c *Counter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}
```

### Q16: When should you NOT embed `sync.Mutex`?

**Answer:** When the lock is an internal implementation detail and you do not want callers to be able to manipulate it directly. Then use a named lowercase field:

```go
type Counter struct {
    mu sync.Mutex  // private, no promotion
    n  int
}
```

The standard library (`sync.Map`, `bytes.Buffer`) uses named locks for this reason.

### Q17: Does `go vet` warn about value receivers on a struct embedding `sync.Mutex`?

**Answer:** Yes - "passes lock by value" or "Inc passes lock by value: Counter contains sync.Mutex". A value receiver would copy the lock, which is a correctness bug.

```go
type Counter struct{ sync.Mutex; n int }
func (c Counter) Inc() { c.Lock() } // go vet flags this
```

### Q18: How does interface satisfaction interact with embedding?

**Answer:** A type satisfies an interface if its method set contains every method the interface requires. Promoted methods count. So embedding can be a quick way to satisfy an interface.

```go
type Closer interface{ Close() error }

type Resource struct{}
func (r *Resource) Close() error { return nil }

type Manager struct{ *Resource } // Manager and *Manager get Close

var _ Closer = &Manager{Resource: &Resource{}}
```

### Q19: What is the difference between embedding `Resource` and embedding `*Resource`?

**Answer:**
- Embedding `Resource` (value): `*Manager` has `Close()` because Manager is addressable when used as a pointer. `Manager` (value) does NOT have `Close()` if `Close` has a pointer receiver.
- Embedding `*Resource`: both `Manager` and `*Manager` have `Close()` because the embedded pointer is already addressable.

This is the most common source of "does not implement Closer" errors.

### Q20: What does "diamond problem" mean and why doesn't Go have it?

**Answer:** In some inheritance languages a class can inherit from two parents that both inherit from a common grandparent, leading to questions like "does this class have one or two grandparent instances?" Go avoids the question entirely:

- Each embedded field is a **distinct field** in the outer struct. Embedding `Mid1` and `Mid2`, both of which embed `Base`, gives the outer struct two separate `Base` values - one inside each mid.
- Any selector that could resolve to either is a **compile error**. The user must qualify explicitly.

```go
type Base struct{ ID string }
func (b Base) BaseID() string { return b.ID }

type Mid1 struct{ Base }
type Mid2 struct{ Base }

type Derived struct{ Mid1; Mid2 }

var d Derived
// d.BaseID() // compile error - ambiguous
d.Mid1.BaseID() // OK
d.Mid2.BaseID() // OK
```

There is no diamond because the language never silently picks one path.

---

## Senior-Level Questions

### Q21: How does the spec define "promoted"?

**Answer:** From the [Selectors](https://go.dev/ref/spec#Selectors) section: "A field or method `f` of an embedded field in a struct `x` is called promoted if `x.f` is a legal selector that denotes that field or method `f`." The selector is legal if there is exactly one `f` at the shallowest depth in the embedded-field tree.

### Q22: How does shallowest-depth resolution work with multi-level embedding?

**Answer:** The compiler walks the embedded-field tree and groups all matches by depth. The shallowest depth where `f` appears wins. If multiple matches exist at that depth, the selector is ambiguous.

```go
type L1 struct{}
func (L1) M() {}

type L2 struct{ L1 }
func (L2) M() {} // depth 0 of L2

type L3 struct{ L2 }

var x L3
x.M() // resolves to L2.M (depth 1 of L3); L1.M at depth 2 is ignored
```

### Q23: Why is there no "virtual dispatch" through embedding?

**Answer:** Promotion is a compile-time selector rewrite, not a runtime mechanism. `o.M()` becomes `o.Inner.M()` during compilation. There is no vtable that maps `Outer.M` to `Inner.M` at runtime. This means an inner method called from another inner method cannot magically dispatch to an outer override - the outer method does not exist from the inner's point of view.

```go
type Inner struct{}
func (i Inner) A() string { return i.B() } // calls Inner.B always
func (i Inner) B() string { return "inner B" }

type Outer struct{ Inner }
func (Outer) B() string { return "outer B" }

var o Outer
fmt.Println(o.A()) // "inner B" - not "outer B"
```

This is the fundamental reason "embedding is not subclassing."

### Q24: What is the addressability subtlety for promoted pointer-receiver methods?

**Answer:** When `Outer` embeds value `T` and `T` has a method with `*T` receiver, the method is in `*Outer`'s method set. From a value of `Outer`, the call `o.M()` works **only if `o` is addressable** (the compiler synthesizes `(&o.Inner).M()`). Common non-addressable contexts:

- Map element access: `m["k"].M()` is illegal.
- Function return value: `getOuter().M()` is illegal.
- Interface value (because the interface holds a copy): `var i I = outer; i.M()` works only if the interface was filled with `*Outer`, not `Outer`.

### Q25: How does embedding affect interface satisfaction with pointer methods?

**Answer:** This is the canonical "value vs pointer embed" decision.

```go
type Closer interface{ Close() error }

type R struct{}
func (r *R) Close() error { return nil }

type AVal struct{ R }    // value embed
type APtr struct{ *R }   // pointer embed

var _ Closer = &AVal{}    // OK - *AVal's set has Close
// var _ Closer = AVal{}  // compile error
var _ Closer = APtr{R: &R{}} // OK - APtr's set has Close
var _ Closer = &APtr{R: &R{}}// OK
```

**Rule of thumb:** if the inner type's interesting methods have pointer receivers and you sometimes need the outer type to satisfy an interface as a value, embed the pointer.

### Q26: What happens to a promoted method value's receiver capture?

**Answer:** When you create a method value `o.Promoted`, the compiler captures the appropriate receiver - either a copy of `o.Inner` or `&o.Inner`, depending on the original receiver type. Subsequent mutations to `o.Inner` (when the captured value is a copy) are not visible.

```go
type Inner struct{ N int }
func (i Inner) Get() int { return i.N }

type Outer struct{ Inner }

o := Outer{Inner{N: 1}}
mv := o.Get
o.Inner.N = 99
fmt.Println(mv()) // 1 - captured a copy
```

For pointer-receiver promoted methods, the captured value is a pointer:

```go
func (i *Inner) Get() int { return i.N }
o := Outer{Inner{N: 1}}
mv := o.Get
o.Inner.N = 99
fmt.Println(mv()) // 99 - pointer captured
```

### Q27: Can a struct embed a generic type's instantiation?

**Answer:** Yes, since Go 1.18.

```go
type List[T any] struct{ items []T }
func (l *List[T]) Add(x T) {}

type IntList struct {
    List[int]   // field name is "List" (no type args in name)
}

var il IntList
il.Add(42)      // promoted from List[int]
```

The field name is the **base name** of the generic type, without type arguments.

### Q28: Can a struct embed an interface? What does that mean for the method set?

**Answer:** Yes, the embedded type may be an interface. The methods of the interface are promoted to the outer struct's method set. At runtime, the calls dispatch through the interface stored in the field.

```go
type Service struct {
    io.ReadWriter
}

s := Service{ReadWriter: someConn}
s.Read(buf)   // dispatches to someConn.Read at runtime
s.Write(buf)
```

This is a frequently-used **test stub** pattern: embed the interface, fill in only the methods you want to mock; the rest are inherited from the (possibly nil!) interface value and will panic if called.

### Q29: What is the difference between this pattern and the `06-embedding-interfaces` topic?

**Answer:**
- Topic 19 (this): a **struct** embeds **another struct** (or pointer-to-struct, or a struct field whose declared type is an interface). Concrete methods are promoted to a concrete type.
- Topic 06: an **interface** type definition lists another **interface** type. The method signatures of the embedded interface become required by the outer interface.

```go
// Topic 06 - interface embeds interface (signatures inherited)
type ReadWriter interface {
    io.Reader
    io.Writer
}

// Topic 19 - struct embeds struct (concrete methods promoted)
type Cache struct {
    sync.Mutex
    data map[string]string
}
```

### Q30: How do you debug an "ambiguous selector" error in a deep embedding tree?

**Answer:**

1. List every embedded chain that could resolve to the method name.
2. For each chain, compute the depth.
3. Find chains at the same minimum depth - those are the conflicting candidates.
4. Resolve by either:
   - Adding an explicit method on the outer type that delegates to the chosen inner.
   - Using `outer.Path.M()` at the call site.
   - Removing one of the embedded fields if it's unnecessary.

Tools: `go doc -all <pkg>.Outer` lists the promoted methods; `go vet` does not catch dormant ambiguity, so code review is critical.

---

## Tricky / Curveball Questions

### Q31: What does this print?

```go
type Inner struct{ N int }
func (i Inner) Show() { fmt.Println(i.N) }

type Outer struct {
    Inner
    N int
}

o := Outer{Inner: Inner{N: 1}, N: 2}
o.Show()
```

- a) 1
- b) 2
- c) Compile error
- d) 0

**Answer: a) 1**

`Show` is a promoted method bound to `o.Inner`. Inside `Show`, `i.N` is `o.Inner.N`, not `o.N`.

### Q32: What does this code do?

```go
type A struct{}
func (A) M() string { return "A" }

type B struct{}
func (B) M() string { return "B" }

type C struct {
    A
    B
}
```

- a) Compile error at type definition
- b) Compiles fine; `C{}.M()` returns "A"
- c) Compiles fine; calling `C{}.M()` is a compile error
- d) Compiles fine; calling `C{}.M()` panics

**Answer: c)**

The struct definition is legal. The ambiguity surfaces only when somebody actually calls `C{}.M()`.

### Q33: What does this print?

```go
type Inner struct{}
func (i *Inner) M() string { return "inner" }

type Outer struct{ Inner } // value embed

func main() {
    o := Outer{}
    fmt.Println(o.M())
}
```

- a) "inner"
- b) Compile error - cannot call pointer receiver method on value
- c) Runtime panic - nil pointer
- d) Compile error - method not in set

**Answer: a) "inner"**

`o` is addressable (named local variable), so the compiler synthesizes `(&o.Inner).M()`. The fact that `M` has a pointer receiver and `Outer` embeds `Inner` by value is fine when the outer value is addressable.

### Q34: What if `o` were not addressable?

```go
func makeO() Outer { return Outer{} }
makeO().M()
```

**Answer:** Compile error: "cannot call pointer method on makeO()". Function return values are not addressable.

### Q35: What does this code do?

```go
type I interface{ M() }
type T struct{}
func (T) M() {}

type W struct {
    I
}

w := W{}
w.M()
```

- a) Calls T.M
- b) Compile error
- c) Runtime panic - nil interface
- d) Does nothing silently

**Answer: c) Runtime panic**

`w.I` is a nil interface (zero value). The method is in `W`'s set (promoted from `I`), but at runtime the call dispatches through the nil interface and panics.

### Q36: Can you do this?

```go
type T struct{}
type S struct{ **T }
```

**Answer:** No - compile error. The spec forbids embedding pointer-to-pointer types.

### Q37: Can you do this?

```go
type I interface{}
type S struct{ *I }
```

**Answer:** No - compile error. Pointer to interface cannot be an embedded field.

### Q38: What is the field name here?

```go
import "image"
type S struct {
    image.Point
}
```

**Answer:** `Point` (the unqualified name). To access it: `s.Point`. The `image` qualifier is part of the type, not the field name.

### Q39: What does this print?

```go
type T struct{ X int }

type Outer struct {
    T
    X int
}

func main() {
    o := Outer{T: T{X: 1}, X: 2}
    fmt.Println(o.X)
    fmt.Println(o.T.X)
}
```

**Answer:**
```
2
1
```

`o.X` resolves to the depth-0 `Outer.X`. `o.T.X` reaches the inner field explicitly.

### Q40: What is the method-set of `Outer` here?

```go
type Inner struct{}
func (i  Inner)  A() {}
func (i *Inner)  B() {}

type Outer struct{ Inner }
```

**Answer:**
- `Outer` (value): {A}
- `*Outer`: {A, B}

`B` requires a pointer receiver, and `Outer`-as-value cannot guarantee addressability of `Outer.Inner`, so `B` is not in `Outer`'s value method set.

---

## Coding Tasks

### Task 1: Service with embedded Logger

```go
// Build a Service that embeds *Logger so that Info/Warn/Error are
// callable directly on the service, with safe behavior when the
// logger is nil.
```

**Solution:**

```go
type Logger struct {
    prefix string
    out    io.Writer
}

func (l *Logger) Info(msg string)  { l.write("INFO", msg) }
func (l *Logger) Warn(msg string)  { l.write("WARN", msg) }
func (l *Logger) Error(msg string) { l.write("ERROR", msg) }

func (l *Logger) write(level, msg string) {
    if l == nil { return } // nil-safe
    fmt.Fprintln(l.out, l.prefix, level, msg)
}

type Service struct {
    *Logger
    repo UserRepo
}

func NewService(repo UserRepo, log *Logger) *Service {
    return &Service{Logger: log, repo: repo}
}
```

### Task 2: Resolve ambiguity

```go
// A and B both have Run(). Build C that embeds both, makes c.Run()
// legal, and prefers A's Run.
```

**Solution:**

```go
type A struct{}; func (A) Run() string { return "A" }
type B struct{}; func (B) Run() string { return "B" }

type C struct {
    A
    B
}

func (c C) Run() string { return c.A.Run() } // shadow + delegate
```

### Task 3: Counter with embedded Mutex

```go
// SafeCounter that uses sync.Mutex via embedding, with Inc, Dec, Value.
```

**Solution:**

```go
type SafeCounter struct {
    sync.Mutex
    n int
}

func (c *SafeCounter) Inc() {
    c.Lock()
    defer c.Unlock()
    c.n++
}

func (c *SafeCounter) Dec() {
    c.Lock()
    defer c.Unlock()
    c.n--
}

func (c *SafeCounter) Value() int {
    c.Lock()
    defer c.Unlock()
    return c.n
}
```

Always pointer receivers - copying a struct with an embedded mutex is a bug `go vet` flags.

### Task 4: Decorator via embedding

```go
// Wrap *sql.DB with a TracingDB that logs every QueryContext call,
// without re-implementing the rest of the *sql.DB API.
```

**Solution:**

```go
type TracingDB struct {
    *sql.DB
}

func (t *TracingDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
    log.Println("query:", q)
    return t.DB.QueryContext(ctx, q, args...)
}
```

`t.DB.QueryContext` is the explicit qualifier that reaches the embedded original. Without it the method recurses.

### Task 5: Diagnose this code

```go
type Inner struct{ N int }
func (i *Inner) Inc() { i.N++ }

type Outer struct{ Inner }

func main() {
    m := map[string]Outer{"k": {}}
    m["k"].Inc()
}
```

**Question:** Why does this fail?

**Answer:** `m["k"]` returns a non-addressable copy. `Inc` has a pointer receiver, so the compiler needs `&m["k"].Inner` - but map elements are not addressable. The fix:

```go
v := m["k"]
v.Inc()
m["k"] = v
```

### Task 6: Distinguish topic 19 from topic 06

```go
// Show one example of struct method promotion (this topic) and one of
// interface embedding (topic 06). Explain the difference.
```

**Solution:**

```go
// Topic 19 - struct method promotion
type Inner struct{}
func (Inner) Hello() string { return "hi" }
type Outer struct{ Inner }
var _ = Outer{}.Hello() // concrete method promoted

// Topic 06 - interface embedding
type Reader interface { Read([]byte) (int, error) }
type Closer interface { Close() error }
type ReadCloser interface {
    Reader
    Closer
}
// ReadCloser's method set is {Read, Close} via interface inheritance
```

Topic 19 produces a **concrete type** with promoted **method bodies**. Topic 06 produces an **abstract type** with inherited **method signatures**.

---

## System Design Style

### Q41: When should you embed a struct in production code?

**Answer:** When the outer type is meant to be **substitutable** for the inner type wherever the inner type's interface is required, and you accept the inner type's full public API as part of the outer type's permanent contract. Otherwise prefer a named field for encapsulation.

### Q42: How do you decide between embedding a struct vs embedding an interface?

**Answer:**
- **Embed struct** (or `*struct`): you have a concrete inner type and want its concrete behavior promoted. The inner field is a real value with state.
- **Embed interface**: you want the outer type to delegate to **any** implementation of the interface; the embedded field is a pluggable extension point. Useful for test stubs and decorators.

### Q43: How do you write a decorator?

**Answer:** Embed the type you want to decorate (concrete or interface), then declare on the outer type the methods you want to override. Inside the override, call the embedded version explicitly when you want to delegate.

```go
type LoggingRepo struct {
    UserRepo
}

func (l LoggingRepo) Find(ctx context.Context, id string) (*User, error) {
    log.Println("find:", id)
    return l.UserRepo.Find(ctx, id)
}
```

### Q44: How do you migrate from embedded `*Logger` to a curated API?

**Answer:**

1. Find every external use of `service.Logger.X` and replace with explicit named-field calls.
2. Change the struct from `*Logger` (embedded) to `log *Logger` (named).
3. Add explicit forwarding methods on the service for each method you want to keep public: `func (s *Service) Info(msg string) { s.log.Info(msg) }`.
4. Remove the unused promoted methods from the contract.

This is a breaking change for external callers who used `s.Logger.X` directly, but a non-breaking change for callers who only used the promoted forms `s.X`.

### Q45: How do you handle a future addition to an inner type's API?

**Answer:** If the inner type is in your control, code review every new method for whether it should also be in the outer type's contract. If the inner type is a third-party library, prefer named fields - you do not want a library upgrade to silently grow your public API.

---

## What Interviewers Look For

### Junior

- Knows what an embedded field looks like in syntax
- Can call promoted methods and explain `outer.Inner.M()`
- Understands embedding is composition, not inheritance

### Middle

- Knows the method-set propagation rules for value-embed vs pointer-embed
- Can predict interface satisfaction outcomes
- Understands ambiguous selectors and how to resolve them
- Distinguishes shadowing from override

### Senior

- Articulates why embedding is not subclassing (no virtual dispatch, no `super`)
- Knows the addressability rules that govern pointer-receiver promoted methods
- Understands the difference from `06-embedding-interfaces`
- Can refactor between embed and named-field forms safely

### Professional

- Treats every promoted method as part of the public API contract
- Avoids embedding `sync.Mutex` or `*http.Client` in publicly visible types
- Resolves dormant ambiguity eagerly in code review
- Documents shadowing decisions and the explicit-qualification fallback

---

## Cheat Sheet

```
SYNTAX
─────────────────────────────────────────
type Outer struct { Inner }     // value embed
type Outer struct { *Inner }    // pointer embed
field name = unqualified type name

METHOD SET RULES
─────────────────────────────────────────
Embed Inner:
  Outer  : Inner's value methods
  *Outer : Inner's value + pointer methods
Embed *Inner:
  Both Outer and *Outer: full Inner method set

AMBIGUITY
─────────────────────────────────────────
Two embedded fields, same method name → compile error AT USE
Resolve via: outer.Inner.M()  OR  define M on outer

SHADOWING
─────────────────────────────────────────
Outer's method wins; promoted reachable via outer.Inner.M()
No virtual dispatch - inner methods do NOT call outer overrides

ADDRESSABILITY GOTCHAS
─────────────────────────────────────────
m["k"].PromotedPtrMethod()  → compile error
funcReturnVal.PromotedPtrMethod() → compile error
Fix: assign to a local, call, write back if needed

19 vs 06
─────────────────────────────────────────
19: struct embeds struct/interface field → CONCRETE method promotion
06: interface embeds interface → method-SIGNATURE inheritance
```

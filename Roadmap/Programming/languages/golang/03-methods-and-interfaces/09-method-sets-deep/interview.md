# Method Sets Deep — Interview Questions

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

### Q1: What is a method set?

**Answer:** A method set is the set of methods that can be called on a value of a given type. For type `T`, the method set contains every method declared with receiver `T`. For type `*T`, the method set contains every method declared with either receiver `T` or `*T`. The method set determines which interfaces the type satisfies.

```go
type T struct{}
func (t T) A()  {}
func (t *T) B() {}

// MethodSet(T)  = {A}
// MethodSet(*T) = {A, B}
```

### Q2: Why does `*T` include value-receiver methods but not the other way around?

**Answer:** Given a `*T` you can always reach the underlying value (`*p`), so a value-receiver method is callable. Given a `T`, you do not always have an addressable storage location, so the language cannot promise that a `*T` method has somewhere to point to.

### Q3: What does "addressable" mean?

**Answer:** An expression is addressable if you can take its address with `&`. Variables, indexable elements of arrays/slices, and dereferenced pointers are addressable. Map elements, function return values, and constants are not.

```go
var x int           // addressable
arr := [3]int{}     // arr[0] addressable
sl := []int{1}      // sl[0]  addressable
m := map[string]int{} // m["k"] NOT addressable
```

### Q4: Why doesn't `var i Stringer = X{}` compile when only `(*X).String()` exists?

**Answer:** The interface assignment uses the method set of the operand. `X{}` is of type `X`, whose method set excludes pointer-receiver methods. `String()` is therefore not in the set, so the interface contract is unmet.

```go
type Stringer interface{ String() string }
type X struct{}
func (x *X) String() string { return "x" }

// var i Stringer = X{}   // ERROR
var i Stringer = &X{}     // OK
```

### Q5: Does Go ever auto-take the address of a value to satisfy an interface?

**Answer:** No. The compiler will auto-address for a method **call** on an addressable variable (`x.M()` becomes `(&x).M()`), but never for an interface assignment. Interface satisfaction is purely a method-set check on the expression's type.

---

## Middle-Level Questions

### Q6: Why is `m["k"].PointerMethod()` rejected when the value is a pointer-receiver method?

**Answer:** Calling a `*T` method requires an addressable receiver so the compiler can take its address. Map index expressions are explicitly non-addressable in the spec — Go reserves the right to relocate hash-map entries during rehashing. Without a stable address, the auto-address shortcut cannot apply.

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

m := map[string]Counter{"a": {}}
// m["a"].Inc()       // ERROR: cannot take address of m["a"]
c := m["a"]; c.Inc(); m["a"] = c   // workaround
// or: map[string]*Counter
```

### Q7: Are composite literals addressable?

**Answer:** A bare composite literal like `T{}` is **not** addressable — `&T{}.field` is a syntax/semantics error in some positions, but `&T{}` itself is allowed as a special case for taking the address of the literal as a whole. As a method call target, `T{}.PointerMethod()` is rejected because `T{}` cannot be made into an `&T{}` expression that becomes the receiver.

```go
type X struct{}
func (x *X) M() {}

// X{}.M()       // ERROR: cannot call pointer method on X literal
(&X{}).M()       // OK
x := X{}; x.M()  // OK — x is addressable
```

### Q8: What method set does an interface variable expose?

**Answer:** When an interface holds a concrete value of type `V`, the dynamic value is **not addressable** through the interface. You can call any method already in the interface, but you cannot recover `&V`. If you need pointer behaviour, the value must already have been stored as a pointer.

```go
type Inc interface{ Inc() }
type C struct{ n int }
func (c *C) Inc() { c.n++ }

var i Inc = &C{}     // must store *C
i.Inc()              // OK
```

### Q9: How does embedding affect method-set propagation?

**Answer:** When `Outer` embeds `Inner`, methods promoted from `Inner` join `Outer`'s method set with the same receiver kind. Embedding `Inner` (value) promotes only value-receiver methods to `Outer`'s value method set — pointer methods are still reachable through `*Outer`. Embedding `*Inner` (pointer) promotes both value- and pointer-receiver methods to `Outer`'s value method set, because `*Inner` already supplies the pointer.

```go
type Inner struct{}
func (i Inner)  V() {}
func (i *Inner) P() {}

type ByValue   struct{ Inner }
type ByPointer struct{ *Inner }

// MethodSet(ByValue)    = {V}
// MethodSet(*ByValue)   = {V, P}
// MethodSet(ByPointer)  = {V, P}
// MethodSet(*ByPointer) = {V, P}
```

### Q10: What is the rule for the loop variable since Go 1.22?

**Answer:** Before 1.22, the loop variable in `for _, v := range s` was a single variable reused per iteration; capturing `&v` or `v.Method` retained the last value. From 1.22 the variable is scoped per-iteration, so each capture sees its own copy. This directly affects method values bound inside loops.

```go
for _, t := range items {
    go t.Run()        // Go 1.22+: each goroutine sees its own t
}
```

---

## Senior-Level Questions

### Q11: Walk through the spec rules for method sets.

**Answer:** The spec states:

1. The method set of an interface type is its interface.
2. The method set of a defined type `T` consists of all methods declared with receiver type `T`.
3. The method set of a pointer type `*T` (where `T` is a defined non-pointer, non-interface type) consists of all methods declared with receiver `*T` or `T`.

A method `m` is callable on `x` if `m` is in the method set of `x`'s type, **or** `x` is addressable and `&x`'s method set contains `m`. The second clause is the source of every "auto-address" shortcut.

### Q12: What is the difference between a method-set check and a method-call check?

**Answer:**
- **Method-set check** (interface assignment, type assertion): only methods literally in the type's method set count. No auto-addressing.
- **Method-call check** (`x.M()`): methods in `T`'s method set are callable; if `x` is addressable and `*T`'s set has `M`, the compiler implicitly substitutes `(&x).M()`.

This is why `x.M()` compiles even when only `(*T).M` exists, but `var i I = x` does not.

### Q13: Why does embedding a value-typed field still let `*Outer` call pointer methods of the embedded type?

**Answer:** When the outer is `*Outer`, the embedded field is reached via `(*outer).Inner`, which is addressable (a field of an addressable struct is addressable). The compiler can therefore take `&(*outer).Inner` to satisfy the pointer receiver. The method set of `*Outer` accordingly includes the pointer methods of `Inner`.

```go
type Inner struct{}
func (i *Inner) P() {}

type Outer struct{ Inner }

var o Outer
o.P()       // OK — o.Inner is addressable
(&o).P()    // OK — explicit
```

### Q14: How does interface satisfaction interact with anonymous-pointer embedding?

**Answer:** Embedding `*Inner` in a struct gives the outer's value type the entire method set of `*Inner`. This is the canonical pattern for decorators: the wrapper holds an interface (or pointer) and inherits its methods, then overrides one or two by re-declaring them on the wrapper.

```go
type Repo interface{ Find(id string) string }

type LoggingRepo struct{ Repo }
func (l LoggingRepo) Find(id string) string {
    log.Println("find", id)
    return l.Repo.Find(id)
}
```

### Q15: When does method-set semantics force a heap allocation?

**Answer:** When Go must take the address of a stack value to satisfy a pointer-receiver method that escapes (for example, becoming the dynamic value of an interface, or being captured by a goroutine), the value must move to the heap. The method-set check tells the compiler an address is needed; escape analysis then promotes it.

```go
type S struct{ n int }
func (s *S) M() {}

func leak() interface{ M() } {
    s := S{}
    return &s     // s escapes to heap
}
```

---

## Tricky / Curveball Questions

### Q16: What does the following print?

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

s := []T{{1}, {2}}
s[0].Inc()
fmt.Println(s[0].n)
```

- a) 1
- b) 2
- c) Compile error
- d) Panic

**Answer: b — 2**

Slice elements are addressable, so `s[0].Inc()` compiles as `(&s[0]).Inc()`. The pointer receiver mutates the element in place.

### Q17: Same idea, but with a map. What happens?

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

m := map[string]T{"k": {1}}
m["k"].Inc()
```

- a) Mutates m["k"]
- b) Silent no-op
- c) Compile error
- d) Runtime panic

**Answer: c — Compile error**

Map elements are not addressable, so the auto-address shortcut cannot fire.

### Q18: What does this compile to?

```go
type Stringer interface{ String() string }
type X struct{}
func (x *X) String() string { return "x" }

func f(s Stringer) {}

f(X{})
```

- a) Compiles, prints "x"
- b) Compile error
- c) Compiles, prints empty
- d) Runtime panic

**Answer: b — Compile error**

`X{}` is type `X`. `String()` lives only on `*X`, so it is not in `X`'s method set. The implicit interface conversion fails. Use `f(&X{})` instead — but note that `&X{}` is one of the few cases where a literal can have its address taken because the compiler treats `&Composite{}` specially.

### Q19: Embed by value or by pointer? What is the difference here?

```go
type Logger struct{}
func (l *Logger) Log(s string) { fmt.Println(s) }

type A struct{ Logger }
type B struct{ *Logger }

var a A
var b B
a.Log("hi")
b.Log("hi")    // ?
```

**Answer:** `a.Log("hi")` works — `a` is addressable, so `(&a.Logger).Log()` is generated. `b.Log("hi")` panics: `B`'s embedded `*Logger` is the zero value `nil`, and `Log` dereferences nothing — wait, here it doesn't dereference. The actual call `b.Logger.Log("hi")` calls a method on a nil `*Logger`; since the method itself prints without touching the receiver, it works. The interview point: by-value embedding gives you a usable zero value, by-pointer embedding gives you an opt-in dependency you must initialize.

### Q20: Which assignments compile?

```go
type I interface{ M() }
type T struct{}
func (t *T) M() {}

var t T
var i1 I = t       // 1
var i2 I = &t      // 2
var i3 I = T{}     // 3
var i4 I = &T{}    // 4
```

- a) 2 only
- b) 2 and 4
- c) 1, 2, 4
- d) All

**Answer: b — 2 and 4**

`M` lives on `*T`. Only `*T` operands satisfy `I`. There is no implicit addressing in interface assignments, so neither `t` nor `T{}` qualifies even though `t` is addressable.

### Q21: Type assertion direction surprise.

```go
type I interface{ M() }
type T struct{}
func (t T) M() {}

var i I = T{}
v, ok := i.(*T)
fmt.Println(ok)
```

**Answer:** `false`. The dynamic type stored in `i` is `T`, not `*T`. Type assertions match the exact dynamic type; method-set inclusion does not turn `T` into `*T` retroactively.

---

## Coding Tasks

### Task 1: Make a value type satisfy an interface that requires a pointer method

```go
type Stringer interface{ String() string }
type Color struct{ R, G, B uint8 }
// Currently has only func (c *Color) String() string {...}
// Modify so Color (value) satisfies Stringer.
```

**Solution:**

```go
func (c Color) String() string {
    return fmt.Sprintf("#%02x%02x%02x", c.R, c.G, c.B)
}
```

Switching to a value receiver puts `String` in `Color`'s method set. If mutation were required, the alternative is to always pass `&Color{}`.

### Task 2: Print method-set membership at runtime

```go
// Given an arbitrary value, print all methods in its method set.
```

**Solution:**

```go
import "reflect"

func DumpMethods(x any) {
    t := reflect.TypeOf(x)
    for i := 0; i < t.NumMethod(); i++ {
        fmt.Println(t.Method(i).Name)
    }
}
```

`reflect.TypeOf(x)` returns the dynamic type. Pass a value or a pointer to see the difference.

### Task 3: Force a map to support pointer-receiver methods

```go
// type Counter struct{ n int }; (*Counter).Inc
// Build a registry that lets m["key"].Inc() work.
```

**Solution:**

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

m := map[string]*Counter{}
m["k"] = &Counter{}
m["k"].Inc()    // OK — map value is *Counter, already a pointer
```

The pointer is a copyable value, so the index expression's non-addressability does not matter.

### Task 4: Detect method-set mismatch at compile time

```go
// Use a compile-time assertion to ensure *MyType satisfies an interface.
```

**Solution:**

```go
var _ io.Writer = (*MyType)(nil)
```

The blank-identifier assignment runs at compile time. `(*MyType)(nil)` is a typed nil pointer — its method set is `*MyType`'s method set.

---

## System Design Style

### Q22: How would you design a plugin system that admits both value-typed and pointer-typed plugins?

**Answer:** Define the plugin contract as an interface and require registrations to be of pointer type by convention — register `&MyPlugin{}` rather than `MyPlugin{}`. This guarantees the method-set superset and avoids "implements interface in some places but not others" surprises. Document the rule and add `var _ Plugin = (*MyPlugin)(nil)` assertions in plugin packages.

### Q23: How do you reason about interface satisfaction in a code review?

**Answer:** Three checks:
1. Look at the receiver of every method named in the interface — is it value or pointer?
2. Look at the call sites — is the value being assigned to the interface a value or a pointer?
3. If mixed, ask whether the value site is addressable and whether the type was meant to be embedded.

A clean codebase usually picks one receiver style per type; mixing forces every reader to recompute the method set in their head.

### Q24: Why do many APIs accept `*T` as a receiver even when the method is read-only?

**Answer:** Three reasons:
1. **Future-proofing**: a future maintainer adding mutation does not need to change the call sites.
2. **Single method-set surface**: callers can always pass `*T`, so mixing receivers later does not bifurcate the type into "addressable-callers-only" code paths.
3. **Avoiding copies**: large structs and structs that contain locks must use pointer receivers.

The trade-off: pointer receivers make zero-value usability and concurrency harder to reason about.

---

## What Interviewers Look For

### Junior

- Can recite `MethodSet(T)` vs `MethodSet(*T)` rules.
- Knows that `m["k"].PointerMethod()` does not compile.
- Recognises that `var i Stringer = X{}` fails when only `(*X).String` exists.

### Middle

- Distinguishes the method-set check (interface assignment, assertion) from the method-call check (auto-addressing).
- Explains addressability — what is and isn't.
- Knows the difference between embedding `T` and `*T`.
- Understands the Go 1.22 loop variable change and its effect on method values.

### Senior

- Reads spec language fluently and applies it to corner cases.
- Connects method-set rules to escape analysis and heap allocation.
- Designs APIs that pick a single receiver style and justify it.
- Uses `var _ I = (*T)(nil)` compile-time assertions.

### Professional

- Mentors others through subtle bugs (map element, composite literal, interface holding `T`).
- Explains rationale for spec decisions (why map elements are non-addressable).
- Sets team conventions for receiver choice and embedding.
- Reviews dependencies for pre-1.22 loop-capture risks.

---

## Cheat Sheet

```
METHOD SET RULES
────────────────────────────────────
MethodSet(T)  = methods with receiver T
MethodSet(*T) = methods with receiver T OR *T
Interface assignment: uses operand's exact type
Method call:          can auto-address if operand is addressable

NON-ADDRESSABLE EXPRESSIONS
────────────────────────────────────
- map index:           m["k"]
- function return:     f().field
- composite literal:   T{}.method  (as call target)
- constants:           MyConst

ADDRESSABLE EXPRESSIONS
────────────────────────────────────
- variables:           v
- struct field of addressable: a.b
- slice/array element: s[i]
- pointer dereference: *p

EMBEDDING METHOD-SET PROPAGATION
────────────────────────────────────
Outer embeds T:   value methods of T   → MethodSet(Outer)
                  pointer methods of T → MethodSet(*Outer)
Outer embeds *T:  all methods of *T    → MethodSet(Outer)

INTERFACE GOTCHAS
────────────────────────────────────
var i I = X{}    fails if  String  is on *X only
var i I = &X{}   works
i := X{}; var j I = i   still fails — same reason

LOOP VARIABLE
────────────────────────────────────
< Go 1.22:  one v across iterations  → method values share v
≥ Go 1.22:  per-iteration v          → safe by default
```

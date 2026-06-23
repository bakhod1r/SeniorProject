# Go Type Switch — Interview Questions

## Junior Level

### Q1: What is a type switch in Go?

**Answer**: A type switch is a special form of `switch` whose cases match on the **dynamic type** of an interface value. Syntax:

```go
switch v := x.(type) {
case int:    // v is int here
case string: // v is string here
default:     // v has the operand's interface type
}
```

The expression `x.(type)` is only legal as the operand of a type switch.

---

### Q2: What is the difference between a type switch and a type assertion?

**Answer**: A **type assertion** `x.(T)` extracts a single specific type from an interface. It comes in two forms:

```go
v := x.(int)         // panics on mismatch
v, ok := x.(int)     // safe, ok=false on mismatch
```

A **type switch** is a multi-way version that branches on multiple types in one statement:

```go
switch v := x.(type) {
case int:
case string:
case error:
}
```

The type switch is preferred when you have several types to handle. It also reads the interface header only once, so it's slightly faster than chained assertions.

This is one of the **five mandated** interview questions for type switches.

---

### Q3: Can the operand of a type switch be a concrete type?

**Answer**: No. The operand **must be an interface type** (`any`, `error`, a custom interface, etc.). Switching on a concrete type is a compile error:

```go
n := 5
switch n.(type) { // ERROR: cannot type switch on non-interface value n
}
```

This is one of the **five mandated** interview questions.

---

### Q4: Why must the operand be an interface?

**Answer**: A type switch inspects the **dynamic type** stored at runtime inside an interface header (the `_type` field of an `eface` or the `_type` of an `iface.tab`). A concrete-type variable doesn't have a separate dynamic type — its static type is the type. There's nothing for the switch to discriminate on, so the language disallows it at compile time.

---

### Q5: What does `case nil:` match?

**Answer**: `case nil:` matches an interface value with **no dynamic type** — i.e., the result of `var x any` or `var x any = nil`.

A typed nil (e.g., `var p *int; var x any = p`) does NOT match `case nil:` — it matches `case *int:` because the interface still carries a dynamic type pointer.

```go
var p *int
var x any = p
switch x.(type) {
case nil:
    fmt.Println("nil")  // not printed
case *int:
    fmt.Println("*int") // printed
}
```

---

### Q6: What does `default` match?

**Answer**: Anything not covered by the other cases. Inside `default`, the bound `v` keeps the **operand's interface type** — typically `any`. So you can't call typed methods on `v` inside `default`; assert further if needed.

---

### Q7: Can a single case match multiple types?

**Answer**: Yes. List them comma-separated:

```go
switch x.(type) {
case int, int64, float64:
    // matches any of these
}
```

But the bound `v` in such a case has the **operand's interface type**, not any of the listed types. If you want typed access, split into separate cases.

This is one of the **five mandated** interview questions.

---

## Middle Level

### Q8: How do you fall through in a type switch?

**Answer**: You **can't**. `fallthrough` is illegal in type switches:

```go
switch x.(type) {
case int:
    fallthrough // compile error
case string:
}
```

The reason: the bound `v` would change type between cases, breaking the type system. To share logic across cases, extract to a helper function.

This is one of the **five mandated** interview questions.

---

### Q9: Does case order matter?

**Answer**: For **concrete-type-only** cases, no — at most one matches. For cases that include **interface types**, **yes** — the first matching case wins. This means a concrete type that implements an interface must be listed before the interface case, or the concrete case becomes dead code:

```go
// WRONG — *MyErr is dead code
switch err.(type) {
case error:    // catches everything
case *MyErr:
}

// RIGHT
switch err.(type) {
case *MyErr:
case error:
}
```

This is one of the **five mandated** interview questions.

---

### Q10: How does a type switch interact with method-set rules?

**Answer**: Type switches respect Go's method-set rules. If a type's methods are defined with pointer receivers, the value type does **not** satisfy interfaces that require those methods. A type switch reflects this:

```go
type stringer interface{ String() string }

type Foo struct{}
func (f *Foo) String() string { return "foo" }

var x any = Foo{}    // value, not pointer
switch x.(type) {
case stringer:       // does NOT match — Foo doesn't implement String
case Foo:            // matches
}

var y any = &Foo{}
switch y.(type) {
case stringer:       // matches
case *Foo:           // dead — stringer matches first
}
```

---

### Q11: When would you choose a type switch over a method on an interface?

**Answer**: A type switch is appropriate when:
- The operation **differs per type** (so giving each type the same method makes no sense).
- The set of types is **closed and known** (a sealed interface).
- You're decoding a heterogeneous value (e.g., JSON `interface{}` → various types).

A method on an interface is preferable when:
- Every type has the same operation with the same signature.
- The type set is open or extensible.
- You want compile-time enforcement of "every type must implement this".

The type switch is concentrated knowledge in one place; the method approach is distributed. Choose based on which structure better fits your domain.

---

### Q12: How does a type switch differ from a value switch?

**Answer**:

| Aspect | Value switch | Type switch |
|--------|--------------|-------------|
| Compares | values via `==` | types via runtime type tag |
| Operand | any comparable | interface only |
| Default v | not bound | typed per case |
| `fallthrough` | allowed | NOT allowed |
| Multi-case | values share scope | bound v re-types to operand |

---

### Q13: What does this print?

```go
switch x := any(nil).(type) {
case nil:
    fmt.Println("nil case, x =", x)
}
```

**Answer**: `nil case, x = <nil>`. The bound `x` in the `nil` case has the operand's type (`any`), holding the nil value.

---

### Q14: Can you type-switch on a generic type parameter?

**Answer**: Indirectly. Convert through `any` first:

```go
func handle[T any](x T) {
    switch v := any(x).(type) {
    case int:    // ...
    case string: // ...
    }
}
```

This pays the boxing cost of converting `T` to `any`. For simple numeric dispatch, a type set in the constraint is usually a better choice — no runtime type check needed.

---

### Q15: What's the relationship between `interface{}` and `any` in type switches?

**Answer**: They are aliases — `any` was introduced in Go 1.18 as a synonym for `interface{}`. They behave identically. Type switches work the same on either. Modern code prefers `any` for readability.

---

## Senior Level

### Q16: How does a type switch lower to runtime operations?

**Answer**: For each `case T:`:
- If `T` is concrete, the compiler emits a pointer comparison: `e._type == &T_descriptor`.
- If `T` is an interface, the compiler emits a `getitab` call that hashes `(T_iface, x._type)` and looks up an `*itab` in the runtime cache.

The bound `v` is the iface data field reinterpreted as `T` (a copy if `T` is large; a pointer otherwise).

The whole switch is a sequence of compares and conditional branches; there's no jump-table optimization currently because `_type` pointers don't have useful numeric structure.

---

### Q17: What is the `*itab` cache and why does it matter?

**Answer**: The `itab` (interface table) describes a `(interface, concrete type)` pair plus the method dispatch table. The runtime caches itabs in a global hash table.

First match cost includes:
- Hash `(inter, typ)`.
- Verify `typ` implements every method of `inter` (linear in method count).
- Allocate the itab.

Subsequent matches are O(1) cache lookups. So **interface-type cases** in a type switch are cheap once warm but expensive on first call. This shows up as latency spikes during startup / first-use scenarios.

---

### Q18: How do you optimize a hot type switch?

**Answer**:
1. **Profile first** with `pprof`.
2. **Order cases by frequency** — hottest type first reduces average compares.
3. **Split multi-type cases** if you need typed access.
4. **Avoid boxing large structs** — pass pointers.
5. **Replace with method dispatch** if the family is closed and operations are uniform.
6. **Replace with `map[reflect.Type]Handler`** if the family is large or open.
7. **Use generics** for numeric dispatch.

---

### Q19: How does the bound `v` interact with closures?

**Answer**: A closure inside a case captures the bound `v` like any other local variable. Each iteration of an enclosing loop creates a fresh `v` (in Go 1.22+ semantics for the outer loop variable; the case binding has always been per-case-entry). So closures see distinct values.

```go
for _, x := range xs {
    switch v := x.(type) {
    case int:
        fns = append(fns, func() int { return v })
    }
}
```

Each closure captures the per-iteration `v`. Pre-1.22, the outer `x` was shared, but the case-bound `v` was a fresh binding, so this still worked.

---

### Q20: How would you implement type-switch-style dispatch with O(1) lookup over a large type set?

**Answer**: Build a registry keyed by `reflect.Type`:

```go
var registry = map[reflect.Type]Handler{}

func Register(t reflect.Type, h Handler) {
    registry[t] = h
}

func Dispatch(x any) {
    if h, ok := registry[reflect.TypeOf(x)]; ok {
        h(x)
    }
}
```

Trade-offs vs type switch:
- O(1) lookup vs O(N) linear scan.
- Higher constant cost (hash + map probe vs pointer compare).
- Open extensibility — callers can add types.
- Interface-type matching is harder (`reflect.Type` is concrete; you can't easily register "anything implementing X").

For ~5 cases, type switch wins. For ~50 cases or extensible registries, the map wins.

---

### Q21: Explain `getitab` and where it's documented.

**Answer**: `getitab` is in `src/runtime/iface.go`. It looks up or builds the `*itab` for a `(interface_type, concrete_type)` pair. The cache is `itabTable`, a lock-free read / locked-write hash table. On a cache miss, it verifies that the concrete type implements every method of the interface and constructs the itab. Used by:
- `assertI2I` / `assertE2I` (interface-to-interface conversions).
- The compiler-emitted code for type switches with interface cases.

Reading this file gives ground truth about how type switches behave.

---

### Q22: How do you make a type switch exhaustive?

**Answer**: Go's compiler doesn't enforce exhaustiveness on type switches. To approximate it:

1. **Sealed interface**: define an unexported method that limits implementers to your package:
    ```go
    type Cmd interface{ cmd() }
    ```
2. **Linter**: use the `exhaustive` linter (https://github.com/nishanths/exhaustive) with `//exhaustive:enforce` directives.
3. **Default-panic**: in your switch, panic in the default with a diagnostic — bugs surface immediately.
4. **Test coverage**: write tests that exercise each case, including `default`.

---

### Q23: What happens during type switching of a wrapped error?

**Answer**: A type switch sees only the **outer** dynamic type. If `err` is `fmt.Errorf("ctx: %w", &MyErr{})`, the dynamic type is `*fmt.wrapError`, not `*MyErr`. The case `case *MyErr:` does not match.

For wrapped error inspection, use `errors.As`:

```go
var my *MyErr
if errors.As(err, &my) {
    // ...
}
```

`errors.As` walks the unwrap chain.

---

## Trap Questions

### Trap 1: What does this print?

```go
var p *int
var x any = p
switch x.(type) {
case nil:
    fmt.Println("nil")
case *int:
    fmt.Println("*int")
}
```

**Answer**: `*int`. A typed-nil pointer in an interface is NOT a nil interface. The `_type` field is non-nil; only the data pointer is nil.

---

### Trap 2: Will this compile?

```go
switch v := x.(type) {
case int:
    fmt.Println(v + 1)
    fallthrough
case int64:
    fmt.Println(v + 1)
}
```

**Answer**: No. `fallthrough` is illegal in type switches.

---

### Trap 3: What's the type of `v`?

```go
var x any = 5
switch v := x.(type) {
case int, int64:
    _ = v
}
```

**Answer**: `any` (i.e., the operand's interface type). Multi-type cases don't narrow `v` to a specific type because the body could be entered with any of them.

---

### Trap 4: What does this print?

```go
type Foo struct{}
func (f *Foo) String() string { return "foo" }

type Stringer interface{ String() string }

var x any = Foo{}
switch x.(type) {
case Stringer:
    fmt.Println("stringer")
case Foo:
    fmt.Println("Foo")
}
```

**Answer**: `Foo`. `Foo` (value) doesn't implement `Stringer` because `String` has a pointer receiver. So the `Stringer` case doesn't match. If `x = &Foo{}`, the answer would be `stringer`.

---

### Trap 5: What's wrong with this code?

```go
switch err.(type) {
case error:
    fmt.Println("an error")
default:
    fmt.Println("not an error")
}
```

**Answer**: Two issues:
- `err` is presumably already typed `error`. The case `case error:` matches **any** non-nil error, while a nil error matches `default` because nil `error` is a nil interface. Probably what was intended.
- More importantly, this is a type switch where a single comma-ok assertion would be more idiomatic:
    ```go
    if err != nil {
        fmt.Println("an error")
    } else {
        fmt.Println("not an error")
    }
    ```
- Or even just `if err != nil` — no type switch needed.

---

## Mandated Question Index

The five questions explicitly required by this topic:

1. **Q2** — Difference between type switch and type assertion.
2. **Q4** — Why must the operand be an interface.
3. **Q9** — Does case order matter.
4. **Q7** — Can a single case match multiple types.
5. **Q8** — How do you fall through a type switch.

---

## Summary

Junior questions cover syntax and basic semantics. Middle covers the relationship to type assertions, methods, and value switches; the role of case order. Senior covers compiler lowering, the itab cache, optimization strategies, and the relationship with errors and generics. Trap questions probe the well-known pitfalls: typed nil, fallthrough, multi-case `v`'s type, method-set rules, and order with interfaces.

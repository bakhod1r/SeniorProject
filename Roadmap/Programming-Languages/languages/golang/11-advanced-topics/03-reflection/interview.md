# Reflection — Interview

Common interview questions about Go's `reflect` package.

---

## Q1. What are the three laws of reflection?

1. Reflection goes from `interface{}` to `reflect.Value`.
2. Reflection goes from `reflect.Value` back to `interface{}`.
3. To modify a reflection object, the value must be settable (addressable + exported).

---

## Q2. What's the difference between `Kind` and `Type`?

`Type` is the full named type (`main.Counter`, `time.Duration`). `Kind` is the underlying category (`Int`, `Slice`, `Struct`). Two named types can share a `Kind` but never share a `Type`.

---

## Q3. Why does `reflect.ValueOf(x).SetInt(5)` panic?

Because the `Value` is not settable. `ValueOf(x)` is a snapshot of `x`'s value, not addressable. To mutate, reflect on `&x` and call `.Elem()`:

```go
reflect.ValueOf(&x).Elem().SetInt(5)
```

---

## Q4. Can you modify unexported struct fields via reflection?

The standard API doesn't allow it — `SetXxx` panics. You can bypass with `unsafe`:

```go
v := reflect.ValueOf(&t).Elem().FieldByName("x")
reflect.NewAt(v.Type(), unsafe.Pointer(v.UnsafeAddr())).Elem().Set(...)
```

It's a documented escape hatch but should be avoided in production.

---

## Q5. How does `reflect.DeepEqual` differ from `==`?

`==` works on comparable types only and does structural comparison element-by-element where allowed. `DeepEqual` is recursive, handles slices/maps/pointers, but treats nil and empty containers as **unequal** and NaN as **never equal to itself**. For tests, prefer `go-cmp` which is more configurable.

---

## Q6. What does `Interface()` do, and why does it allocate?

`Interface()` returns the reflected value as `any`. Since `any` is a two-word descriptor + data pointer, non-pointer values must be heap-allocated to provide the data pointer. So every `Interface()` call on a non-pointer value typically allocates.

---

## Q7. Why is reflection slow?

Several reasons stacked together:

- Each operation does a Kind-based switch internally.
- Method calls go through `Call(args)`, packing/unpacking `[]reflect.Value`.
- `Interface()` boxes into `any`, allocating.
- Compiler can't inline or optimize through reflection — everything is dynamic.

A typical reflection-based field write is 50–100× slower than a direct write.

---

## Q8. How would you make a reflection-heavy library fast?

1. Cache plans per `reflect.Type` using `sync.Map`.
2. Use `Field(i)` with cached indices instead of `FieldByName` per call.
3. Avoid `Interface()` — use kind-specific accessors.
4. For very hot paths, write per-field closures that use `unsafe.Pointer` and field offsets.
5. Peel off the common cases with `switch v := x.(type)` before reflection.

---

## Q9. What's `reflect.MakeFunc` for?

Constructs a function value at runtime that matches a given `reflect.Type`. The body is implemented by a Go callback receiving `[]reflect.Value` and returning `[]reflect.Value`. Used by mocking frameworks, RPC clients, and middleware libraries.

---

## Q10. Why doesn't `reflect.ValueOf(struct{X int}{}).FieldByName("X").SetInt(5)` work?

Because the struct literal is a temporary, not addressable. You'd need to take its address first:

```go
x := struct{ X int }{}
reflect.ValueOf(&x).Elem().FieldByName("X").SetInt(5)
```

---

## Q11. Are `reflect.Type` values comparable with `==`?

Yes — they're interned by the runtime, so `==` is a pointer comparison and is cheap. This makes `map[reflect.Type]T` a standard caching pattern.

---

## Q12. How do you read a struct tag?

```go
field, _ := reflect.TypeOf(T{}).FieldByName("X")
tag := field.Tag.Get("json")
```

`Tag.Get(key)` parses the space-separated `key:"value"` pairs and returns the value (or empty). `Lookup` distinguishes "key present with empty value" from "key absent".

---

## Q13. What's the difference between `reflect.New(t)` and `reflect.Zero(t)`?

- `reflect.New(t)` returns a `Value` of kind `Ptr` to a fresh zero `t`. The result is **addressable**.
- `reflect.Zero(t)` returns a `Value` of kind `t` (the zero value). The result is **not addressable**.

For mutation, you need `New(t).Elem()`. For "what's the zero look like", `Zero(t)` is enough.

---

## Q14. Why can't reflection see methods with pointer receivers when you reflect on a value?

Go's method set rules: the method set of `T` is methods with `T` receiver only; the method set of `*T` includes both. Reflection follows the language's rules. To see pointer-receiver methods, reflect on a pointer to the value.

---

## Q15. When would you *not* use reflection?

When any of these fit the use case:

- An interface ("does this type have a `String()` method?").
- A type switch ("if it's one of these known types, do X").
- Generics (Go 1.18+, for known-shape monomorphic code).
- Code generation (for many shapes known at build time).

Reflection is the right tool only when the set of types is genuinely open and runtime-discoverable.

---

## Q16. How does `encoding/json` use reflection?

It walks the type at first encode/decode for a given `reflect.Type`, computes a per-type plan (fields, tags, offsets, encoders), and caches the plan. Subsequent operations use the cached plan, which is still slower than hand-written code but avoids the worst overhead of repeated type walking.

---

## Q17. What's the cost of `MethodByName` + `Call`?

Roughly: name lookup (~100 ns), argument packing (allocs per argument), call dispatch (similar to an interface call), result unpacking. Order of magnitude is microseconds for typical signatures. Avoid in hot paths.

---

## Q18. Are reflect operations safe for concurrent use?

`reflect.Type` is immutable and safe to share. `reflect.Value` reads on the same underlying value are safe (if the value is safe to read concurrently). Writes (`Set*`) follow the same rules as any other concurrent write — they need synchronization.

A read-mostly type cache (`sync.Map[reflect.Type]Plan`) is the canonical concurrent reflection structure.

---

## Q19. How would you detect whether a type implements an interface, given only the `reflect.Type`?

```go
ifaceType := reflect.TypeOf((*Stringer)(nil)).Elem()
t.Implements(ifaceType)
```

The `(*Stringer)(nil)` trick gets you an interface type because you can't reflect on the interface itself directly.

---

## Q20. Bonus — describe a time you replaced reflection with something faster.

Open-ended. Strong answers describe a specific change: e.g., "the validator was using `FieldByName` per request; we cached the indices and switched to closures over `unsafe.Pointer` offsets, dropping validation CPU from 18% to 4%." The point is to show you've done this kind of optimization with measurement.

---

## Cheat sheet

- Three laws: interface ↔ reflection, settability requires addressable + exported.
- Read with kind-specific methods; check `Kind()` first.
- Cache the plan per `Type`.
- Avoid `Interface()` in hot paths.
- Use `Field(i)` with cached index, not `FieldByName`.
- Pointer-receiver methods only via `*T`.
- `DeepEqual`: nil vs empty matters; NaN is never equal.

---

## Further reading
- "The Laws of Reflection" — Rob Pike
- `reflect` source code in `src/reflect/`

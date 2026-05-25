# Reflection — Specification

> **Focus:** Precise reference for the `reflect` package — its types, the laws governing them, the operations they support, and the boundaries of safe use.
>
> **Sources:**
> - `reflect` package: https://pkg.go.dev/reflect
> - "The Laws of Reflection": https://go.dev/blog/laws-of-reflection
> - Go spec — Type identity: https://go.dev/ref/spec#Type_identity

---

## 1. Three core types

| Type | Role |
|------|------|
| `reflect.Type` | Compile-time-like view of any Go type, accessible at runtime |
| `reflect.Value` | Runtime handle to a value with its dynamic type |
| `reflect.Kind` | Coarse classification (Bool, Int, Slice, Map, Struct, Ptr, Interface, …) |

```go
t := reflect.TypeOf(x)    // (*rtype) – the static type of x
v := reflect.ValueOf(x)   // (Value)  – the value with its dynamic type
k := t.Kind()             // Kind – e.g., reflect.Struct
```

---

## 2. The three laws

> **1.** Reflection goes from `interface{}` value to reflection object.
> **2.** Reflection goes from reflection object to `interface{}` value.
> **3.** To modify a reflection object, the value must be settable.

Settability requires the reflect.Value to refer to an addressable, exported location. A `Value` obtained from `reflect.ValueOf(x)` directly is **not** settable; you must reflect on `&x` and then call `.Elem()`.

---

## 3. The `Kind` taxonomy

```
Invalid, Bool, Int, Int8…Int64, Uint, Uint8…Uint64, Uintptr,
Float32, Float64, Complex64, Complex128,
Array, Chan, Func, Interface, Map, Pointer, Slice, String, Struct,
UnsafePointer
```

`Kind` is the right discriminator for most reflection logic. Two different named types (`type MyInt int` and `int`) have **different** `Type` but the **same** `Kind`.

---

## 4. Type identity

`reflect.Type` values are comparable. Two `reflect.Type` values are equal iff the underlying Go types are identical. This makes `t1 == t2` cheap and correct, including for unnamed types: `reflect.TypeOf(map[string]int(nil)) == reflect.TypeOf(map[string]int(nil))`.

---

## 5. Reading values

| Method | Returns | Notes |
|--------|---------|-------|
| `v.Bool()` | `bool` | Panics if Kind isn't Bool |
| `v.Int()` | `int64` | All signed-integer kinds |
| `v.Uint()` | `uint64` | All unsigned-integer kinds |
| `v.Float()` | `float64` | Float32 or Float64 |
| `v.Complex()` | `complex128` | Complex64 or Complex128 |
| `v.String()` | `string` | Returns `"<T Value>"` for non-strings, not a panic |
| `v.Bytes()` | `[]byte` | Panics if not a `[]byte` |
| `v.Interface()` | `any` | Panics if v was obtained from an unexported field |

The kind-specific methods are fast but type-pickyl; cross-kind reads require explicit conversion (`v.Convert(targetType).Int()`).

---

## 6. Writing values

```go
ptr := &thing
v := reflect.ValueOf(ptr).Elem()   // settable
v.SetInt(42)
v.FieldByName("X").SetString("hi")
```

Settability rules:

- `Value` from `ValueOf(x)` directly: **not** settable.
- `Value` from `ValueOf(&x).Elem()`: settable.
- Struct field: settable iff the struct is settable **and** the field is exported.
- Map entry: not settable in place; use `SetMapIndex`.

---

## 7. Struct fields

```go
t := reflect.TypeOf(MyStruct{})
for i := 0; i < t.NumField(); i++ {
    f := t.Field(i)                 // reflect.StructField
    fmt.Println(f.Name, f.Type, f.Tag.Get("json"))
}
```

`StructField` carries: `Name`, `PkgPath` (empty for exported), `Type`, `Tag`, `Offset`, `Index`, `Anonymous`. Tags are parsed by `Tag.Get(key)` using the `key:"value"` convention.

---

## 8. Method invocation

```go
v := reflect.ValueOf(obj)
m := v.MethodByName("DoIt")
out := m.Call([]reflect.Value{ reflect.ValueOf(arg) })
result := out[0].Interface()
```

- Method receivers are baked into the returned `Value`.
- Arguments must match the method's signature exactly, including pointer-ness.
- Variadic methods can use `m.CallSlice(...)`.
- `Call` is **slow** — typically 10–100× the cost of a direct call.

---

## 9. Construction APIs

| Function | Result |
|----------|--------|
| `reflect.New(T)` | `Value` of kind `Ptr` to a zero `T` |
| `reflect.MakeSlice(T, len, cap)` | New slice value of type `T` (T must be a slice type) |
| `reflect.MakeMap(T)` | New map value |
| `reflect.MakeChan(T, buf)` | New channel value |
| `reflect.MakeFunc(T, fn)` | Dynamically constructed function with body `fn` |
| `reflect.Zero(T)` | Zero value of type `T` (not addressable) |

`MakeFunc` lets you implement an interface at runtime — see "Higher-order patterns" below.

---

## 10. `DeepEqual`

`reflect.DeepEqual(a, b)` recursively compares values:

- Different types ⇒ false.
- Slices: same length and DeepEqual elements; nil and empty slices are **not** equal.
- Maps: same keys (==) and DeepEqual values; nil and empty maps are **not** equal.
- Funcs: equal iff both nil.
- Pointers: equal iff both nil or both point to DeepEqual values.
- Structs: DeepEqual field-by-field.
- Cycles are handled via a visited set.

DeepEqual is the right hammer for tests; in production it's slow and sensitive to nil-vs-empty distinctions.

---

## 11. Conversion and assignment

```go
v := reflect.ValueOf(int32(5))
ok := v.Type().ConvertibleTo(reflect.TypeOf(int64(0)))   // true
v2 := v.Convert(reflect.TypeOf(int64(0)))                // *Value* of type int64
```

`ConvertibleTo` is the runtime equivalent of writing `T(x)` in source. `AssignableTo` is more strict — it matches the language's assignment rules.

---

## 12. Reflection and interfaces

```go
type Stringer interface { String() string }

t := reflect.TypeOf(struct{}{})
si := reflect.TypeOf((*Stringer)(nil)).Elem()     // get the interface type
t.Implements(si)                                  // true if the type satisfies the interface
```

`Implements`, `AssignableTo`, `ConvertibleTo` are the standard interrogation operations.

---

## 13. Allocation behavior

Every `reflect.Value` operation that hands out a value through `Interface()` boxes it into an `any` (heap allocation). Most other operations are non-allocating but still expensive due to switch-on-Kind work and reflective bookkeeping.

Hot paths that go through reflection in any form should be benchmarked, then replaced with code generation if performance is critical.

---

## 14. Concurrency

`reflect.Value` and `reflect.Type` are safe for concurrent **read** use as long as the underlying object is. Writes (via `Set`) are not synchronized — the usual data-race rules apply.

`reflect.Type` values are interned within the runtime; comparison is pointer comparison and is cheap and thread-safe.

---

## 15. Limits

- Cannot read unexported fields' interface values: `v.Interface()` panics, though `v.Bytes()`, `v.String()`, etc., often work.
- Cannot set unexported fields without `unsafe` tricks (and doing so violates encapsulation).
- Cannot fabricate types at runtime (`reflect.StructOf`, `reflect.SliceOf`, `reflect.MapOf` exist but produce *existing* type values, not new categories).
- Cannot guarantee monomorphic performance — every call through reflection is, by definition, dynamic.

---

## 16. Related references

- "The Laws of Reflection": https://go.dev/blog/laws-of-reflection
- `reflect` package: https://pkg.go.dev/reflect
- Escape implications: [02-escape-analysis](../02-escape-analysis/)
- Code generation alternatives (`go generate`, `stringer`, `easyjson`)

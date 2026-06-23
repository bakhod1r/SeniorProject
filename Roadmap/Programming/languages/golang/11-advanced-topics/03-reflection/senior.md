# Reflection — Senior

## 1. The "what reflection actually does" mental model

A `reflect.Value` is internally three words: a pointer to the type descriptor (`*rtype`), a pointer to the data, and a flag word (kind, addressable, exported, etc.). Operations on the value dispatch on `Kind` via giant switches inside the runtime. Every method call across reflection traverses this machinery — there's no shortcut once you're inside.

`reflect.Type` is the same `*rtype` exposed through a small interface. Two `reflect.Type` values are equal iff the pointers are equal, and the runtime interns these descriptors, so `==` is a single comparison.

When you understand the data layout, performance tuning becomes obvious: amortize type lookups, avoid `Interface()` when possible, do the kind switch *once* per type and cache the result.

---

## 2. Caching reflection setup

```go
type entry struct {
    fields []reflect.StructField
    decoders []func(reflect.Value, string)
}

var typeCache sync.Map  // map[reflect.Type]*entry

func entryFor(t reflect.Type) *entry {
    if e, ok := typeCache.Load(t); ok {
        return e.(*entry)
    }
    e := buildEntry(t)
    typeCache.Store(t, e)
    return e
}
```

This is the standard idiom for reflection-heavy libraries. The expensive work — walking the type's fields, parsing tags, computing offsets, building per-field decoder functions — happens once per type. Subsequent calls hit the cache and just invoke prebuilt closures.

`encoding/json`, `database/sql/sql.Scan`, and `validator.v10` all use this pattern internally.

---

## 3. Closures over unsafe pointers as fast paths

Once you have the field offset, you can avoid most reflection overhead by writing the value through `unsafe`:

```go
func intSetter(off uintptr) func(p unsafe.Pointer, v int64) {
    return func(p unsafe.Pointer, v int64) {
        *(*int64)(unsafe.Add(p, off)) = v
    }
}
```

The first reflection pass builds one closure per field. Subsequent decodes call the closures directly with the struct's base pointer. This is how fast JSON libraries (`go-json`, `easyjson`-generated code, `sonic`) achieve their speed — they cache an offset table once, then operate via `unsafe.Pointer` arithmetic.

Trade-off: now you're maintaining low-level pointer code, which is more fragile and harder to read. Reserve for top-3 hot paths.

---

## 4. The "interface upgrade" pattern

When a generic library has fast paths for specific kinds, the canonical idiom:

```go
func write(w io.Writer, v any) error {
    switch x := v.(type) {
    case []byte:
        _, err := w.Write(x)
        return err
    case string:
        _, err := io.WriteString(w, x)
        return err
    case json.Marshaler:
        b, err := x.MarshalJSON()
        if err != nil { return err }
        _, err = w.Write(b)
        return err
    default:
        return jsonEncode(w, v)   // slow reflection path
    }
}
```

This avoids reflection altogether for the common cases. The cost of the type switch is much lower than reflective bookkeeping.

---

## 5. `MakeFunc` for runtime polymorphism

`MakeFunc` produces a function whose signature matches a given `reflect.Type`. Internally, the runtime compiles a small ABI shim that packages the call's actual arguments into a `[]reflect.Value`, invokes your callback, and unpacks the results.

```go
func wrap(orig any, before, after func()) any {
    v := reflect.ValueOf(orig)
    t := v.Type()
    return reflect.MakeFunc(t, func(args []reflect.Value) []reflect.Value {
        before()
        out := v.Call(args)
        after()
        return out
    }).Interface()
}
```

Use cases:

- Mocking frameworks (`gomock`, `testify/mock`).
- AOP-style middleware that wraps arbitrary methods.
- RPC stubs that produce a client method per spec entry.

Cost: each call through a `MakeFunc` value is one full reflection dispatch. For high-throughput paths, generate the wrapper at build time instead.

---

## 6. Unexported field access — when (rarely) justified

Hard rule: don't.

Soft rule: if you must (testing internal state of a third-party type), do it locally and clearly:

```go
func readUnexported(v reflect.Value, name string) reflect.Value {
    f := v.FieldByName(name)
    return reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem()
}
```

This bypasses the export check. It is a documented escape hatch (`testing/quick` uses it). Don't ship it.

---

## 7. Type-driven dispatch tables

Cleaner alternative to `MethodByName` when you control the types involved:

```go
var handlers = map[reflect.Type]func(any) error{
    reflect.TypeOf(&UserMsg{}):  handleUser,
    reflect.TypeOf(&OrderMsg{}): handleOrder,
}

func handle(v any) error {
    if h, ok := handlers[reflect.TypeOf(v)]; ok {
        return h(v)
    }
    return errors.New("unknown type")
}
```

Faster than `MethodByName` (map lookup vs name search), explicit, and easy to test.

---

## 8. Reflection and the GC

`reflect.Value` holds pointers that are visible to the GC. Once you reflect on a value, the GC sees its full reachable graph. This is usually fine — but with `unsafe.Pointer` and offset tricks, you must be careful: writing through a derived pointer doesn't add the pointee to the GC's view; the original `Value` handle is what keeps the object alive.

`runtime.KeepAlive(v)` after a sequence of `unsafe.Pointer`-based writes is the explicit way to extend lifetime.

---

## 9. JSON, but better

The standard `encoding/json` uses reflection on every encode/decode. The popular accelerator path:

1. Generate marshaler/unmarshaler code with `easyjson` or compile-time codegen tools.
2. Or use a runtime-fast library like `goccy/go-json` that uses reflection but with extensive caching and `unsafe.Pointer` field access.

`encoding/json/v2` (in development) significantly reduces the reflection overhead and introduces typed accessors. Watch it for stable adoption.

---

## 10. Real-world story: validation library tuning

A team was using `go-playground/validator` to validate ~5000 incoming structs per second. Profile showed 20% of CPU in reflection. They:

1. Cached the `reflect.Type` → validation plan once.
2. Built per-field closures using `unsafe.Pointer` offset access.
3. Pre-compiled regular expressions at registration.
4. Added a fast path for the 5 most common shape combinations as type-asserted code.

Result: reflection CPU went from 20% to 3%. The library wasn't broken — it was just doing all the type lookup on every request. Caching the *plan* is the standard win.

---

## 11. Pitfalls

| Pitfall | What goes wrong |
|---------|-----------------|
| Calling `Interface()` on every field | Forces heap boxing of each value |
| Not caching `Type` lookups | Repeated `reflect.TypeOf` is cheap but adds up |
| Using `FieldByName` in a loop | Linear scan per call; use `Field(i)` with cached index |
| Using `DeepEqual` in production code | Slow and surprising; use type-specific comparisons |
| Using `MethodByName` for a known set of methods | Use an interface and direct dispatch |

---

## 12. Concurrency story

`reflect.Type` is immutable and safe to share across goroutines.

`reflect.Value` holds a pointer to underlying data; concurrent **reads** are as safe as the underlying data permits. Concurrent **writes** require synchronization just like any other Go data.

A cache (`sync.Map` of `Type` → plan) is the standard concurrent pattern.

---

## 13. Reflection vs. generics, decided

| Choose generics when... | Choose reflection when... |
|--------------------------|----------------------------|
| The set of types is known at compile time | The set is open and user-extensible |
| You need monomorphic performance | A 5–20× slowdown is acceptable |
| The code is well-typed naturally | The API contract is "give me anything" |
| You want compiler-checked correctness | You need to discover structure at runtime |

Generics replaced *some* uses of reflection (`golang.org/x/exp/maps`, `slices`, `constraints`) but not all. Truly polymorphic code (JSON, validation, env config) still needs reflection.

---

## 14. Summary

Mature reflection use looks like: cache the plan per type, dispatch on `Kind` once, use `unsafe.Pointer` offsets for hot writes, and provide type-switch fast paths around the slow reflective code. Senior engineers know reflection is a budget, not a free tool, and reach for code generation when the budget is too tight.

---

## Further reading
- `cmd/compile/internal/reflectdata`: where the runtime descriptors come from
- `github.com/goccy/go-json` source: a model reflection-driven serializer
- `runtime/reflect` interaction: https://pkg.go.dev/reflect (read the source comments)
- "Understanding Go's reflect.Value" — Dave Cheney

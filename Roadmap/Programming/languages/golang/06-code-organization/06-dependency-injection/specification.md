# Dependency Injection — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [`google/wire` Reference](#googlewire-reference)
3. [`go.uber.org/fx` Reference](#gouberorgfx-reference)
4. [`go.uber.org/dig` Reference](#gouberorgdig-reference)
5. [Go Interface Semantics Relevant to DI](#go-interface-semantics-relevant-to-di)
6. [The Nil-Interface Trap](#the-nil-interface-trap)
7. [Embedded Interfaces](#embedded-interfaces)
8. [References](#references)

---

## Introduction

Unlike the language itself, dependency injection has no Go-level specification. The relevant references are:

1. The Go Language Specification at `go.dev/ref/spec` — for interface semantics that DI relies on.
2. `github.com/google/wire` package documentation — for `wire`'s API and tags.
3. `go.uber.org/fx` package documentation — for `fx`'s `Module`, `Lifecycle`, and `Provide`/`Invoke`.
4. `go.uber.org/dig` package documentation — for the underlying container.

This file paraphrases each, side-by-side with the language semantics that DI exploits. Direct quotations are avoided; consult the upstream docs for verbatim text.

---

## `google/wire` Reference

`wire` is a code generator. The runtime package exists almost entirely to make injector skeletons compile.

### Public types and functions in the runtime package

| Name | Purpose |
|------|---------|
| `wire.NewSet(providers...)` | Declares a *provider set* — a group of providers reused across injectors. Arguments may be functions, struct values, type bindings, or other `Set` values. |
| `wire.Build(providers...)` | Marker call placed in the body of an injector skeleton. The argument is the set of providers `wire` should use to satisfy the injector's return type. |
| `wire.Bind(iface, impl)` | Declares that wherever `iface` is needed, `impl` should be supplied. `iface` is `new(IFaceType)` and `impl` is `new(*ConcreteType)`. |
| `wire.Value(v)` | Treats a literal Go value as a provider that returns it. |
| `wire.Struct(new(T), "*")` | Provider that constructs a struct, populating its fields from the container. `"*"` means "fill all fields"; you may list individual field names. |
| `wire.InterfaceValue(iface, v)` | Like `wire.Value` but for interface-typed values. |

### Build constraints used by `wire`

| Tag | Meaning |
|-----|---------|
| `//go:build wireinject` | Skeleton file: compiled only when `wire` is parsing it. Excluded from `go build`. |
| `//go:build !wireinject` | Generated file: compiled in normal builds, excluded when `wire` parses sources. |

### Failure modes

`wire`'s analyser fails the build on:

- A type with no provider in the chosen set.
- Two providers for the same type without a `wire.Bind` to disambiguate.
- A cycle in the provider graph.
- A provider that is unreachable from the injector's return type.

### Cleanup convention

A provider may return `(T, func(), error)`. The middle return is the cleanup. `wire` composes cleanups in reverse construction order in the generated injector.

---

## `go.uber.org/fx` Reference

`fx` is a runtime DI container layered on `dig`. Public surface:

| Symbol | Purpose |
|--------|---------|
| `fx.New(opts...)` | Construct an `App` from a list of options. |
| `fx.Provide(funcs...)` | Register provider functions. Each function's return values become available in the container. |
| `fx.Invoke(funcs...)` | Register functions to be called once during startup; their parameters are resolved from the container. |
| `fx.Module(name, opts...)` | Group providers and invocations under a logical name. Modules can be composed. |
| `fx.Lifecycle` | A struct injected into providers / invocations; `Append(Hook)` registers `OnStart` and `OnStop` callbacks. |
| `fx.Hook` | `{ OnStart, OnStop func(context.Context) error }`. Both run sequentially in registration / reverse-registration order. |
| `fx.Supply(values...)` | Provide pre-constructed values directly to the container. |
| `fx.Decorate(funcs...)` | Wrap an existing provider's value before delivery (middleware-like). |

### `fx.In` / `fx.Out`

Embedding `fx.In` in a struct turns the struct into a parameter object: each exported field is filled from the container.

```go
type Params struct {
    fx.In

    DB     *sql.DB
    Logger *slog.Logger
}
```

`fx.Out` is the dual: a struct of return values to expose multiple types from one constructor.

### Lifecycle semantics

- `OnStart` callbacks run in *registration order*, sequentially, with the startup `context.Context`.
- `OnStop` callbacks run in *reverse registration order*, sequentially, with the shutdown context.
- An error in any `OnStart` aborts further startup and triggers `OnStop` for already-started components.

### App execution

`App.Run()` blocks waiting for `os.Interrupt`/`SIGTERM`. `App.Start(ctx)` and `App.Stop(ctx)` are the programmatic equivalents.

---

## `go.uber.org/dig` Reference

`dig` is the lower-level container `fx` builds on; you can use it directly.

| Symbol | Purpose |
|--------|---------|
| `dig.New(...Option)` | Construct a `Container`. |
| `(*Container).Provide(constructor, ...)` | Register a constructor. |
| `(*Container).Invoke(fn)` | Resolve and call `fn` with values from the container. |
| `dig.In` / `dig.Out` | Same as `fx.In` / `fx.Out`. |
| `dig.Name("...")` | Tag on a struct field to select a *named* value when multiple providers exist for one type. |
| `dig.Optional` | Tag on a struct field meaning "leave zero if not provided". |
| `dig.Group("...")` | Tag for value groups (many providers contributing to a slice). |

### Resolution order

`dig` resolves lazily on `Invoke`. A provider is called the first time its result is needed; the result is cached for subsequent injections (singletons).

### Errors

`dig` returns errors from `Invoke` rather than panicking, with a structured trace pointing at the missing provider.

---

## Go Interface Semantics Relevant to DI

The Go specification on interfaces (§ "Interface types", § "Method sets") underpins everything DI does. Three points matter most:

### 1. Structural conformance

A type `T` satisfies an interface `I` iff its method set includes every method of `I`. There is no `implements` keyword, no registration. This is what makes consumer-side interfaces possible: a downstream package can declare an interface that an unrelated upstream type already satisfies.

### 2. Method set rules for pointer vs value receivers

- A type `T`'s method set includes methods with value receivers.
- A type `*T`'s method set includes methods with both value *and* pointer receivers.

Practical effect: if your `Service` defines `func (s *Service) Save(...)`, only `*Service` satisfies an interface with a `Save` method, not `Service`. DI frameworks expose this via type errors when a value type is registered where a pointer is required.

### 3. Interface values are two-word

An interface value is `(type pointer, data pointer)`. A nil interface is `(nil, nil)`. A typed-nil interface, e.g. `var s *Service = nil; var any I = s`, is `(*Service, nil)` — *not* equal to `nil`.

This is the **nil-interface trap** — important enough to deserve its own section.

---

## The Nil-Interface Trap

### Symptom

```go
type Logger interface{ Log(string) }

func New(l Logger) *Service {
    if l == nil {
        l = noopLogger{} // intent: default to noop
    }
    return &Service{l: l}
}

var realLogger *RealLogger // nil!
svc := New(realLogger)
svc.l.Log("hello") // panic: nil pointer dereference
```

`realLogger` is a nil `*RealLogger`. Passed to `New(l Logger)`, the interface variable `l` carries `(*RealLogger, nil)` — the type is set, the data pointer is nil. The check `l == nil` is **false** because the type slot is populated. The fallback to `noopLogger{}` never runs. Calling `l.Log("...")` dispatches into the method on `*RealLogger`, dereferences the nil receiver, and panics.

### Rule

Never compare an interface value against `nil` to check "did the caller forget to provide me with anything?" Either:

- Take the *concrete type* and check `if rl == nil`. The compiler is happy because the type matches.
- Document that nil is unsupported and let the caller know.
- Use `reflect.ValueOf(l).IsNil()` if you really need it (slow, ugly; treat as last resort).

### Why it matters in DI

DI frameworks pass values through interface variables constantly. A constructor that "defends against nil" with `if l == nil` is buggy. The cleanest defence is to require non-nil providers and let the type system enforce that callers supply a real implementation.

---

## Embedded Interfaces

An interface can embed another:

```go
type Reader interface {
    Read(p []byte) (int, error)
}

type Closer interface {
    Close() error
}

type ReadCloser interface {
    Reader
    Closer
}
```

`ReadCloser` has the methods of both. A type satisfies `ReadCloser` iff it satisfies both `Reader` and `Closer`.

### Why this matters for DI

Consumer-side interfaces sometimes accumulate. If service `A` needs a reader and service `B` also needs a closer, you can compose:

```go
type ABReader interface {
    Reader
    Closer
}
```

This is *cleaner* than declaring a single 7-method interface for whoever needs the union. Each individual interface stays small; the composed one is built up by embedding.

### Method-set conflicts

If two embedded interfaces declare the *same* method with the same signature, no conflict — they just contribute it once. If they declare it with *different* signatures, the embedding type is invalid and the compiler rejects it.

---

## References

- Go Modules Reference — `go.dev/ref/mod` (background on package import paths used by DI frameworks).
- The Go Programming Language Specification — `go.dev/ref/spec` (interface and method-set rules).
- `github.com/google/wire` — package documentation and `wire` tool.
- `go.uber.org/fx` — package documentation.
- `go.uber.org/dig` — package documentation.
- `pkg.go.dev` pages for each of the above.

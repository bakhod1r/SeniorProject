# The `expvar` Package — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where `expvar` Is Specified](#where-expvar-is-specified)
3. [The `Var` Interface](#the-var-interface)
4. [Exported Types](#exported-types)
5. [Exported Functions](#exported-functions)
6. [The HTTP Handler Contract](#the-http-handler-contract)
7. [The Default Variables](#the-default-variables)
8. [The JSON Output Contract](#the-json-output-contract)
9. [Concurrency Guarantees](#concurrency-guarantees)
10. [The Duplicate-Name Contract](#the-duplicate-name-contract)
11. [Behaviour Across Go Versions](#behaviour-across-go-versions)
12. [References](#references)

---

## Introduction

The Go language specification (`go.dev/ref/spec`) does not mention `expvar`. It is a *standard library package*, not a language feature. The authoritative reference is the package documentation at **`pkg.go.dev/expvar`**, backed by the implementation in `src/expvar/expvar.go` of the Go distribution.

Sources of truth, in decreasing formality:

1. **Package documentation** — `pkg.go.dev/expvar`, the godoc for every exported symbol.
2. **The standard library source** — `src/expvar/expvar.go`, the de-facto specification where the godoc is terse.
3. **`runtime.MemStats` documentation** — `pkg.go.dev/runtime#MemStats`, for the `memstats` default.

This file separates "what the documented API guarantees" from implementation detail. Where the godoc is silent, the source is the specification.

---

## Where `expvar` Is Specified

`expvar` is documented entirely by its godoc. The package comment states its purpose:

> Package `expvar` provides a standardized interface to public variables, such as operation counters in servers. It exposes these variables via HTTP at `/debug/vars` in JSON format.

The godoc further specifies that importing the package registers the HTTP handler and publishes `cmdline` and `memstats`. There is no separate prose reference (unlike the Go Modules Reference for `go mod`); the godoc *is* the reference.

---

## The `Var` Interface

The central type:

```go
type Var interface {
    String() string
}
```

The documented contract: `String()` returns a **valid JSON value**. Every published variable must satisfy this interface, and the returned string is used verbatim as the JSON value in the `/debug/vars` document. The godoc is explicit that the returned string must be valid JSON.

A type satisfies `Var` by implementing this single method. The built-in types (`Int`, `Float`, `String`, `Map`, `Func`) all implement it correctly; custom types must honour the valid-JSON requirement.

---

## Exported Types

| Type | Definition | Key methods |
|------|-----------|-------------|
| `Int` | A 64-bit integer variable | `Add(delta int64)`, `Set(value int64)`, `Value() int64`, `String() string` |
| `Float` | A 64-bit float variable | `Add(delta float64)`, `Set(value float64)`, `Value() float64`, `String() string` |
| `String` | A string variable | `Set(value string)`, `Value() string`, `String() string` |
| `Map` | A string-keyed map of `Var` | `Add`, `AddFloat`, `Set`, `Get`, `Delete`, `Do`, `Init`, `String` |
| `Func` | `func() any` adapted to `Var` | `Value() any`, `String() string` |
| `KeyValue` | `struct{ Key string; Value Var }` | (a plain struct; argument to `Do`) |

Documented details:

- **`Int`, `Float`** — `Add` and `Set` are documented as safe for concurrent use. `Value` returns the current numeric value; `String` returns its JSON-number rendering.
- **`String`** — `Value()` returns the raw Go string; `String()` returns the **JSON-quoted** string. The godoc notes `String` returns a quoted form suitable for JSON.
- **`Map`** — `Add(key, delta int64)` adds to the `Int` under `key`, creating it if needed. `AddFloat(key, delta float64)` does the same with a `Float`. `Set(key, av Var)` assigns an arbitrary `Var`. `Get(key) Var` returns the value or `nil`. `Delete(key)` removes it. `Do(f func(KeyValue))` iterates in sorted key order. `Init() *Map` removes all keys and returns the map.
- **`Func`** — defined as `type Func func() any`. Its `String()` calls the function and JSON-marshals the result. The value is recomputed on each call.

---

## Exported Functions

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `Publish` | `func Publish(name string, v Var)` | Registers `v` under `name` in the global registry. Calls `log.Fatal` (terminates) if `name` is already registered. |
| `Get` | `func Get(name string) Var` | Returns the `Var` registered under `name`, or `nil` if none. |
| `NewInt` | `func NewInt(name string) *Int` | Creates an `Int`, publishes it under `name`, returns it. |
| `NewFloat` | `func NewFloat(name string) *Float` | Creates a `Float`, publishes it, returns it. |
| `NewString` | `func NewString(name string) *String` | Creates a `String`, publishes it, returns it. |
| `NewMap` | `func NewMap(name string) *Map` | Creates a `Map`, publishes it, returns it. |
| `Do` | `func Do(f func(KeyValue))` | Calls `f` for each published variable, in **sorted key order**, while holding the registry lock. |
| `Handler` | `func Handler() http.Handler` | Returns the HTTP handler that serves `/debug/vars`. |

Documented properties:

- The `New*` functions are convenience wrappers over `Publish`; they inherit the duplicate-name termination.
- `Do` holds the registry lock during iteration; the godoc cautions against operations that would require the lock from within `f`.
- `Handler` was added so the endpoint can be mounted on a mux other than `http.DefaultServeMux`.

---

## The HTTP Handler Contract

On import, the package's `init`:

1. Registers a handler at the path `/debug/vars` on `http.DefaultServeMux` (equivalent to `http.Handle("/debug/vars", Handler())`).
2. Publishes the `cmdline` and `memstats` variables.

The handler:

- Responds with `Content-Type: application/json; charset=utf-8`.
- Writes a single JSON object whose members are every published variable: the key is the variable name (JSON-quoted), the value is the **verbatim output** of that variable's `String()`.
- Iterates variables in sorted key order, producing deterministic output.

`Handler()` returns this same handler so callers can mount it explicitly:

```go
mux.Handle("/debug/vars", expvar.Handler())
```

The godoc notes that the package registers on the default mux *and* that `Handler()` is provided for callers who want to register elsewhere. There is no documented way to *unregister* the default-mux handler.

---

## The Default Variables

Two variables are published at init:

- **`cmdline`** — documented as the program's command-line arguments (`os.Args`), as a JSON array of strings. Implemented as a `Func`.
- **`memstats`** — documented as the result of `runtime.ReadMemStats`, i.e. a `runtime.MemStats` value serialized to JSON. Implemented as a `Func`, so it is recomputed (a fresh `ReadMemStats`) on every read.

The exact field set of `memstats` is defined by `runtime.MemStats`, not by `expvar`; consult `pkg.go.dev/runtime#MemStats` for field meanings.

---

## The JSON Output Contract

The documented output guarantees:

- The response body is a single JSON **object**.
- Each member key is a published variable name.
- Each member value is the raw string returned by that variable's `String()` method — the handler does **not** re-encode it.
- Members appear in sorted key order.

The critical consequence (specified by the "must be valid JSON" requirement on `Var.String()`): because the value is spliced verbatim, a `Var` whose `String()` returns invalid JSON produces an invalid overall document. The contract places the burden of valid JSON on each `Var` implementation, not on the handler.

The built-in types satisfy this:
- `Int`/`Float` emit a JSON number.
- `String` emits a JSON string (quoted, escaped).
- `Map` emits a JSON object.
- `Func` emits `json.Marshal` of the function's result.

---

## Concurrency Guarantees

The godoc documents these safety properties:

- **`Int`, `Float`, `String`** — `Add`/`Set`/`Value` are safe for concurrent use. (The implementation uses `sync/atomic`.)
- **`Map`** — `Add`, `AddFloat`, `Set`, `Get`, `Delete`, and `Do` are safe for concurrent use.
- **The registry** — `Publish`, `Get`, and `Do` are safe for concurrent use (guarded by a mutex).
- **`Func`** — the adapter itself adds no synchronization; the *function body's* thread-safety is the caller's responsibility, since it may run concurrently with other goroutines reading or mutating shared state.

No built-in type requires the caller to add a mutex. The documentation's concurrency guarantees cover all the type-level operations.

---

## The Duplicate-Name Contract

`Publish` (and therefore the `New*` constructors) **terminates the program** if the name is already registered. The godoc states that `Publish` logs via `log.Fatal` (or equivalently panics in a way that terminates) on a reused name, with a message of the form `Reuse of exported var name: <name>`.

Specified consequences:

- Names are effectively permanent for the process lifetime; there is no `Unpublish`.
- A name collision is a fatal startup condition, not a recoverable error — `Publish` has no error return.
- Two packages publishing the same name, or a test republishing a name, will terminate the process.

This is a deliberate API contract: publication has no error channel (it occurs in `init`/`var` initializers), and the package chooses loud termination over silent shadowing.

---

## Behaviour Across Go Versions

`expvar` has been remarkably stable since Go 1.0. Notable points:

- **Go 1.0** — `expvar` introduced with `Int`, `Float`, `String`, `Map`, `Func`, `Publish`, `Get`, the `New*` constructors, `Do`, and the `/debug/vars` registration on the default mux.
- **Go 1.8** — `Handler()` added, enabling explicit mounting on a non-default mux.
- **Various releases** — internal concurrency hardening of `String` and `Map` (e.g. moving to atomic-backed storage so reads are never torn) without changing the documented API. `Float.Add` is implemented as a CAS loop.
- **Go 1.18+** — `Func` is documented as `func() any` (the `any` alias for `interface{}`); behaviour unchanged.
- **`Map.Init`** returns `*Map` for chaining; `Map.Delete` is available for key removal.

The documented surface — the `Var` interface, the five types, the `Publish`/`Get`/`New*`/`Do`/`Handler` functions, the `/debug/vars` endpoint, and the two default variables — has been stable for the entire modern history of Go. New code on Go 1.21+ uses the same API as code from a decade earlier.

---

## References

- [`expvar` package documentation](https://pkg.go.dev/expvar) — authoritative.
- [`expvar.Var` interface](https://pkg.go.dev/expvar#Var)
- [`expvar.Handler`](https://pkg.go.dev/expvar#Handler)
- [`expvar.Publish` / `Get` / `Do`](https://pkg.go.dev/expvar#Publish)
- [`runtime.MemStats`](https://pkg.go.dev/runtime#MemStats) — the `memstats` field set.
- [Source: `src/expvar/expvar.go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/expvar/expvar.go)
- [`net/http.ServeMux`](https://pkg.go.dev/net/http#ServeMux) — the default-mux registration target.

# The `expvar` Package — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What the Package Does on Import, Step by Step](#what-the-package-does-on-import-step-by-step)
3. [The Registry Data Structures](#the-registry-data-structures)
4. [`Publish`, `Get`, and the Duplicate-Name Contract](#publish-get-and-the-duplicate-name-contract)
5. [The Handler: How `/debug/vars` Is Serialized](#the-handler-how-debugvars-is-serialized)
6. [The JSON Contract in Detail](#the-json-contract-in-detail)
7. [Atomic Backing of `Int`, `Float`, and `String`](#atomic-backing-of-int-float-and-string)
8. [`Map` Internals and the Key-Creation Race](#map-internals-and-the-key-creation-race)
9. [`Func` Semantics and Read-Path Cost](#func-semantics-and-read-path-cost)
10. [The Default Variables: `cmdline` and `memstats`](#the-default-variables-cmdline-and-memstats)
11. [Integration Patterns Without the Default Mux](#integration-patterns-without-the-default-mux)
12. [Building a Custom Exporter Over the Registry](#building-a-custom-exporter-over-the-registry)
13. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats `expvar` not as "a counter library" but as a small, fully readable contract between three pieces: a global registry, a set of concurrency-safe `Var` implementations, and an HTTP handler that serializes the registry to JSON. The entire package is a few hundred lines in `src/expvar/expvar.go`; reading it end-to-end is an afternoon and dispels every mystery.

This file is for engineers who maintain observability infrastructure, embed `expvar` into larger frameworks, write exporters that bridge `expvar` into other systems, or own the correctness and security of debug endpoints. After reading you will:

- Know what `expvar` does internally, in pseudocode, from import to serialized response.
- Reason about the registry, the locking, and the atomic backing of each type.
- Understand exactly how the handler builds the JSON document and why the `Var` contract is what it is.
- Build a custom exporter over the registry without re-implementing it.
- Operate `/debug/vars` securely as part of a structured debug surface.

`expvar` is conceptually simple — publish variables, serve them as JSON — but its details (the raw-JSON splice, the fatal duplicate rule, the recomputed `Func`) govern correctness and security in ways that "just a counter" misses.

---

## What the Package Does on Import, Step by Step

The package's `init` and the constructors establish the whole system. Stripped to essentials:

1. **`init` registers the HTTP handler.** It calls `http.HandleFunc("/debug/vars", expvarHandler)` on `http.DefaultServeMux`.
2. **`init` publishes `cmdline`.** A `Func` returning `os.Args`.
3. **`init` publishes `memstats`.** A `Func` that calls `runtime.ReadMemStats` and returns the struct.
4. **Constructors create-and-publish.** `NewInt`/`NewFloat`/`NewString`/`NewMap` allocate a value and call `Publish`.
5. **`Publish` mutates the global registry** under a write lock, fataling on a duplicate name.

### Pseudocode

```go
var (
    mutex   sync.RWMutex
    vars    = map[string]Var{}
    varKeys []string // sorted, for deterministic output
)

func init() {
    http.HandleFunc("/debug/vars", expvarHandler)
    Publish("cmdline", Func(cmdline))   // returns os.Args
    Publish("memstats", Func(memstats)) // calls runtime.ReadMemStats
}

func Publish(name string, v Var) {
    mutex.Lock()
    defer mutex.Unlock()
    if _, exists := vars[name]; exists {
        log.Panicln("Reuse of exported var name:", name) // effectively fatal
    }
    vars[name] = v
    varKeys = append(varKeys, name)
    slices.Sort(varKeys)
}
```

The real implementation differs only in polish — the exact log call, the use of a sorted insert, the `Func` definitions for the defaults. The shape is exactly this: a guarded map plus a sorted key slice, populated at init and by constructors.

---

## The Registry Data Structures

The registry is three coordinated pieces guarded by one `sync.RWMutex`:

- **`vars map[string]Var`** — the name → value mapping.
- **`varKeys []string`** — the names, kept sorted, so iteration and serialization are deterministic.
- **`mutex sync.RWMutex`** — write-locked by `Publish`; read-locked by `Do` and the handler.

Why a separate sorted key slice instead of sorting the map keys on each read? Determinism with low read cost: keeping `varKeys` sorted at publish time (publication is rare) means the handler and `Do` can iterate in order under a read lock without sorting on the hot path. Reads vastly outnumber publishes, so the cost is paid where it is cheap.

The read/write split matters: many goroutines can iterate (`Do`, the handler) concurrently under the read lock, while `Publish` takes the exclusive write lock. Publication is a startup-time event; iteration is a steady-state event. The lock discipline reflects that.

---

## `Publish`, `Get`, and the Duplicate-Name Contract

### `Publish(name string, v Var)`

Takes the write lock, checks for an existing name, and — if found — terminates the program (a `log.Panicln`/fatal path; the message is `Reuse of exported var name: <name>`). Otherwise it stores the var and re-sorts the key list.

The fatal behaviour is a deliberate contract, not a bug. Two rationales:

- **Publication has no error channel.** It happens in `init` and `var` initializers, where returning an error is impossible. The only ways to signal a collision are panic/fatal or silent overwrite. Silent overwrite would shadow one variable behind another and corrupt observability invisibly; failing loud is the lesser evil.
- **A name collision is a program bug,** not a runtime condition to handle. It means two parts of the binary claimed the same global identifier. The correct response is to fix the code, which a startup crash forces.

### `Get(name string) Var`

Read-locks and returns the stored `Var` or `nil`. There is no `(Var, bool)` form; `nil` is the not-found signal. Always nil-check before type-asserting:

```go
if v := expvar.Get("requests"); v != nil {
    n := v.(*expvar.Int).Value()
}
```

### No `Unpublish`

There is no removal API. The registry grows monotonically for the process lifetime. This is why names are an effectively permanent contract and why republishing in tests is hazardous.

---

## The Handler: How `/debug/vars` Is Serialized

`expvarHandler` is short. In pseudocode:

```go
func expvarHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    fmt.Fprintf(w, "{\n")
    first := true
    Do(func(kv KeyValue) {
        if !first {
            fmt.Fprintf(w, ",\n")
        }
        first = false
        fmt.Fprintf(w, "%q: %s", kv.Key, kv.Value.String())
    })
    fmt.Fprintf(w, "\n}\n")
}
```

The two load-bearing details:

1. **The key is `%q`-quoted** — `expvar` JSON-encodes the *name* itself. Names with special characters are safely quoted.
2. **The value is `%s`-spliced raw** — `kv.Value.String()` is written *verbatim*, with no encoding. This is the crux of the whole contract: the handler trusts each `Var` to return valid JSON.

`Do` is the iteration primitive (next section). The handler holds the registry read lock for the duration of the response via `Do`, which means a slow `Var.String()` (e.g. an expensive `Func`) holds the read lock and can delay concurrent `Publish` calls — rarely an issue in practice, but worth knowing.

The `Content-Type` is `application/json`, so the endpoint advertises itself correctly to clients and scrapers.

---

## The JSON Contract in Detail

Because the handler splices `Var.String()` raw, the contract is absolute: **`String()` must return exactly one syntactically valid JSON value.**

| Type | `String()` output | Valid JSON? |
|------|-------------------|-------------|
| `Int(42)` | `42` | number ✓ |
| `Float(0.95)` | `0.95` | number ✓ |
| `String("hi")` | `"hi"` | string ✓ (quoted) |
| `Map{...}` | `{"a": 1, "b": 2}` | object ✓ |
| `Func(fn)` | `json.Marshal(fn())` | depends on fn's result |
| bad custom `Var` | `hi` (unquoted) | ✗ — corrupts whole doc |

Consequences a professional must internalize:

- **`String` quotes itself by necessity.** A bare string is not valid JSON; `String.String()` therefore returns the JSON-encoded form. `Value()` returns the raw Go string. The two differ, and that difference is correct, not a quirk to work around.
- **One bad `Var` poisons the document.** Since values are concatenated raw, a single `Var` returning invalid JSON makes the entire `/debug/vars` response unparseable. A scraper that JSON-decodes the whole body drops *everything*, not just the offending key.
- **Custom `Var`s must marshal-and-fallback.** Always `json.Marshal` and return a valid fallback (`"null"`) on error — never an empty string, never raw text.
- **`Func` results are marshaled for you.** `Func.String()` calls `json.Marshal` on the function's return value, so a `Func` returning an arbitrary marshalable Go value is safe; a `Func` returning something `json.Marshal` errors on yields the marshal-error path.

---

## Atomic Backing of `Int`, `Float`, and `String`

The scalar types are concurrency-safe without per-operation mutexes, using `sync/atomic`.

### `Int`

Backed by `atomic.Int64`. `Add` is `atomic.AddInt64`; `Set` is an atomic store; `Value` is an atomic load; `String` formats the loaded value with `strconv.FormatInt`. There is no lock, so `Add` scales to extremely high call rates — it is a single atomic instruction plus the function-call overhead.

### `Float`

Backed by `atomic.Uint64` storing the IEEE-754 bit pattern (`math.Float64bits`). `Set`/`Value` are a single atomic store/load with bit conversion. `Add` cannot be a single atomic instruction (float addition is not atomic in hardware), so it is a **compare-and-swap loop**:

```go
for {
    cur := atomic.LoadUint64(&f.bits)
    next := math.Float64bits(math.Float64frombits(cur) + delta)
    if atomic.CompareAndSwapUint64(&f.bits, cur, next) {
        break
    }
}
```

Under contention the loop may retry, but it remains lock-free and correct.

### `String`

Backed by an `atomic.Value` (or equivalent) holding the string. `Set` stores; `Value` loads the raw string; `String` returns the JSON-quoted form via `strconv.Quote`/`json.Marshal`. Because the store is atomic, a concurrent reader never observes a torn or partially-updated string.

**Historical note.** Very old Go versions implemented `String` with a plain mutex and a non-atomic update path; in pathological interleavings a reader could observe an inconsistent value, and the JSON-quoting behaviour was the fix that guaranteed valid output. On all supported Go (1.21+), `String` is fully consistent and you do not need to reason about torn reads.

The takeaway: the scalar types are lock-free and safe; never wrap them in your own mutex.

---

## `Map` Internals and the Key-Creation Race

`Map` is the most intricate built-in type because it must safely *create* a per-key value on first write while allowing concurrent writers.

Internals (modern Go):

- A `sync.Map` (`m`) holds `key → Var` (the per-key value, usually an `*Int`).
- An ordered key list (`keysMu` + a slice) maintains sorted output.
- `Add(key, delta)` does a `Load`; if the key is absent it constructs a fresh `*Int`, attempts `LoadOrStore`, and the winner's `*Int` is the one that gets the add. This LoadOrStore is the race-free creation: concurrent first-writers to the same new key both call `LoadOrStore`, exactly one's `*Int` is stored, and both then `Add` to that single value. No duplicate counters, no lost increments.

`AddFloat` is the same with a `*Float`. `Set(key, v Var)` stores an arbitrary `Var`. `Get` returns the per-key `Var` or `nil`. `Delete` removes a key. `Do` iterates in sorted key order. `Init` resets the map.

`Map.String()` builds a JSON object, iterating keys in sorted order and splicing each value's `String()` — the same raw-JSON contract applies per value, which is why the per-key values must themselves be valid `Var`s (they are, since `Add`/`AddFloat` create `Int`/`Float`, and `Set` requires a `Var`).

Performance: an `Add` to an *existing* key is a `sync.Map` load plus an atomic add — cheap. An `Add` to a *new* key pays the `LoadOrStore` and the sorted-key bookkeeping — more expensive, but a one-time cost per key. For very hot, known key sets, pre-creating the keys at startup avoids the creation race on the hot path.

---

## `Func` Semantics and Read-Path Cost

`Func` is the simplest type and the one with the subtlest operational profile:

```go
type Func func() any
func (f Func) Value() any     { return f() }
func (f Func) String() string { b, _ := json.Marshal(f()); return string(b) }
```

Every read of the variable — i.e. every `/debug/vars` request, and every `Do` that calls `String()` — **invokes the function**. This has three professional implications:

1. **Always current.** A `Func` gauge cannot drift, because it has no stored state; it computes the live value on demand.
2. **Read-path cost.** The function runs on the HTTP request goroutine, holding the registry read lock. An expensive `Func` (I/O, deep computation, lock contention) makes `/debug/vars` slow and can perturb the very process you are inspecting. The fix is to compute expensive values on a background timer and have the `Func` return a cached, cheaply-read value.
3. **Panic propagation.** A panic inside the function propagates through the handler. Read-path code must be panic-free, or defensively recovered, or the `/debug/vars` request fails.

The default `memstats` is a `Func` that calls `runtime.ReadMemStats`. That call is not free — historically it could briefly stop the world — so high-frequency scraping of the full endpoint has a measurable cost driven entirely by this `Func`.

---

## The Default Variables: `cmdline` and `memstats`

Two variables are published by `init`:

### `cmdline`

A `Func` returning `os.Args` — the program name and every command-line argument, as a JSON array. Operationally useful (which binary, which flags) and a disclosure risk (flags, paths, any secret passed on the command line).

### `memstats`

A `Func` that calls `runtime.ReadMemStats(&m)` and returns the populated `runtime.MemStats`. Every field — `Alloc`, `TotalAlloc`, `HeapInuse`, `NumGC`, `PauseTotalNs`, and dozens more — is serialized. It is a live snapshot, recomputed on each read, which is why it is always current and why it carries the `ReadMemStats` cost.

Both are ordinary `Func`s in the same global registry; there is nothing special about them except that the package publishes them for you. You can read them via `expvar.Get("memstats")` and type-assert, or iterate them with `Do`, exactly like any other var. Because they disclose operational detail, they are the primary reason `/debug/vars` must never be public.

---

## Integration Patterns Without the Default Mux

The `init`-time registration on `http.DefaultServeMux` is convenient and risky. Professional integration controls it explicitly.

### Mount on a custom mux

```go
mux := http.NewServeMux()
mux.Handle("/debug/vars", expvar.Handler())
server := &http.Server{Addr: "127.0.0.1:6060", Handler: mux}
```

`expvar.Handler()` returns the same handler the package registers by default. Mounting it yourself decouples the endpoint from the default mux and lets you choose the path, the listener, and any wrapping middleware (auth).

### Separate public and debug listeners

The standard professional layout: a public `http.Server` with an explicit mux that *does not* carry `/debug/*`, and a second internal `http.Server` (localhost-bound) that mounts `/debug/vars` and `/debug/pprof`. Public traffic never reaches the debug endpoints, and the default-mux registration is inert because you never serve `http.DefaultServeMux`.

### Wrapping for authentication

```go
mux.Handle("/debug/vars", requireAuth(expvar.Handler()))
```

Since `expvar.Handler()` is a plain `http.Handler`, composing it with middleware is trivial. This is the way to make the endpoint reachable beyond localhost safely.

The principle: never let the endpoint's exposure be an emergent property of "imported `expvar` + served default mux." Make it an explicit `mux.Handle` you can see and review.

---

## Building a Custom Exporter Over the Registry

When you need `expvar`'s numbers in another system, walk the registry rather than re-implementing it.

### `expvar.Do` in-process

```go
expvar.Do(func(kv expvar.KeyValue) {
    switch v := kv.Value.(type) {
    case *expvar.Int:
        emitGauge(kv.Key, float64(v.Value()))
    case *expvar.Float:
        emitGauge(kv.Key, v.Value())
    case *expvar.Map:
        v.Do(func(inner expvar.KeyValue) {
            emitLabeled(kv.Key, inner.Key, inner.Value)
        })
    default:
        // Func or custom Var: fall back to parsing String()
        emitRaw(kv.Key, kv.Value.String())
    }
})
```

Type-switching gives you typed access to `*Int`, `*Float`, `*Map`, so you can translate into a target metric system (Prometheus, OTLP) with proper types where possible. For `Func` and custom `Var`s you fall back to parsing the JSON from `String()`.

### Scraping `/debug/vars` out-of-process

A standalone exporter polls the endpoint, JSON-decodes the body, and re-emits. This works without modifying the target binary but cannot recover types or labels — it sees only flat JSON.

### What you cannot recover

Neither approach can synthesize information `expvar` never carried: there are no histograms to translate, no label sets beyond `Map` keys, no rate metadata. The exporter is a faithful re-exposer of flat numbers, nothing more. Treat it as transitional, not as a substitute for native instrumentation.

---

## Edge Cases the Source Reveals

A close reading of `src/expvar/expvar.go` exposes corners most users never hit:

- **Raw-JSON splice.** The handler writes `Var.String()` verbatim. A `Var` returning malformed JSON corrupts the entire document — there is no per-var isolation.
- **`String` vs `Value`.** `String()` is JSON-quoted; `Value()` is the raw Go value. They intentionally differ for the `String` type.
- **`Func` runs under the read lock.** A slow `Func` delays concurrent publication and slows the whole response, because `Do` holds the read lock across all vars.
- **Sorted, deterministic output.** Keys are kept sorted at publish time; `/debug/vars` and `Do` always emit in sorted order. Do not rely on insertion order; do rely on sorted order.
- **`Get` returns `nil`, not `(Var, false)`.** Nil-check before type-asserting.
- **No removal.** The registry only grows; names are permanent; republishing is fatal.
- **Default-mux side effect on import.** Importing the package (even blank) registers `/debug/vars` on `http.DefaultServeMux` whether or not you ever serve it.
- **`Map.Add` to a new key is race-free** via `LoadOrStore`; concurrent first-writers do not create duplicate counters.
- **`memstats` cost.** Each read calls `runtime.ReadMemStats`; the endpoint's read cost is dominated by this default `Func`.

These are pointers to *reach for the source* when behaviour surprises you. The package is small and well-commented; an hour of reading answers most questions definitively.

---

## Operational Playbook

A condensed reference for common scenarios.

| Scenario | Recipe |
|----------|--------|
| Add a counter | `var c = expvar.NewInt("name")`; `c.Add(1)`. |
| Add a gauge | `expvar.Publish("name", expvar.Func(func() any { return liveValue() }))`. |
| Per-key counts | `var m = expvar.NewMap("name")`; `m.Add(key, 1)`. |
| Serve on a custom mux | `mux.Handle("/debug/vars", expvar.Handler())`. |
| Gate the endpoint | Wrap `expvar.Handler()` in auth middleware; bind to localhost. |
| Avoid default-mux exposure | Never serve `http.DefaultServeMux` on a public listener. |
| Read a var in code | `v := expvar.Get("name")`; nil-check; type-assert. |
| Snapshot all vars | `expvar.Do(func(kv expvar.KeyValue){ ... })`. |
| Fix invalid `/debug/vars` JSON | Find the custom `Var` whose `String()` returns non-JSON; marshal-and-fallback. |
| Fix slow `/debug/vars` | Find the expensive `Func`; cache its value on a timer. |
| Avoid test crashes | Inject unpublished vars in tests; publish once in production via `sync.Once`. |
| Bridge to Prometheus | Walk the registry with `Do` and type-switch, or scrape `/debug/vars` and translate. |
| Audit disclosure | Curl `/debug/vars`; review `cmdline`, `memstats`, and every app var for sensitive data. |

---

## Summary

`expvar` is a small, fully readable contract: a global registry of `name → Var`, guarded by a read/write mutex with a sorted key list, plus an HTTP handler that serializes the registry into one JSON object by splicing each `Var.String()` *verbatim*. The professional understanding centers on that raw-JSON splice (which makes the valid-JSON contract absolute and one bad var fatal to the whole document), the lock-free atomic backing of `Int`/`Float`/`String`, the race-free `LoadOrStore` key creation in `Map`, and the recompute-on-read semantics and read-path cost of `Func` — including the `memstats` default that calls `runtime.ReadMemStats` on every read.

Operationally, the two things that bite are security and integration. The `init`-time registration on `http.DefaultServeMux` causes silent exposure if you serve the default mux publicly; the fix is to never serve it publicly and to mount `expvar.Handler()` explicitly on a gated internal listener. When you need the numbers elsewhere, walk the registry with `Do` and type-switch rather than re-implementing the package — accepting that you can only re-expose flat values, never synthesize the histograms and labels `expvar` never carried.

Mastering these layers turns `expvar` from "a counter library" into a precise tool: the smallest correct way to expose live process state as JSON, with a contract you can read in full and a security posture you must enforce deliberately.

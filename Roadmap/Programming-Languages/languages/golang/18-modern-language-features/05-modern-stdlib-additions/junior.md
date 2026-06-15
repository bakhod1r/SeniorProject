# Modern Standard-Library Additions — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What new standard-library packages did Go add recently, and how do I use the everyday ones?"

For most of Go's life, things that other languages baked into their standard libraries — structured logging, a generic "sort this slice" function, "give me the keys of this map" — were left to third-party packages. You reached for `logrus` or `zap` for logs, you wrote your own `contains` loop, you copied a `Keys()` helper into every project.

Between **Go 1.21 (August 2023)** and **Go 1.24 (February 2025)**, the standard library closed most of those gaps. Generics (added in 1.18) finally made it possible to write *type-safe* helper packages, and the team used them to ship:

- **`log/slog`** — structured, levelled logging, built in.
- **`slices`** — `Sort`, `Contains`, `Index`, `Min`, `Max`, and friends, for any slice.
- **`maps`** — `Keys`, `Values`, `Clone`, `Equal`, for any map.
- **`cmp`** — comparison helpers (`cmp.Compare`, `cmp.Or`).
- **`math/rand/v2`** — a cleaned-up randomness package.
- **`unique`** — deduplicate (intern) repeated values to save memory.

And one big non-package change: **`net/http.ServeMux` learned method-and-pattern routing** in Go 1.22, so you can write `mux.HandleFunc("GET /items/{id}", ...)` without a router library.

After reading this file you will:
- Know which package to import for common tasks (logging, sorting, map keys, comparison)
- Write a structured log line with `slog`
- Sort and search a slice without writing a loop
- Get the keys of a map in one call
- Register an HTTP route with a method and a path variable

You do **not** need to understand iterators (`iter`), handler internals, or interning yet. This file is the everyday toolkit.

---

## Prerequisites

- **Required:** Go **1.21 or newer** for `slog`, `slices`, `maps`, `cmp`. Go **1.22+** for `math/rand/v2`, `cmp.Or`, and the new `http.ServeMux` routing. Go **1.23+** for `unique` and the slice/map iterator functions. Check with `go version`.
- **Required:** Comfort writing a `main` package, importing standard-library packages, and running `go run`.
- **Required:** Basic understanding of slices and maps.
- **Helpful:** A nodding acquaintance with generics — you do not need to *write* generic code, only call generic functions like `slices.Sort(s)`.
- **Helpful:** Having logged with `log.Println` before, so you can feel the difference `slog` makes.

If `go version` prints `go1.21` or higher, start here. For the 1.22/1.23 features, you need the matching version.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Standard library (stdlib)** | The packages that ship with Go itself — no `go get` needed. |
| **`log/slog`** | The structured-logging package added in Go 1.21. "slog" = structured log. |
| **Structured logging** | Logging key/value pairs (`user_id=42 status="ok"`) instead of one free-form string. |
| **`slices`** | A generic package of slice helpers (`Sort`, `Contains`, `Index`, …) added in 1.21. |
| **`maps`** | A generic package of map helpers (`Keys`, `Values`, `Clone`, …) added in 1.21. |
| **`cmp`** | A tiny package of comparison helpers (`cmp.Compare`, `cmp.Or`) added in 1.21/1.22. |
| **`cmp.Ordered`** | A constraint matching any type you can compare with `<` (numbers, strings). |
| **`math/rand/v2`** | A redesigned randomness package added in 1.22; the "v2" of `math/rand`. |
| **`unique`** | A package (1.23) that deduplicates equal values so you store each only once. |
| **`ServeMux`** | The standard HTTP request router (`http.NewServeMux()`); gained pattern routing in 1.22. |
| **Handler (slog)** | The object that decides *how* a log record is formatted and *where* it goes. |
| **Attr** | A single key/value pair attached to a `slog` log line. |

---

## Core Concepts

### `slog`: logging with key/value pairs

Old-style logging produces a string you later regret trying to parse:

```go
log.Printf("user %d logged in from %s", userID, ip)
// 2009/11/10 23:00:00 user 42 logged in from 10.0.0.1
```

`slog` produces a *record* with named fields, which a machine can read:

```go
slog.Info("user logged in", "user_id", userID, "ip", ip)
// time=... level=INFO msg="user logged in" user_id=42 ip=10.0.0.1
```

The arguments after the message are **alternating keys and values**: `"user_id", userID, "ip", ip`. `slog` is built into the standard library, has levels (Debug/Info/Warn/Error), and can output human-readable text *or* JSON — without changing your call sites.

### `slices`: stop writing the same loops

Before 1.21, "is `x` in this slice?" meant a `for` loop. Now:

```go
import "slices"

nums := []int{5, 2, 8, 1}
slices.Sort(nums)                 // nums is now [1 2 5 8]
found := slices.Contains(nums, 8) // true
i := slices.Index(nums, 5)        // 2
biggest := slices.Max(nums)       // 8
```

Every function is *generic* — it works for `[]int`, `[]string`, `[]float64`, or any comparable element type, with full type safety.

### `maps`: keys, values, clone

Go maps still do not have a built-in "give me the keys" method. The `maps` package fills that gap (with a twist we cover in Code Examples — in 1.23 these return *iterators*):

```go
import "maps"

m := map[string]int{"a": 1, "b": 2}
m2 := maps.Clone(m)          // a separate copy
equal := maps.Equal(m, m2)   // true
```

### `cmp`: comparison helpers

`cmp.Compare(a, b)` returns `-1`, `0`, or `+1`. `cmp.Or` (1.22) returns the first non-zero argument — perfect for "use this, else fall back to that":

```go
import "cmp"

port := cmp.Or(os.Getenv("PORT"), "8080") // "8080" if PORT is empty
```

### `net/http.ServeMux`: routing with methods and path variables (1.22)

The biggest quality-of-life win for web developers. Before 1.22, the standard router could not match by method or extract path variables; you needed `chi`, `gorilla/mux`, or `gin`. Since 1.22:

```go
mux := http.NewServeMux()
mux.HandleFunc("GET /items/{id}", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")          // grab the {id} segment
    fmt.Fprintf(w, "item %s", id)
})
```

The pattern is `METHOD /path/{wildcard}`. The method (`GET`, `POST`, …) is optional; the `{name}` segments become path values you read with `r.PathValue("name")`.

---

## Real-World Analogies

**1. A labelled spice rack vs. a mystery jar.** Old `log.Printf` is a jar of mixed spices — you taste it to figure out what is inside. `slog` is a rack where each jar is labelled `cinnamon`, `cumin`, `paprika`. A machine (or a tired human at 3 a.m.) can find the one it needs instantly.

**2. A Swiss-army knife you finally own.** For years you borrowed your neighbour's knife (`logrus`, `lo`, `golang.org/x/exp/slices`). Now the toolkit ships in the box: `slices`, `maps`, `cmp`. Same tools, no borrowing.

**3. A renovated kitchen, not a new house.** `math/rand/v2` is not a different language; it is the *same* randomness, with the drawers reorganised so the sharp knives are no longer pointing at you (no accidental global seeding, no confusing method names).

**4. A coat-check ticket.** `unique.Make` is like a coat check: hand in your coat (a value), get a small numbered ticket (a `Handle`). A thousand people with identical coats can share one stored coat, and comparing tickets is instant.

---

## Mental Models

### Model 1 — "Generics made the helpers possible"

`slices`, `maps`, and `cmp` could not exist before Go 1.18's generics. They are the *payoff* of generics: one `slices.Sort` instead of a hand-written sort per element type. When you call them, you are calling generic functions.

### Model 2 — `slog` separates *what* from *how*

Your code says *what* happened: `slog.Info("order placed", "id", id)`. A **Handler** decides *how* it is rendered (text? JSON?) and *where* it goes (stdout? a file?). You can swap the handler without touching a single log call.

### Model 3 — The `v2` packages are "do-overs"

`math/rand/v2` exists because the Go team cannot change `math/rand` without breaking everyone. So they made a parallel, better version. Both coexist. New code uses `v2`.

### Model 4 — `ServeMux` patterns read left to right

`"GET /items/{id}"` = "match a GET request whose path is `/items/` followed by one segment, captured as `id`." The toolchain enforces precedence (more specific patterns win) so you do not have to order routes carefully.

### Model 5 — These are additions, not replacements

Your old `log`, your old `for` loops, your old `math/rand` code all still compile. Nothing was removed. You adopt the new packages where they help.

---

## Pros & Cons

### Pros

- **No third-party dependency** for logging, slice/map helpers, comparison. Smaller `go.mod`, fewer supply-chain worries.
- **Type-safe** — `slices.Contains([]int{...}, "x")` will not compile. The compiler catches mistakes.
- **Consistent** — every Go project from 1.21 onward speaks the same `slog`/`slices` vocabulary.
- **Faster onboarding** — the docs are on `pkg.go.dev`, maintained by the Go team.
- **`net/http` routing** removes the most common reason to add a router dependency.

### Cons

- **Version floor** — using these features raises your minimum Go version. A library targeting Go 1.20 cannot use `slog`.
- **`slog` ergonomics take getting used to** — the alternating key/value style is easy to get wrong (odd number of arguments).
- **Iterator-returning functions (1.23)** surprised people who expected `maps.Keys` to return a slice. (It returns an iterator now.)
- **Ecosystem still catching up** — some libraries default to their own logger, not `slog`.

---

## Use Cases

Reach for the modern stdlib when:

- **You are starting a new service** on Go 1.22+. Use `slog` for logging and `http.ServeMux` for routing before adding any dependency.
- **You keep writing `contains`/`indexOf`/`sort` loops.** Replace them with `slices`.
- **You need a map's keys or a defensive copy.** `maps.Keys`, `maps.Clone`.
- **You read config with fallbacks.** `cmp.Or(envValue, defaultValue)`.
- **You generate random numbers** in new code. Use `math/rand/v2`.
- **You hold millions of repeated strings/structs** and want to cut memory. `unique`.

Do **not** rush to:

- Rewrite a working third-party logger across a huge codebase on day one — migrate gradually.
- Adopt `unique` before you have measured a real memory problem.

---

## Code Examples

### Example 1 — Your first `slog` line

```go
package main

import "log/slog"

func main() {
    slog.Info("server started", "port", 8080, "env", "dev")
    slog.Warn("low disk space", "free_mb", 120)
    slog.Error("connection failed", "host", "db1", "err", "timeout")
}
```

Output (default text handler):

```
2025/02/01 10:00:00 INFO server started port=8080 env=dev
2025/02/01 10:00:00 WARN low disk space free_mb=120
2025/02/01 10:00:00 ERROR connection failed host=db1 err=timeout
```

The pairs after the message are `key, value, key, value, ...`.

### Example 2 — Switching to JSON logs

Same call sites, different output — just install a JSON handler:

```go
package main

import (
    "log/slog"
    "os"
)

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    slog.SetDefault(logger) // make slog.Info() etc. use it

    slog.Info("server started", "port", 8080)
}
```

Output:

```json
{"time":"2025-02-01T10:00:00Z","level":"INFO","msg":"server started","port":8080}
```

Now a log aggregator can index `port` as a real field.

### Example 3 — `slices` everyday operations

```go
package main

import (
    "fmt"
    "slices"
)

func main() {
    s := []int{3, 1, 4, 1, 5, 9, 2, 6}

    slices.Sort(s)                       // [1 1 2 3 4 5 6 9]
    fmt.Println(slices.Contains(s, 5))   // true
    fmt.Println(slices.Index(s, 4))      // index of first 4
    fmt.Println(slices.Min(s), slices.Max(s)) // 1 9

    s = slices.Compact(s)                // remove *adjacent* duplicates
    fmt.Println(s)                       // [1 2 3 4 5 6 9]

    c := slices.Clone(s)                 // independent copy
    fmt.Println(slices.Equal(s, c))      // true
}
```

`slices.Compact` only removes *adjacent* equal elements — that is why you sort first.

### Example 4 — Sorting structs with `slices.SortFunc` and `cmp`

```go
package main

import (
    "cmp"
    "fmt"
    "slices"
)

type Person struct {
    Name string
    Age  int
}

func main() {
    people := []Person{
        {"Bob", 30}, {"Alice", 25}, {"Eve", 30},
    }

    slices.SortFunc(people, func(a, b Person) int {
        return cmp.Or(
            cmp.Compare(a.Age, b.Age),   // first by age
            cmp.Compare(a.Name, b.Name), // then by name
        )
    })

    fmt.Println(people) // [{Alice 25} {Bob 30} {Eve 30}]
}
```

`cmp.Compare` returns -1/0/+1; `cmp.Or` returns the first non-zero result, giving multi-key sorting in three lines.

### Example 5 — `maps` keys and clone (Go 1.21 vs 1.23)

In Go 1.23, `maps.Keys` returns an **iterator**, not a slice. To get a slice, collect it:

```go
package main

import (
    "fmt"
    "maps"
    "slices"
)

func main() {
    m := map[string]int{"a": 1, "b": 2, "c": 3}

    keys := slices.Sorted(maps.Keys(m)) // iterator → sorted slice
    fmt.Println(keys)                   // [a b c]

    cp := maps.Clone(m)
    fmt.Println(maps.Equal(m, cp))      // true
}
```

`maps.Keys(m)` hands you an iterator; `slices.Sorted` (1.23) drains it into a sorted slice. See [01-iterators-and-range-over-func](../01-iterators-and-range-over-func/junior.md) for what iterators are.

### Example 6 — Modern HTTP routing (Go 1.22)

```go
package main

import (
    "fmt"
    "net/http"
)

func main() {
    mux := http.NewServeMux()

    mux.HandleFunc("GET /items/{id}", func(w http.ResponseWriter, r *http.Request) {
        id := r.PathValue("id")
        fmt.Fprintf(w, "GET item %s\n", id)
    })

    mux.HandleFunc("POST /items", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "created an item")
    })

    http.ListenAndServe(":8080", mux)
}
```

`GET /items/5` prints `GET item 5`; `POST /items` prints `created an item`; `DELETE /items/5` returns `405 Method Not Allowed` automatically.

### Example 7 — `cmp.Or` for config fallbacks

```go
package main

import (
    "cmp"
    "fmt"
    "os"
)

func main() {
    port := cmp.Or(os.Getenv("PORT"), os.Getenv("FALLBACK_PORT"), "8080")
    fmt.Println("listening on", port)
}
```

The first non-empty string wins; `"8080"` is the final default.

---

## Coding Patterns

### Pattern: configure the default logger once, log everywhere

```go
func main() {
    h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
    slog.SetDefault(slog.New(h))
    // From now on, slog.Info/Warn/Error anywhere uses JSON.
}
```

### Pattern: sort-then-search

`slices.BinarySearch` needs a sorted slice; pair it with `slices.Sort`:

```go
slices.Sort(s)
i, found := slices.BinarySearch(s, target)
```

### Pattern: deterministic map iteration

Maps iterate in random order. For stable output, sort the keys:

```go
for _, k := range slices.Sorted(maps.Keys(m)) {
    fmt.Println(k, m[k])
}
```

### Pattern: prefer `http.ServeMux` before a router library

Start every new HTTP service with the standard mux. Only add `chi`/`echo` if you hit a feature the stdlib genuinely lacks (middleware chaining ergonomics, regex routes).

---

## Clean Code

- **Always pass keys and values in pairs to `slog`.** An odd count produces a `!BADKEY` placeholder, not a compile error.
- **Use constant keys**, not formatted strings: `slog.Info("done", "count", n)` — not `slog.Info(fmt.Sprintf("done %d", n))`. The whole point is structure.
- **Import `slices`/`maps` instead of copy-pasting helpers.** Delete your old `contains` and `keys` utilities.
- **Use `cmp.Compare` inside `SortFunc`**, not hand-written `if a < b { return -1 }` ladders.
- **Set the logger once in `main`** and use the package-level `slog.Info` elsewhere, or pass a `*slog.Logger` explicitly. Pick one style.

---

## Product Use / Feature

These additions affect real products:

- **Observability.** `slog` JSON output drops straight into Loki, Datadog, CloudWatch, or Elasticsearch with searchable fields — no log-parsing regex.
- **Smaller dependency trees.** Dropping a logging library and a router shrinks `go.mod`, speeds builds, and reduces audit surface.
- **Fewer bugs.** Type-safe `slices`/`maps` calls replace error-prone hand loops.
- **Reproducible randomness.** `math/rand/v2`'s explicit seeding makes tests deterministic when you want them and properly random when you do not.

---

## Error Handling

- **`slog` does not return errors from `Info`/`Warn`/`Error`.** Logging "cannot fail" from your perspective; a broken handler is the handler's problem. Log the error *value* as an attribute: `slog.Error("failed", "err", err)`.
- **`slices.Index` returns `-1`** when not found, not an error. Check for `>= 0`.
- **`slices.BinarySearch` returns `(int, bool)`** — the bool tells you whether the element was actually present; the int is the insertion point either way.
- **`r.PathValue("name")` returns `""`** for an unknown wildcard name — there is no error, so spell the name correctly.
- **`maps.Keys` (1.23) returns an iterator**, not a slice — calling `len()` on it will not compile. Collect first.

---

## Security Considerations

- **`math/rand/v2` is still NOT cryptographically secure.** For tokens, passwords, or keys, use `crypto/rand`. `math/rand/v2` is for simulations, jitter, shuffling — not secrets.
- **Do not log secrets with `slog`.** Structured logs are easy to index *and* easy to leak. Keep passwords, tokens, and PII out of attributes.
- **`http.ServeMux` wildcards are path segments, not regex** — `{id}` matches one segment and will not match `/`, which limits some traversal tricks, but always validate `PathValue` before using it in queries or file paths.
- **JSON log injection** — attacker-controlled strings in attributes are safely escaped by `slog.NewJSONHandler`; do not hand-build JSON log lines yourself.

---

## Performance Tips

- **`slices.Contains` is O(n).** For repeated membership tests, build a `map[T]struct{}` instead.
- **`slog` text/JSON handlers allocate.** For hot paths, guard with `logger.Enabled(ctx, level)` so disabled levels do nothing.
- **`slices.Clone` and `maps.Clone` are shallow** — fast, but nested slices/maps are shared.
- **`math/rand/v2` is faster** than v1 for many operations and has no global mutex on its top-level functions in the same way — see middle.md.
- **`unique.Make` trades CPU for memory** — interning costs a hash lookup but can hugely reduce heap when values repeat.

---

## Best Practices

1. **Use `slog` for new code's logging.** Set the default handler in `main`.
2. **Replace hand-written loops with `slices`/`maps`** wherever they read better.
3. **Start HTTP services with `http.ServeMux`** and its method/wildcard patterns.
4. **Use `math/rand/v2` in new code**, `crypto/rand` for anything secret.
5. **Collect iterator results** (`slices.Collect`, `slices.Sorted`) when you need a slice.
6. **Pin your `go` directive** to the version whose features you use (`go 1.22` to use the new routing).
7. **Keep `slog` keys consistent** across the codebase so dashboards stay simple.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Odd number of `slog` arguments

```go
slog.Info("done", "count")   // value for "count" is missing!
// ...msg="done" !BADKEY=count
```

Always pass keys *and* values.

### Pitfall 2 — `maps.Keys` returns an iterator (1.23+)

```go
keys := maps.Keys(m)        // this is an iter.Seq[K], not a []K
sort.Strings(keys)          // ✗ does not compile
keys := slices.Collect(maps.Keys(m)) // ✓ now it is a slice
```

### Pitfall 3 — `slices.Compact` only removes adjacent duplicates

```go
slices.Compact([]int{1, 1, 2, 1}) // → [1 2 1], NOT [1 2]
```

Sort first if you want global dedup.

### Pitfall 4 — Routing precedence surprises

`/items/{id}` and `/items/new` both match `/items/new`. The standard mux resolves it: the *more specific* pattern (`/items/new`) wins. You do not need to register routes in a special order.

### Pitfall 5 — Forgetting the method makes the route match all methods

`mux.HandleFunc("/items/{id}", ...)` matches GET, POST, DELETE — everything. Add the method when you mean to restrict it.

### Pitfall 6 — `math/rand/v2` has no `Seed`

There is no `rand.Seed` in v2; the global generator is auto-seeded once, randomly. For determinism, create your own source. (See middle.md.)

---

## Common Mistakes

- **Logging unstructured strings with `slog`.** `slog.Info(fmt.Sprintf("user %d", id))` throws away the entire benefit.
- **Calling `len()` on `maps.Keys(m)`** in 1.23+. It is an iterator.
- **Using `slices.Compact` without sorting.** Surprising leftovers.
- **Reaching for `gorilla/mux`** on a new 1.22 project before checking the stdlib.
- **Using `math/rand/v2` for security tokens.** Use `crypto/rand`.
- **Mixing `math/rand` and `math/rand/v2`** in one file by accident — different APIs.
- **Expecting `cmp.Or("", "")` to error** — it returns the zero value `""`.

---

## Common Misconceptions

> *"`slog` is just `log` with colours."*

No. `slog` produces *structured records* with typed key/value attributes, levels, and pluggable handlers. `log` produces one formatted string.

> *"`slices` is the same as `golang.org/x/exp/slices`."*

The standard `slices` (1.21) is the *graduated, stabilised* version of the experimental one. Some signatures changed (notably `maps.Keys` became an iterator). Migrate to the stdlib one.

> *"`math/rand/v2` replaces `crypto/rand`."*

No. `crypto/rand` is for security. `math/rand/v2` is for everything else (simulations, shuffles, jitter).

> *"The new `ServeMux` is a full framework."*

No. It is a smarter router: methods, wildcards, precedence. It is not middleware, validation, or rendering. For those you still add code or a library.

> *"I have to rewrite all my logging at once."*

No. `slog` coexists with `log`. You migrate gradually.

---

## Tricky Points

- **`slog.Info` vs `logger.Info`** — the package-level functions use the *default* logger; a `*slog.Logger` value uses its own handler. Set the default once.
- **`slices.Sort` requires `cmp.Ordered` elements**; for structs use `slices.SortFunc`.
- **`maps.Keys`/`maps.Values` order is random** (map iteration order). Sort if you need stability.
- **`cmp.Or` evaluates all arguments** (Go is not lazy here) — do not put side-effecting calls in it expecting short-circuit.
- **The `{$}` pattern** in `ServeMux` (e.g. `/items/{$}`) matches *only* the exact path `/items/`, not subpaths — a 1.22 nuance.
- **`PathValue` only works** when the request was routed by a pattern with that wildcard.

---

## Test

Try this in a scratch folder (Go 1.23+):

```go
package main

import (
    "log/slog"
    "maps"
    "os"
    "slices"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

    nums := []int{4, 2, 7, 2, 1}
    slices.Sort(nums)
    nums = slices.Compact(nums)

    m := map[string]int{"x": 1, "y": 2}
    keys := slices.Sorted(maps.Keys(m))

    slog.Info("result", "nums", nums, "keys", keys, "max", slices.Max(nums))
}
```

Now answer:
1. What does `slices.Compact` do *before* you sort vs after? (Adjacent-only dedup.)
2. Why is `slices.Sorted(maps.Keys(m))` needed instead of `maps.Keys(m)`? (Keys is an iterator; you want a sorted slice.)
3. What handler makes the output JSON? (`slog.NewJSONHandler`.)
4. Is `math/rand/v2` safe for password generation? (No — use `crypto/rand`.)

---

## Tricky Questions

**Q1.** Why does `maps.Keys` return an iterator instead of a slice?

A. Iterators (1.23) avoid allocating a slice you might not need; you can `range` over keys directly, or collect them with `slices.Collect`/`slices.Sorted`. The experimental `x/exp/maps.Keys` returned a slice, which is why the change surprised people.

**Q2.** I wrote `slog.Info("hi", "user")` and saw `!BADKEY`. Why?

A. You passed a key with no value. `slog`'s variadic args are key/value pairs; an odd count leaves the last key without a value, rendered as `!BADKEY=user`.

**Q3.** `slices.Compact` left duplicates in my slice. Bug?

A. No. It only removes *adjacent* equal elements. Sort first for global deduplication.

**Q4.** Does `cmp.Or` short-circuit like `||`?

A. No. All arguments are evaluated; it then returns the first non-zero one. Do not rely on it to skip expensive calls.

**Q5.** My `GET /items/{id}` route also caught `/items/`. Why?

A. It should not — `{id}` requires a non-empty segment. If you also want to match the bare collection path, register `/items/{$}` or `/items`. Check your patterns.

**Q6.** Can I use `slog` on Go 1.20?

A. No. `log/slog` arrived in 1.21. On 1.20 you need a third-party logger or the experimental `golang.org/x/exp/slog`.

**Q7.** Is `math/rand/v2`'s global generator seeded the same every run?

A. No. It is auto-seeded with a random value at startup, every run, and there is no `Seed` function to make it deterministic. Create your own `rand.New(rand.NewPCG(seed1, seed2))` for reproducibility.

**Q8.** Why is there both `slices.Sort` and `slices.SortFunc`?

A. `Sort` works on `cmp.Ordered` elements (numbers, strings) using `<`. `SortFunc` takes a comparison function for everything else — structs, custom orders, multi-key sorts.

---

## Cheat Sheet

```go
// --- slog (1.21) ---
slog.Info("msg", "key", value, "key2", value2)
slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))

// --- slices (1.21; iterators 1.23) ---
slices.Sort(s)                  // ascending, Ordered elements
slices.SortFunc(s, cmpFn)       // custom comparison
slices.Contains(s, x)           // bool
slices.Index(s, x)              // int, -1 if absent
slices.BinarySearch(s, x)       // (int, bool) — needs sorted s
slices.Min(s) / slices.Max(s)
slices.Compact(s)               // dedup ADJACENT equals
slices.Clone(s) / slices.Equal(a, b)
slices.Collect(seq) / slices.Sorted(seq) // iterator → slice (1.23)

// --- maps (1.21; iterators 1.23) ---
maps.Keys(m) / maps.Values(m)   // iterators in 1.23
maps.Clone(m) / maps.Equal(a, b) / maps.Copy(dst, src)

// --- cmp (1.21 / Or in 1.22) ---
cmp.Compare(a, b)               // -1, 0, +1
cmp.Or(a, b, c)                 // first non-zero

// --- math/rand/v2 (1.22) ---
rand.IntN(100)                  // [0,100)
rand.N(int64(50))               // generic version
r := rand.New(rand.NewPCG(1, 2))// reproducible

// --- net/http routing (1.22) ---
mux.HandleFunc("GET /items/{id}", h)
id := r.PathValue("id")
```

| Need | Use | Since |
|------|-----|-------|
| Structured logs | `log/slog` | 1.21 |
| Sort/search/contains a slice | `slices` | 1.21 |
| Keys/values/clone a map | `maps` | 1.21 |
| Compare / fallback | `cmp` | 1.21 / `Or` 1.22 |
| Randomness (non-secret) | `math/rand/v2` | 1.22 |
| Method + path routing | `http.ServeMux` | 1.22 |
| Intern repeated values | `unique` | 1.23 |
| Collection iterators | `slices`/`maps` iter funcs | 1.23 |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Write a `slog` line with correct key/value pairs
- [ ] Switch the default logger to JSON output
- [ ] Sort, search, and dedup a slice with `slices`
- [ ] Sort a struct slice with `slices.SortFunc` and `cmp.Compare`/`cmp.Or`
- [ ] Get a map's keys as a sorted slice (remembering the iterator step in 1.23)
- [ ] Register an HTTP route with a method and a path variable, and read it with `PathValue`
- [ ] Explain why `math/rand/v2` is not for secrets
- [ ] State which Go version each feature needs
- [ ] Avoid the odd-argument `slog` mistake and the adjacent-only `Compact` mistake

---

## Summary

Between Go 1.21 and 1.24 the standard library grew the helpers Go developers had been importing for years: **`log/slog`** for structured logging, **`slices`**/**`maps`**/**`cmp`** for generic collection and comparison work, **`math/rand/v2`** for cleaner randomness, **`unique`** for value interning, and a much smarter **`net/http.ServeMux`** with method-and-wildcard routing.

For a junior, the daily wins are: log with `slog` (key/value pairs, swappable handlers), stop hand-writing slice/map loops, and route HTTP requests with `GET /items/{id}` plus `r.PathValue`. Remember the version floors, remember `maps.Keys` is now an iterator, and remember `math/rand/v2` is never for secrets.

These are additions, not replacements — your old code still works. Adopt the new packages where they make code shorter, safer, and dependency-free.

---

## What You Can Build

After learning this:

- **A dependency-free JSON-logging web service** using only `log/slog` and `http.ServeMux`.
- **A CLI** that sorts, filters, and deduplicates data with `slices` instead of hand loops.
- **A config loader** that falls back through sources with `cmp.Or`.
- **A reproducible simulation** seeded deterministically with `math/rand/v2`.
- **A leaderboard endpoint** sorting structs by multiple keys with `SortFunc` + `cmp`.

You cannot yet:
- Write a custom `slog.Handler` (middle/professional)
- Use `slog` groups, `With`, and context integration (middle)
- Intern values efficiently with `unique.Handle` (middle)
- Build your own iterators (see [01-iterators-and-range-over-func](../01-iterators-and-range-over-func/junior.md))

---

## Further Reading

- [Go 1.21 Release Notes](https://go.dev/doc/go1.21) — `slog`, `slices`, `maps`, `cmp`.
- [Go 1.22 Release Notes](https://go.dev/doc/go1.22) — `math/rand/v2`, `cmp.Or`, `net/http` routing.
- [Go 1.23 Release Notes](https://go.dev/doc/go1.23) — `unique`, iterators, `slices`/`maps` iterator funcs.
- [Go 1.24 Release Notes](https://go.dev/doc/go1.24) — further refinements.
- [`log/slog` package docs](https://pkg.go.dev/log/slog) — the headline addition.
- [Structured Logging with slog (Go blog)](https://go.dev/blog/slog) — the official tutorial.
- [`slices`](https://pkg.go.dev/slices), [`maps`](https://pkg.go.dev/maps), [`cmp`](https://pkg.go.dev/cmp) package docs.
- [Routing Enhancements for Go 1.22 (Go blog)](https://go.dev/blog/routing-enhancements).

---

## Related Topics

- [18.5.1 Iterators and range-over-func](../01-iterators-and-range-over-func/junior.md) — what `slices.All`, `maps.Keys` return
- [18.5.3 `min`, `max`, `clear` builtins](../03-min-max-clear-builtins/junior.md) — sibling 1.21 builtins
- 18.1 Generics — why these generic packages became possible
- 12 Standard Library — the broader stdlib survey
- 09 Concurrency — `slog`'s context integration ties in here

---

## Diagrams & Visual Aids

```
slog: what vs how

   your code                handler                output
   ---------                -------                ------
   slog.Info(            ┌─ TextHandler ──→  level=INFO msg=...
     "msg",      ──────► │
     "k", v)             └─ JSONHandler ──→  {"level":"INFO","msg":...}

   Same call sites. Swap the handler, change the format.
```

```
slices / maps / cmp — the generic toolkit (Go 1.21+)

   slices: Sort SortFunc Index Contains Equal Compact
           Insert Delete Clone Min Max BinarySearch
           (1.23) All Values Collect Sorted

   maps:   Keys Values Clone Equal Copy DeleteFunc
           (1.23 Keys/Values return iterators)

   cmp:    Ordered  Compare  Less  Or(1.22)
```

```
net/http routing (1.22)

   "GET /items/{id}"
    │    │      │
    │    │      └── wildcard → r.PathValue("id")
    │    └───────── path
    └────────────── method (optional)

   precedence: most specific pattern wins
   /items/new  ▸ beats ▸  /items/{id}
```

```
randomness, which package?

   secret? (token, key, password) ──► crypto/rand
   not secret? (shuffle, jitter)  ──► math/rand/v2
   legacy code already on v1      ──► math/rand (still works)
```

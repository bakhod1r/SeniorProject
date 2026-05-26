# Builder Pattern — Optimize

## 1. Goal of this file

This file is about **when a naïve builder is slow or wasteful, and when the fix is worth shipping**. Junior taught the shape, middle taught the variants. Optimize is about the cases where a textbook builder shows up in a CPU or allocation profile and you have to do something about it.

The honest envelope: most builders construct one server at startup, one SQL query per HTTP handler, one test fixture per `t.Run`. At those frequencies, the pattern is essentially free — a single `*Builder` allocation, a handful of field writes, and a `Build()` call that copies into the target. Nobody notices.

It becomes visible when:

- The builder runs **per request** (SQL query per handler, HTTP request per outbound call, log entry per write).
- The builder does **string concatenation with `+=`** instead of `strings.Builder`.
- The builder **value-copies on every step** instead of pointer-mutating.
- The builder **deep-clones maps/slices** that the caller never mutates.
- The builder has a **`sync.Mutex` on every step** for thread-safety nobody asked for.
- The builder is **rebuilt for every call** when the prefix is identical.

Baseline you need to beat. From middle.md §12:

```
BenchmarkDirectStructInit-8     500000000   2.1 ns/op    0 B/op    0 allocs/op
BenchmarkPointerBuilder-8        20000000  54.7 ns/op   48 B/op    1 allocs/op
BenchmarkValueBuilder-8           5000000 213.5 ns/op  240 B/op    5 allocs/op
```

The pointer-receiver builder costs ~55 ns and one allocation. That's the number to beat — or, more often, the number that's already fine.

Structure of the file:

1. Real wins (§3–§9): receiver choice, `strings.Builder`, lazy init, copy-on-write, removing mutexes, `sync.Pool`, prefix caching.
2. Wins that aren't always wins (§10–§14): closure lists, terminal memoization, validation split, config caching, reflection vs codegen.
3. Cost-benefit framing (§15).

---

## 2. Table of Contents

1. [Goal of this file](#1-goal-of-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1: Value-receiver builder allocating on every step](#3-exercise-1-value-receiver-builder-allocating-on-every-step)
4. [Exercise 2: SQL builder using `+=` instead of `strings.Builder`](#4-exercise-2-sql-builder-using--instead-of-stringsbuilder)
5. [Exercise 3: Defensive slice/map allocation in `New()`](#5-exercise-3-defensive-slicemap-allocation-in-new)
6. [Exercise 4: Deep-clone allocating maps caller never mutates](#6-exercise-4-deep-clone-allocating-maps-caller-never-mutates)
7. [Exercise 5: `sync.Mutex` on every step](#7-exercise-5-syncmutex-on-every-step)
8. [Exercise 6: `sync.Pool` for per-request HTTP request builders](#8-exercise-6-syncpool-for-per-request-http-request-builders)
9. [Exercise 7: SQL builder regenerating identical prefix bytes](#9-exercise-7-sql-builder-regenerating-identical-prefix-bytes)
10. [Exercise 8: Generic `Builder[T]` with closure-list — replace with direct field set](#10-exercise-8-generic-buildert-with-closure-list--replace-with-direct-field-set)
11. [Exercise 9: Multi-terminal builder recomputing the same SQL twice](#11-exercise-9-multi-terminal-builder-recomputing-the-same-sql-twice)
12. [Exercise 10: Validation in `Build()` repeated per call](#12-exercise-10-validation-in-build-repeated-per-call)
13. [Exercise 11: Config file re-parsed on every `Build()`](#13-exercise-11-config-file-re-parsed-on-every-build)
14. [Exercise 12: Reflection in `Build()` — replace with code generation](#14-exercise-12-reflection-in-build--replace-with-code-generation)
15. [When NOT to optimize](#15-when-not-to-optimize)
16. [The optimization checklist](#16-the-optimization-checklist)
17. [Summary](#17-summary)

---

## 3. Exercise 1: Value-receiver builder allocating on every step

### Scenario

Someone wrote the builder with value-receiver semantics (middle.md §5.2) because "it's safer / immutable / fork-friendly". The builder is never forked. Every chain step copies the entire builder struct. For a 6-step chain on a 96-byte builder, that's 6 heap copies — six allocations per construction — for no actual benefit.

### Before

```go
package query

import (
    "errors"
    "fmt"
    "strings"
)

type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    orderBy string
    limit   int
    err     error
}

// Value receiver — each step returns a *copy* of the builder.
func Select(cols ...string) Builder {
    return Builder{columns: cols}
}

func (b Builder) From(t string) Builder {
    if b.err != nil { return b }
    if t == "" { b.err = errors.New("From: empty table"); return b }
    b.table = t
    return b
}

func (b Builder) Where(cond string, args ...any) Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b Builder) OrderBy(col string) Builder {
    if b.err != nil { return b }
    b.orderBy = col
    return b
}

func (b Builder) Limit(n int) Builder {
    if b.err != nil { return b }
    if n < 0 { b.err = fmt.Errorf("Limit: negative"); return b }
    b.limit = n
    return b
}

func (b Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    if b.orderBy != "" {
        sb.WriteString(" ORDER BY ")
        sb.WriteString(b.orderBy)
    }
    if b.limit > 0 {
        fmt.Fprintf(&sb, " LIMIT %d", b.limit)
    }
    return sb.String(), b.args, nil
}
```

### Benchmark

```go
func BenchmarkValueBuilder(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _, _ = Select("id", "name", "email").
            From("users").
            Where("active = ?", true).
            Where("created_at > ?", "2024-01-01").
            OrderBy("created_at DESC").
            Limit(100).
            Build()
    }
}
```

```
BenchmarkValueBuilder-8     2_500_000     485 ns/op    624 B/op   11 allocs/op
```

Six chain steps × the slice-grow allocations × the final SQL string. Eleven allocations for one query.

<details><summary>After</summary>

Switch the receiver to pointer. The chain semantics stay identical at the call site; only the internals change.

```go
type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    orderBy string
    limit   int
    err     error
}

// Pointer receiver — one allocation, mutations in place.
func Select(cols ...string) *Builder {
    return &Builder{columns: cols}
}

func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    if t == "" { b.err = errors.New("From: empty table"); return b }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) OrderBy(col string) *Builder {
    if b.err != nil { return b }
    b.orderBy = col
    return b
}

func (b *Builder) Limit(n int) *Builder {
    if b.err != nil { return b }
    if n < 0 { b.err = fmt.Errorf("Limit: negative"); return b }
    b.limit = n
    return b
}

func (b *Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    if b.orderBy != "" {
        sb.WriteString(" ORDER BY ")
        sb.WriteString(b.orderBy)
    }
    if b.limit > 0 {
        fmt.Fprintf(&sb, " LIMIT %d", b.limit)
    }
    return sb.String(), b.args, nil
}
```

```
BenchmarkPointerBuilder-8   6_000_000     198 ns/op    296 B/op    6 allocs/op
```

2.4× faster, 5 fewer allocations.

**Why it's faster.** The value-receiver version produced a fresh `Builder` value on every step. The Go escape analyzer, seeing the value escape into the chain expression, heap-allocates each intermediate. With pointer receivers, the builder is allocated once; every step mutates in place. No copy, no escape.

**Trade-off.**
1. You lose the implicit "forking" property. `base := Select(...).From(...)` followed by two divergent chains will now share state. If you actually need forking, use middle.md §4.2 `Clone()`.
2. Calling `b.Build()` twice on the same builder reads the *current* state both times. With value receivers, an intermediate `b` was frozen at that step. Document that the pointer-receiver builder is single-use.

**When NOT to do this.** If your code genuinely branches mid-chain (`base := q.Select("id"); admin := base.Where(...); user := base.Where(...)`), switching to pointer receivers introduces silent bugs. The value-receiver cost is the price of correctness in that pattern. Run a `grep` for builder reuse before changing the receiver.

**pprof:**

```bash
go test -bench=BenchmarkValueBuilder -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) top
```

You'll see `query.Builder.From`, `query.Builder.Where`, etc. each contributing one allocation in the value-receiver version. After the switch, only the initial `*Builder` and slice-grows remain.

</details>

---

## 4. Exercise 2: SQL builder using `+=` instead of `strings.Builder`

### Scenario

The SQL builder accumulates the query as a `string` field, appending with `+=` in each step. Every `+=` allocates a fresh string holding the concatenation. For a 6-clause query, that's 6 string allocations whose sizes grow with each step.

### Before

```go
package query

import "fmt"

type Builder struct {
    sql  string  // accumulated query
    args []any
    err  error
}

func Select(cols ...string) *Builder {
    return &Builder{sql: "SELECT " + columnsJoin(cols)}
}

func columnsJoin(cols []string) string {
    out := ""
    for i, c := range cols {
        if i > 0 { out += ", " }
        out += c                     // each += allocates
    }
    return out
}

func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    b.sql += " FROM " + t            // allocates
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    if !contains(b.sql, " WHERE ") {
        b.sql += " WHERE " + cond
    } else {
        b.sql += " AND " + cond
    }
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) OrderBy(col string) *Builder {
    if b.err != nil { return b }
    b.sql += " ORDER BY " + col
    return b
}

func (b *Builder) Limit(n int) *Builder {
    if b.err != nil { return b }
    b.sql += fmt.Sprintf(" LIMIT %d", n)
    return b
}

func (b *Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    return b.sql, b.args, nil
}

func contains(s, sub string) bool { /* strings.Contains inlined */ return false }
```

### Benchmark

```go
func BenchmarkStringConcat(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _, _ = Select("id", "name", "email").
            From("users").
            Where("active = ?", true).
            Where("created_at > ?", "2024-01-01").
            OrderBy("created_at DESC").
            Limit(100).
            Build()
    }
}
```

```
BenchmarkStringConcat-8     1_000_000   1_140 ns/op   1_360 B/op   23 allocs/op
```

Every `+=` allocates a new string. The `contains(b.sql, " WHERE ")` scan adds O(n) work per `Where` call.

<details><summary>After</summary>

Accumulate fragments and assemble once in `Build()`. The fragments live in a slice; the final string is one allocation backed by `strings.Builder`.

```go
package query

import (
    "fmt"
    "strings"
)

type Builder struct {
    columns []string
    table   string
    wheres  []string
    args    []any
    orderBy string
    limit   int
    err     error
}

func Select(cols ...string) *Builder {
    return &Builder{columns: cols}
}

func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) OrderBy(col string) *Builder {
    if b.err != nil { return b }
    b.orderBy = col
    return b
}

func (b *Builder) Limit(n int) *Builder {
    if b.err != nil { return b }
    b.limit = n
    return b
}

func (b *Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    // Pre-size the buffer based on expected output length.
    sb.Grow(64 + 16*len(b.wheres))
    sb.WriteString("SELECT ")
    for i, c := range b.columns {
        if i > 0 { sb.WriteString(", ") }
        sb.WriteString(c)
    }
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        for i, w := range b.wheres {
            if i > 0 { sb.WriteString(" AND ") }
            sb.WriteString(w)
        }
    }
    if b.orderBy != "" {
        sb.WriteString(" ORDER BY ")
        sb.WriteString(b.orderBy)
    }
    if b.limit > 0 {
        fmt.Fprintf(&sb, " LIMIT %d", b.limit)
    }
    return sb.String(), b.args, nil
}
```

```
BenchmarkStringsBuilder-8   5_500_000     215 ns/op    288 B/op    6 allocs/op
```

5.3× faster, 17 fewer allocations.

**Why it's faster.** `strings.Builder` writes into a growable `[]byte` and converts to `string` once at the end (via `unsafe.String`, no copy). The `+=` version reallocates a fresh string on every operation, copying the previous content each time. For a chain that builds up to N bytes total, the `+=` version does O(N²) total work; `strings.Builder` does O(N).

The `sb.Grow(64 + 16*len(b.wheres))` hint avoids the geometric resizing entirely if the estimate is close — one allocation instead of `log2(N)`.

**Trade-off.**
1. The structure of the builder changes — you now store fields, not a pre-assembled string. If callers expected `b.sql` to be progressively inspectable mid-chain, that view is gone.
2. The `contains(b.sql, " WHERE ")` trick (used to detect first vs subsequent `Where`) is no longer needed — you have `len(b.wheres) == 0` instead. Cleaner.
3. The `Build()` is now where all the formatting work lives. Profilers will point at `Build()` instead of `Where()`. That's correct but might surprise reviewers who remember the old shape.

**When NOT to do this.** Never. This is a pure win for any text-accumulating builder. `+=` in a builder is essentially always a bug.

**pprof:**

```bash
go test -bench=BenchmarkStringConcat -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) top
```

The `+=` version shows `runtime.concatstrings` and `runtime.mallocgc` dominating. The `strings.Builder` version shows only `strings.(*Builder).WriteString` and one final `unsafe.String`.

</details>

---

## 5. Exercise 3: Defensive slice/map allocation in `New()`

### Scenario

The builder constructor allocates empty slices and maps "just in case" the caller will append. Many callers never do — they call `Build()` with the defaults. The allocations are pure waste.

### Before

```go
package server

import "log"

type Server struct {
    addr     string
    headers  map[string]string
    handlers []Handler
    tags     []string
}

type Builder struct {
    addr     string
    headers  map[string]string
    handlers []Handler
    tags     []string
    err      error
}

// Defensive: pre-allocate everything in case caller wants to append.
func NewBuilder() *Builder {
    return &Builder{
        headers:  make(map[string]string, 16),   // allocated even if unused
        handlers: make([]Handler, 0, 8),
        tags:     make([]string, 0, 8),
    }
}

func (b *Builder) Addr(a string) *Builder { b.addr = a; return b }

func (b *Builder) Header(k, v string) *Builder {
    b.headers[k] = v
    return b
}

func (b *Builder) Handler(h Handler) *Builder {
    b.handlers = append(b.handlers, h)
    return b
}

func (b *Builder) Build() *Server {
    return &Server{
        addr:     b.addr,
        headers:  b.headers,
        handlers: b.handlers,
        tags:     b.tags,
    }
}

type Handler func()
```

### Benchmark

```go
func BenchmarkMinimalBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = NewBuilder().Addr(":8080").Build()  // never touches headers/handlers/tags
    }
}
```

```
BenchmarkMinimalBuild-8    2_000_000   620 ns/op    752 B/op    5 allocs/op
```

Five allocations: builder, headers map, handlers slice, tags slice, server. For a caller that only sets `Addr`, only the builder and server are actually used.

<details><summary>After</summary>

Lazy-init: allocate slices and maps only when the corresponding method is called.

```go
func NewBuilder() *Builder {
    return &Builder{}  // zero-initialized; no allocations beyond the builder itself
}

func (b *Builder) Addr(a string) *Builder { b.addr = a; return b }

func (b *Builder) Header(k, v string) *Builder {
    if b.headers == nil {
        b.headers = make(map[string]string, 4)  // small initial size
    }
    b.headers[k] = v
    return b
}

func (b *Builder) Handler(h Handler) *Builder {
    b.handlers = append(b.handlers, h)  // append handles nil slice
    return b
}

func (b *Builder) Tag(t string) *Builder {
    b.tags = append(b.tags, t)
    return b
}

func (b *Builder) Build() *Server {
    return &Server{
        addr:     b.addr,
        headers:  b.headers,   // may be nil — Server should tolerate that
        handlers: b.handlers,
        tags:     b.tags,
    }
}
```

```
BenchmarkMinimalBuild-8    12_000_000   95 ns/op    144 B/op    2 allocs/op
```

6.5× faster, 3 fewer allocations.

**Why it's faster.** A `nil` map and `nil` slice are zero-cost: no backing array, no map bucket allocation. `append(nilSlice, x)` allocates *only when needed*. Maps need the explicit `if nil` check because writing to a nil map panics, but the allocation cost only hits when someone actually sets a header.

The benchmark with full usage:

```go
func BenchmarkFullBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = NewBuilder().
            Addr(":8080").
            Header("X-A", "1").
            Header("X-B", "2").
            Handler(func() {}).
            Tag("prod").
            Build()
    }
}
```

```
BenchmarkFullBuild-defensive-8    1_500_000    820 ns/op    928 B/op    7 allocs/op
BenchmarkFullBuild-lazy-8         1_800_000    760 ns/op    832 B/op    6 allocs/op
```

When the caller actually uses everything, the lazy version is marginally faster (one fewer pre-allocation that immediately grows anyway). The wins compound when callers use *some* methods but not all.

**Trade-off.**
1. `Build()` may produce a `Server` with `nil` maps/slices. The Server's methods must tolerate `nil` (which Go usually does — `len(nil) == 0`, `range nil` is a no-op, but `nilMap[k]` returns the zero value while `nilMap[k] = v` *panics*).
2. The `if b.headers == nil` check runs on every `Header` call. Sub-nanosecond, but real.
3. If callers expect "the builder has a fresh empty map I can pre-populate by accessing", that's gone.

**When NOT to do this.** If `Build()` ships the builder's maps/slices to code that *writes* to them post-construction, and that code doesn't nil-check, you'll get panics. Audit the consumer first.

**pprof:**

```bash
go test -bench=BenchmarkMinimalBuild -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list NewBuilder
```

The defensive version shows `make(map[string]string, 16)` and the two `make([]..., 0, 8)` calls as allocation sources. After lazy-init, those vanish from the profile when the methods aren't called.

</details>

---

## 6. Exercise 4: Deep-clone allocating maps caller never mutates

### Scenario

Following the "Build copies in" rule from junior.md §10.2, the builder deep-copies its maps into the resulting `Server`. The Server never mutates them. The defensive copy is pure waste.

### Before

```go
package server

type Server struct {
    headers map[string]string
}

type Builder struct {
    headers map[string]string
}

func NewBuilder() *Builder {
    return &Builder{headers: make(map[string]string, 16)}
}

func (b *Builder) Header(k, v string) *Builder {
    b.headers[k] = v
    return b
}

func (b *Builder) Build() *Server {
    // Defensive deep copy — costs O(n)
    h := make(map[string]string, len(b.headers))
    for k, v := range b.headers {
        h[k] = v
    }
    return &Server{headers: h}
}

func (s *Server) Header(k string) string { return s.headers[k] }  // read-only
```

### Benchmark

```go
func BenchmarkBuildWithDeepCopy(b *testing.B) {
    b.ReportAllocs()
    var bld *Builder
    for i := 0; i < b.N; i++ {
        bld = NewBuilder()
        for j := 0; j < 20; j++ {
            bld.Header(fmt.Sprintf("X-%d", j), "v")
        }
        _ = bld.Build()
    }
}
```

```
BenchmarkBuildWithDeepCopy-8    200_000   6_840 ns/op   4_480 B/op   24 allocs/op
```

The Build's deep copy is `2_500` ns of the total — about a third.

<details><summary>After</summary>

Copy-on-write: hand the map to the Server *by reference*, and only clone it if the builder is reused or the Server attempts a write. Since the Server is read-only in this scenario, the clone never happens.

```go
type Server struct {
    headers map[string]string
}

type Builder struct {
    headers   map[string]string
    builtOnce bool   // marks the builder as consumed
}

func NewBuilder() *Builder {
    return &Builder{headers: make(map[string]string, 16)}
}

func (b *Builder) Header(k, v string) *Builder {
    if b.builtOnce {
        // Builder was already consumed; the map is owned by a Server.
        // Clone now to avoid corrupting that Server.
        m := make(map[string]string, len(b.headers)+1)
        for k, v := range b.headers { m[k] = v }
        b.headers = m
        b.builtOnce = false
    }
    b.headers[k] = v
    return b
}

func (b *Builder) Build() *Server {
    // Hand ownership of the map to the Server. No copy.
    b.builtOnce = true
    return &Server{headers: b.headers}
}

func (s *Server) Header(k string) string { return s.headers[k] }
```

```
BenchmarkBuildCOW-8    400_000   3_640 ns/op   2_240 B/op   13 allocs/op
```

1.9× faster, half the allocations. The 24 → 13 allocation count drops because the second map and its bucket structures are gone.

**Why it's faster.** The map is allocated once, populated once, handed off once. The copy happens *only if* the builder is mutated after `Build()`. In the common case (build, use, discard), the copy is never paid.

**Trade-off — this is where you have to be careful.**
1. The Server now holds a reference to the builder's map. If the builder is mutated post-Build *without* triggering the COW path, the Server sees the mutation. The `builtOnce` flag guards against that, but a bug in the flag logic leaks the mutation.
2. Concurrent mutation: if the builder and the Server are used in different goroutines after `Build()`, the data race is on the same map. The `builtOnce` flag isn't atomic. You need a memory barrier or document "do not touch builder after Build()".
3. If multiple Servers come from the same builder (`b.Build(); b.Header(...); b.Build()`), the first Server's map is mutated unless COW triggered. Test this path explicitly.

The `builtOnce` flag converts what was an *invariant* in the original (build copies, so builders and servers are independent) into a *contract* (don't touch the builder after Build, or do, but pay the COW). Trading a constant cost for a conditional cost. Worth it only if the conditional is rare.

**When NOT to do this.** If callers reuse builders (functional-style construction), the COW path triggers frequently and the optimization becomes a pessimization. Profile the actual access pattern before committing.

A simpler variant if you control both sides: declare the Server's map field as `readonly` by convention and skip the copy entirely. No flag, no COW:

```go
// Server.headers is read-only after Build. Callers must not mutate.
type Server struct {
    headers map[string]string
}

func (b *Builder) Build() *Server {
    return &Server{headers: b.headers}  // shared, by contract
}
```

This is what `protobuf-go` does for `Descriptor`s. Document it loudly.

**pprof:**

```bash
go test -bench=BenchmarkBuildWithDeepCopy -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) list Build
```

The `make(map[string]string, len(b.headers))` line is where the defensive cost lives.

</details>

---

## 7. Exercise 5: `sync.Mutex` on every step

### Scenario

Someone added a `sync.Mutex` to the builder "to make it safe". The mutex is taken on every step method. No code path actually uses the builder concurrently — the lock is pure overhead.

### Before

```go
package query

import (
    "fmt"
    "strings"
    "sync"
)

type Builder struct {
    mu      sync.Mutex
    table   string
    columns []string
    wheres  []string
    args    []any
    err     error
}

func Select(cols ...string) *Builder {
    return &Builder{columns: cols}
}

func (b *Builder) From(t string) *Builder {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.err != nil { return b }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) Build() (string, []any, error) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    return sb.String(), b.args, nil
}
```

### Benchmark

```go
func BenchmarkLockedBuilder(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _, _ = Select("id").
            From("users").
            Where("a = ?", 1).
            Where("b = ?", 2).
            Where("c = ?", 3).
            Build()
    }
}
```

```
BenchmarkLockedBuilder-8    3_500_000   340 ns/op    240 B/op    7 allocs/op
```

`runtime.mutex_lock` and `runtime.mutex_unlock` dominate the per-call CPU profile — ~25% of total time.

<details><summary>After</summary>

Remove the mutex. Document that the builder is single-threaded (which it always was, by design — middle.md §13.5).

```go
type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    err     error
}

func Select(cols ...string) *Builder {
    return &Builder{columns: cols}
}

func (b *Builder) From(t string) *Builder {
    if b.err != nil { return b }
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) Build() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    return sb.String(), b.args, nil
}
```

```
BenchmarkUnlockedBuilder-8   8_000_000   148 ns/op    240 B/op    7 allocs/op
```

2.3× faster. The allocation count is identical — only CPU savings.

**Why it's faster.** Each `Lock`/`Unlock` pair on an uncontended mutex still costs ~25 ns on amd64 (atomic CAS for the lock, atomic store for the unlock). Five chained calls × 50 ns = 250 ns of pure overhead.

**Trade-off — this is the dangerous one.**
1. If *any* code path actually does pass the builder across goroutines, removing the mutex creates a data race. `go test -race` will catch obvious cases; subtle aliasing (the builder captured in a closure that runs later) may slip through.
2. You're trading a defensive guarantee for performance. The guarantee was probably wrong (a builder shouldn't be shared) but removing it is irreversible from a caller's perspective — if any external caller relies on the thread-safety, you'll break them.

**When to do this.** When `go test -race ./...` is clean on a thorough test suite and the builder isn't part of a public stable API.

**When NOT to do this.** If the builder is a public API with unknown callers (e.g., an open-source library), keep the mutex or change the type and version-bump the package. The 200 ns/call cost is the price of a backwards-compatibility guarantee.

**Variant: zero-cost concurrency check in dev builds.**

```go
//go:build !race

type Builder struct { /* fields */ }

func (b *Builder) Where(...) *Builder { /* no lock */ }
```

```go
//go:build race

type Builder struct {
    fields  /* ... */
    owner   atomic.Int64
}

func (b *Builder) Where(...) *Builder {
    if owner := b.owner.Load(); owner != 0 && owner != int64(getg()) {
        panic("builder used from multiple goroutines")
    }
    b.owner.Store(int64(getg()))
    /* ... */
}
```

The race-build catches the bug; the production build pays nothing. `getg()` requires unsafe; many teams skip this. Acceptable answer is "single-threaded, panic if you abuse".

**pprof:**

```bash
go test -bench=BenchmarkLockedBuilder -cpuprofile=cpu.prof
go tool pprof -list 'Where$' cpu.prof
```

You'll see `runtime.lock2` and `runtime.unlock` lines accounting for ~25% of `Where`'s time. After removal, they vanish.

</details>

---

## 8. Exercise 6: `sync.Pool` for per-request HTTP request builders

### Scenario

An outbound HTTP client builds a request per call with the builder pattern. The builder itself is a single allocation, but at 100k requests/sec that's 100k builder allocations/sec hitting the GC.

### Before

```go
package httpx

import (
    "io"
    "net/http"
    "strings"
)

type RequestBuilder struct {
    method  string
    url     string
    headers http.Header
    body    io.Reader
    err     error
}

func NewRequest(method, url string) *RequestBuilder {
    return &RequestBuilder{
        method:  method,
        url:     url,
        headers: make(http.Header, 8),
    }
}

func (b *RequestBuilder) Header(k, v string) *RequestBuilder {
    if b.err != nil { return b }
    b.headers.Set(k, v)
    return b
}

func (b *RequestBuilder) Body(body io.Reader) *RequestBuilder {
    if b.err != nil { return b }
    b.body = body
    return b
}

func (b *RequestBuilder) Build() (*http.Request, error) {
    if b.err != nil { return nil, b.err }
    req, err := http.NewRequest(b.method, b.url, b.body)
    if err != nil { return nil, err }
    for k, vs := range b.headers {
        for _, v := range vs { req.Header.Add(k, v) }
    }
    return req, nil
}
```

### Benchmark

```go
func BenchmarkPerRequestBuilder(b *testing.B) {
    b.ReportAllocs()
    body := strings.NewReader("payload")
    for i := 0; i < b.N; i++ {
        _, _ = NewRequest("POST", "https://api.example.com/users").
            Header("Content-Type", "application/json").
            Header("X-Trace-ID", "abc123").
            Header("X-Tenant", "t1").
            Body(body).
            Build()
    }
}
```

```
BenchmarkPerRequestBuilder-8    1_500_000    885 ns/op    1_120 B/op   11 allocs/op
```

The builder, headers map, and the http.Request itself dominate.

<details><summary>After</summary>

Pool the builder. Reset it between uses. The http.Request still allocates (you can't pool that without owning the http.Client), but the builder's allocation cost is amortized.

```go
package httpx

import (
    "io"
    "net/http"
    "sync"
)

type RequestBuilder struct {
    method  string
    url     string
    headers http.Header
    body    io.Reader
    err     error
}

func (b *RequestBuilder) reset() {
    b.method = ""
    b.url = ""
    b.body = nil
    b.err = nil
    // Keep headers map; clear contents.
    for k := range b.headers {
        delete(b.headers, k)
    }
}

var requestBuilderPool = sync.Pool{
    New: func() any {
        return &RequestBuilder{headers: make(http.Header, 8)}
    },
}

func AcquireRequest(method, url string) *RequestBuilder {
    b := requestBuilderPool.Get().(*RequestBuilder)
    b.method = method
    b.url = url
    return b
}

func ReleaseRequest(b *RequestBuilder) {
    b.reset()
    requestBuilderPool.Put(b)
}

func (b *RequestBuilder) Header(k, v string) *RequestBuilder {
    if b.err != nil { return b }
    b.headers.Set(k, v)
    return b
}

func (b *RequestBuilder) Body(body io.Reader) *RequestBuilder {
    if b.err != nil { return b }
    b.body = body
    return b
}

func (b *RequestBuilder) Build() (*http.Request, error) {
    if b.err != nil { return nil, b.err }
    req, err := http.NewRequest(b.method, b.url, b.body)
    if err != nil { return nil, err }
    for k, vs := range b.headers {
        for _, v := range vs { req.Header.Add(k, v) }
    }
    return req, nil
}

// Usage
func makeRequest() (*http.Request, error) {
    b := AcquireRequest("POST", "https://api.example.com/users")
    defer ReleaseRequest(b)
    return b.
        Header("Content-Type", "application/json").
        Header("X-Trace-ID", "abc123").
        Header("X-Tenant", "t1").
        Build()
}
```

```
BenchmarkPooledBuilder-8    2_800_000    480 ns/op    640 B/op    6 allocs/op
```

1.8× faster, 5 fewer allocations. The savings come from the recycled builder, headers map, and skip of the initial `make`.

**Why it's faster.** `sync.Pool` keeps a per-P cache; `Get` is a single atomic load in the hot case. The builder lives across calls; the `reset()` only clears state, never frees the backing array of the headers map. The map's bucket structure persists, so subsequent `Set` calls reuse it.

**Trade-off — `sync.Pool` always has these.**
1. **Ownership becomes manual.** You must call `Release` (or use `defer`). Forgetting it doesn't leak — GC reclaims — but defeats the pool. Linters can catch some cases.
2. **The pool's contents disappear during GC.** `sync.Pool.Get` may return a freshly-allocated object even after thousands of `Put` calls. This is by design — the pool is best-effort.
3. **Reset bugs are sticky.** If `reset()` forgets a field, the next consumer sees stale data. The fix is unit tests that explicitly check state after `Acquire`.
4. **The pooled builder must not escape.** If a goroutine takes `b` and stashes it somewhere persistent, `Release` corrupts that reference. Document "do not retain after Release".
5. **The `*http.Request` returned from `Build()` is not pooled.** The biggest allocation in the original was the request itself, not the builder. The win is real but smaller than the headline number suggests.

**When NOT to do this.** Below 10k builds/sec, the pool overhead matches or exceeds the savings. The headers-map reset costs ~30 ns; for low frequency, the original `make` was actually cheaper.

**Variant: pool only the headers map.**

```go
var headersPool = sync.Pool{
    New: func() any { h := make(http.Header, 8); return &h },
}

func NewRequest(method, url string) *RequestBuilder {
    h := headersPool.Get().(*http.Header)
    return &RequestBuilder{method: method, url: url, headers: *h}
}

// Caller calls Release after Build() returns:
func (b *RequestBuilder) Release() {
    for k := range b.headers { delete(b.headers, k) }
    h := b.headers
    headersPool.Put(&h)
}
```

You still allocate one builder per call but save the headers map. Sometimes simpler than pooling the whole builder.

**pprof:**

```bash
go test -bench=BenchmarkPerRequestBuilder -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) top
```

In the pre-pool profile, `httpx.NewRequest` and `make(http.Header)` are top contributors. After pooling, both drop to near-zero (only the very first call allocates).

</details>

---

## 9. Exercise 7: SQL builder regenerating identical prefix bytes

### Scenario

A service runs the same `SELECT id, name, email FROM users WHERE` prefix for thousands of queries per second, with different `WHERE` clauses. The builder rebuilds the entire prefix string every time.

### Before

```go
package userq

import (
    "fmt"
    "strings"
)

type Builder struct {
    wheres []string
    args   []any
}

func NewUserQuery() *Builder { return &Builder{} }

func (b *Builder) Where(cond string, args ...any) *Builder {
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) Build() (string, []any) {
    var sb strings.Builder
    sb.WriteString("SELECT id, name, email FROM users")
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        for i, w := range b.wheres {
            if i > 0 { sb.WriteString(" AND ") }
            sb.WriteString(w)
        }
    }
    return sb.String(), b.args
}
```

### Benchmark

```go
func BenchmarkUserQuery(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = NewUserQuery().
            Where("active = ?", true).
            Where("created_at > ?", "2024-01-01").
            Build()
    }
}
```

```
BenchmarkUserQuery-8    7_000_000    175 ns/op    160 B/op    4 allocs/op
```

Most of the 160 bytes is the prefix `"SELECT id, name, email FROM users WHERE "` being formed anew each call.

<details><summary>After</summary>

Cache the prefix bytes. The builder writes them into the output buffer with a single `Write([]byte)` call.

```go
var userQueryPrefix = []byte("SELECT id, name, email FROM users")
var whereSep = []byte(" WHERE ")
var andSep = []byte(" AND ")

func (b *Builder) Build() (string, []any) {
    // Estimate output size to avoid Grow's geometric resizing.
    size := len(userQueryPrefix)
    if len(b.wheres) > 0 {
        size += len(whereSep)
        for i, w := range b.wheres {
            if i > 0 { size += len(andSep) }
            size += len(w)
        }
    }
    var sb strings.Builder
    sb.Grow(size)
    sb.Write(userQueryPrefix)
    if len(b.wheres) > 0 {
        sb.Write(whereSep)
        for i, w := range b.wheres {
            if i > 0 { sb.Write(andSep) }
            sb.WriteString(w)
        }
    }
    return sb.String(), b.args
}
```

```
BenchmarkUserQueryCached-8    11_000_000    105 ns/op    96 B/op    2 allocs/op
```

1.7× faster, 2 fewer allocations.

**Why it's faster.** Two wins. First, `Write([]byte)` doesn't need to do a string-to-bytes conversion — it copies bytes directly. `WriteString` is similar in modern Go, so this part is small. Second and bigger: the pre-sized `Grow(size)` allocates the buffer exactly once. Without the size estimate, `strings.Builder` doubles the buffer as needed, leading to 2–3 reallocations and copies for a typical query.

**Trade-off.**
1. The `Grow(size)` calculation is a separate pass over `wheres`. For very short queries this overhead can match the savings; benchmark.
2. The prefix bytes are now a global. If you have many "kinds" of queries (orders, products, etc.) each needs its own prefix slice — easy to forget one and slip back to a string literal.
3. The `[]byte` aliases the string data internally; modifying them at runtime corrupts every future call. Mark them as constants in spirit: don't mutate.

**When NOT to do this.** If the prefix is short (< 16 bytes) the savings are within the noise. If the prefix varies per call (truly dynamic SQL), there's nothing to cache.

**Variant: full template caching for query "shapes".**

If you have a fixed set of N query shapes, cache the entire query template and substitute parameters:

```go
var listActiveUsersTemplate = []byte("SELECT id, name, email FROM users WHERE active = ? AND created_at > ?")

func ListActiveUsers(since string) (string, []any) {
    return string(listActiveUsersTemplate), []any{true, since}
}
```

No builder. No assembly. Just a parameter list. This is what `sqlc` generates. The builder is overkill for queries with a fixed shape.

**pprof:**

```bash
go test -bench=BenchmarkUserQuery -memprofile=mem.prof
go tool pprof -alloc_space mem.prof
(pprof) list Build
```

The before profile shows `strings.(*Builder).grow` consuming allocations. After the `Grow(size)` hint, that line shows near-zero bytes.

</details>

---

## 10. Exercise 8: Generic `Builder[T]` with closure-list — replace with direct field set

### Scenario

Middle.md §5.1 showed a generic `Builder[T]` that accumulates `func(*T)` closures. Each `With(func)` allocates one closure. For T-types where you control the package, you can replace the closure list with direct field sets — keeping the API ergonomic but eliminating the per-call closure allocations.

### Before

```go
package builderx

type Builder[T any] struct {
    apply []func(*T)
    err   error
}

func New[T any]() *Builder[T] { return &Builder[T]{} }

func (b *Builder[T]) With(f func(*T)) *Builder[T] {
    if b.err != nil { return b }
    b.apply = append(b.apply, f)
    return b
}

func (b *Builder[T]) Build() (*T, error) {
    if b.err != nil { return nil, b.err }
    var t T
    for _, f := range b.apply {
        f(&t)
    }
    return &t, nil
}

// Caller
type Server struct {
    addr    string
    timeout time.Duration
    logger  *log.Logger
}

func makeServer() *Server {
    s, _ := builderx.New[Server]().
        With(func(s *Server) { s.addr = ":8080" }).
        With(func(s *Server) { s.timeout = 30 * time.Second }).
        With(func(s *Server) { s.logger = log.Default() }).
        Build()
    return s
}
```

### Benchmark

```go
func BenchmarkGenericBuilder(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = makeServer()
    }
}
```

```
BenchmarkGenericBuilder-8    3_000_000    410 ns/op    432 B/op    8 allocs/op
```

Three closures + the slice growth + the builder + the server = 8 allocations.

<details><summary>After</summary>

Drop the generic. Write a hand-rolled builder for `Server` with direct field setters.

```go
package server

import (
    "log"
    "time"
)

type Server struct {
    addr    string
    timeout time.Duration
    logger  *log.Logger
}

type Builder struct {
    s   Server
    err error
}

func New() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) *Builder       { b.s.addr = a; return b }
func (b *Builder) Timeout(d time.Duration) *Builder { b.s.timeout = d; return b }
func (b *Builder) Logger(l *log.Logger) *Builder    { b.s.logger = l; return b }

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    out := b.s
    return &out, nil
}

func makeServer() *Server {
    s, _ := New().
        Addr(":8080").
        Timeout(30 * time.Second).
        Logger(log.Default()).
        Build()
    return s
}
```

```
BenchmarkDirectBuilder-8    25_000_000    52 ns/op    96 B/op    2 allocs/op
```

7.9× faster, 6 fewer allocations.

**Why it's faster.** No closures means no closure allocations. No `apply` slice means no slice growth. Just field writes. The builder type itself is the only thing that needs to escape to the heap.

**Trade-off.**
1. **You lose genericity.** The generic builder worked for any `T`; the direct version is `Server`-specific. If you have 50 target types, you write 50 builders.
2. **Code generation can bridge this.** If you really need many target types, generate the direct builder for each. See Exercise 12 (and §13 of the functional-options optimize file).
3. **API is more verbose at the *library* level** (one method per field). Trivial at the caller side (same chain shape).

**When to keep the generic.** Library authors who can't know the target types — e.g., a "config DSL" framework — must use the closure-list approach. For application code with a finite number of build targets, write direct builders.

**A middle-ground variant: generic with constraint.**

```go
type Buildable[T any] interface {
    *T
    Defaults()  // method on the pointer type
}

func New[T any, PT Buildable[T]]() PT {
    var t T
    pt := PT(&t)
    pt.Defaults()
    return pt
}
```

Type-parameter constrained to types with a `Defaults()` method. Each `T` gets its own direct builder, but the entry point is generic. Looks cute, rarely worth the type machinery.

**pprof:**

```bash
go test -bench=BenchmarkGenericBuilder -memprofile=mem.prof
go tool pprof -alloc_objects mem.prof
(pprof) list 'With$'
```

You'll see anonymous `func1`, `func2`, `func3` entries — those are the closures. After the rewrite, only the builder and final server allocations remain.

</details>

---

## 11. Exercise 9: Multi-terminal builder recomputing the same SQL twice

### Scenario

The builder has multiple terminals (middle.md §7): `.SQL()` returns the query string for logging, `.Run(ctx, db)` executes it. A common pattern is:

```go
b := query.Select(...).From(...).Where(...)
log.Println("executing:", b.SQL())   // call 1: builds SQL
rows, _ := b.Run(ctx, db)             // call 2: builds SQL again
```

Each terminal calls the same internal `assemble()`. The second call redoes the work.

### Before

```go
package query

import (
    "context"
    "database/sql"
    "strings"
)

type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    err     error
}

func (b *Builder) assemble() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    return sb.String(), b.args, nil
}

func (b *Builder) SQL() string {
    s, _, _ := b.assemble()
    return s
}

func (b *Builder) Run(ctx context.Context, db *sql.DB) (*sql.Rows, error) {
    s, args, err := b.assemble()
    if err != nil { return nil, err }
    return db.QueryContext(ctx, s, args...)
}
```

### Benchmark

```go
func BenchmarkLogAndRun(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        q := Select("id", "name").From("users").Where("active = ?", true)
        _ = q.SQL()
        _ = q.SQL()    // simulate logging + running
    }
}
```

```
BenchmarkLogAndRun-8    4_000_000    310 ns/op    256 B/op    8 allocs/op
```

Two assembles, each doing a `strings.Builder` allocation and a `strings.Join`.

<details><summary>After</summary>

Memoize the result in the builder. The first `assemble()` computes; subsequent calls return the cached string.

```go
type Builder struct {
    table   string
    columns []string
    wheres  []string
    args    []any
    err     error

    // memoized result
    cachedSQL  string
    cachedArgs []any
    cached     bool
}

// Any mutation invalidates the cache.
func (b *Builder) From(t string) *Builder {
    b.cached = false
    b.table = t
    return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
    b.cached = false
    b.wheres = append(b.wheres, cond)
    b.args = append(b.args, args...)
    return b
}

func (b *Builder) assemble() (string, []any, error) {
    if b.err != nil { return "", nil, b.err }
    if b.cached {
        return b.cachedSQL, b.cachedArgs, nil
    }
    var sb strings.Builder
    sb.WriteString("SELECT ")
    sb.WriteString(strings.Join(b.columns, ", "))
    sb.WriteString(" FROM ")
    sb.WriteString(b.table)
    if len(b.wheres) > 0 {
        sb.WriteString(" WHERE ")
        sb.WriteString(strings.Join(b.wheres, " AND "))
    }
    b.cachedSQL = sb.String()
    b.cachedArgs = b.args
    b.cached = true
    return b.cachedSQL, b.cachedArgs, nil
}
```

```
BenchmarkLogAndRunMemoized-8    7_000_000    175 ns/op    128 B/op    4 allocs/op
```

1.8× faster, half the allocations.

**Why it's faster.** The second `assemble()` call is now a struct-field read instead of a `strings.Builder` traversal. The two-allocations-per-build cost becomes one-allocation-total.

**Trade-off.**
1. **Every mutation must invalidate the cache.** Forget one (a new `OrderBy()` method that doesn't set `cached = false`) and you get stale SQL. Subtle. Add a test that mutates then re-reads each terminal.
2. **The cache is per-builder.** It doesn't help if you build a fresh builder for each query (the common case). It only helps when the builder is consulted multiple times.
3. **The builder is now stateful in a new way.** Goroutine safety becomes "even reads need synchronization if there's any chance of mutation" — though §7 already established that builders are single-threaded.

**When NOT to do this.** If `SQL()` is called once per builder (the typical case), the memoization is wasted memory (the cache fields cost ~32 bytes regardless of whether they're used). The optimization only pays off when terminals are called repeatedly on the same builder.

**Variant: lazy validation cache.**

Same pattern for validation: if `Validate()` and `Build()` both check the same invariants, cache the result.

```go
func (b *Builder) Validate() error {
    if b.validated { return b.validateErr }
    b.validateErr = b.runValidation()
    b.validated = true
    return b.validateErr
}
```

Each mutation sets `b.validated = false`.

**pprof:**

```bash
go test -bench=BenchmarkLogAndRun -cpuprofile=cpu.prof
go tool pprof -list 'assemble$' cpu.prof
```

Before: `assemble` shows as 50% of CPU. After: it shows as 25% (one of the two calls is now the cache hit).

</details>

---

## 12. Exercise 10: Validation in `Build()` repeated per call

### Scenario

`Build()` runs O(n) validation across all fields. When the builder is constructed fresh from the same options every time, the validation is doing the same checks repeatedly. The first build proves the configuration is valid; subsequent rebuilds with the same options re-prove it.

### Before

```go
package server

import (
    "errors"
    "fmt"
    "net"
    "time"
)

type Server struct {
    addr    string
    timeout time.Duration
    maxConn int
    tlsCert string
    tlsKey  string
}

type Builder struct {
    addr    string
    timeout time.Duration
    maxConn int
    tlsCert string
    tlsKey  string
}

func NewBuilder() *Builder {
    return &Builder{timeout: 30 * time.Second, maxConn: 100}
}

func (b *Builder) Addr(a string) *Builder    { b.addr = a; return b }
func (b *Builder) Timeout(d time.Duration) *Builder { b.timeout = d; return b }
func (b *Builder) MaxConn(n int) *Builder    { b.maxConn = n; return b }
func (b *Builder) TLS(cert, key string) *Builder {
    b.tlsCert = cert
    b.tlsKey = key
    return b
}

func (b *Builder) Build() (*Server, error) {
    // Validation runs every time
    if b.addr == "" { return nil, errors.New("addr required") }
    if _, _, err := net.SplitHostPort(b.addr); err != nil {
        return nil, fmt.Errorf("addr: %w", err)
    }
    if b.timeout <= 0 { return nil, errors.New("timeout must be positive") }
    if b.timeout > time.Hour { return nil, errors.New("timeout too large") }
    if b.maxConn <= 0 { return nil, errors.New("maxConn must be positive") }
    if b.maxConn > 100000 { return nil, errors.New("maxConn too large") }
    if (b.tlsCert == "") != (b.tlsKey == "") {
        return nil, errors.New("tlsCert and tlsKey must both be set or both empty")
    }
    if b.tlsCert != "" {
        // imagine we also check files exist
        if !fileExists(b.tlsCert) { return nil, errors.New("tlsCert file not found") }
        if !fileExists(b.tlsKey)  { return nil, errors.New("tlsKey file not found") }
    }
    return &Server{
        addr: b.addr, timeout: b.timeout, maxConn: b.maxConn,
        tlsCert: b.tlsCert, tlsKey: b.tlsKey,
    }, nil
}

func fileExists(p string) bool { /* stat */ return true }
```

### Benchmark

```go
func BenchmarkRepeatedBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = NewBuilder().
            Addr(":8080").
            Timeout(30 * time.Second).
            MaxConn(1000).
            TLS("cert.pem", "key.pem").
            Build()
    }
}
```

```
BenchmarkRepeatedBuild-8    2_000_000   720 ns/op    256 B/op    5 allocs/op
```

`net.SplitHostPort` is ~200 ns; the `fileExists` calls are ~200 ns each. That's ~600 ns of validation per build.

<details><summary>After</summary>

Split validation into "one-time" and "per-build". Validate once at startup; produce a `ValidatedConfig` that the per-call constructor trusts.

```go
type ValidatedConfig struct {
    addr    string
    timeout time.Duration
    maxConn int
    tlsCert string
    tlsKey  string
}

// Heavy validation, called once at startup.
func (b *Builder) Validate() (*ValidatedConfig, error) {
    if b.addr == "" { return nil, errors.New("addr required") }
    if _, _, err := net.SplitHostPort(b.addr); err != nil {
        return nil, fmt.Errorf("addr: %w", err)
    }
    if b.timeout <= 0 { return nil, errors.New("timeout must be positive") }
    if b.timeout > time.Hour { return nil, errors.New("timeout too large") }
    if b.maxConn <= 0 { return nil, errors.New("maxConn must be positive") }
    if b.maxConn > 100000 { return nil, errors.New("maxConn too large") }
    if (b.tlsCert == "") != (b.tlsKey == "") {
        return nil, errors.New("tlsCert and tlsKey must both be set or both empty")
    }
    if b.tlsCert != "" {
        if !fileExists(b.tlsCert) { return nil, errors.New("tlsCert file not found") }
        if !fileExists(b.tlsKey)  { return nil, errors.New("tlsKey file not found") }
    }
    return &ValidatedConfig{
        addr: b.addr, timeout: b.timeout, maxConn: b.maxConn,
        tlsCert: b.tlsCert, tlsKey: b.tlsKey,
    }, nil
}

// Cheap, called per request — no validation.
func (c *ValidatedConfig) NewServer() *Server {
    return &Server{
        addr: c.addr, timeout: c.timeout, maxConn: c.maxConn,
        tlsCert: c.tlsCert, tlsKey: c.tlsKey,
    }
}
```

Usage:

```go
// Once at startup
cfg, err := NewBuilder().Addr(":8080").Timeout(30*time.Second).MaxConn(1000).
    TLS("cert.pem", "key.pem").Validate()
if err != nil { log.Fatal(err) }

// Per request
func handler() *Server { return cfg.NewServer() }
```

```
BenchmarkValidatedNewServer-8    50_000_000   28 ns/op    96 B/op    1 allocs/op
```

26× faster than the original. The validation cost is paid once.

**Why it's faster.** The per-call path is now a single struct allocation and a copy. All the file existence checks, address parsing, and conditional logic happen exactly once at startup.

**Trade-off.**
1. **Two-step API.** Callers must call `Validate()` first, then `NewServer()`. Worse ergonomics for one-off uses.
2. **`ValidatedConfig` is a new type to maintain.** Adding a field to `Server` means adding it to `ValidatedConfig`, the validation code, and the `NewServer()` method. Three places instead of one.
3. **The pattern assumes the config is stable.** If the config changes per-request (different addr per call), the optimization doesn't apply — you're back to per-call validation.

**When NOT to do this.** If `Build()` is called rarely (e.g., once per server start) the optimization is wasted complexity. For per-request builders with a stable config, it's a clear win.

**Variant: validate-on-write.**

Each step validates its own input but skips cross-field checks. Cross-field checks happen lazily on first `Build()`, cached, then skipped.

```go
func (b *Builder) Addr(a string) *Builder {
    if a == "" { b.err = errors.New("Addr: empty"); return b }
    if _, _, err := net.SplitHostPort(a); err != nil {
        b.err = fmt.Errorf("Addr: %w", err); return b
    }
    b.addr = a
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    if !b.crossValidated {
        // Run cross-field checks once
        if (b.tlsCert == "") != (b.tlsKey == "") {
            return nil, errors.New("TLS cert/key mismatch")
        }
        b.crossValidated = true
    }
    return &Server{ /* ... */ }, nil
}
```

Each builder's first `Build()` is slow; subsequent rebuilds are fast. Useful for the "config that's modified slightly per call" pattern.

**pprof:**

```bash
go test -bench=BenchmarkRepeatedBuild -cpuprofile=cpu.prof
go tool pprof -list 'Build$' cpu.prof
```

`net.SplitHostPort` and `fileExists` dominate the before profile. Both vanish from the per-call profile in the after version.

</details>

---

## 13. Exercise 11: Config file re-parsed on every `Build()`

### Scenario

The builder is fed by a config file. The naïve implementation re-reads and re-parses the file on every `Build()`. For a service that rebuilds objects per request from the same config file, that's a file-system syscall and JSON parse per call.

### Before

```go
package server

import (
    "encoding/json"
    "fmt"
    "os"
    "time"
)

type fileConfig struct {
    Addr    string        `json:"addr"`
    Timeout time.Duration `json:"timeout"`
    Logger  string        `json:"logger"`
}

type Builder struct {
    configPath string
    overrides  map[string]any
    err        error
}

func FromFile(path string) *Builder {
    return &Builder{configPath: path}
}

func (b *Builder) Override(k string, v any) *Builder {
    if b.overrides == nil { b.overrides = make(map[string]any) }
    b.overrides[k] = v
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    // Re-read on every build
    data, err := os.ReadFile(b.configPath)
    if err != nil { return nil, fmt.Errorf("read config: %w", err) }
    var fc fileConfig
    if err := json.Unmarshal(data, &fc); err != nil {
        return nil, fmt.Errorf("parse config: %w", err)
    }
    s := &Server{
        addr:    fc.Addr,
        timeout: fc.Timeout,
    }
    if v, ok := b.overrides["addr"]; ok       { s.addr = v.(string) }
    if v, ok := b.overrides["timeout"]; ok    { s.timeout = v.(time.Duration) }
    return s, nil
}
```

### Benchmark

```go
func BenchmarkFromFile(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = FromFile("/tmp/server.json").Build()
    }
}
```

```
BenchmarkFromFile-8    30_000   41_500 ns/op   2_640 B/op   12 allocs/op
```

41 microseconds. Dominated by `os.ReadFile` (a syscall + buffer allocation) and `json.Unmarshal`.

<details><summary>After</summary>

Cache the parsed config. Re-parse only if the file's modtime changed (cheap stat call).

```go
package server

import (
    "encoding/json"
    "fmt"
    "os"
    "sync"
    "time"
)

type cachedConfig struct {
    mtime time.Time
    cfg   fileConfig
}

var (
    configCache   = map[string]cachedConfig{}
    configCacheMu sync.RWMutex
)

func loadConfig(path string) (fileConfig, error) {
    // Stat first to check freshness
    info, err := os.Stat(path)
    if err != nil { return fileConfig{}, fmt.Errorf("stat: %w", err) }

    configCacheMu.RLock()
    c, ok := configCache[path]
    configCacheMu.RUnlock()
    if ok && c.mtime.Equal(info.ModTime()) {
        return c.cfg, nil
    }

    // Cache miss or stale: re-read
    data, err := os.ReadFile(path)
    if err != nil { return fileConfig{}, fmt.Errorf("read: %w", err) }
    var fc fileConfig
    if err := json.Unmarshal(data, &fc); err != nil {
        return fileConfig{}, fmt.Errorf("parse: %w", err)
    }

    configCacheMu.Lock()
    configCache[path] = cachedConfig{mtime: info.ModTime(), cfg: fc}
    configCacheMu.Unlock()
    return fc, nil
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    fc, err := loadConfig(b.configPath)
    if err != nil { return nil, err }
    s := &Server{addr: fc.Addr, timeout: fc.Timeout}
    if v, ok := b.overrides["addr"]; ok    { s.addr = v.(string) }
    if v, ok := b.overrides["timeout"]; ok { s.timeout = v.(time.Duration) }
    return s, nil
}
```

```
BenchmarkFromFileCached-8    3_500_000   330 ns/op    96 B/op    2 allocs/op
```

125× faster. The first call still pays the full read; subsequent calls pay only a `stat` syscall and a map lookup.

**Why it's faster.** `os.Stat` is ~1 microsecond (well, kernel-dependent but always much faster than ReadFile + JSON parsing). The cache hit returns the previously-parsed struct.

**Trade-off.**
1. **Global cache** — the `configCache` map is a package-level singleton. Tests must clear it between cases. Adding a test helper `ResetConfigCache()` is non-negotiable.
2. **`os.Stat` is still a syscall.** Not free. On a busy NFS mount it can be the bottleneck. For services where the config never changes after startup, even `Stat` is unnecessary — just cache forever.
3. **Modtime is not foolproof.** Tools that rewrite files with identical content might keep the modtime; tools that touch with a different content might not. For absolute safety, hash the contents — but that's another read + hash, defeating the cache.

**When NOT to do this.** If the config file changes frequently (live reload, k8s configmap rotated every minute) the modtime check is correct but adds complexity. If the config never changes after startup, skip the cache and read once at init:

```go
var serverConfig = mustLoadConfig("/etc/server.json")

func init() { /* load once */ }
```

This is the right answer for 90% of services.

**Variant: explicit reload signal.**

```go
type ConfigLoader struct {
    path string
    cfg  atomic.Pointer[fileConfig]
}

func NewConfigLoader(path string) *ConfigLoader { /* loads and stores */ }
func (l *ConfigLoader) Reload() error { /* re-reads and atomically stores */ }
func (l *ConfigLoader) Get() *fileConfig { return l.cfg.Load() }
```

Callers reload on SIGHUP or via an admin endpoint. Per-build cost is one atomic load — sub-nanosecond.

**pprof:**

```bash
go test -bench=BenchmarkFromFile -cpuprofile=cpu.prof
go tool pprof -list 'Build$' cpu.prof
```

`os.ReadFile`, `json.Unmarshal`, and `runtime.makeslice` dominate the before profile. After caching, only `loadConfig`'s stat call shows up.

</details>

---

## 14. Exercise 12: Reflection in `Build()` — replace with code generation

### Scenario

A "framework-style" builder uses reflection in `Build()` to populate fields by tag. It works for any target type but pays a reflection cost on every call.

### Before

```go
package builderx

import (
    "fmt"
    "reflect"
)

type Builder struct {
    values map[string]any
    err    error
}

func New() *Builder { return &Builder{values: map[string]any{}} }

func (b *Builder) Set(field string, value any) *Builder {
    b.values[field] = value
    return b
}

func (b *Builder) Build(target any) error {
    v := reflect.ValueOf(target)
    if v.Kind() != reflect.Ptr || v.Elem().Kind() != reflect.Struct {
        return fmt.Errorf("Build: target must be *struct")
    }
    elem := v.Elem()
    t := elem.Type()
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        tag := f.Tag.Get("builder")
        if tag == "" { continue }
        val, ok := b.values[tag]
        if !ok { continue }
        fv := elem.Field(i)
        if !fv.CanSet() { continue }
        rv := reflect.ValueOf(val)
        if !rv.Type().AssignableTo(fv.Type()) {
            return fmt.Errorf("Build: %s: type mismatch", tag)
        }
        fv.Set(rv)
    }
    return nil
}

// Caller
type Server struct {
    Addr    string        `builder:"addr"`
    Timeout time.Duration `builder:"timeout"`
}
```

### Benchmark

```go
func BenchmarkReflectionBuild(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var s Server
        _ = New().
            Set("addr", ":8080").
            Set("timeout", 30*time.Second).
            Build(&s)
    }
}
```

```
BenchmarkReflectionBuild-8    400_000   3_120 ns/op    560 B/op   18 allocs/op
```

The reflection is the entire cost: `reflect.ValueOf`, `Tag.Get`, `Field`, `Set` — every call.

<details><summary>After</summary>

`go generate` produces a typed builder for each target type. The framework-level reflection vanishes; the generated code is direct field assignment.

```go
//go:generate go run gen.go -type=Server

// generated_server_builder.go (DO NOT EDIT)
package server

import "time"

type ServerBuilder struct {
    addr    string
    timeout time.Duration
    addrSet, timeoutSet bool
    err     error
}

func NewServerBuilder() *ServerBuilder { return &ServerBuilder{} }

func (b *ServerBuilder) Addr(v string) *ServerBuilder {
    b.addr = v; b.addrSet = true; return b
}

func (b *ServerBuilder) Timeout(v time.Duration) *ServerBuilder {
    b.timeout = v; b.timeoutSet = true; return b
}

func (b *ServerBuilder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    s := &Server{}
    if b.addrSet    { s.Addr = b.addr }
    if b.timeoutSet { s.Timeout = b.timeout }
    return s, nil
}
```

The generator:

```go
// gen.go
package main

import (
    "go/ast"
    "go/parser"
    "go/token"
    "os"
    "text/template"
)

const tmpl = `// Code generated. DO NOT EDIT.
package {{.Pkg}}

type {{.Name}}Builder struct {
{{- range .Fields }}
    {{.LowerName}} {{.Type}}
    {{.LowerName}}Set bool
{{- end }}
    err error
}

func New{{.Name}}Builder() *{{.Name}}Builder { return &{{.Name}}Builder{} }
{{ range .Fields }}
func (b *{{$.Name}}Builder) {{.Name}}(v {{.Type}}) *{{$.Name}}Builder {
    b.{{.LowerName}} = v
    b.{{.LowerName}}Set = true
    return b
}
{{ end }}
func (b *{{.Name}}Builder) Build() (*{{.Name}}, error) {
    if b.err != nil { return nil, b.err }
    s := &{{.Name}}{}
{{- range .Fields }}
    if b.{{.LowerName}}Set { s.{{.Name}} = b.{{.LowerName}} }
{{- end }}
    return s, nil
}
`

func main() {
    // Parse the source, find the target type, extract fields, run template.
    // (Implementation omitted for brevity; ~80 lines of go/ast.)
}
```

```go
func BenchmarkGeneratedBuilder(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = NewServerBuilder().
            Addr(":8080").
            Timeout(30*time.Second).
            Build()
    }
}
```

```
BenchmarkGeneratedBuilder-8    40_000_000    38 ns/op    96 B/op    2 allocs/op
```

82× faster, 16 fewer allocations.

**Why it's faster.** No reflection. No tag parsing. No type checks at runtime. The generated code is exactly what you'd write by hand — direct field writes — but the *generator* handled the boilerplate.

**Trade-off.**
1. **Build complexity.** `go generate` must run before `go build`. CI must enforce this; otherwise the generated file drifts.
2. **The generated file goes in version control** (Go convention) but is "untouchable" — manual edits are lost on regeneration. Reviewers must learn to skim it.
3. **N+1 files to maintain.** N for the generated builders, 1 for the generator + its template. When the generator changes, all generated files need regeneration. Easier with `go generate ./...` but easy to forget.
4. **The reflection version worked for *any* type.** The generated version only works for types you've explicitly listed in `gen.go`. Adding a new buildable type is a code change, not a config change.
5. **Debugging the generator is annoying.** When the output is wrong, you debug a template (which has worse tooling than Go itself).

**When to do this.** When you have:
- 5+ target types that all need similar builders, *and*
- A performance profile that flags the reflection-based builder as a hot spot, *and*
- A team that can absorb the build-system complexity.

If any of those is false, hand-write the builders instead. Reflection is acceptable for a handful of types built rarely. Code generation is only worth it at scale.

**When NOT to do this.** If you have one or two builders, hand-write them. If reflection isn't in your profile, skip the generator. Tools like `sqlc` and `ent` exist precisely because hand-rolling N builders is tedious — but they're framework decisions, not micro-optimizations.

**A middle ground: `reflect.Type` cache.**

Reflection in `Build()` is slow mostly because `reflect.TypeOf(target)` resolves the type every call. Cache the resolved metadata:

```go
type typeInfo struct {
    fieldsByTag map[string]int   // tag -> field index
    types       []reflect.Type
}

var typeCache sync.Map // reflect.Type -> *typeInfo

func resolveType(t reflect.Type) *typeInfo {
    if v, ok := typeCache.Load(t); ok { return v.(*typeInfo) }
    ti := &typeInfo{fieldsByTag: map[string]int{}}
    for i := 0; i < t.NumField(); i++ {
        if tag := t.Field(i).Tag.Get("builder"); tag != "" {
            ti.fieldsByTag[tag] = i
            ti.types = append(ti.types, t.Field(i).Type)
        }
    }
    typeCache.Store(t, ti)
    return ti
}

func (b *Builder) Build(target any) error {
    v := reflect.ValueOf(target).Elem()
    ti := resolveType(v.Type())
    for tag, idx := range ti.fieldsByTag {
        val, ok := b.values[tag]
        if !ok { continue }
        v.Field(idx).Set(reflect.ValueOf(val))
    }
    return nil
}
```

```
BenchmarkReflectionCached-8    2_500_000    480 ns/op    96 B/op    2 allocs/op
```

6.5× faster than the original, 13× slower than codegen. A defensible middle ground when you can't afford the generator's complexity but want most of the speedup.

**pprof:**

```bash
go test -bench=BenchmarkReflectionBuild -cpuprofile=cpu.prof
go tool pprof -list 'Build$' cpu.prof
```

`reflect.Value.Set`, `reflect.StructField.Tag`, `reflect.flag.mustBe` — all the reflect-package frames — dominate. In the generated version, they're entirely absent.

</details>

---

## 15. When NOT to optimize

The honest framing: **most builders should not be optimized**. The pattern is cheap. The wins exist only when:

| Condition | Threshold to bother |
|-----------|---------------------|
| Builder frequency | > 10k calls/sec sustained |
| Profile shows builder methods in top 5 % CPU | Yes |
| Allocation profile shows builder closures/copies in top 10 | Yes |
| The "fix" doesn't break correctness (single-thread assumption, shared maps, COW) | Yes |
| You can write a regression test | Yes |
| The fix survives a Go version bump | Probably yes |

If you can't tick most of those, don't optimize. The builders in `sqlx`, `squirrel`, `resty`, `protobuf-go` are all "naïve" by the standards of this file — they ship because the simple version is good enough.

Specific anti-patterns to avoid:

| Anti-pattern | Why it's bad |
|--------------|--------------|
| Removing the deep-copy in `Build()` "for speed" without documenting the shared-state contract | Subtle aliasing bugs that survive code review |
| Switching to value-receivers "for immutability" without checking call sites | Slower (Exercise 1) and breaks chains that rely on mutation |
| Adding `sync.Mutex` "for safety" | Two-thirds slower (Exercise 5) for a guarantee nobody needed |
| Memoizing terminals (Exercise 9) when each builder is used once | Wasted memory for never-hit cache |
| Code generation (Exercise 12) for one or two target types | Build complexity exceeds the benefit |
| `sync.Pool` (Exercise 6) below 10k builds/sec | Pool overhead matches savings |

The default answer to "can we make this builder faster?" is **no, it's fine**. The yes cases are narrow and benchmark-justified.

---

## 16. The optimization checklist

Before shipping any optimization from this file:

1. [ ] Baseline benchmark exists (the unoptimized builder).
2. [ ] Optimized benchmark shows ≥ 2× improvement OR saves ≥ 1 allocation per call.
3. [ ] `pprof` confirms the optimization targets a real hot spot (top 5 % CPU or top 10 allocs).
4. [ ] The new code passes the same tests as the old.
5. [ ] `-gcflags=-m` shows no unexpected escapes.
6. [ ] `-race` is clean (especially for COW, snapshot, lock-removal patterns).
7. [ ] Documentation explains the assumption the optimization makes ("do not retain after Release", "do not mutate the builder after Build").
8. [ ] CI regression test (`benchstat`) compares against the baseline.
9. [ ] Code review has signed off on the trade-off.
10. [ ] The "When NOT to do this" condition from the relevant exercise has been checked.

If any item is missing, the optimization isn't ready.

---

## 17. Summary

The pointer-receiver builder is already fast: ~55 ns and one allocation per construction. Most optimizations in this file save 50–500 ns and 1–6 allocations. That matters at 100k QPS. It does not matter at 100 QPS.

The wins worth shipping cluster in six areas:

1. **Switch value-receivers to pointer-receivers** (Exercise 1) — eliminate per-step copies. Almost always correct.
2. **`strings.Builder` over `+=`** (Exercise 2) — O(N) instead of O(N²) string assembly. Pure win.
3. **Lazy-init defensive slices/maps** (Exercise 3) — zero-cost if unused, cheap if used. Pure win.
4. **Cache prefix bytes / pre-size buffers** (Exercise 7) — single-allocation output strings. Marginal but easy.
5. **Pool builders that run per-request** (Exercise 6) — amortize the builder allocation. Real win above ~10k QPS.
6. **Split one-time validation from per-build construction** (Exercise 10) — move expensive checks off the hot path. Big win when applicable.

The wins that don't always pay off:

- **`sync.Pool` for low-frequency callers** (Exercise 6) — pool overhead exceeds savings below 10k QPS.
- **Memoizing terminal calls** (Exercise 9) — useless if each builder is used once.
- **Code generation for moderate speedups** (Exercise 12) — build complexity isn't free; reserve for ≥ 10× wins.
- **Removing defensive deep-copies** (Exercise 4) — introduces aliasing contracts; one bug and the whole thing leaks.
- **Removing `sync.Mutex`** (Exercise 5) — correct only if you can prove single-thread usage; for public APIs the lock is the price of safety.

Always benchmark. Always check `-race`. Always confirm the optimization survives a Go version bump. Most production codebases need none of these optimizations; the pattern is fine as written in junior.md and middle.md.

---

## Further reading

- `sync.Pool`: https://pkg.go.dev/sync#Pool
- `strings.Builder`: https://pkg.go.dev/strings#Builder
- Escape analysis: https://github.com/golang/go/wiki/CompilerOptimizations
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Sibling: [middle.md](middle.md) — variant choices
- Sibling: [junior.md](junior.md) — the baseline shape
- Related: [01-functional-options/optimize.md](../01-functional-options/optimize.md) — same shape of file for the alternative pattern
- Inspiration (zero-allocation patterns): https://github.com/Masterminds/squirrel
- Inspiration (codegen builders): https://github.com/ent/ent

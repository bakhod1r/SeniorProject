# Modern Standard-Library Additions — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end. Use Go 1.23+ to exercise every feature.

---

## Easy

### Task 1 — First structured log

Write a program that logs three lines with `slog`: an info "service started" with `port=8080`, a warning "cache miss" with `key="user:42"`, and an error "db unreachable" with `host="db1"` and `err="timeout"`.

**Goal.** Get the key/value pairing right (no `!BADKEY`).

**Success.** Three lines, each with the message and its named attributes.

---

### Task 2 — Switch to JSON, then to debug level

Take Task 1 and: (a) make all output JSON via `slog.NewJSONHandler`; (b) set the handler's minimum level to `LevelDebug` and add a `slog.Debug` line that now appears.

**Goal.** Configure a handler with `HandlerOptions{Level: ...}` and `SetDefault`.

**Hint.** `slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))`.

---

### Task 3 — Slice toolkit

Given `s := []int{8, 3, 8, 1, 3, 9, 1}`: sort it, remove duplicates, then print `min`, `max`, whether it contains `9`, and the index of `3`. Use only the `slices` package.

**Goal.** Replace hand loops with `slices.Sort`, `Compact`, `Min`, `Max`, `Contains`, `Index`.

**Hint.** Remember `Compact` is adjacent-only — sort first.

---

### Task 4 — Sorted map keys

Given `m := map[string]int{"banana":3, "apple":5, "cherry":1}`, print the keys in alphabetical order, then the values in key order.

**Goal.** Use `slices.Sorted(maps.Keys(m))` and remember `maps.Keys` is an iterator in 1.23.

**Success.** Output `apple banana cherry` and `5 3 1`.

---

### Task 5 — Config fallback

Read a port from the env vars `PORT` then `FALLBACK_PORT`, defaulting to `"8080"`, in a single expression. Print the chosen value.

**Goal.** Use `cmp.Or`.

**Hint.** `cmp.Or(os.Getenv("PORT"), os.Getenv("FALLBACK_PORT"), "8080")`.

---

## Medium

### Task 6 — Multi-key struct sort

Define `type Player struct { Name string; Score int; Rank int }`. Given a slice of players, sort by `Score` descending, then `Name` ascending, then `Rank` ascending. Use `slices.SortFunc` with `cmp`.

**Goal.** Compose comparators with `cmp.Or` and `cmp.Compare`.

**Hint.** For descending, swap the arguments: `cmp.Compare(b.Score, a.Score)`.

---

### Task 7 — A small REST router

Build an `http.ServeMux` (Go 1.22+, `go 1.22` in `go.mod`) with:
- `GET /todos` → list
- `POST /todos` → create
- `GET /todos/{id}` → fetch one, echoing the id
- `DELETE /todos/{id}` → delete, echoing the id

Run it and verify with `curl` that `PUT /todos/1` returns `405`.

**Goal.** Method + wildcard routing and `PathValue`.

**Success.** Each route responds; wrong methods yield 405 automatically.

---

### Task 8 — Request-scoped logger

Extend Task 7: wrap each handler so that it logs with a child logger carrying a random `request_id` (use `math/rand/v2`) and the route. Use `logger.With(...)`.

**Goal.** Use `slog.With` for request context and `math/rand/v2` for the id.

**Hint.** `reqLog := slog.With("request_id", rand.Int64N(1e9), "route", r.Pattern)`.

---

### Task 9 — Iterator round-trip

Given a `map[string]int`, produce a *sorted-by-value-descending* slice of `"key=value"` strings using `maps.All`, an intermediate slice, and `slices.SortFunc`.

**Goal.** Move between iterators and slices; sort by a derived key.

**Hint.** Collect `maps.All` into `[]struct{K string; V int}` (range the iterator), then `SortFunc`.

---

### Task 10 — Deterministic vs nondeterministic randomness

Write two functions: `shuffleGlobal([]int)` using the package-level `rand.Shuffle`, and `shuffleSeeded([]int, seed uint64)` using `rand.New(rand.NewPCG(seed, seed))`. Show that `shuffleSeeded` with a fixed seed produces the same permutation every run, while `shuffleGlobal` does not.

**Goal.** Understand the absence of global `Seed` and how to get reproducibility.

---

## Hard

### Task 11 — Custom `slog` handler with redaction

Implement a `slog.Handler` that writes one `key=value` line per record, prefixes group names, and drops any attribute whose key is `"password"` or `"token"`. Make `WithAttrs`/`WithGroup` correct (no receiver mutation, `slices.Clip` before append, shared mutex). Verify it against `slogtest.TestHandler`.

**Goal.** Implement the full handler contract correctly.

**Success.** `slogtest.TestHandler` passes; secrets never appear in output even when logged.

---

### Task 12 — Intern labels and measure

Build a slice of 1,000,000 records, each with a `Region string` field drawn from a set of 5 values. Build a second version where `Region` is `unique.Handle[string]`. Compare `inuse_space` with `runtime.ReadMemStats` (or a heap profile).

**Goal.** Demonstrate the memory win from `unique` and where it does/does not apply.

**Hint.** The win shows in heap residency, not in `Make` micro-timing.

---

### Task 13 — `LogValuer` for lazy, redacted fields

Define a `type CreditCard struct { Number string }` with a `LogValue()` method that returns only the last 4 digits as a `slog.String`. Log a `CreditCard` as an attribute and confirm the full number never reaches the output, and that `LogValue` is *not* called when the log level is disabled.

**Goal.** Use `slog.LogValuer` for deferred, redacted logging.

---

### Task 14 — Route conflict detection

Register `GET /files/{name}` and `GET /files/{path...}` on one mux and observe the registration-time panic. Then resolve the design so both a single-file route and a subtree route coexist without conflict.

**Goal.** Understand specificity and the conflict-panic guarantee.

**Hint.** One workable design: `GET /files/{name}` for a flat file, `GET /files/tree/{path...}` for subtree — disjoint prefixes.

---

## Solutions (Sketches)

**Task 1.** `slog.Info("service started", "port", 8080)` etc. — always pairs.

**Task 3.**
```go
slices.Sort(s); s = slices.Compact(s)
fmt.Println(slices.Min(s), slices.Max(s), slices.Contains(s, 9), slices.Index(s, 3))
```

**Task 4.** `for _, k := range slices.Sorted(maps.Keys(m)) { fmt.Print(k, " ") }`.

**Task 5.** `port := cmp.Or(os.Getenv("PORT"), os.Getenv("FALLBACK_PORT"), "8080")`.

**Task 6.**
```go
slices.SortFunc(ps, func(a, b Player) int {
    return cmp.Or(
        cmp.Compare(b.Score, a.Score), // desc
        cmp.Compare(a.Name, b.Name),
        cmp.Compare(a.Rank, b.Rank),
    )
})
```

**Task 7.** `mux.HandleFunc("GET /todos/{id}", func(w, r){ id := r.PathValue("id"); ... })`.

**Task 10.**
```go
func shuffleSeeded(s []int, seed uint64) {
    r := rand.New(rand.NewPCG(seed, seed))
    r.Shuffle(len(s), func(i, j int){ s[i], s[j] = s[j], s[i] })
}
```

**Task 11.** See [professional.md](professional.md) → "Writing a Correct Custom Handler". Key points: copy the receiver in `WithAttrs`/`WithGroup`, `slices.Clip` before `append`, shared `*sync.Mutex`, iterate with `Record.Attrs`, skip `password`/`token` keys.

**Task 12.** Store `unique.Make(region)`; compare `runtime.MemStats.HeapInuse` before/after. With 5 distinct values shared a million times, the interned version drops string residency dramatically.

**Task 13.**
```go
func (c CreditCard) LogValue() slog.Value {
    return slog.StringValue("****" + c.Number[len(c.Number)-4:])
}
slog.Info("charged", "card", card) // only last 4 appear
```

**Task 14.** The two `{name}` vs `{path...}` patterns at the same position conflict → panic. Give them disjoint prefixes (`/files/{name}` vs `/files/tree/{path...}`).

---

## Stretch Goals

- Bridge legacy `log.Printf` into `slog` with `slog.NewLogLogger` and confirm old call sites now emit JSON.
- Write a benchmark comparing `slog.Info(variadic)` vs `slog.LogAttrs(typed)` with `-benchmem`; quantify the allocation difference.
- Add a middleware that injects a trace ID into `ctx` and a custom handler that reads it in `Handle(ctx, record)`.
- Replace a `gorilla/mux` router in an existing project with the stdlib mux; remove the dependency from `go.mod`.

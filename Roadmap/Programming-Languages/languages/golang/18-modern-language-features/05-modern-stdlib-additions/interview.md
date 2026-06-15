# Modern Standard-Library Additions — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Covers Go 1.21–1.24 stdlib additions: `log/slog`, `slices`, `maps`, `cmp`, `math/rand/v2`, `unique`, and `net/http` routing.

---

## Junior

### Q1. What is `log/slog` and how is it different from `log`?

**Model answer.** `log/slog` (Go 1.21) is the standard library's *structured* logging package. Instead of one free-form string, it logs a message plus typed key/value attributes, at a level (Debug/Info/Warn/Error), through a pluggable *handler* that decides the format (text or JSON) and destination. `log.Printf` produces a string a human reads; `slog.Info("login", "user", id)` produces a record a machine can index.

**Common wrong answers.**
- "It's `log` with log levels." (Levels are part of it, but the structured key/value records and handler abstraction are the point.)
- "It replaces `fmt`." (No.)

**Follow-up.** *How do you make `slog` output JSON?* — Install a JSON handler: `slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))`.

---

### Q2. How do you sort a `[]int` using the `slices` package?

**Model answer.** `slices.Sort(s)` — it sorts ascending in place, works on any `cmp.Ordered` element type. For custom orders or structs, use `slices.SortFunc(s, func(a, b T) int { ... })`.

**Common wrong answers.**
- "`sort.Ints(s)`." (Works, but `slices.Sort` is the modern generic answer.)
- "`slices.Sort` returns a new slice." (No — it sorts in place.)

**Follow-up.** *What does `slices.SortFunc`'s callback return?* — An `int`: negative if `a<b`, zero if equal, positive if `a>b` — same contract as `cmp.Compare`.

---

### Q3. In Go 1.23, what does `maps.Keys(m)` return?

**Model answer.** An **iterator** (`iter.Seq[K]`), not a slice. To get a slice, drain it: `slices.Collect(maps.Keys(m))` for unordered, or `slices.Sorted(maps.Keys(m))` for sorted. You can also `for k := range maps.Keys(m) { ... }`.

**Common wrong answers.**
- "A `[]K`." (That was the experimental `x/exp/maps`; the stdlib version returns an iterator.)

**Follow-up.** *Why an iterator?* — It allocates nothing unless you collect, and composes with `slices.Sorted`/`Collect`.

---

### Q4. Write a Go 1.22 route that handles `GET /users/{id}`.

**Model answer.**
```go
mux := http.NewServeMux()
mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    fmt.Fprintf(w, "user %s", id)
})
```
The pattern is `METHOD /path/{wildcard}`; read the wildcard with `r.PathValue("id")`.

**Common wrong answers.**
- "You need `gorilla/mux` for path variables." (Not since Go 1.22.)
- Reading the id from `r.URL.Path` by hand. (Use `PathValue`.)

**Follow-up.** *What happens on `POST /users/5`?* — `405 Method Not Allowed` with an `Allow` header, automatically.

---

### Q5. Is `math/rand/v2` safe for generating passwords?

**Model answer.** No. `math/rand/v2` is a *pseudo-random* generator for simulations, shuffling, and jitter. For passwords, tokens, or keys use `crypto/rand`, which is cryptographically secure.

**Common wrong answers.**
- "Yes, v2 uses ChaCha8 so it's secure." (ChaCha8 backs the generator, but the package is not a CSPRNG API; use `crypto/rand`.)

**Follow-up.** *What does `crypto/rand.Text` do (Go 1.24)?* — Returns a cryptographically-random string, convenient for tokens.

---

## Middle

### Q6. Explain `cmp.Or` and a typical use.

**Model answer.** `cmp.Or[T comparable](vals ...T) T` (Go 1.22) returns the first argument that is not the zero value, or the zero value if all are zero. Two uses: config fallbacks (`port := cmp.Or(os.Getenv("PORT"), "8080")`) and multi-key sorting (`cmp.Or(cmp.Compare(a.A,b.A), cmp.Compare(a.B,b.B))`).

**Common wrong answers.**
- "It short-circuits like `||`." (No — *all* arguments are evaluated.)

**Follow-up.** *Why is the non-short-circuit behaviour a gotcha?* — `cmp.Or(a, expensiveCall())` always runs `expensiveCall()`, even if `a` is non-zero.

---

### Q7. What is the difference between `slog`'s `Info` and `LogAttrs`?

**Model answer.** `logger.Info(msg, args...)` takes loosely-typed `...any` key/value pairs — convenient but it boxes each value into `any`, allocating. `logger.LogAttrs(ctx, level, msg, attrs...)` takes a context and pre-built typed `Attr`s (`slog.Int`, `slog.String`), avoiding the boxing. Use `LogAttrs` in hot paths and where you want compile-time-typed fields.

**Common wrong answers.**
- "They're identical." (No — allocation behaviour and the BADKEY risk differ.)

**Follow-up.** *What is `!BADKEY`?* — The placeholder when you pass an odd number of args to the variadic form (a key without a value).

---

### Q8. Why does `slices.Compact` sometimes leave duplicates?

**Model answer.** `slices.Compact` removes only *adjacent* equal elements, in place, returning a prefix. `[1,1,2,1]` becomes `[1,2,1]`. For global deduplication, sort first: `slices.Compact(slices.Sorted(...))` or `slices.Sort` then `Compact`.

**Follow-up.** *Does `Compact` allocate?* — No; it mutates in place and zeroes the tail (1.22+) to avoid retaining references.

---

### Q9. What problems did `math/rand/v2` fix relative to v1?

**Model answer.** v1 (`math/rand`) had: a weak default generator, the global-seed footgun (originally deterministic unless you seeded), inconsistent naming (`Intn`/`Int63n`/`Int31n`), and a global mutex serialising calls. v2 ships PCG and ChaCha8 generators, consistent `IntN`/`Int64N` naming plus a generic `N[T]`, no global `Seed` (auto-seeded unpredictably), and avoids the global-mutex bottleneck.

**Common wrong answers.**
- "It made it cryptographically secure." (No — still not a CSPRNG API.)

**Follow-up.** *How do you get reproducible randomness in v2?* — Construct your own `rand.New(rand.NewPCG(seed1, seed2))`; there is no way to reseed the global.

---

### Q10. When Go auto-detects routing precedence, what wins?

**Model answer.** The **most specific** pattern wins, independent of registration order. A literal segment beats a `{wildcard}` at the same position (`/items/new` beats `/items/{id}`); a more-specific match beats a `{path...}` catch-all. Two equally-specific overlapping patterns are a conflict and panic at registration time.

**Follow-up.** *What does `{$}` mean?* — It anchors to the exact path: `/items/{$}` matches only `/items/`, not `/items/sub`.

---

## Senior

### Q11. Why is `slog.Handler` being an interface architecturally important?

**Model answer.** It standardises the logging *seam*, not the *engine*. Libraries can log against `*slog.Logger`/`slog.Default()` without imposing a logging backend on consumers — the consumer's `main` chooses the handler (stdlib JSON, a dev pretty-printer, a `zap`/`zerolog` bridge, a test buffer). Cross-cutting policy — redaction, sampling, fan-out, trace-ID injection — lives in handlers, keeping call sites declarative. It is the `io.Reader` of logging.

**Follow-up.** *Where do request-scoped fields belong?* — Either bound per request with `logger.With(...)` and threaded through, or extracted from `ctx` in a custom handler's `Handle(ctx, record)`.

---

### Q12. A teammate swaps `golang.org/x/exp/maps` for the stdlib `maps` and CI compiles fine but a test breaks. Why?

**Model answer.** The stdlib `maps.Keys`/`Values` return iterators, while the `x/exp` versions returned slices. Most call sites still compile (ranging works both ways), but any code that treated the result as a slice — `len()`, indexing, passing to `sort.Strings` — breaks. The fix is to wrap each in `slices.Collect`/`slices.Sorted`. The senior move is to grep for every `maps.Keys`/`maps.Values` during such a migration.

**Follow-up.** *Why did the signature change?* — Iterators arrived in 1.23 and compose better and allocate lazily.

---

### Q13. When would you use the `unique` package, and when not?

**Model answer.** Use it for high-cardinality-but-repetitive `comparable` values — telemetry labels, normalised enums, network addresses — where interning cuts heap usage and makes equality O(1) (handle comparison is a pointer compare). It is GC-aware: entries are reclaimed when no live handle references them, unlike a hand-rolled `map[T]T`. Do *not* use it for genuinely-unique data (UUIDs, timestamps) — pure overhead — or in hot loops where `Make`'s hash+lookup cost outweighs the benefit. Profile heap usage before adopting.

**Follow-up.** *How is `Handle[T]` equality so cheap?* — It wraps a pointer to the canonical entry, so `==` is a pointer comparison regardless of `sizeof(T)`.

---

### Q14. Should a new service drop `chi`/`gorilla` for the stdlib router? Argue both sides.

**Model answer.** The 1.22 mux closed the *routing* gap: methods, `{id}`/`{path...}`/`{$}` wildcards, specificity precedence, and registration-time conflict panics. For new small-to-medium services, start with the stdlib — it is sufficient and adding a router later is cheap. But the stdlib did *not* close the *middleware-organisation* gap: no route groups, no first-class per-route middleware, no regex constraints. For large services with deep middleware trees and many engineers, a thin `http.Handler`-compatible router like `chi` still earns its place for grouping ergonomics, not routing. Choose by which gap actually hurts.

**Follow-up.** *What reliability property does the conflict panic give?* — Ambiguous routes fail at startup instead of silently mis-routing in production.

---

## Staff

### Q15. What does adopting `slog` in a widely-imported *library* cost, and how do you mitigate it?

**Model answer.** It raises the library's `go` directive to 1.21, which every importer inherits — a contract change that can strand consumers on older toolchains (regulated/slow-upgrade shops). Mitigations: set the `go` directive to the lowest version your *used* features require; treat the bump as a notable/minor-version change with changelog notes; and design the logging *seam* so you accept an injected `*slog.Logger` (defaulting to `slog.Default()`) rather than imposing a backend. Expose `LogValuer` on sensitive types so consumers redact centrally. The general principle: a library's minimum-version floor is part of its public API.

**Follow-up.** *How do you keep `math/rand/v2` usage testable in a library?* — Accept an injectable `*rand.Rand`/`rand.Source` so consumers can seed deterministically.

---

### Q16. Design a custom `slog.Handler` that adds a trace ID and redacts secrets. What are the correctness traps?

**Model answer.** Implement the four methods. Pull the trace ID from `ctx` in `Handle(ctx, record)`. Redact via `ReplaceAttr` (or by resolving `LogValuer` and dropping sensitive keys). Traps: (1) `WithAttrs`/`WithGroup` must return a *new* handler and never mutate the receiver — loggers are shared across goroutines; use `slices.Clip` before `append` to avoid backing-array aliasing between siblings. (2) Do not retain the `Record` or its attr slices past `Handle`. (3) Serialise writes to a shared `Writer` with a shared mutex. (4) Resolve `LogValuer` values. (5) Conform via `slogtest.TestHandler` in CI.

**Follow-up.** *Why `slices.Clip`?* — Without capping capacity, two `WithAttrs` calls from the same parent can append into the same backing array and clobber each other.

---

### Q17. You see a heap profile dominated by millions of identical short strings. Walk through your response.

**Model answer.** Confirm via `pprof` heap (alloc_space / inuse_space) that the strings are (a) high count and (b) highly repetitive. If so, intern the offending field with `unique.Make`, storing `Handle[string]` instead of the raw string, and call `.Value()` only when the raw string is needed. Verify with before/after `inuse_space` profiles — the win shows in heap residency, not micro-benchmarks of `Make`. Watch liveness: handles must stay reachable for the canonical entry to persist; this is dedup, not a cache. If repetition turns out low, abandon — `Make`'s lookup cost is then pure overhead. The stdlib does exactly this for `net/netip.Addr`.

**Follow-up.** *What stdlib mechanism makes `unique` reclaim memory?* — Weak references; entries with no live handle are GC'd (the same machinery later exposed as the `weak` package in 1.24).

---

## Rapid-Fire

- **Which Go version added `slog`?** 1.21.
- **Which added `cmp.Or`?** 1.22.
- **Which added `unique` and the iterator funcs?** 1.23.
- **`slices.Index` of an absent element returns?** `-1`.
- **`slices.BinarySearch` returns?** `(index, found bool)`.
- **`maps.Keys` in 1.23 returns?** `iter.Seq[K]`.
- **`cmp.Compare(a, b)` returns?** -1, 0, or +1.
- **Does `math/rand/v2` have `Seed`?** No.
- **Read a route wildcard with?** `r.PathValue("name")`.
- **JSON logs via?** `slog.NewJSONHandler`.
- **Multi-segment route wildcard?** `{name...}`.
- **Exact-path route marker?** `{$}`.

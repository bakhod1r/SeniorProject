# Fail-Fast — Optimization

## 1. How to use this file

Twelve scenarios where Fail-Fast validation is slower, allocates more, or scales worse than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Fail-Fast cost on the hot path is dominated by five things: late detection, reflect-driven validators, allocation on the error path, repeated regex/lookup work, and synchronous chains where parallelism would do. Most wins remove one of those five.

Reading order: Ex. 1 (boundary check), 3 (sentinels), 7 (early ctx), then the rest in any order. Ex. 2, 5, 6 are the ones senior reviews flag most.

---

## 2. Exercise 1 — Validation in a deep function

The boundary handler accepts the request and passes it down. Three layers deep, `chargeCard` calls `validateAmount` and rejects. The two layers between did real work — DB read, fraud lookup, audit write — all wasted, all now needing rollback.

**Before:**

```go
func CreateOrder(ctx context.Context, req OrderReq) error {
    user, err := loadUser(ctx, req.UserID)    // DB hit
    if err != nil { return err }
    items, err := loadItems(ctx, req.ItemIDs) // DB hit
    if err != nil { return err }
    return chargeCard(ctx, user, items, req.AmountCents)
}
func chargeCard(ctx context.Context, u User, it []Item, cents int64) error {
    if cents <= 0 { return errBadAmount } // validated 2 layers in
    // ...
}
```

```
BenchmarkDeepValidation-8       50000     32000 ns/op   1840 B/op   24 allocs/op  // includes 2 DB stubs
```

<details><summary>After</summary>

Validate every field of `req` at the boundary. By the time `chargeCard` runs, all preconditions hold.

```go
func (r OrderReq) Validate() error {
    if r.UserID == 0 { return errBadUserID }
    if len(r.ItemIDs) == 0 { return errNoItems }
    if r.AmountCents <= 0 { return errBadAmount }
    return nil
}
func CreateOrder(ctx context.Context, req OrderReq) error {
    if err := req.Validate(); err != nil { return err }
    user, err := loadUser(ctx, req.UserID)
    if err != nil { return err }
    items, err := loadItems(ctx, req.ItemIDs)
    if err != nil { return err }
    return chargeCard(ctx, user, items, req.AmountCents)
}
```

```
BenchmarkBoundaryValidation-8  100000000     12 ns/op    0 B/op   0 allocs/op  // bad-input path
BenchmarkBoundaryValidation_OK-8   50000   32100 ns/op  1840 B/op  24 allocs/op  // happy path unchanged
```

~2600× faster on the reject path; happy path unchanged.

**Why faster:** Bad input never touches the DB. The two `loadUser`/`loadItems` calls — each a network round-trip and allocations for the response — are skipped entirely. The happy path pays one extra cheap function call.

**Trade-off:** Duplicated logic if `chargeCard` is also called from a different entry that lacks `Validate()`. Make the validator a method on the request type, share it across entries.

**When NOT:** Validators that genuinely need data the boundary can't see (e.g. "amount must be less than this user's daily limit"). Pull the limit check after `loadUser`, but keep the cheap field checks at the boundary.
</details>

---

## 3. Exercise 2 — Reflect-based struct validator

`go-playground/validator` walks struct tags with reflect on every call. Tag parsing is cached, but reflect's per-field dispatch (`reflect.Value.Field`, `reflect.Value.Interface`) is allocation-heavy and resists inlining.

**Before:**

```go
type CreateUserReq struct {
    Email string `validate:"required,email,max=254"`
    Age   int    `validate:"gte=13,lte=120"`
    Name  string `validate:"required,min=1,max=80"`
}
var v = validator.New()
func validate(r CreateUserReq) error { return v.Struct(r) }
```

```
BenchmarkReflectValidate-8       1500000      830 ns/op   240 B/op    7 allocs/op
BenchmarkReflectValidate_Bad-8   1200000     1020 ns/op   384 B/op   11 allocs/op
```

<details><summary>After</summary>

Generate (or hand-write) a direct-call validator. `go generate` can emit the obvious code; many shops do it by hand for boundary structs.

```go
//go:generate validatorgen -type=CreateUserReq
func (r CreateUserReq) Validate() error {
    if r.Email == "" { return errEmailRequired }
    if len(r.Email) > 254 { return errEmailTooLong }
    if !looksLikeEmail(r.Email) { return errEmailBadFormat }
    if r.Age < 13 || r.Age > 120 { return errBadAge }
    if r.Name == "" { return errNameRequired }
    if n := len(r.Name); n < 1 || n > 80 { return errNameLen }
    return nil
}
```

```
BenchmarkGenValidate-8         60000000      19 ns/op    0 B/op   0 allocs/op
BenchmarkGenValidate_Bad-8    300000000       4 ns/op    0 B/op   0 allocs/op
```

~44× faster happy path, ~250× faster reject path, zero allocations.

**Why faster:** Direct field reads inline. No reflect indirection, no map lookups for tag handlers, no `reflect.Value` materialization. Errors are sentinel pointers — no `fmt.Errorf` allocation.

**Trade-off:** Generated code drifts from tags if you forget to regenerate. Hook `go generate` into the build. Tags are still documentation — keep them but trust the generated check.

**When NOT:** Schemas that change frequently and aren't a hot path (admin tools, one-off scripts). Reflect's flexibility is worth its cost when the call rate is low.
</details>

---

## 4. Exercise 3 — `fmt.Errorf` with values on the hot path

Every rejection allocates: `fmt.Errorf("user %d: bad age %d", id, age)` builds a wrapper, a `[]byte` for the formatted message, and boxes both ints into `any`. A 1% rejection rate at 100k QPS is 1k allocs/sec just for errors.

**Before:**

```go
func ValidateAge(userID int64, age int) error {
    if age < 13 || age > 120 {
        return fmt.Errorf("user %d: bad age %d", userID, age)
    }
    return nil
}
```

```
BenchmarkFmtErrorf-8       3000000      400 ns/op   120 B/op    4 allocs/op  // rejection
BenchmarkFmtErrorf_OK-8  500000000        2 ns/op     0 B/op    0 allocs/op
```

<details><summary>After</summary>

Sentinel errors for the hot rejection path. Carry the bad value separately if a caller needs it — most don't.

```go
var ErrBadAge = errors.New("validate: age must be in [13, 120]")

func ValidateAge(userID int64, age int) error {
    if age < 13 || age > 120 { return ErrBadAge }
    return nil
}

// For callers that need the value, wrap in a typed FieldError that
// carries the field name and embeds the sentinel via Unwrap().
```

```
BenchmarkSentinel-8       1000000000       1.8 ns/op    0 B/op   0 allocs/op
BenchmarkSentinel_OK-8     500000000         2 ns/op    0 B/op   0 allocs/op
```

~220× faster on the reject path, zero allocations.

**Why faster:** Returning a package-level `error` is a single iface header copy of an already-constructed value. `fmt.Errorf` formats, allocates, boxes, and constructs each call.

**Trade-off:** Static message loses the userID and the actual age. For audit logs add structure (`slog.Error("bad age", "user", uid, "got", age, "err", ErrBadAge)`) — the cost lives in the slog path, not the validator.

**When NOT:** Cold paths (CLI argument parsing, startup config) where a rich message saves the operator a debugging session. The error-allocation cost is 400 ns once at boot.
</details>

---

## 5. Exercise 4 — Regex compile per call

`regexp.MustCompile` inside the validator recompiles the regex every call. The DFA construction is ~µs; lookup is ns. The order of magnitude wrong.

**Before:**

```go
func ValidateSKU(s string) error {
    re := regexp.MustCompile(`^[A-Z]{2}-\d{4}-[A-Z0-9]{6}$`)
    if !re.MatchString(s) { return errBadSKU }
    return nil
}
```

```
BenchmarkRegexInline-8     200000     8200 ns/op   6240 B/op   62 allocs/op
```

<details><summary>After</summary>

Compile once, package-level.

```go
var skuRE = regexp.MustCompile(`^[A-Z]{2}-\d{4}-[A-Z0-9]{6}$`)

func ValidateSKU(s string) error {
    if !skuRE.MatchString(s) { return errBadSKU }
    return nil
}
```

```
BenchmarkRegexPackage-8   20000000     85 ns/op    0 B/op   0 allocs/op
```

~96× faster, zero allocations per call.

**Why faster:** DFA built once at package init. Per-call cost is the match itself — string scan plus state transitions. No allocator pressure.

**Trade-off:** Package-level state is initialized whether or not `ValidateSKU` is ever called. For 16-line patterns it's a few KB of memory — negligible. For dozens of validators consider `sync.OnceValue` for lazy init.

**When NOT:** Regex patterns built from user input (search filters). There you must compile per request — but cache the compiled value behind an LRU keyed by pattern string.
</details>

---

## 6. Exercise 5 — Tag-based validator vs unrolled inline checks

Even with caches and codegen, tag-based validators carry indirection — a slice of field-checker functions iterated with a virtual call per field. For boundary structs called millions of times per second, hand-unrolling beats every generator.

**Before:**

```go
type Login struct {
    User string `validate:"required,alphanum,min=3,max=32"`
    Pass string `validate:"required,min=8,max=128"`
}
func (l Login) Validate() error { return tagWalk(l) } // generic walker
```

```
BenchmarkTagWalk-8        5000000     310 ns/op    32 B/op   2 allocs/op
```

<details><summary>After</summary>

Inline the checks. The compiler inlines `Validate`, and the bounds-check elimination on `len(s)` is straightforward.

```go
func (l Login) Validate() error {
    if l.User == "" { return errUserRequired }
    if n := len(l.User); n < 3 || n > 32 { return errUserLen }
    for i := 0; i < len(l.User); i++ {
        c := l.User[i]
        if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
            return errUserAlphanum
        }
    }
    if l.Pass == "" { return errPassRequired }
    if n := len(l.Pass); n < 8 || n > 128 { return errPassLen }
    return nil
}
```

```
BenchmarkInlineUnrolled-8    100000000     14 ns/op    0 B/op   0 allocs/op
```

~22× faster, zero allocations.

**Why faster:** The compiler can fuse the length check with the loop bound and elide the per-iteration bounds check. The tag walker pays a virtual call per check plus an `any`-boxed value per parameter (`min=3`).

**Trade-off:** Hand-unrolled code drifts from the field type. Pair it with `go test -fuzz` that confirms the unrolled validator agrees with a reference tag walker on random input.

**When NOT:** Long structs (20+ fields) where the unrolled version becomes unreadable — generate it (Ex. 2) instead.
</details>

---

## 7. Exercise 6 — `json.Decode` into `map[string]any` then validate

A handler decodes into a map "for flexibility", then checks types one key at a time. Every value is boxed in `any`; numbers come back as `float64` even for integers; unknown keys silently pass.

**Before:**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    var raw map[string]any
    if err := json.NewDecoder(r.Body).Decode(&raw); err != nil { http.Error(w, "bad json", 400); return }
    email, ok := raw["email"].(string)
    if !ok || email == "" { http.Error(w, "email", 400); return }
    ageF, ok := raw["age"].(float64)
    if !ok { http.Error(w, "age", 400); return }
    age := int(ageF)
    // ... use email, age
}
```

```
BenchmarkMapAnyDecode-8     500000    3100 ns/op   1080 B/op   28 allocs/op
```

<details><summary>After</summary>

Typed struct + `DisallowUnknownFields`. Unknown fields fail fast at decode; integers stay integers.

```go
type Req struct {
    Email string `json:"email"`
    Age   int    `json:"age"`
}
func (r Req) Validate() error {
    if r.Email == "" { return errEmailRequired }
    if r.Age < 13 || r.Age > 120 { return errBadAge }
    return nil
}
func handler(w http.ResponseWriter, r *http.Request) {
    var req Req
    dec := json.NewDecoder(r.Body); dec.DisallowUnknownFields()
    if err := dec.Decode(&req); err != nil { http.Error(w, "bad json", 400); return }
    if err := req.Validate(); err != nil { http.Error(w, err.Error(), 400); return }
    // ... use req.Email, req.Age
}
```

```
BenchmarkTypedDecode-8     1500000     980 ns/op    320 B/op   6 allocs/op
```

~3.2× faster, ~4.7× fewer allocations.

**Why faster:** Typed decoding writes directly into struct fields — no `any` boxing, no map insertion. `DisallowUnknownFields` short-circuits payloads with junk before the validator runs.

**Trade-off:** Schema is now part of the binary. Open-ended request shapes (admin "patch arbitrary field" endpoint) genuinely need the map.

**When NOT:** True schemaless endpoints. Webhook receivers that must accept future fields without code change — but even there, decode the known prefix typed and `json.RawMessage` the rest.
</details>

---

## 8. Exercise 7 — Late `ctx.Err()` check after computation

A long handler computes for 20 ms, then checks `ctx.Err()` at the end before writing the response. If the client cancelled at ms 1, the server wasted 20 ms of work.

**Before:**

```go
func handler(ctx context.Context, req Req) (Resp, error) {
    a := step1(req)   // 5 ms
    b := step2(a)     // 8 ms
    c := step3(b)     // 7 ms
    if err := ctx.Err(); err != nil { return Resp{}, err }
    return Resp{C: c}, nil
}
```

```
BenchmarkLateCtxCheck-8       60     20100000 ns/op  // even when cancelled
```

<details><summary>After</summary>

Check at every natural boundary — before each expensive step.

```go
func handler(ctx context.Context, req Req) (Resp, error) {
    if err := ctx.Err(); err != nil { return Resp{}, err }
    a := step1(req)
    if err := ctx.Err(); err != nil { return Resp{}, err }
    b := step2(a)
    if err := ctx.Err(); err != nil { return Resp{}, err }
    c := step3(b)
    return Resp{C: c}, nil
}
```

```
BenchmarkEarlyCtxCheck_Cancel-8      500000    4200 ns/op  // cancel at step1
BenchmarkEarlyCtxCheck_OK-8              60   20100500 ns/op  // 500 ns overhead happy path
```

~4800× faster when cancelled, ~500 ns overhead when not.

**Why faster:** Each `ctx.Err()` is a single atomic load of the context's internal `err` pointer. Returning early skips the expensive `step2`/`step3`. The savings dominate as soon as cancellation rate × wasted-work > 0.

**Trade-off:** Slight code noise. Wrap with a small helper if you have many steps.

**When NOT:** Tiny synchronous handlers where total work is < 100 µs — cancellation rarely arrives mid-work. Genuinely indivisible work (a single syscall) — pass `ctx` into the syscall instead.
</details>

---

## 9. Exercise 8 — `errors.New` per call

A validator constructs its error with `errors.New("bad amount")` on each rejection. `errors.New` allocates an `*errorString` on the heap every time.

**Before:**

```go
func ValidateAmount(c int64) error {
    if c <= 0 { return errors.New("amount must be positive") }
    return nil
}
```

```
BenchmarkErrorsNewPerCall-8    50000000    24 ns/op    16 B/op   1 allocs/op
```

<details><summary>After</summary>

Sentinel — defined once.

```go
var ErrBadAmount = errors.New("amount must be positive")
func ValidateAmount(c int64) error {
    if c <= 0 { return ErrBadAmount }
    return nil
}
```

```
BenchmarkSentinelErr-8       1000000000    1.8 ns/op    0 B/op   0 allocs/op
```

~13× faster, zero allocations. Bonus: callers can now `errors.Is(err, ErrBadAmount)` for structured handling.

**Why faster:** Sentinel is a package-level pointer. Returning it is iface-header construction over a constant — no heap. `errors.New` always allocates.

**Trade-off:** Callers that compare with `==` on the message string break. Use `errors.Is`. Wrapping with `fmt.Errorf("ctx: %w", ErrBadAmount)` still works, costs the wrapper's allocation only — wrap only when you need context.

**When NOT:** Errors that genuinely carry distinct data (a `*ValidationError` with a slice of failing fields). Sentinel is wrong; pool the struct or accept the allocation.
</details>

---

## 10. Exercise 9 — Panic-recover for control flow

A validator chain uses `panic(badField{...})` to unwind on the first failure, recovered at the boundary. The author thought "deeply nested, no return ceremony". The runtime hates this.

**Before:**

```go
type badField struct{ name, why string }
func mustString(m map[string]any, k string) string {
    v, ok := m[k].(string)
    if !ok { panic(badField{k, "not string"}) }
    return v
}
func validate(m map[string]any) (err error) {
    defer func() {
        if r := recover(); r != nil {
            if b, ok := r.(badField); ok { err = fmt.Errorf("%s: %s", b.name, b.why); return }
            panic(r)
        }
    }()
    _ = mustString(m, "email")
    _ = mustString(m, "name")
    return nil
}
```

```
BenchmarkPanicRecover-8       300000    4200 ns/op    192 B/op   3 allocs/op  // reject
BenchmarkPanicRecover_OK-8   30000000      40 ns/op      0 B/op   0 allocs/op  // happy, defer still runs
```

<details><summary>After</summary>

Plain error returns.

```go
func getString(m map[string]any, k string) (string, error) {
    v, ok := m[k].(string)
    if !ok { return "", &FieldErr{k, "not string"} }
    return v, nil
}
func validate(m map[string]any) error {
    if _, err := getString(m, "email"); err != nil { return err }
    if _, err := getString(m, "name");  err != nil { return err }
    return nil
}
```

```
BenchmarkErrReturn-8       100000000     12 ns/op    32 B/op   1 allocs/op  // reject
BenchmarkErrReturn_OK-8    500000000      2 ns/op     0 B/op   0 allocs/op  // happy
```

~350× faster on reject, ~20× faster on happy path (defer + recover bookkeeping gone).

**Why faster:** `panic` unwinds the stack — walks frames, runs deferred functions, allocates a panic record. `recover` adds defer overhead even on the happy path. A return is one MOV plus a branch.

**Trade-off:** None for validators. `panic` belongs to truly impossible states (nil where non-nil is contractual), not "user typed the wrong thing".

**When NOT:** Across a parser library boundary, recursive-descent parsers sometimes use panic to unwind on syntax error and recover at the top. The win there is code clarity for the parser author; the cost is one-time-per-bad-input. Validators don't have that excuse.
</details>

---

## 11. Exercise 10 — Linear scan for duplicates

`req.Items` is a slice of order line IDs. The validator forbids duplicates. The current code does a nested loop — O(N²). At N=200, 40k comparisons per request.

**Before:**

```go
func validateUnique(ids []int64) error {
    for i := 0; i < len(ids); i++ {
        for j := i + 1; j < len(ids); j++ {
            if ids[i] == ids[j] { return errDuplicate }
        }
    }
    return nil
}
```

```
BenchmarkDupLinear-8     50000    24000 ns/op    0 B/op   0 allocs/op  // 200 items
```

<details><summary>After</summary>

Set lookup. For small N (< 32) linear is actually fine — branch the implementation.

```go
func validateUnique(ids []int64) error {
    if len(ids) < 16 { // small: linear wins (cache + no map setup)
        for i := 0; i < len(ids); i++ {
            for j := i + 1; j < len(ids); j++ {
                if ids[i] == ids[j] { return errDuplicate }
            }
        }
        return nil
    }
    seen := make(map[int64]struct{}, len(ids))
    for _, id := range ids {
        if _, dup := seen[id]; dup { return errDuplicate }
        seen[id] = struct{}{}
    }
    return nil
}
```

```
BenchmarkDupSet_200-8        500000    3100 ns/op   3200 B/op   3 allocs/op
BenchmarkDupSet_8-8        20000000     90 ns/op       0 B/op   0 allocs/op  // small branch
```

~8× faster at N=200; small-case branch keeps tiny lists allocation-free.

**Why faster:** O(N) vs O(N²) for the dominant branch. The set's hash table setup is amortized to one allocation.

**Trade-off:** The set allocates; below N=16 the allocation cost outweighs the algorithmic win — hence the branch. For very large N (10k+), pre-size the map exactly to avoid rehashes.

**When NOT:** When the IDs are bounded small integers (< 4096) — use a bitset instead of a map, no allocation and tighter cache footprint.
</details>

---

## 12. Exercise 11 — Per-request validator instance

The handler does `v := validator.New()` per request. Construction allocates the rule registry, the cache map, the universal translator. Even with all that cached, it's wasted allocations.

**Before:**

```go
func handler(w http.ResponseWriter, r *http.Request) {
    v := validator.New()
    var req Req
    json.NewDecoder(r.Body).Decode(&req)
    if err := v.Struct(req); err != nil { http.Error(w, err.Error(), 400); return }
    // ...
}
```

```
BenchmarkPerReqValidator-8     200000    8400 ns/op    4800 B/op   42 allocs/op
```

<details><summary>After</summary>

Reuse the validator. For stateful per-request validators (rare), pool them.

```go
var sharedV = validator.New() // safe for concurrent use after init

func handler(w http.ResponseWriter, r *http.Request) {
    var req Req
    json.NewDecoder(r.Body).Decode(&req)
    if err := sharedV.Struct(req); err != nil { http.Error(w, err.Error(), 400); return }
}

// If the validator type is genuinely not concurrent-safe, use a sync.Pool
// and Reset() on Put.
```

```
BenchmarkSharedValidator-8    2000000     820 ns/op    240 B/op    7 allocs/op
BenchmarkPooledValidator-8    3000000     480 ns/op    120 B/op    3 allocs/op
```

~10× faster (shared) or ~17× (pool).

**Why faster:** The rule registry, cache map, and translator are built once. Per-request work is the actual struct walk, not the validator setup.

**Trade-off:** Shared state needs to be concurrent-safe (`go-playground/validator` is, after init — register custom rules at boot). Pool adds reset complexity; only use when the struct is genuinely not safe to share.

**When NOT:** Tests where validator config differs per case. Init-time only call sites where construction cost is paid once anyway.
</details>

---

## 13. Exercise 12 — Synchronous validation chain

A request validator does five independent I/O checks: email-blocklist lookup, IP geo-check, captcha verify, fraud score, rate-limit. Each is ~30 ms, all sequential — 150 ms before the user gets a 400.

**Before:**

```go
func validate(ctx context.Context, req Req) error {
    if err := checkEmailBlocked(ctx, req.Email); err != nil { return err }
    if err := checkIPGeo(ctx, req.IP); err != nil { return err }
    if err := checkCaptcha(ctx, req.CaptchaToken); err != nil { return err }
    if err := checkFraud(ctx, req); err != nil { return err }
    if err := checkRateLimit(ctx, req.UserID); err != nil { return err }
    return nil
}
```

```
BenchmarkSyncChain-8        20    150_000_000 ns/op  // all five sequential
```

<details><summary>After</summary>

Fan out the independent checks with `errgroup.WithContext`. The first failure cancels the rest.

```go
func validate(ctx context.Context, req Req) error {
    g, gctx := errgroup.WithContext(ctx)
    g.Go(func() error { return checkEmailBlocked(gctx, req.Email) })
    g.Go(func() error { return checkIPGeo(gctx, req.IP) })
    g.Go(func() error { return checkCaptcha(gctx, req.CaptchaToken) })
    g.Go(func() error { return checkFraud(gctx, req) })
    g.Go(func() error { return checkRateLimit(gctx, req.UserID) })
    return g.Wait()
}
```

```
BenchmarkParallelChain-8     50     31_000_000 ns/op  // dominated by the slowest
```

~5× faster. With cancellation on first error, a fast failure returns even sooner.

**Why faster:** Five 30-ms latencies overlap. Wall time becomes `max(30 ms)` plus goroutine scheduling overhead (~µs), not `sum(30 ms × 5)`.

**Trade-off:** Five concurrent outbound calls per request — multiply by QPS to check downstream capacity. Cheap-then-expensive ordering is lost: if `checkRateLimit` is 0.1 ms and would reject 90% of bad traffic, run it first synchronously, then parallel-fan the expensive ones.

**When NOT:** Dependent checks (`checkFraud` needs the geo result). Chains where one check is the obvious 99%-reject filter — run it first, save the fan-out for the survivors. Hot paths where the goroutine setup cost (~3 µs) approaches the check cost.
</details>

---

## 14. When NOT to optimize

Validators dominate a CPU profile only when (a) the validator runs on a per-request hot path, and (b) the work it gates is non-trivial. A CLI tool validating flags once at startup gains nothing from any of these — keep the readable version.

- Boot-time config validation — `fmt.Errorf` with full context is the right call.
- Test fixture validators — clarity over speed.
- Admin endpoints called by humans — 1 ms per validator is invisible.

**Profile first.** Validator overhead has five signatures in a CPU profile:

- `reflect.Value.Field` / `reflect.Value.Interface` on a hot stack → Ex. 2 (codegen).
- `regexp.compile` in `pprof` flame → Ex. 4 (package-level compile).
- `fmt.Sprintf` / `runtime.convT*` under an error path → Ex. 3 or 9 (sentinels).
- `runtime.gopanic` / `runtime.gorecover` in any non-startup stack → Ex. 9 (return errors).
- `runtime.mapassign_faststr` in JSON decode → Ex. 6 (typed decode).

**Common premature optimizations:**

- Codegen validators (Ex. 2) for a 5-field struct in a cold endpoint — the tag walker is fine.
- Sentinels (Ex. 3) when rejection rate is 0.01% — the rich message helps ops more than ns saved.
- Parallel fan-out (Ex. 12) for cheap checks (<1 ms each) — goroutine overhead wins.
- `sync.Pool` of validators (Ex. 11) when the validator is already concurrent-safe.

**Correctness gaps disguised as optimizations:**

- Sentinel errors that lose the bad value with no `slog` capturing it — debug regression at 3 a.m.
- Boundary validation that skips deeper invariants ("amount < daily limit") — bad order reaches `chargeCard`.
- Parallel fan-out that ignores the first error and waits for all — wastes downstream capacity.
- `DisallowUnknownFields` flipped on a backwards-compat endpoint — old clients break overnight.
- Replacing `errors.New` with sentinel where the original carried mutable state — shared mutation hazard.
- Set-based dedup that uses `map[any]struct{}` — boxing allocations dwarf the algorithmic win.
- Hot-loop `ctx.Err()` placed inside a tight numeric kernel — branch noise slows the success path.

---

## 15. Summary

**Always-ship wins** (apply by default in any new boundary validator):

- Validate at the boundary, not in deep functions (Ex. 1).
- Sentinel errors for hot-path rejections (Ex. 3, 9).
- Package-level `regexp.MustCompile` (Ex. 4).
- Typed JSON decode + `DisallowUnknownFields` (Ex. 6).
- Plain error returns instead of panic-recover (Ex. 9).
- Reuse the validator across requests (Ex. 11).

**Wins behind a profile** (when measurements justify them):

- Codegen / hand-unrolled validators over reflect (Ex. 2, 5).
- Early `ctx.Err()` between expensive steps (Ex. 7).
- Set-based dedup with a small-N branch (Ex. 10).
- Parallel fan-out for independent I/O checks (Ex. 12).
- `sync.Pool` of validators when they carry per-request state (Ex. 11).

**Specialty** (only when the design calls for it):

- Bitset dedup for bounded small integer alphabets.
- LRU-cached compiled regex for user-supplied patterns — DoS vector if unbounded.
- Per-tenant validator config with `atomic.Pointer[Config]` for hot-reload.
- Streaming validators on `io.Reader` for huge payloads.

Fail-Fast cost on the hot path comes from late detection, reflect overhead, allocation in the error path, repeated compilation work, and serial chains where parallelism is free. Strip those by checking at the boundary, compiling once, returning sentinels, and fanning out only when each branch earns its goroutine.

# Modern Standard-Library Additions — Find the Bug

> Each snippet uses a Go 1.21–1.24 standard-library addition and contains a real-world bug. Find it, explain why it is wrong, and fix it. The bugs cover `log/slog`, `slices`, `maps`, `cmp`, `math/rand/v2`, `unique`, and `net/http` routing.

---

## Bug 1 — Odd `slog` arguments

```go
slog.Info("user logged in", "user_id", id, "ip")
```

**Bug:** The variadic args are key/value pairs, but there are three of them: `"user_id"`, `id`, `"ip"`. The trailing `"ip"` is a key with no value, so `slog` emits it as `!BADKEY=ip` (and silently drops the intended IP).

**Fix:** supply the value, or use typed attrs which cannot be miscounted:

```go
slog.Info("user logged in", "user_id", id, "ip", ip)
// or
slog.LogAttrs(ctx, slog.LevelInfo, "user logged in",
    slog.Int("user_id", id), slog.String("ip", ip))
```

---

## Bug 2 — `maps.Keys` treated as a slice

```go
m := map[string]int{"a": 1, "b": 2}
keys := maps.Keys(m)
sort.Strings(keys)        // compile error
fmt.Println(len(keys))    // compile error
```

**Bug:** In the standard library (Go 1.23), `maps.Keys` returns an `iter.Seq[string]` iterator, not a `[]string`. You cannot `sort.Strings` it or call `len` on it. This snippet was likely ported from `golang.org/x/exp/maps`, whose `Keys` returned a slice.

**Fix:** collect into a slice first:

```go
keys := slices.Sorted(maps.Keys(m)) // []string, sorted
fmt.Println(len(keys))
```

---

## Bug 3 — `slices.Compact` without sorting

```go
ids := []int{3, 1, 3, 2, 1, 3}
ids = slices.Compact(ids)
fmt.Println(ids) // expected [1 2 3], got [3 1 3 2 1 3]
```

**Bug:** `slices.Compact` only removes *adjacent* duplicates. Unsorted input has no adjacent duplicates here, so nothing is removed.

**Fix:** sort first:

```go
slices.Sort(ids)
ids = slices.Compact(ids) // [1 2 3]
```

---

## Bug 4 — Mutating a slice the caller still holds

```go
func removeAt(s []int, i int) []int {
    return slices.Delete(s, i, i+1)
}

orig := []int{10, 20, 30, 40}
trimmed := removeAt(orig, 1)
fmt.Println(trimmed)        // [10 30 40] — fine
fmt.Println(orig)           // [10 30 40 0] — surprise!
```

**Bug:** `slices.Delete` mutates the input's backing array in place (and zeroes the freed tail since Go 1.22), then returns a shorter slice. `orig` shares that array, so it is corrupted.

**Fix:** clone if the original must survive:

```go
func removeAt(s []int, i int) []int {
    return slices.Delete(slices.Clone(s), i, i+1)
}
```

---

## Bug 5 — Expecting `cmp.Or` to short-circuit

```go
cfg := cmp.Or(userValue, loadDefaultFromDisk())
```

**Bug:** `cmp.Or` evaluates *all* its arguments before choosing the first non-zero one — it does not short-circuit like `||`. `loadDefaultFromDisk()` runs even when `userValue` is non-empty, doing needless (possibly expensive or side-effecting) work.

**Fix:** guard the expensive call explicitly:

```go
cfg := userValue
if cfg == "" {
    cfg = loadDefaultFromDisk()
}
```

`cmp.Or` is for cheap, side-effect-free fallbacks like env vars and literals.

---

## Bug 6 — Reseeding the `math/rand/v2` global

```go
import "math/rand/v2"

func init() {
    rand.Seed(time.Now().UnixNano()) // compile error: undefined: rand.Seed
}
```

**Bug:** `math/rand/v2` has **no** `Seed` function. The global generator is auto-seeded unpredictably at startup; there is intentionally no way to reseed it. This code is a v1 habit applied to v2.

**Fix:** delete the seeding for normal use (it is already random). For *reproducible* randomness, construct your own source:

```go
r := rand.New(rand.NewPCG(seedHi, seedLo))
r.IntN(100)
```

---

## Bug 7 — `math/rand/v2` for a security token

```go
func newToken() string {
    b := make([]byte, 16)
    for i := range b {
        b[i] = byte(rand.IntN(256)) // math/rand/v2
    }
    return hex.EncodeToString(b)
}
```

**Bug:** `math/rand/v2` is not cryptographically secure; tokens generated from it are predictable to an attacker who can observe enough output. Using it for security tokens is a vulnerability.

**Fix:** use `crypto/rand`:

```go
func newToken() string {
    b := make([]byte, 16)
    _, _ = crypto_rand.Read(b)
    return hex.EncodeToString(b)
}
// or, Go 1.24:
func newToken() string { return crypto_rand.Text() }
```

---

## Bug 8 — Mutating the receiver in a custom `slog` handler

```go
func (h *myHandler) WithAttrs(as []slog.Attr) slog.Handler {
    h.attrs = append(h.attrs, as...) // mutates the shared receiver!
    return h
}
```

**Bug:** `WithAttrs` must return a *new* handler without mutating the receiver. Loggers (and their handlers) are shared across goroutines; mutating `h.attrs` here corrupts every other logger derived from the same parent and is a data race.

**Fix:** copy, clip, append:

```go
func (h *myHandler) WithAttrs(as []slog.Attr) slog.Handler {
    nh := *h
    nh.attrs = append(slices.Clip(h.attrs), as...)
    return &nh
}
```

`slices.Clip` caps the capacity so the append cannot clobber a sibling's backing array.

---

## Bug 9 — Route pattern without a method matches everything

```go
mux.HandleFunc("/admin/delete/{id}", deleteHandler)
```

```bash
$ curl -X GET http://host/admin/delete/5   # deletes item 5 via a GET!
```

**Bug:** A pattern with no method matches *all* HTTP methods. A destructive operation registered without `DELETE`/`POST` is reachable via `GET`, which crawlers, prefetchers, and CSRF can trigger.

**Fix:** specify the method:

```go
mux.HandleFunc("DELETE /admin/delete/{id}", deleteHandler)
```

Now `GET` on that path returns `405 Method Not Allowed`.

---

## Bug 10 — Reading the wrong `PathValue` name

```go
mux.HandleFunc("GET /users/{userID}", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id") // wildcard is named userID, not id
    fmt.Fprintf(w, "user %q", id) // always prints ""
})
```

**Bug:** `PathValue` looks up by the *wildcard name* in the pattern. The wildcard is `{userID}`, but the code asks for `"id"`, which does not exist, so `PathValue` returns `""` with no error.

**Fix:** match the names:

```go
id := r.PathValue("userID")
```

---

## Bug 11 — `slices.Contains` in an O(n²) loop

```go
seen := []string{}
for _, name := range names { // names is large
    if !slices.Contains(seen, name) {
        seen = append(seen, name)
    }
}
```

**Bug:** `slices.Contains` is O(n). Calling it once per element makes the dedup O(n²) — fine for dozens of names, a disaster for hundreds of thousands.

**Fix:** use a set:

```go
set := make(map[string]struct{}, len(names))
seen := make([]string, 0, len(names))
for _, name := range names {
    if _, ok := set[name]; !ok {
        set[name] = struct{}{}
        seen = append(seen, name)
    }
}
```

Or, if order does not matter: `seen := slices.Compact(slices.Sorted(slices.Values(names)))`.

---

## Bug 12 — `cmp.Compare` arguments swapped for descending sort

```go
slices.SortFunc(scores, func(a, b int) int {
    return cmp.Compare(a, b) // intended DESCENDING
})
```

**Bug:** `cmp.Compare(a, b)` yields ascending order. For descending, the arguments must be swapped. As written, this sorts ascending despite the comment.

**Fix:**

```go
slices.SortFunc(scores, func(a, b int) int {
    return cmp.Compare(b, a) // descending
})
```

---

## Bug 13 — Interning genuinely-unique data

```go
type Event struct {
    ID    unique.Handle[string] // a UUID — unique per event
    Type  string
}

func record(uuid, typ string) Event {
    return Event{ID: unique.Make(uuid), Type: typ}
}
```

**Bug:** `unique` deduplicates *repeated* values. UUIDs are unique by construction, so interning them never shares anything — every `Make` does a hash + concurrent-map insert for zero memory benefit, adding CPU cost and an ever-growing canonical map (until GC reclaims unreferenced entries).

**Fix:** store the raw value; reserve `unique` for the repetitive field:

```go
type Event struct {
    ID   string                // unique — store directly
    Type unique.Handle[string] // few distinct values, highly repeated
}
```

---

## Bug 14 — `slog` logging a secret

```go
slog.Info("authenticated", "user", user.Name, "password", user.Password)
```

**Bug:** Structured logs are indexed and shipped to aggregators; logging the password puts a plaintext secret into searchable storage and likely third-party systems. This is a serious data-exposure bug.

**Fix:** never log secrets. Redact centrally in the handler via `ReplaceAttr`, and remove the attribute from the call site:

```go
slog.Info("authenticated", "user", user.Name)

// defensive central redaction:
opts := &slog.HandlerOptions{
    ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
        if a.Key == "password" || a.Key == "token" {
            return slog.Attr{}
        }
        return a
    },
}
```

---

## Bug 15 — Assuming `maps.Keys` order is stable

```go
keys := slices.Collect(maps.Keys(m))
firstKey := keys[0] // assumed to be the "first inserted" key
```

**Bug:** Map iteration order is randomised, and `maps.Keys` reflects that. `keys[0]` is an arbitrary key that varies run to run. Any logic depending on it is nondeterministic.

**Fix:** sort if you need a defined order:

```go
keys := slices.Sorted(maps.Keys(m))
firstKey := keys[0] // smallest key, deterministic
```

---

## Bug 16 — `BinarySearch` on an unsorted slice

```go
nums := []int{5, 2, 9, 1, 7}
i, found := slices.BinarySearch(nums, 9)
fmt.Println(i, found) // wrong / nondeterministic
```

**Bug:** `slices.BinarySearch` requires a **sorted** slice. On unsorted input it returns a meaningless index and may report `found=false` for a present element.

**Fix:** sort first (and keep it sorted thereafter):

```go
slices.Sort(nums)
i, found := slices.BinarySearch(nums, 9) // correct
```

---

## Bug 17 — Forgetting `LogValuer` is skipped when disabled — relying on its side effect

```go
type Audit struct{ ID int }

func (a Audit) LogValue() slog.Value {
    writeAuditRow(a.ID) // side effect inside LogValue — anti-pattern
    return slog.IntValue(a.ID)
}

logger.Debug("audited", "rec", Audit{ID: 7}) // Debug disabled in prod
```

**Bug:** `LogValue` is only called when the record is actually emitted. With `Debug` disabled, `LogValue` never runs, so `writeAuditRow` is silently skipped in production. Putting a required side effect inside `LogValue` ties business behaviour to log levels.

**Fix:** keep `LogValue` pure (formatting only); do the audit write explicitly:

```go
writeAuditRow(rec.ID)
logger.Debug("audited", "rec", rec)
```

---

## Bug 18 — Re-using a `Record` across handlers

```go
func (h *teeHandler) Handle(ctx context.Context, r slog.Record) error {
    go h.remote.Handle(ctx, r) // retains r in another goroutine
    return h.local.Handle(ctx, r)
}
```

**Bug:** A `slog.Record`'s internal attribute storage may be reused after `Handle` returns. Passing `r` to a goroutine that outlives the call can read freed/overwritten attributes — a data race and corruption bug.

**Fix:** clone the record before handing it to an async consumer:

```go
func (h *teeHandler) Handle(ctx context.Context, r slog.Record) error {
    rc := r.Clone()
    go h.remote.Handle(ctx, rc)
    return h.local.Handle(ctx, r)
}
```

---

## Bug 19 — `slices.Clone` assumed to be deep

```go
type Order struct{ Items []string }

a := Order{Items: []string{"x", "y"}}
orders := []Order{a}
cp := slices.Clone(orders)
cp[0].Items[0] = "MUTATED"
fmt.Println(orders[0].Items[0]) // "MUTATED" — not isolated!
```

**Bug:** `slices.Clone` is *shallow*. It copies the `Order` structs, but each copied struct still shares the same underlying `Items` slice. Mutating through the clone affects the original.

**Fix:** deep-copy the nested slices explicitly:

```go
cp := slices.Clone(orders)
for i := range cp {
    cp[i].Items = slices.Clone(cp[i].Items)
}
```

---

## Bug 20 — Route precedence misunderstanding leads to a dead handler

```go
mux.HandleFunc("GET /api/{resource}", genericHandler)
mux.HandleFunc("GET /api/health", healthHandler) // never reached?
```

A developer "fixed" perceived shadowing by registering `genericHandler` first.

**Bug:** The *assumption* that registration order matters is the bug. The mux selects the **most specific** pattern regardless of order, so `/api/health` correctly beats `/api/{resource}` — but the developer, believing order matters, may reorder routes elsewhere and introduce real conflicts (two equally-specific patterns), which panic at registration.

**Fix:** rely on specificity, not order. Both registrations here are correct as written; `GET /api/health` wins for `/api/health`, `genericHandler` wins for everything else. Remove any order-based "fixes" and let specificity resolve precedence.

---

## How to Practise

For each bug: (1) predict the symptom before running, (2) reproduce it (`go run`, `go vet`, `go test -race`), (3) apply the fix, (4) confirm. Several of these (`-race` for the handler bugs, `-benchmem` for the O(n²) and allocation bugs) are caught by tooling — make a habit of running it.

# Go Short Statement in If — Middle Level

## 1. Introduction

At middle level, the question is no longer *what* the init form does — it is *when to reach for it*, *when to avoid it*, and *what shapes of code it tightens versus blurs*. The init form is one of Go's most underrated readability tools: it shrinks variable scope to exactly the lines that need the value, eliminates a class of stale-state bugs, and keeps long blocks of error-checked code visually clean. It also has sharp edges — most famously the err-shadowing trap.

This level focuses on real-world patterns, the tension between init-style and split-style declarations, and the interplay with `defer`, `range`, channel ops, and concurrency.

---

## 2. Prerequisites

- Junior-level material on if-init and the comma-ok forms
- Variable scope and shadowing (2.2)
- `defer` semantics (2.6.6)
- Channel operations (3.2)
- Mutex and `sync.Once` basics (3.3)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Init scope | The implicit block formed by the if/else if/else chain |
| Stale variable | A name still in scope after its meaningful lifetime ends |
| Err-shadowing | An inner `:=` declaration that hides an outer `err` |
| Guard pattern | A check-and-return shape, often paired with an init |
| Hoisted call | A call deliberately placed outside the init for readability |
| Snapshot | A value copy distinct from a live reference |
| Side-effect init | An init that calls a function with observable mutation |

---

## 4. Real-World Patterns

### 4.1 The Standard Err Guard

The most prevalent use:

```go
func writeConfig(path string, data []byte) error {
    if err := os.WriteFile(path, data, 0o644); err != nil {
        return fmt.Errorf("writeConfig: %w", err)
    }
    return nil
}
```

Why this shape works:
- `err` exists only inside the `if`. After it, there is no `err` to mistakenly inspect.
- The reader's eye sees the "verb" (`os.WriteFile`) and the guard together.
- If a refactor adds a second call, you cannot accidentally test the first call's stale `err`.

Compare a verbose split:

```go
err := os.WriteFile(path, data, 0o644)
if err != nil {
    return fmt.Errorf("writeConfig: %w", err)
}
return nil
```

This is also legal and used widely when the value (or error) must outlive the check. The init form is preferred when the outcome is fully consumed by the guard.

### 4.2 When the Result Must Outlive the Guard

If you need both `value` and `error` past the check, init form does not fit:

```go
data, err := os.ReadFile(path)
if err != nil {
    return nil, err
}
return parse(data) // data needed here
```

A common temptation is to write this as `if data, err := os.ReadFile(path); err != nil { ... }` and then discover that `data` is gone outside the chain. Recognizing this case early avoids a frustrating undo.

Rule of thumb: if any returned value is used **after** the chain, do not use init form.

### 4.3 The Err-Shadowing Trap

Init declarations create a new scope. They never reach into the surrounding scope to assign:

```go
func process(items []item) error {
    var err error
    for _, it := range items {
        if err := handle(it); err != nil {
            // inner err — shadows outer
            log.Println(err)
            continue
        }
    }
    return err // outer err is still nil — we lost real errors!
}
```

The compiler will not warn because the inner `err` is "used" (`if err != nil`). The outer `err` is unused but the compiler may not flag it depending on context.

Two fixes:

**Drop the outer if you do not need to surface errors:**
```go
for _, it := range items {
    if err := handle(it); err != nil {
        log.Println(err)
        continue
    }
}
```

**Or use `=` to assign to the outer:**
```go
var err error
for _, it := range items {
    if err = handle(it); err != nil {
        log.Println(err)
        continue
    }
}
return err
```

`=` here uses the init form **without** declaring a new variable. Because all names on the left already exist, `=` is the right operator. This is one of the few times the init runs as an assignment instead of a short variable declaration.

### 4.4 Init Prevents Shadowing — Sometimes

Init form **prevents** shadowing only when there is no surrounding `err` to shadow. If your function has no `err` variable yet, the init introduces a fresh one with no risk:

```go
func step1() error {
    if err := callA(); err != nil { return err }
    if err := callB(); err != nil { return err } // independent err
    return nil
}
```

Each `err` lives only in its own `if`. There is no outer `err` to be shadowed. This is the "init-only" style that some shops adopt to eliminate shadowing entirely.

### 4.5 Init With `defer`

`defer` evaluates its function value and arguments immediately, but the deferred call runs at function return. Defers placed inside an `if`-init scope **only execute if the branch is taken**:

```go
func openAndUse(path string) error {
    if f, err := os.Open(path); err != nil {
        return err
    } else {
        defer f.Close() // runs when openAndUse returns
        return useFile(f)
    }
}
```

This pattern works but `else`-defer reads awkwardly. Most Go code splits:

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()
return useFile(f)
```

The split allows `defer` to live at the top level of the function, which is the conventional shape.

### 4.6 Init With `range`

Inside a loop, init keeps loop-local variables out of the loop body's scope when only the guard cares about them:

```go
for _, p := range paths {
    if info, err := os.Stat(p); err != nil {
        log.Printf("%s: %v", p, err)
    } else if info.IsDir() {
        log.Printf("%s: directory", p)
    } else {
        log.Printf("%s: %d bytes", p, info.Size())
    }
}
```

Without init, `info` and `err` would persist for the full iteration body. With init, they vanish at `}`, leaving the next iteration with a clean slate. (The variables are recreated per iteration anyway, but the reader's mental model is cleaner.)

### 4.7 Init With Channel Ops

```go
for {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case msg := <-ch:
        if v, ok := decode(msg); ok {
            handle(v)
        } else {
            log.Println("decode failed:", msg)
        }
    }
}
```

The `select` case already binds `msg`; the if-init scopes the decode result. The two scopes nest cleanly.

A direct receive-and-test:
```go
if v, ok := <-ch; ok {
    process(v)
} else {
    return errors.New("channel closed")
}
```

This is concise but blocks. Receivers in production code usually live inside a `select` for cancellation; the if-init guard then sits inside the case body.

### 4.8 Tightening Lock Critical Sections

Init runs **before** the body, so it executes inside whatever context the surrounding code provides. Holding a lock across an init keeps both init and body inside the critical section:

```go
mu.Lock()
if v, ok := cache[k]; ok {
    mu.Unlock()
    return v
}
// upgrade behavior...
mu.Unlock()
```

If the critical section should be tighter, hoist the read:

```go
mu.Lock()
v, ok := cache[k]
mu.Unlock()
if ok {
    return v
}
```

The init form is **not** automatically a tightening tool for locks; it is a scope tool, not a lifetime tool.

---

## 5. Five Worked Examples

### Example 1 — Layered Validation

```go
package config

import (
    "errors"
    "fmt"
    "strings"
)

type Config struct {
    Host string
    Port int
}

func ParseHost(raw string) (Config, error) {
    if t := strings.TrimSpace(raw); t == "" {
        return Config{}, errors.New("empty host:port")
    } else if i := strings.LastIndex(t, ":"); i < 0 {
        return Config{}, fmt.Errorf("missing port in %q", t)
    } else if port, err := parsePort(t[i+1:]); err != nil {
        return Config{}, fmt.Errorf("bad port %q: %w", t[i+1:], err)
    } else {
        return Config{Host: t[:i], Port: port}, nil
    }
}

func parsePort(s string) (int, error) { /* ... */ return 0, nil }
```

Each `else if` introduces its own init. The function reads as a chain of validations, each scoped to its check.

### Example 2 — Cache Lookup With Fallback

```go
func (c *Cache) Get(k string) (Value, error) {
    if v, ok := c.local[k]; ok {
        return v, nil
    }
    if v, err := c.remote.Fetch(k); err == nil {
        c.local[k] = v
        return v, nil
    } else {
        return Value{}, err
    }
}
```

The two ifs hold independent inits — the first uses comma-ok, the second uses err-guard. Neither leaks names.

### Example 3 — Conditional Cleanup

```go
func runJob(j Job) (err error) {
    if h, openErr := j.Open(); openErr != nil {
        return openErr
    } else {
        defer func() {
            if cerr := h.Close(); cerr != nil && err == nil {
                err = cerr
            }
        }()
        return j.Run(h)
    }
}
```

The named return `err` allows the deferred close to upgrade a nil error. The inner `cerr` is fully scoped to the deferred function. The outer `openErr` and the body live in the if/else chain only.

### Example 4 — Building a Slice From Optional Values

```go
func collect(sources []Source) []Value {
    out := make([]Value, 0, len(sources))
    for _, s := range sources {
        if v, ok := s.Try(); ok {
            out = append(out, v)
        }
    }
    return out
}
```

The init form keeps `v` and `ok` from leaking past the guard. Each iteration's pair is independent.

### Example 5 — Switch With Init for Dispatch

```go
func messageKind(m Message) string {
    switch t := m.Type(); {
    case t.IsControl():
        return "control"
    case t.IsData():
        return "data"
    case t.IsError():
        return "error"
    default:
        return "unknown"
    }
}
```

Multiple cases share `t` without computing `m.Type()` repeatedly. The variable evaporates after the switch.

---

## 6. Init Style vs Split Style

A team-level decision: when both shapes are legal, which to prefer?

| Situation | Recommended |
|-----------|-------------|
| Single-call err check, value unused after | init form |
| Multi-line setup before the check | split |
| Value or error consumed after the chain | split |
| Comma-ok guard (`v, ok := m[k]; ok`) | init form |
| Long boolean condition referring to many names | split |
| Heavy work (DB call, network) in the init | split (clarity) |
| Loop body where the variable should reset each iteration | init form |
| Defer attached to the value | usually split (defer at top level) |

A useful heuristic: if reading the init aloud takes longer than reading the condition, hoist it.

---

## 7. The Pre-Go-1.0 Comparison

Older C-style languages do not have this form. The Go-equivalent of:

```c
int x = compute();
if (x > 0) { ... }
```

would have been the same in early Go. Go added the init form so the variable's scope can be pinned to the check. Without it, a programmer might write:

```go
x := compute()
if x > 0 { ... }
// x lingers here, possibly to be reused incorrectly
```

The init form is, fundamentally, a scope discipline: it's a way to say "this value exists for this check and no longer." That mindset is the deepest reason to use it.

---

## 8. When NOT to Use If-Init

1. **Values needed after the chain.** Once you need them outside, init form forces an awkward extraction or a redundant call.
2. **Complex multi-step setup.** Two assignments, a log line, and a check reads better split out.
3. **Init has its own significant error path.** If the init might itself fail in a way that needs separate handling, isolate it.
4. **Conditions that reference many names.** When the condition is long, putting the init in front makes a wide line.
5. **When clarity loses.** If a colleague misreads it, optimize for them, not for terseness.

---

## 9. Anti-Patterns

### 9.1 Side-Effect Init

```go
if state.Counter++; state.Counter == 1 { firstHit() }
```

Legal, surprising. Increment and condition mixing makes diff review harder. Hoist:

```go
state.Counter++
if state.Counter == 1 { firstHit() }
```

### 9.2 Init That Pretends to Be Pure

```go
if v := slowQuery(ctx); v != nil { ... }
```

`slowQuery` is a major operation; a reader scanning for "what does this branch test" must mentally evaluate the call. Hoist with a clear name:

```go
v := slowQuery(ctx)
if v != nil { ... }
```

### 9.3 Multi-Result Init Where Only One Is Used

```go
if v, _ := m[k]; v > 0 { ... }
```

This loses comma-ok semantics. The map index without comma-ok returns the zero value when absent, which may be misleading. Prefer:

```go
if v, ok := m[k]; ok && v > 0 { ... }
```

The `ok` distinguishes "missing" from "present-and-zero".

### 9.4 Init Used to Cram Two Statements

```go
if logSetup(); ready { ... }
```

`logSetup()` is an expression statement. Two lines do this more clearly:

```go
logSetup()
if ready { ... }
```

---

## 10. Interaction With Linters

- `staticcheck` warns on dead variables that come from incorrect shadowing.
- `revive` has the `if-return` and `indent-error-flow` rules that prefer the early-return shape, often combined with init.
- The deprecated `ifshort` linter explicitly suggested moving short single-use declarations into the if-init form.
- `gocritic`'s `ifElseChain` checks for chains that should be a switch.

These tools exist because the choice between init and split affects readability enough to warrant automated nudges.

---

## 11. Init Form In Practice — A Closer Look

### 11.1 HTTP Handler Patterns

The init form dominates HTTP handler code where each call returns a value plus an error and the value is fully consumed by the response logic:

```go
func handleUser(w http.ResponseWriter, r *http.Request) {
    if id, err := parseID(r.URL.Path); err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    } else if u, err := store.Lookup(r.Context(), id); err != nil {
        http.Error(w, "not found", http.StatusNotFound)
        return
    } else {
        json.NewEncoder(w).Encode(u)
    }
}
```

This shape is dense and tightly scoped. Each `else if` introduces its own value within its branch. Errors do not propagate to the surrounding function. After `}`, none of `id`, `err`, or `u` exist — there is no possibility of accidentally reusing them.

The trade-off: the chain is deeply nested. Many shops prefer the flatter shape:

```go
func handleUser(w http.ResponseWriter, r *http.Request) {
    id, err := parseID(r.URL.Path)
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    u, err := store.Lookup(r.Context(), id)
    if err != nil {
        http.Error(w, "not found", http.StatusNotFound)
        return
    }
    json.NewEncoder(w).Encode(u)
}
```

Both are valid. The flat form is more common in Go codebases because it reads top-to-bottom; the nested chain reads as a single expression. Pick one and apply consistently within a file.

### 11.2 Returning Multiple Values From Init

Some functions return three or more values. Init form handles them:

```go
if a, b, c, err := splitThree(s); err != nil {
    return err
} else if a != b {
    return fmt.Errorf("mismatch: %v %v", a, b)
} else {
    use(a, b, c)
    return nil
}
```

Each name is in scope across the chain. Once you have four or more names, the line becomes wide; consider hoisting.

### 11.3 Recovering With Init After a Goroutine Panic

A pattern combining `recover` and init:

```go
func safeRun(f func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    f()
    return nil
}
```

Here `r := recover()` is the init for the panic check. It runs only inside the deferred function; `r` is scoped to that if. If `r == nil` (no panic in progress), the if body skips and the function returns `err` as the named return.

### 11.4 Fan-Out Result Aggregation

```go
type result struct {
    name string
    n    int
    err  error
}

func gather(results <-chan result) (map[string]int, error) {
    out := make(map[string]int)
    for r := range results {
        if r.err != nil {
            return nil, fmt.Errorf("%s: %w", r.name, r.err)
        }
        if v, ok := out[r.name]; ok {
            out[r.name] = v + r.n
        } else {
            out[r.name] = r.n
        }
    }
    return out, nil
}
```

The `if v, ok := out[r.name]; ok { ... } else { ... }` reads more naturally than a separate map lookup followed by an if. Both branches mutate the map; neither leaks `v` or `ok`.

### 11.5 Pipelines With Multiple Stages

Long pipelines benefit from per-stage init scoping:

```go
func process(input []byte) error {
    if decoded, err := decode(input); err != nil {
        return fmt.Errorf("decode: %w", err)
    } else if validated, err := validate(decoded); err != nil {
        return fmt.Errorf("validate: %w", err)
    } else if normalized, err := normalize(validated); err != nil {
        return fmt.Errorf("normalize: %w", err)
    } else if err := submit(normalized); err != nil {
        return fmt.Errorf("submit: %w", err)
    }
    return nil
}
```

Each stage's intermediate value (`decoded`, `validated`, `normalized`) is in scope from its declaration to the chain's end. The errors all share the name `err` — but each is shadowed in its own implicit block, so they do not interfere.

A more conventional flat shape exists; both are correct. The chained form makes the pipeline visually one expression.

### 11.6 Init In a Test Helper

```go
func mustParse(t *testing.T, s string) int {
    t.Helper()
    if n, err := strconv.Atoi(s); err != nil {
        t.Fatalf("parse %q: %v", s, err)
        return 0 // unreachable
    } else {
        return n
    }
}
```

`t.Fatalf` does not return, so the `return 0` is unreachable. Linters may complain. A cleaner shape:

```go
func mustParse(t *testing.T, s string) int {
    t.Helper()
    n, err := strconv.Atoi(s)
    if err != nil {
        t.Fatalf("parse %q: %v", s, err)
    }
    return n
}
```

When a branch terminates control flow (`t.Fatal`, `panic`, `os.Exit`), init form's else gets awkward; flatten.

---

## 12. Summary Checklist

- Use init for single-call err checks where the result is fully consumed.
- Use init for comma-ok guards on maps, channels, and type assertions.
- Avoid init when a value must outlive the chain.
- Avoid init when the work is heavy or the condition is long.
- Watch for err-shadowing: prefer `=` if assigning to an outer error.
- Reach for switch-init to share a value across cases without recomputation.
- Treat init as a scope tool, not a lock or critical-section tool.
- Prefer flat per-statement shape when a branch ends with `Fatal`/`Exit`/`panic`.
- Limit chained `else if` with init to ~3 stages; beyond that, the flat shape reads better.
- Linters (`revive`, `staticcheck`, `gocritic`) nudge toward whichever shape matches the situation; trust them and apply the suggestion.

---

## 13. Reading Other People's If-Init Code

Reading code written by others is the practical skill that ties everything together. When you see:

```go
if v, err := svc.Lookup(ctx, id); err != nil { ... } else { use(v) }
```

ask yourself:

- **Is `v` used past the chain?** If so, the code is buggy or about to be refactored.
- **Is there an outer `err`?** If so, the inner `err` shadows it. Check whether that is intentional.
- **Is `svc.Lookup` heavy?** If so, the init buries an important call; consider hoisting in your review feedback.
- **Could this be a switch?** If the if/else if chain dispatches on the same value, switch-init is cleaner.

Senior engineers do this scan on every if/else block they encounter. After enough repetitions it becomes automatic.

---

## 14. The "Single Question" Test

A useful heuristic for deciding init vs split: if the entire if/else chain answers one question with a single `cond`, init fits. If it answers multiple questions or sets up state for downstream code, split.

Single question:
```go
if v, ok := m[k]; ok && v > 0 {
    handlePositive(v)
} else {
    handleMissingOrNonPositive()
}
```
The whole chain answers "does the map have a positive value at k?". Init form fits.

Multiple questions:
```go
v, ok := m[k]
if !ok { return errMissing }
if v < 0 { return errNegative }
if v > maxAllowed { return errTooLarge }
process(v)
```
Three checks; init does not fit. Split is clearer.

This heuristic captures most real-world cases.

---

## 15. Closing Note on Style

The init form is not magic. It is a syntactic affordance for a specific shape: "do this; then check the result". The shape exists in millions of Go programs because it tightens scope and reads as a single thought. Use it when the shape fits; do not force code into it when it does not. Style is not adherence to a single rule; it is matching the right pattern to the right situation.

# Go Short Statement in If — Professional / Internals Level

## 1. Overview

The init form is one of Go's defining stylistic features. The Go standard library uses it pervasively for error guards, type assertions, and map lookups. This document surveys real OSS usage, summarizes the official style guide's stance, and lists the linters that enforce or recommend the form.

---

## 2. Style Guide References

### Effective Go

The official style guide says:

> "Since `if` and `switch` accept an initialization statement, it's common to see one used to set up a local variable."

Source: https://go.dev/doc/effective_go#if

The same section recommends using the init form for "decoration" — preparing values that the condition tests. It explicitly endorses the err-guard:

```go
if err := file.Chmod(0664); err != nil {
    log.Print(err)
    return err
}
```

### Go Code Review Comments

`https://github.com/golang/go/wiki/CodeReviewComments#variable-names` and `#error-strings` reinforce that error variables should be named `err` and that early-return guards keep code flat. Combined, this becomes the if-init err-guard pattern.

### Google Go Style Guide

`https://google.github.io/styleguide/go/` (the public version of the internal guide) has a "Decisions" section on "If" that states:

> "Prefer initialization in the if statement when the variable is only used within the if-else."

This is a direct codification of the rule we have been discussing.

---

## 3. Standard Library Examples

### `net/http` — Server.ServeHTTP path matching

`src/net/http/server.go`:

```go
if h, _ := mux.Handler(r); h != nil {
    h.ServeHTTP(w, r)
    return
}
```

`mux.Handler` returns a handler and a pattern; the init isolates the handler check. The pattern is discarded with `_`.

### `net/http` — chunked decoding

```go
if cw, ok := w.(*chunkWriter); ok {
    cw.flush(false)
}
```

A type-assertion guard scoped tightly to the only use.

### `database/sql` — connection pooling

`src/database/sql/sql.go`:

```go
if dc, err := db.conn(ctx, alwaysNewConn); err != nil {
    return nil, err
} else {
    // use dc...
}
```

Variants of this guard appear dozens of times in `database/sql`. The init keeps `dc` and `err` local to each guarded block.

### `encoding/json` — decoder state

`src/encoding/json/decode.go`:

```go
if u, ut, pv := indirect(v, false); u != nil {
    return u.UnmarshalJSON(d.data[start:d.off])
} else if ut != nil {
    return ut.UnmarshalText(item)
} else {
    v = pv
}
```

A three-way init (`u, ut, pv := indirect(v, false)`) feeds the entire if/else if/else chain. After `}`, none of the three names exist.

### `encoding/json` — type assertion in encoder

`src/encoding/json/encode.go`:

```go
if m, ok := v.Interface().(json.Marshaler); ok {
    return m.MarshalJSON()
}
```

### `os/exec` — process I/O

`src/os/exec/exec.go`:

```go
if c.SysProcAttr != nil {
    if c.SysProcAttr.Pdeathsig != 0 { ... }
}
```

Not every example uses init — but the `if c.SysProcAttr != nil` guard is itself the same pattern in spirit, scoped to its check.

### `runtime` — switch with init

`src/runtime/proc.go` contains a switch with init:

```go
switch s := readgstatus(gp); s {
case _Grunning, _Gscanrunning:
    ...
case _Gsyscall, _Gscansyscall:
    ...
}
```

`s` is named, computed once, and reused across cases.

---

## 4. Other Influential Open-Source Codebases

The same patterns dominate well-known OSS projects:

- **Kubernetes** (`k8s.io/kubernetes`) uses `if err := op(...); err != nil { return err }` consistently across controllers. The Go style guide is enforced as part of code review.
- **Docker / Moby** uses the comma-ok form for image-store lookups: `if img, err := store.Get(id); err == nil { ... }`.
- **Prometheus** uses if-init in its label-set lookup paths.
- **etcd** uses init-form heavily in raft state transitions.
- **Hashicorp's Terraform / Vault** do the same.

This is not coincidental — the form is so embedded in the language's idiom that any large Go codebase will exhibit it on most pages.

---

## 5. Team Conventions

A practical convention used by many teams:

1. **Always** use init form for err checks where the result is fully consumed.
2. **Always** use init form for `comma-ok` guards on maps, channels, and type assertions.
3. **Never** use init form when a value is needed past the chain.
4. **Never** put more than one statement's worth of work in the init.
5. **Prefer** `=` to `:=` in init when the LHS names already exist and you intend to mutate them (avoids shadowing surprises).
6. **Prefer** init-form switch when a single value drives multiple cases.
7. **Avoid** init form for non-error multi-statement setups; hoist them.

This is not a universal standard, but it captures the convergent practice of major Go shops.

---

## 6. Review Checklist

When reviewing a Go diff, look for:

- **Stale variables.** Is there a `:=` that introduces a name used only inside the if? Suggest moving it into init.
- **Shadowed err.** Inside a function with an outer `err`, does an inner `if err := ... ; err != nil` accidentally shadow? Suggest `=` or restructure.
- **Init too heavy.** Does the init contain a multi-step call chain or side effects? Hoist for clarity.
- **Comma-ok with `_`.** Does code drop the `ok` value (`v, _ := m[k]; v > 0`)? This silently treats "missing" as zero. Restore `ok` and combine with `&&`.
- **Switch without init when init would fit.** Is the same value computed in multiple cases? Promote to switch-init.
- **`else` after a return.** If the if-branch ends with `return`/`continue`/`break`, the `else` is redundant; flatten.

A typical review note:

> "Move `data` and `err` into the if-init since neither is used after the block."

---

## 7. Lint Rules

### `staticcheck`

- **ST1017** "Don't use Yoda conditions." Indirectly relevant: init form sometimes hides a Yoda condition. Not a direct rule on init.
- **S1023** "Omit redundant control flow." When a final return is unreachable due to an exhaustive if/else if, this rule fires.
- **SA4006** "A value assigned to a variable is never read before being overwritten." Catches the err-shadow bug when the outer err is overwritten without being checked.

### `revive`

- **`indent-error-flow`** prefers the early-return shape combined with init-form err checks. Discourages `if err == nil { ... } else { return err }`; prefers `if err != nil { return err } ...`.
- **`if-return`** requires `if err := op(); err != nil { return err }` style instead of `err := op(); if err != nil { return err }` when the value is unused later.
- **`var-declaration`** discourages explicit `var x type = expr` when `x := expr` would do.

### `ifshort` (deprecated)

The original goal was: "if a variable is used only inside one if/else, declare it in the init." The lint was retired around late 2022 because Go's compiler-builtin diagnostic and review culture made it redundant; many codebases still pin to its older versions. Source: https://github.com/esimonov/ifshort.

### `gocritic`

- **`ifElseChain`** — `staticcheck` ST1017 equivalent — suggests `switch` when an if/else if/else chain dispatches on the same value, often pairing with switch-init.

### `golangci-lint` aggregations

Most of the above are bundled in `golangci-lint`. A typical config enables `staticcheck`, `revive`, and `gocritic`. The init form is not a single rule but the cumulative effect of many.

---

## 8. Code Generation

When generating Go code (e.g., `protoc-gen-go`, `sqlc`, `oapi-codegen`), the templates emit init-form err checks as the default:

```go
if err := proto.Unmarshal(b, &m); err != nil {
    return nil, err
}
```

Generated code is one of the most consistent users of the init form because templates have no reason to spread `err` across multiple lines.

---

## 9. Performance Implications: None

There is no measurable runtime difference between init form and a hoisted declaration. The compiler emits identical assembly. This is purely a readability and scope-discipline feature.

The optimization document covers the few corner cases where register pressure differs by microseconds; for production code, this is not a consideration.

---

## 10. Common Production Bugs Avoided

The init form prevents specific classes of production bugs:

1. **Stale-error reads.** A function uses `err := op1()`; later in the function someone copy-pastes another `err := op2()`. The first `err` is never re-checked. Init form ensures `err` does not exist past the check.
2. **Map zero-value confusion.** `v := m[k]; if v > 0` silently treats absent keys as zero. Init's comma-ok form `if v, ok := m[k]; ok && v > 0` distinguishes.
3. **Type assertion panic vs guard.** `s := i.(string); use(s)` panics on mismatch. `if s, ok := i.(string); ok { use(s) }` is safe.
4. **Channel-closed misread.** `v := <-ch` returns the zero value if the channel is closed; `if v, ok := <-ch; ok` distinguishes.

These are not academic. Each is a recurring bug source in code reviews.

---

## 11. Style References Summary

| Source | URL | Stance |
|--------|-----|--------|
| Effective Go | https://go.dev/doc/effective_go#if | Endorses init form for one-shot setup |
| Go Code Review Comments | https://go.dev/wiki/CodeReviewComments | Implies init form via early-return guidance |
| Google Go Style Guide | https://google.github.io/styleguide/go/ | "Prefer init when var only used in chain" |
| `staticcheck` | https://staticcheck.dev/docs/checks | Catches shadow and dead writes |
| `revive` | https://revive.run/r | `indent-error-flow`, `if-return` |
| `golangci-lint` | https://golangci-lint.run | Aggregates all of the above |

---

## 12. Annotated Snippets From the Standard Library

### 12.1 `net/http/server.go` — Listener Acceptance

```go
// Roughly the shape used in Server.Serve.
for {
    rw, err := l.Accept()
    if err != nil {
        if ne, ok := err.(net.Error); ok && ne.Temporary() {
            // backoff
            continue
        }
        return err
    }
    go c.serve(...)
}
```

The inner `if ne, ok := err.(net.Error); ok && ne.Temporary()` is the exact comma-ok-in-init pattern: type-assert to a more specific interface, test a method, branch. If it is a `net.Error` and temporary, we back off; otherwise we bubble the error up.

### 12.2 `database/sql/sql.go` — Query Result Iteration

```go
for rows.Next() {
    if err := rows.Scan(&name, &n); err != nil {
        return err
    }
    // use name, n
}
if err := rows.Err(); err != nil {
    return err
}
```

Two separate `if err := op(); err != nil { return err }` patterns. Each `err` is fresh and lives only in its own if. The outer function may also have a `defer rows.Close()` that runs regardless.

### 12.3 `encoding/json/decode.go` — Indirect Pointer Walk

```go
if u, ut, pv := indirect(v, false); u != nil {
    return u.UnmarshalJSON(d.data[start:d.off])
} else if ut != nil {
    return ut.UnmarshalText(item)
} else {
    v = pv
}
```

A three-result init feeding a three-way chain. After the chain, none of `u`, `ut`, or `pv` exists; the only side effect that survives is the assignment `v = pv` in the `else`.

### 12.4 `runtime/proc.go` — Status Switch

```go
switch s := readgstatus(gp); s {
case _Grunning, _Gscanrunning:
    // running
case _Gsyscall, _Gscansyscall:
    // syscall
case _Gwaiting:
    // waiting
default:
    throw("unexpected status")
}
```

`readgstatus(gp)` is a complex function involving atomic loads. Calling it once and binding to `s` is the natural fit for switch-init.

---

## 13. Migration Patterns From Older Code

A common code-review reaction when modernizing pre-2015 Go:

**Before**:
```go
var err error
err = f.Close()
if err != nil {
    log.Println(err)
}
```

**After**:
```go
if err := f.Close(); err != nil {
    log.Println(err)
}
```

The `var err error` declaration was redundant — the variable was used only inside the check. Init form removes the dead outer name.

Another common pattern:

**Before**:
```go
v, ok := m[k]
if !ok {
    return errMissing
}
use(v)
```

**After (when v is needed past the check, leave as-is)**: above is correct.

**After (when v is only used inside)**:
```go
if v, ok := m[k]; ok {
    use(v)
} else {
    return errMissing
}
```

Or, more idiomatically:
```go
if _, ok := m[k]; !ok {
    return errMissing
}
v := m[k] // re-lookup; legal but wasteful for hot paths
use(v)
```

The "re-lookup" form is rarely worth it. Stick with the comma-ok flat shape unless `v` truly should not exist outside the check.

---

## 14. Code Generators That Emit Init Form

| Generator | URL | Init usage |
|-----------|-----|-----------|
| `protoc-gen-go` | https://pkg.go.dev/google.golang.org/protobuf/cmd/protoc-gen-go | Emits `if err := ...; err != nil { return err }` for every Marshal/Unmarshal step |
| `sqlc` | https://sqlc.dev | Generates query methods that scan rows with init-form err checks |
| `oapi-codegen` | https://github.com/oapi-codegen/oapi-codegen | OpenAPI handler stubs use init-form for validation guards |
| `mockgen` | https://github.com/uber-go/mock | Generated mocks use init-form for argument matching |

These tools emit init form because their output is meant to be read by humans during code review and pair with lint configurations that prefer the form.

---

## 15. Closing Notes

The init form is not a clever trick — it is a standard idiom used in millions of lines of Go. Treat it as the default for short err and comma-ok guards. When the value must outlive the chain, use the explicit declaration form. When in doubt, run the file through `gofmt` and look for the lint warnings; the toolchain has strong opinions and they are usually right.

Three guidelines summarize professional usage:

1. **Default to init form for one-shot err and comma-ok guards.** The community pattern is overwhelming; deviating without reason creates friction in review.
2. **Hoist when a value outlives the check.** Recognize this case early — fixing it later requires unwinding the init.
3. **Match team convention.** If your codebase uses the flat shape, do the same; if it nests with chained `else if`, do that. Consistency within a codebase trumps personal preference.

---

## 16. Open Questions and Edge Cases

A few sharp edges worth understanding before writing or reviewing init form in production:

### 16.1 Init In a Goroutine Capture

```go
for _, p := range paths {
    go func() {
        if data, err := os.ReadFile(p); err != nil {
            log.Println(err)
        } else {
            handle(data)
        }
    }()
}
```

The closure captures `p`. Pre-Go-1.22 this was the famous loop-variable capture bug. Go 1.22+ fixes it for `:=` loop variables. The init form has nothing to do with the bug — it just happens to be the most natural shape inside the goroutine.

### 16.2 Init In a Deferred Function

```go
defer func() {
    if err := recover(); err != nil {
        log.Println("recovered:", err)
    }
}()
```

The `err := recover()` is the canonical init-form recover pattern. `recover` returns the panic value or nil; the if branches accordingly.

### 16.3 Init With An Operator That Allocates

```go
if data, err := json.Marshal(v); err != nil { return err }
```

`json.Marshal` allocates. The init form does not change allocation behavior — same as a hoisted call. The escape analyzer makes the same decisions.

### 16.4 Init In a Named-Return Function With Recover

```go
func safe() (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
        }
    }()
    risky()
    return nil
}
```

The deferred function's init `if r := recover(); r != nil { ... }` is scoped to the deferred function. The mutation of `err` is to the named return of the outer function — that works because `err` is captured by reference.

---

## 17. Linter Configuration Snippet

A representative `.golangci.yml` enabling the relevant init-form lints:

```yaml
linters:
  enable:
    - staticcheck
    - revive
    - gocritic
    - govet

linters-settings:
  revive:
    rules:
      - name: indent-error-flow
      - name: if-return
      - name: var-declaration
  gocritic:
    enabled-checks:
      - ifElseChain
      - typeAssertChain
```

This covers the major init-form-related rules. `staticcheck` and `govet` run with default rule sets.

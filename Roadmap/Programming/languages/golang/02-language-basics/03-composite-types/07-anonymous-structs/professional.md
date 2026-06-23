# Go Anonymous Structs — Professional / Internals Level

## 1. Overview

This document covers anonymous-struct usage as it appears in production Go: standard-library tests, real HTTP handlers in `net/http` and Kubernetes' apiserver, configuration shapes, and the linter rules that constrain abuse. It is a tour of where anonymous structs are correct in real code, where they are wrong, and what the broader ecosystem has converged on.

---

## 2. Standard Library Usage

### 2.1 Test Tables

Anonymous structs as the element type of a test slice is one of the dominant idioms in the Go standard library.

`src/strings/strings_test.go`:

```go
var ContainsTests = []struct {
    str, substr string
    expected    bool
}{
    {"abc", "bc", true},
    {"abc", "bcd", false},
    {"abc", "", true},
    {"", "a", false},
}
```

`src/encoding/json/decode_test.go` carries hundreds of such tables, including nested anonymous structs:

```go
var unmarshalTests = []struct {
    in        string
    ptr       any
    out       any
    err       error
    golden    bool
    disallow  bool
}{
    ...
}
```

The pattern is consistent: a slice literal with an inline struct type, named fields, named-field initializers when the row is nontrivial, and a `for ... t.Run ...` driver loop.

### 2.2 Inline JSON in Tests

`src/encoding/json/encode_test.go`:

```go
type SamePointerNoCycle struct {
    Ptr1, Ptr2 *SamePointerNoCycle
}

var samePointerNoCycle = &SamePointerNoCycle{}
```

For one-off encoding fixtures, anonymous structs appear directly:

```go
v := struct {
    Foo string
    Bar map[string]int
}{Foo: "x", Bar: map[string]int{"a": 1}}
```

### 2.3 Network Code

`net/http` uses anonymous structs sparingly for internal sentinels and for inline test responses. Real handler responses are usually named types because they form part of a stable contract.

### 2.4 Compiler Internals

`cmd/compile/internal/types2/struct.go` defines the `Struct` type itself. The compiler is a heavy user of structured data, but rarely uses anonymous structs in its code — internal types are named for traceability.

---

## 3. Real-World Production Patterns

### 3.1 Inline Response Body in HTTP Handlers

Common in small services:

```go
func handleHealth(w http.ResponseWriter, r *http.Request) {
    _ = json.NewEncoder(w).Encode(struct {
        Status string `json:"status"`
        Build  string `json:"build"`
    }{
        Status: "ok",
        Build:  buildID,
    })
}
```

Pros: response shape is local. Cons: contract drifts silently if another handler returns "the same shape" — different anonymous struct.

### 3.2 Kubernetes Apiserver Patterns

In Kubernetes' `kubernetes/staging/src/k8s.io/apiserver`, response shapes are almost always named — these shapes form the public API surface. Anonymous structs appear in:
- Test setup.
- Inline error responses inside handler-internal helpers.
- Subtest-row tables in unit tests.

The rule there is: **anything that goes on the wire as part of the API has a named type**.

### 3.3 Configuration in Test Setup

```go
func TestPipeline(t *testing.T) {
    cfg := struct {
        Workers     int
        BatchSize   int
        FlushPeriod time.Duration
    }{
        Workers:     4,
        BatchSize:   100,
        FlushPeriod: 10 * time.Millisecond,
    }
    pipe := newPipeline(cfg.Workers, cfg.BatchSize, cfg.FlushPeriod)
    ...
}
```

The configuration is local to the test; naming it adds noise.

### 3.4 Shaping a One-Off External Request

Calling a third-party API that needs a small JSON envelope:

```go
body, _ := json.Marshal(struct {
    APIKey string `json:"api_key"`
    Query  string `json:"q"`
}{APIKey: key, Query: query})
```

If this same envelope shows up in three callers, promote to a named type.

### 3.5 Inline Pluck on Decode

```go
var probe struct {
    Token string `json:"access_token"`
}
if err := json.NewDecoder(resp.Body).Decode(&probe); err != nil {
    return "", err
}
return probe.Token, nil
```

The full response has 15 fields; the caller cares about one. A named DTO would mislead readers into thinking the rest matters.

### 3.6 Embedded "Section" Subgroups

Common in YAML/JSON-driven configuration:

```go
type ServiceConfig struct {
    Name string
    HTTP struct {
        Listen  string
        Timeout time.Duration
    }
    DB struct {
        DSN     string
        MaxConn int
    }
}
```

Each section is anonymous because it would be referenced only via `cfg.HTTP.X`. Some teams promote these subgroups to named types for testability; both are valid.

---

## 4. Where Anonymous Structs Are Wrong

### 4.1 gRPC Service Definitions

Protobuf-generated types must be named — `protoc` cannot emit anonymous shapes, and downstream code must reference them by name. There is no anonymous option in the gRPC ecosystem.

### 4.2 Persisted Database Models

ORM-mapped structs (e.g. `gorm`, `ent`) require named types. Migration generators reference them; query builders rely on type identity.

```go
// Required pattern:
type User struct {
    ID    uint   `gorm:"primaryKey"`
    Email string `gorm:"uniqueIndex"`
    ...
}
```

An anonymous struct cannot carry the ORM tags' lifecycle correctly because there is no central place to evolve it.

### 4.3 Public Library APIs

A library that exposes a function `func New() (struct{...}, error)` forces every caller to repeat the shape. Library authors invariably name the type.

### 4.4 Domains That Need Methods

Validation, formatting, marshalling overrides — any of these require methods, which require a named type.

### 4.5 Stable Wire Schemas

OpenAPI-defined responses, event-bus messages, persistent log entries — all require a named type so the schema can be evolved with code review.

---

## 5. Linter Rules

### 5.1 `staticcheck` SA9004

`staticcheck` does not have a dedicated "ban anonymous structs" rule, but SA9004 (and related rules) flag oddities like duplicate field tags. Anonymous structs are often the site of these because the shape is repeated by hand.

### 5.2 `revive`

`revive` includes a rule `cognitive-complexity` and `function-length` that indirectly catches enormous test tables, often built from anonymous structs.

A custom `revive` rule like `max-anonymous-struct-fields` or `no-anonymous-struct-in-exported-signature` is a common in-house linter at large Go shops.

### 5.3 `golint` Successors

Modern Go-vet warns about exported-without-doc; anonymous structs in exported signatures often trip this because there is no name to document.

### 5.4 Custom AST Linters

Teams often write a small AST walker that:
- Counts fields in inline `*ast.StructType` literals.
- Flags duplicates across files.
- Flags anonymous structs in exported function parameters and returns.

---

## 6. Style Guides

### 6.1 Google Go Style Guide

The Google style guide recommends named types for any shape used in more than one place or any shape that crosses a package boundary. Anonymous structs are accepted in tests and inline JSON.

### 6.2 Uber Go Style Guide

Uber's guide prefers named types for production code. Anonymous structs are explicitly recommended only for test tables.

### 6.3 Effective Go

Effective Go does not prohibit anonymous structs, and it shows them in examples for composite literals. The implicit recommendation is "use them for one-offs."

---

## 7. Production Use Cases — Examples

### 7.1 Health Endpoint

```go
type Server struct {
    build string
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(struct {
        Status string `json:"status"`
        Build  string `json:"build"`
    }{
        Status: "ok",
        Build:  s.build,
    })
}
```

### 7.2 Internal Audit Log

```go
func (s *Server) audit(action string, userID int, extra map[string]any) {
    s.audits.Send(struct {
        At     time.Time      `json:"at"`
        Action string         `json:"action"`
        UserID int            `json:"user_id"`
        Extra  map[string]any `json:"extra,omitempty"`
    }{
        At:     time.Now(),
        Action: action,
        UserID: userID,
        Extra:  extra,
    })
}
```

If `s.audits` is internal to the server, an anonymous struct keeps the schema next to the producer. If audit becomes a shared platform service, promote to a named `AuditEvent` type.

### 7.3 SQL Row Pluck

```go
var row struct {
    ID    int64
    Email string
}
err := db.QueryRow("SELECT id, email FROM users WHERE id = ?", id).Scan(&row.ID, &row.Email)
```

Pulling two fields from a row inside a private helper. If the helper is called from many places or grows, promote.

### 7.4 Test Table for an Algorithm

```go
func TestNormalize(t *testing.T) {
    cases := []struct {
        in   string
        want string
    }{
        {"  hi  ", "hi"},
        {"\thi\n", "hi"},
        {"", ""},
    }
    for _, c := range cases {
        if got := normalize(c.in); got != c.want {
            t.Errorf("normalize(%q) = %q, want %q", c.in, got, c.want)
        }
    }
}
```

### 7.5 One-Off Internal API Body

```go
func (c *Client) submitMetric(name string, value float64) error {
    body, _ := json.Marshal(struct {
        Name  string  `json:"name"`
        Value float64 `json:"value"`
        At    int64   `json:"at"`
    }{Name: name, Value: value, At: time.Now().Unix()})
    return c.post("/metrics", body)
}
```

If `submitMetric` is one of many endpoints sharing a base envelope, promote.

---

## 8. Anti-Patterns Found in Real Code

### 8.1 Same Shape, Two Files

```go
// internal/handlers/health.go
type response = struct {
    Status string `json:"status"`
    Build  string `json:"build"`
}
// internal/handlers/version.go (drift!)
type response = struct {
    Status string `json:"status"`
    Build  string `json:"build_id"` // tag drift
}
```

The "shared" alias to an anonymous shape diverges across files. The compiler does not warn because each file has its own alias.

### 8.2 Anonymous Struct in Exported Signature

```go
// Bad — public API
func New() (struct{ ID int }, error) { ... }

// Caller:
h, err := New()
// h's type is struct{ ID int } — caller must spell it to pass to other code.
```

### 8.3 Wide Test Table

```go
cases := []struct {
    name, in, lang, locale, want string
    flags, debug                 bool
    timeout                      time.Duration
    setup                        func()
    expect                       func(*testing.T)
}{ /* 50 entries */ }
```

The row deserves a named type, possibly with builder helpers.

### 8.4 Inline Struct With Methods Wanted

```go
// Bad — wants String() but cannot have it
log.Printf("%v", struct{ X int }{42}) // prints {42} — no formatting control
```

### 8.5 Cross-Package Sharing via Anonymous Type

A package returns an anonymous struct; a downstream package builds the same shape locally. Identity holds, but maintenance is fragile.

---

## 9. Code Review Heuristics

When reviewing anonymous-struct usage:
- **Search the package** for the same shape; if found, suggest promotion.
- **Check field count**: more than five is a smell.
- **Check tag consistency**: drift is silent.
- **Check exposure**: anonymous in exported signatures is a hard "no".
- **Check method needs**: any planned `String()`, `Validate()`, `Marshal*` means name it.
- **Check schema stability**: wire formats need names.

---

## 10. Real OSS References

| Project | Pattern |
|---------|---------|
| `src/encoding/json/decode_test.go` | Heavy table-driven tests with anonymous structs |
| `src/strings/strings_test.go` | Multi-table anonymous struct tests |
| `src/net/http/server_test.go` | Anonymous structs in inline test fixtures |
| Kubernetes apiserver | Named for wire types; anonymous for tests and internals |
| Caddy server | Named types throughout; anonymous in tests |
| Hugo | Named for content types; anonymous for inline shaping |
| Cobra | Named for commands; anonymous for option groupings in tests |

---

## 11. Tooling

### 11.1 `gopls` Behavior

`gopls` will not suggest extracting an anonymous struct to a named type by default, but the "extract type" code action can be invoked.

### 11.2 `go vet`

`go vet` does not specifically warn about anonymous structs but will catch issues like field-tag malformations even on anonymous structs.

### 11.3 `staticcheck`

Tag-format warnings (S1037, SA9004) apply to anonymous structs.

### 11.4 `errcheck`

Indifferent to anonymous structs.

### 11.5 IDE Refactors

GoLand / VS Code Go can extract an anonymous struct into a named type via "Extract Type" or "Refactor".

---

## 12. Performance Behavior in Production

In benchmarks, anonymous and named structs are indistinguishable. Reflection-based libraries (`encoding/json`, `gob`) cache the type descriptor on first use; the cache is keyed by `*reflect.rtype`. Anonymous structs share the descriptor across the program when shape matches.

There is no measurable performance reason to choose one over the other. The only differences are **maintenance, documentation, and method support**.

---

## 13. Migration Strategies

When you decide to promote:
1. Find every site that constructs the shape.
2. Define the named type next to the most prominent user.
3. Replace inline literals with the named type.
4. Add a doc comment.
5. If the shape will be marshaled, write `MarshalJSON`/`UnmarshalJSON` on the named type if needed.
6. Run tests.

Tools that help:
- `gopls` "Extract Type" code action.
- `gofmt -r` for simple structural rewrites.
- Custom AST tooling for large-scale migrations.

---

## 14. Real Bug Stories

### 14.1 Tag Drift in Two Handlers

A team had two handlers returning "the same" anonymous shape. One day, a developer changed `json:"id"` to `json:"user_id"` in one handler. The two responses diverged silently. Discovered weeks later when a client library tried to merge results.

Fix: promote to a named `UserResp` type.

### 14.2 Anonymous Struct in Exported API

A library returned `func Stat() struct{ N int; Bytes int64 }`. Callers' code became unmaintainable when the shape grew a third field — every caller had to update.

Fix: introduce a named `Stat` type, deprecate the function, ship a v2.

### 14.3 Cross-Package Identity Surprise

Code relied on `reflect.DeepEqual` between values from two packages. Fields drifted slightly (one added a tag), and `DeepEqual` silently returned `false`. Detected via failing test only after weeks of diagnosis.

Fix: shared named type.

---

## 15. Senior Production Checklist

- [ ] Anonymous shapes used only in tests and inline serialization.
- [ ] No anonymous struct in exported function signatures.
- [ ] No anonymous struct in cross-package contracts.
- [ ] Field tags consistent across "same" anonymous shapes.
- [ ] Promotion to named type whenever the shape is reused.
- [ ] Methods provided via wrapping in a named struct, never attempted on the anonymous one.

---

## 16. Summary

In production Go, anonymous structs are concentrated in test tables, inline JSON shaping, and private helpers. They are absent from gRPC types, persisted models, and stable wire schemas. The standard library uses them heavily in tests and sparingly in handlers. Linter rules and style guides converge on the same advice: **named types by default, anonymous when local AND simple AND no methods needed**. Performance is identical; the trade-off is purely about maintenance and API design.

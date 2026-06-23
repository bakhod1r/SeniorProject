# Build Tags — Specification

> **Focus:** Precise reference for Go build constraints (build tags) — syntactic forms, grammar, placement rules, file-name suffixes, predefined tags, tool interactions, and behavioral guarantees.
>
> **Sources:**
> - `go help buildconstraint`
> - cmd/go documentation: https://pkg.go.dev/cmd/go#hdr-Build_constraints
> - `go/build` package: https://pkg.go.dev/go/build
> - Go 1.17 proposal: https://go.googlesource.com/proposal/+/master/design/draft-gobuild.md

---

## 1. Synopsis

A **build constraint** is a line comment that controls whether the Go tool compiles a file. A constraint that evaluates to `true` for the current build context includes the file; one that evaluates to `false` silently excludes it.

```go
//go:build linux && amd64

package mypkg
```

Constraints apply to a whole file. There is no per-function or per-declaration constraint.

---

## 2. Syntactic forms

| Form | Since | Status |
|------|-------|--------|
| `//go:build <expr>` | Go 1.17 | Preferred for all new code |
| `// +build <expr>` | Pre-Go 1.17 | Legacy; still recognized; `gofmt` migrates it |

If both forms are present in one file, they **must agree** (evaluate to the same Boolean function). The Go tool errors out on mismatch.

---

## 3. Grammar

The body of `//go:build` is a Boolean expression:

```
expr     = orExpr
orExpr   = andExpr ( "||" andExpr )*
andExpr  = unaryExpr ( "&&" unaryExpr )*
unaryExpr= [ "!" ] primary
primary  = ident | "(" expr ")"
ident    = letter { letter | digit | "_" }
```

Operator precedence: `!` > `&&` > `||`. Identifiers are matched against the active tag set; unknown identifiers evaluate to `false` (no error, no warning).

The legacy `// +build` form uses a different two-axis grammar: **space = OR**, **comma = AND**, **multiple lines = AND**. `gofmt` normalises the two forms.

---

## 4. Placement rules

1. The constraint must appear in the **comment block above the `package` clause**.
2. It must be followed by a **blank line** before `package` (or any non-constraint comment).
3. Only **one** `//go:build` line is recognized per file. Additional lines are ignored.
4. A constraint **inside the package body** (between functions, below `package`) is treated as an ordinary comment and has no effect.

```go
//go:build linux && amd64
                            <-- REQUIRED blank line
package mypkg
```

---

## 5. File-name suffix form

A file's name imposes implicit constraints based on its last one or two underscore-separated tokens (before the `.go` extension):

| File name pattern | Implicit constraint |
|-------------------|---------------------|
| `name_GOOS.go` | matches `GOOS` |
| `name_GOARCH.go` | matches `GOARCH` |
| `name_GOOS_GOARCH.go` | matches `GOOS` AND `GOARCH` |
| `name_test.go` | only compiled under `go test` |
| `name_GOOS_test.go` | matches `GOOS` AND test-only |
| `name_GOOS_GOARCH_test.go` | matches `GOOS` AND `GOARCH` AND test-only |

Recognized `GOOS` values (Go 1.21+): `aix`, `android`, `darwin`, `dragonfly`, `freebsd`, `hurd`, `illumos`, `ios`, `js`, `linux`, `netbsd`, `openbsd`, `plan9`, `solaris`, `wasip1`, `windows`, `zos`.

Recognized `GOARCH` values (Go 1.21+): `386`, `amd64`, `arm`, `arm64`, `loong64`, `mips`, `mips64`, `mips64le`, `mipsle`, `ppc64`, `ppc64le`, `riscv64`, `s390x`, `wasm`.

The suffix match is **case-sensitive lowercase**. `foo_LINUX.go` is not a constraint.

Suffix and `//go:build` are implicitly ANDed: `foo_linux.go` with `//go:build amd64` requires both linux AND amd64.

---

## 6. Predefined tags

The following identifiers are set by the Go tool for every build:

| Category | Tags |
|----------|------|
| `GOOS` | One per recognized OS (`linux`, `darwin`, `windows`, ...) |
| `GOARCH` | One per recognized arch (`amd64`, `arm64`, ...) |
| Compiler | `gc` or `gccgo` (whichever is in use) |
| Cgo | `cgo` if `CGO_ENABLED=1` and a C toolchain is available |
| Unix umbrella | `unix` (Go 1.19+) on Unix-family `GOOS` |
| BoringSSL | `boringcrypto` for BoringSSL-backed builds |
| Go version | One `go1.X` for every released minor version through the current toolchain (e.g., Go 1.23 sets `go1.21`, `go1.22`, `go1.23`) |

Plus every identifier passed via `-tags` (see Section 7).

---

## 7. Interaction with `-tags` and `GOFLAGS`

```bash
go build -tags=integration .
go build -tags="integration e2e" .
go build -tags=integration,e2e .
GOFLAGS=-tags=integration go build .
```

The `-tags` value is split on commas or whitespace; each token becomes a true identifier in the constraint context. Order does not matter.

`GOFLAGS` is read once at the start of every `go` command, so `GOFLAGS=-tags=...` applies to `go build`, `go test`, `go vet`, `go run`, `go list`, etc.

`-tags` is shared by `go build`, `go test`, `go run`, `go install`, `go vet`, `go list`, `go generate` (the directives inherit it), and `go fix`. `gopls` accepts equivalent configuration under `build.buildFlags`.

---

## 8. Formatter behavior

`gofmt` (and `go fix`) does two things with build constraints:

1. If a file has only `// +build`, `gofmt` **adds** an equivalent `//go:build` line above it.
2. If a file has both forms and they agree, `gofmt` leaves them alone.

`gofmt` does **not** delete the legacy `// +build` line. Removal is a manual cleanup step once the project no longer targets pre-1.17 toolchains.

---

## 9. Build identity

Each combination of `(source content, GOOS, GOARCH, CGO_ENABLED, toolchain version, -tags, -gcflags, -ldflags, -race, ...)` produces a distinct **build ID** for each package object and final binary:

```bash
go tool buildid <binary>          # show build ID
go version -m   <binary>           # show -tags and other build settings
```

Two binaries built from the same source with different tag sets are guaranteed to have different build IDs and live as separate entries in `GOCACHE`.

---

## 10. Tool awareness

| Tool | Tag awareness |
|------|---------------|
| `go build`, `go install`, `go run`, `go test` | Honour `-tags` |
| `go list` | Honour `-tags`; expose `.GoFiles`, `.IgnoredGoFiles`, `.TestGoFiles`, `.CgoFiles` |
| `go vet` | Honour `-tags`; must be passed explicitly per build combination |
| `go generate` | Directives inherit `-tags` from the invoking command |
| `gofmt`, `go fix` | Migrate `// +build` to `//go:build` |
| `gopls` | Reads `build.buildFlags` configuration; otherwise uses default tag set |

---

## 11. Behavioral guarantees

- A file whose constraint is `false` is **not compiled, not type-checked, not linked**. Its imports are not loaded.
- Excluded files **must still parse** as Go source (the lexer/parser reads enough to find the constraint).
- The constraint applies to the whole file; there is no per-function or per-declaration constraint.
- `gofmt` round-trip preserves and synchronises both forms when they agree; mismatched forms are an error from `go vet` and modern `go` versions.
- Per-tag `GOCACHE` separation guarantees that two builds with different tags cannot return each other's stale objects.

---

## 12. Non-goals and limitations

- No per-function constraints. The whole file is the unit.
- No expression-level constraints inside Go code. `//go:build` is a comment, evaluated before parsing.
- No `else` branch. To express "X otherwise Y", create two files with complementary constraints.
- Unknown identifiers do not error; they evaluate to `false`. Typos fail open.
- The legacy `// +build` form may eventually be removed, but as of Go 1.21+ it is still supported for compatibility.

---

## 13. Related references
- Build constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- `go/build` package: https://pkg.go.dev/go/build
- `go help buildconstraint`, `go help buildflags`
- Go 1.17 release notes: https://go.dev/doc/go1.17#build-constraints
- `go tool buildid`, `go version -m`

# Build Tags — Under the Hood

## 1. The path from source to selected file

When the Go tool decides whether to include a file, three components cooperate:

1. **`go/build`** (`src/go/build/build.go`) — the public package other tools use to inspect a Go project. It exposes `Context.MatchFile` and `Default.Import`, which read the file's first non-blank lines and evaluate the constraint.
2. **`cmd/go/internal/imports/build.go`** — the build-list driver used by `go build`/`go test`. It uses the constraint evaluator to filter files before passing them to the compiler.
3. **`cmd/compile`** — never sees the dropped files; it only compiles what the driver hands it.

The interesting code lives in `go/build`: a small lexer reads `//go:build` and `// +build` comments, a Boolean parser turns the expression into an AST, and an evaluator walks that AST against a `BuildContext` (the current `GOOS`, `GOARCH`, `CgoEnabled`, `BuildTags`, and `ReleaseTags`).

---

## 2. The grammar precisely

The body of `//go:build` is a Boolean expression in this grammar:

```
expr     = orExpr
orExpr   = andExpr ( "||" andExpr )*
andExpr  = unaryExpr ( "&&" unaryExpr )*
unaryExpr= [ "!" ] primary
primary  = ident | "(" expr ")"
ident    = letter { letter | digit | "_" }
```

Identifiers are evaluated against the set of active tags:

- One per `GOOS` (`linux`, `darwin`, ...).
- One per `GOARCH` (`amd64`, `arm64`, ...).
- `cgo` if `CgoEnabled` is true.
- `gc` or `gccgo` for the active compiler.
- `unix` if the current `GOOS` is in the Unix family (`AIX`, `Android`, `Darwin`, `Dragonfly`, `FreeBSD`, `Hurd`, `Illumos`, `iOS`, `Linux`, `NetBSD`, `OpenBSD`, `Solaris`).
- `boringcrypto` for the BoringSSL build.
- `go1.X` for every released minor version up to and including the running toolchain.
- Every identifier in `BuildContext.BuildTags` (set from `-tags`).

Any other identifier evaluates to **false**. There is no error for unknown tags — that is why typos like `productioon` silently disable the file.

---

## 3. How the legacy form is parsed

`// +build` uses a two-axis grammar that long predates the modern form:

- **Space** inside one line means OR: `// +build linux darwin` → `linux || darwin`.
- **Comma** inside one line means AND: `// +build linux,amd64` → `linux && amd64`.
- **Multiple lines** are ANDed together.

```
// +build linux darwin
// +build amd64
```

means `(linux || darwin) && amd64`. The Go tool internally normalises this to the same AST `//go:build` produces. When both forms are present, the tool requires they evaluate to the same Boolean function; otherwise it errors. `gofmt -r` (and `go fix`) generate the matching `//go:build` line from `// +build` so the two stay in sync.

---

## 4. File-name suffix parsing

The suffix is parsed by `goodOSArchFile` in `go/build`. The algorithm: strip the optional `_test` suffix (file is a test file), then look at the last one or two underscore-separated tokens of the base name (without `.go`):

- If the last token matches a known `GOARCH` and the second-to-last matches a known `GOOS`, both constrain the file.
- Else if the last token matches a known `GOOS` or `GOARCH`, that one constrains it.
- Else no implicit constraint.

```
foo_linux_amd64.go         → GOOS=linux AND GOARCH=amd64
foo_amd64_linux.go         → GOOS=linux AND GOARCH=amd64 ? NO — order is GOOS then GOARCH, so this is GOARCH=linux (which doesn't exist) → no constraint
foo_linux_test.go          → GOOS=linux AND test-only
foo_linus.go               → "linus" is not a GOOS → no constraint (silent!)
foo_amd64.go               → GOARCH=amd64
```

The Go tool also implicitly ANDs the suffix with any `//go:build` line, so `foo_linux.go` with `//go:build amd64` requires both linux AND amd64.

Case matters. The token list is lowercase. `foo_LINUX.go` constrains nothing.

---

## 5. Placement rules

Three placement rules, enforced by `go/build` when reading the file:

1. The constraint must appear in the **comment block before the `package` clause**.
2. It must be followed by a **blank line** before `package`. If `package` immediately follows, the constraint becomes a doc comment.
3. If both `//go:build` and `// +build` appear, `//go:build` is **preferred**, and `// +build` must agree.

A constraint **inside** the package body — between functions or below `package` — is ignored. The constraint applies to the **whole file**, not to a function. Go has no per-function build constraint.

The `//go:build` line was specifically designed to be picked up by `gofmt` and parsed by editors, hence the strict placement: tools can find it without reading the whole file.

---

## 6. Interaction with `go list` and `go vet`

`go list` shows the filtered view:

```bash
go list -f '{{.GoFiles}}' .                # default build
go list -tags=integration -f '{{.GoFiles}}' .   # with the integration tag
go list -f '{{.IgnoredGoFiles}}' .         # files excluded by constraints
go list -f '{{.CgoFiles}}' .                # cgo files included for current build
```

This is the fastest way to confirm a tag is doing what you expect — much better than guessing from `go build` output.

`go vet -tags=...` accepts the same flag, and uses it identically. Forget to pass it and you vet only the default build, missing problems in tag-gated files. CI should vet **every** build combination that ships.

`gopls`, the Go language server, also reads tags. In your editor configuration:

```json
{
  "gopls": { "build.buildFlags": ["-tags=integration"] }
}
```

Without this, your IDE shows red squiggles in integration files because it can't resolve symbols defined in the integration-only branch.

---

## 7. Build IDs and tag-distinct binaries

Each compiled package object in `GOCACHE` is keyed by a **build ID** that hashes, among other things, the active tag set, `GOOS`, `GOARCH`, `CGO_ENABLED`, the compiler version, and the source content. `go tool buildid` shows it:

```bash
go build -o app1 .
go build -tags=integration -o app2 .
go tool buildid app1
go tool buildid app2     # different ID
```

Two binaries built from the same source with different tags have **different** build IDs and **different** cached objects. This is what guarantees correctness: `go install` won't return a stale binary for the wrong tag combination.

Conversely, `go version -m app` shows the `-tags` settings baked into the binary, so you can audit which tag set a production binary was built with.

---

## 8. The standard library's use of tags

The Go runtime and standard library are themselves the most extensive build-tag user in the ecosystem. A tour:

- `src/runtime/os_linux.go`, `os_darwin.go`, `os_windows.go` — per-OS scheduler integration with the kernel.
- `src/syscall/syscall_linux_amd64.go` — per-OS-and-arch syscall numbers and stub signatures.
- `src/internal/cpu/cpu_x86.go` (`//go:build 386 || amd64`) — feature detection limited to x86 builds.
- `src/net/cgo_unix.go` (`//go:build cgo && (...)`) — opt-in glibc resolver path.
- `src/crypto/internal/boring/` — the BoringSSL implementation, gated by `//go:build boringcrypto`.

Reading these is the most efficient way to learn idiomatic tag usage. The pattern is always the same: a small dispatch file with no constraint, plus per-platform files that each implement the same package-private functions.

---

## 9. Summary

The Go tool implements build constraints in `go/build`: a Boolean expression of identifiers (`GOOS`, `GOARCH`, `cgo`, `unix`, `go1.X`, plus `-tags`) is parsed, evaluated against the current context, and used to filter the file list before the compiler ever sees it. The modern `//go:build` is preferred over the legacy `// +build` and must agree if both are present. The file-name suffix is parsed by inspecting the last one or two underscore tokens, matched case-sensitively against known OS/arch names. Each tag combination produces a distinct `GOCACHE` entry and a distinct build ID, so two binaries built with different tags are guaranteed to be the artifacts they claim to be. `go list`, `go vet`, and `gopls` all honour the same `-tags` flag — keep them aligned with what CI builds.

---

## Further reading
- `go/build` package source: https://github.com/golang/go/blob/master/src/go/build/build.go
- `cmd/go/internal/imports/build.go`
- Build constraint spec: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- Go 1.17 proposal for `//go:build`: https://go.googlesource.com/proposal/+/master/design/draft-gobuild.md
- `go tool buildid` and `go version -m` reference

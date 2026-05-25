# go generate — Professional

## 1. Where the implementation lives

`go generate` is a subcommand of `cmd/go`. The source is in `src/cmd/go/internal/generate/generate.go` in the Go tree. It is a remarkably small file — under 500 lines — because the command does very little: walk packages, scan source files, match a regex, and `exec.Command` the result. There is no compiler interaction, no module fetching beyond what the directive itself triggers, and no caching layer.

A useful mental model: `go generate` is `grep -E '^//go:generate ' *.go | xargs -L1 sh -c`, but with environment injection, package walking, and a regex slightly stricter than that grep.

---

## 2. Package and file discovery

When you invoke `go generate ./...`:

1. The Go tool resolves the package pattern against `go.mod` (module mode) or `GOPATH` (legacy).
2. For each matched package it enumerates files via the normal build context, **including `_test.go` files** and files matched by current build constraints.
3. Files filtered out by `//go:build` tags or `_GOOS`/`_GOARCH` filename suffixes are skipped — their directives are invisible.
4. Each surviving file is read top to bottom; lines are scanned for the directive prefix.

Because discovery uses the active build context, `GOOS=linux go generate ./...` will see directives in `foo_linux.go` that the same command on macOS would not. This is the same reason your IDE may grey out a file you can clearly see runs in CI: build constraints are environment-dependent.

---

## 3. The directive regex

The matcher in `cmd/go/internal/generate` is essentially:

```
^//go:generate( |\t)(.*)$
```

Three rules fall out of this:

- The line must **start** with `//` — no leading whitespace, no leading `/* */`.
- There must be **no space** between `//` and `go:generate`. `// go:generate ...` is treated as an ordinary comment.
- After `go:generate` there must be exactly one space or tab, then the command.

Anything else — leading whitespace, leading text, `// //go:generate`, indented under another comment — is silently ignored. There is no error, no warning. This is the single most common reason a directive "does not fire".

Blank lines and other comments between directives are fine; each directive is independent.

---

## 4. Environment injection

Before `exec.Command` runs the generator, the Go tool sets these variables on the child process:

| Variable | Source |
|----------|--------|
| `$GOARCH`, `$GOOS` | From the build context |
| `$GOFILE` | Base name of the file holding the directive |
| `$GOLINE` | 1-based line number of the directive |
| `$GOPACKAGE` | Package name parsed from the file |
| `$GOROOT` | Active `GOROOT` |
| `$DOLLAR` | Literal `$` — used to emit `$` in shell-quoted args |
| `$PATH`, `$HOME`, etc. | Inherited from the calling environment |

Variable substitution is done by `go generate` itself **before** `exec.Command` is called. The expansion rule is a small substitutor: `$VAR` and `${VAR}` are replaced; unknown variables become empty strings. Notably, the **shell is not involved** — there is no globbing, no pipe handling, no `&&`. If you need shell features, write `bash -c '...'` explicitly.

---

## 5. Execution model

For each directive:

1. The line is split into argv after variable expansion. Quoting follows Go's `strconv.Unquote` rules: `"a b"` and `'x'` are one argument each.
2. `exec.Command(argv[0], argv[1:]...)` is constructed.
3. The child's `Dir` is set to the **directory of the source file**, not the user's CWD.
4. Stdin is `/dev/null`, stdout and stderr are forwarded.
5. The child is run synchronously. A non-zero exit aborts the whole `go generate` run unless `-keep-going` semantics are arranged externally (the tool itself stops on first error).

Directives in one file run sequentially in source order. Directives across packages run in package order; there is no parallelism.

---

## 6. `-x`, `-n`, `-v`, `-run`

```bash
go generate -n ./...        # print commands, do not execute (dry run)
go generate -x ./...        # print each command before executing
go generate -v ./...        # print package names as scanned
go generate -run=regex ./...# only execute directives whose command line matches
```

`-x` is the closest equivalent of `bash -x`: it prints the resolved command line, post-variable-expansion, exactly as it will run. Pair `-n` and `-x` while debugging a directive you suspect is wrong.

`-run` matches the regex against the **full command line of the directive** (program + args), not the file path or package. `-run=stringer` will catch `go run .../stringer ...` as well as a bare `stringer`.

---

## 7. The `go.mod` `tool` directive (Go 1.24+)

Before Go 1.24 the canonical way to track a generator was a `tools.go` file with a `//go:build tools` tag and blank imports:

```go
//go:build tools
package tools
import _ "golang.org/x/tools/cmd/stringer"
```

Go 1.24 introduces a `tool` directive in `go.mod`:

```
module example.com/app

go 1.24
tool golang.org/x/tools/cmd/stringer
```

You can then invoke it as `go tool stringer ...` and `go.mod` records the exact version. In a directive:

```go
//go:generate go tool stringer -type=State
```

This replaces the older `go run pkg@vX.Y.Z` pattern for projects that prefer their generator set to live in `go.mod`. Both styles remain valid; the `tool` directive is cleaner for repos with many generators, the inline `@vX.Y.Z` form is cleaner for a one-off directive.

---

## 8. Security boundary

`go generate` runs whatever you tell it to with the privileges of the calling user. The risks are real:

- `go generate ./...` on an untrusted checkout executes every directive in every file. A directive that runs `curl ... | sh` will do exactly that.
- `go run pkg@vX.Y.Z` downloads code from a proxy and runs it. Pinning a version mitigates supply-chain risk somewhat, but the binary still executes locally.
- The module checksum database (`GOSUMDB`) protects against tampering at the proxy, not against malicious-but-published modules.

Practices that hold up: review untrusted repos before generating in them; pin every generator; rely on `GOPROXY` policy and `go.sum` rather than ad hoc downloads; never generate as root.

---

## 9. Interaction with formatting and `//line` directives

Generators are expected to produce gofmt-clean output. The standard pattern is to build a buffer, run `go/format.Source` on it, then write the file. Skipping the `format.Source` step almost always shows up later as `gofmt` failures in CI.

Generated files often emit `//line filename:lineno` directives so that compile errors point back to the **source schema** (e.g., the `.proto` file) instead of the generated `.go` file. The Go compiler honors these in error messages and debug info; `go vet` and the language server do too.

The `// Code generated <generator> DO NOT EDIT.` header (the regex `^// Code generated .* DO NOT EDIT\.$` matched on one of the first lines) is recognized by `go vet`, several lint suites, and code-review tools. Add it from every generator you write.

---

## 10. Edge cases worth knowing

- **Leading whitespace.** `    //go:generate ...` is ignored. Must start at column 1.
- **Block comments.** `/* go:generate ... */` is ignored. Only `//` line comments are scanned.
- **Doc comment placement.** Directives are not part of doc comments; they can sit anywhere a top-level comment can.
- **Inside function bodies.** Directives in function-internal comments are still detected — the scanner does not care about Go scope, only line position.
- **CRLF line endings.** Recognized correctly; the trailing `\r` is stripped before matching.
- **`go generate` with no package argument.** Runs against the current package only, like `go build`.
- **Aborting on first error.** A failing directive halts the run; later packages are not generated. Plan rollouts so a transient failure doesn't leave half the tree regenerated.

---

## 11. Summary

`go generate` is intentionally a thin loop over a strict regex with a small set of injected environment variables. Everything that feels like magic — pinned versions, deterministic output, gofmt cleanliness, CI verification — is the responsibility of the generator and the team conventions around it. Read `cmd/go/internal/generate/generate.go` once; it will permanently fix your mental model and answer almost every "why doesn't my directive fire" question on its own.

---

## Further reading
- `cmd/go` source — `src/cmd/go/internal/generate/generate.go`
- `go help generate`
- Go blog — Generating code: https://go.dev/blog/generate
- `go.mod` `tool` directive proposal (Go 1.24): https://go.dev/issue/48429
- `go/format` package: https://pkg.go.dev/go/format

# go vet — Specification

> **Focus:** Precise reference for the `go vet` command — synopsis, arguments, standard analyzers, flags, environment, exit behavior, and guarantees.
>
> **Sources:**
> - `go help vet`, `go doc cmd/vet`, `go tool vet help`
> - cmd/go documentation: https://pkg.go.dev/cmd/go
> - `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis

---

## 1. Synopsis

```
go vet [-n] [-x] [-vettool prog] [build flags] [vet flags] [packages]
```

`go vet` runs the standard set of analyzers (or those provided by `-vettool`) over the named packages and prints diagnostics. It does not execute the code. Exit code is non-zero if any diagnostic is reported.

---

## 2. Argument forms

| Form | Meaning |
|------|---------|
| `./...` | Every package in the current module |
| `.` | The current package |
| `./pkg/x/...` | A subtree |
| `example.com/m/pkg` | A specific package by import path |
| (no argument) | Equivalent to `.` |

Like other `go` commands, vet operates on **packages**, not files. There is no "vet this one file" form (use `go tool vet file.go` for a single-file run).

---

## 3. Standard analyzers (default vet set)

| Analyzer | One-line description |
|----------|----------------------|
| `asmdecl` | Mismatches between assembly files and Go declarations |
| `assign` | Useless self-assignments (`x = x`) |
| `atomic` | Misuse of `sync/atomic` (e.g., assigning the result of an Add) |
| `bools` | Suspicious boolean operations (`x && !x`) |
| `buildtag` | Malformed `//go:build` / `// +build` constraints |
| `cgocall` | Mishandled cgo pointer passing |
| `composites` | Composite literals with unkeyed fields in imported types |
| `copylocks` | Locks (e.g., `sync.Mutex`) passed by value |
| `directive` | Misplaced or unknown `//go:` directives |
| `errorsas` | `errors.As` second argument must be a non-nil pointer |
| `framepointer` | Assembly that breaks frame-pointer assumptions |
| `httpresponse` | Using `resp` before checking `err` from `http.Get` etc. |
| `ifaceassert` | Impossible interface type assertions |
| `loopclosure` | Capturing the loop variable in a goroutine (pre-Go 1.22 trap) |
| `lostcancel` | `cancel` from `context.WithCancel` not invoked on all paths |
| `nilfunc` | Comparing a function to nil with a constant result |
| `printf` | Format-verb / argument-type mismatches in printf-like calls |
| `shift` | Shifts that exceed the width of the integer type |
| `sigchanyzer` | Unbuffered channel passed to `signal.Notify` |
| `slog` | Misuse of `log/slog` (key/value pairing issues) |
| `stdmethods` | Methods on stdlib interfaces with wrong signatures |
| `stringintconv` | `string(int)` (almost always wrong; use `strconv.Itoa`) |
| `structtag` | Malformed struct tags |
| `testinggoroutine` | `t.Fatal` etc. called from a goroutine other than the test |
| `tests` | Malformed test/benchmark/example function signatures |
| `timeformat` | Use of mis-ordered date layout (`2006-02-01` etc.) |
| `unmarshal` | Passing a non-pointer to `json.Unmarshal` etc. |
| `unreachable` | Statements that can never execute |
| `unsafeptr` | Invalid `uintptr ↔ unsafe.Pointer` conversions |
| `unusedresult` | Discarding the result of certain pure functions (`fmt.Errorf`, `errors.New`) |

`shadow` exists but is **off by default**. Enable via `go vet -vettool=$(which shadow) ./...` or by registering it in a custom `unitchecker`.

Run `go tool vet help` for the authoritative list installed with your toolchain, and `go tool vet help <name>` for detailed flags.

---

## 4. Vet-specific flags

| Flag | Effect |
|------|--------|
| `-vettool prog` | Run the external analyzer binary `prog` (built with `unitchecker.Main`) instead of the standard vet set |
| `-NAME` (boolean) | Enable analyzer `NAME` (e.g., `-printf=true`) |
| `-NAME=false` | Disable analyzer `NAME` |
| `-NAME.FLAG` | Pass an analyzer-specific flag (e.g., `-printf.funcs=` to register custom printf-like functions) |
| `-json` | Emit diagnostics as JSON for machine consumption |
| `-c=N` | Print N lines of source context around each diagnostic |

Build flags (`-tags`, `-mod`, `-trimpath`, `-race` for build-tag determination, etc.) are also accepted and influence package loading.

---

## 5. Interaction with `go test`

`go test` runs a **defensive subset** of vet before executing tests. Controlled via:

```
go test [-vet list] packages
```

| Value | Meaning |
|-------|---------|
| `-vet=off` | Skip vet entirely |
| `-vet=all` | Run the full vet set (same as `go vet`) |
| `-vet=a,b,c` | Run only the named analyzers |
| (default) | A vetted-for-tests subset (varies by Go version): typically `atomic`, `bools`, `buildtag`, `directive`, `errorsas`, `ifaceassert`, `nilfunc`, `printf`, `stringintconv` |

If a diagnostic fires, the package is reported as `FAIL pkg [vet]` and the test binary is not run.

---

## 6. Environment variables

| Variable | Role |
|----------|------|
| `GOCACHE` | Build cache reused for vet results and exported facts |
| `GOFLAGS` | Default flags applied to every `go` command, including `vet` |
| `GOOS`, `GOARCH` | Target platform (affects which files vet sees) |
| `CGO_ENABLED` | Affects which files are included via build constraints |
| `GOTMPDIR` | Where vet's temporary work files live |
| `GOMAXPROCS` | Default `-p` parallelism derived from CPU count |
| `GOROOT`, `GOPATH`, `GOMODCACHE` | Package resolution |

---

## 7. Exit codes and behavior

| Situation | Exit behavior |
|-----------|---------------|
| No diagnostics reported | Exit 0 |
| One or more diagnostics reported | Exit non-zero (typically 1) |
| Package loading/typecheck error | Exit non-zero with the error on stderr (vet cannot analyze code that does not typecheck) |
| `-vettool` binary fails to start or speak the protocol | Exit non-zero with diagnostic about the tool |

Diagnostics are printed to stderr in the form `file:line:col: message`.

---

## 8. Behavioral guarantees

- **Zero false positives (design contract).** The standard vet set only reports issues with high confidence. Analyzers that produce occasional false positives are rejected from the standard set on purpose; they belong in opt-in linters.
- **No execution.** Vet never runs your code; it operates on parsed/typechecked AST (and SSA for some analyzers).
- **Cache-coherent.** Vet results are cached in `GOCACHE` keyed by source content, dependency facts, analyzer identity, and flags. Unchanged inputs → cache hit.
- **Cross-package via Facts.** Analyzers export gob-encoded `Fact`s that propagate up the import graph (e.g., `printf` knows about user-defined formatter functions in other packages).
- **Composes with `go test`.** A defensive subset runs inside `go test` by default; configurable via `-vet`.

---

## 9. Non-goals / limitations

- **Not a linter.** Vet does not flag style, naming, complexity, or "likely improvements." Use `staticcheck`, `revive`, or `golangci-lint` for those.
- **Not a security scanner.** Use `gosec` and `govulncheck` for security and dependency CVEs.
- **Not exhaustive.** Vet catches a curated set of bugs; many real bugs (logic errors, race conditions outside `loopclosure`/`copylocks`) require tests or other tools.
- **Does not analyze code that fails to typecheck.** Fix compilation errors first.
- **Cannot rewrite code.** Diagnostics may include suggested fixes (in `-json` output) for tools like `gopls`, but `go vet` itself does not apply them.

---

## 10. Related references

- `go help vet`, `go tool vet help`
- `cmd/vet` source: https://github.com/golang/go/tree/master/src/cmd/vet
- `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis
- `unitchecker` (write a `-vettool`-compatible binary): https://pkg.go.dev/golang.org/x/tools/go/analysis/unitchecker
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching

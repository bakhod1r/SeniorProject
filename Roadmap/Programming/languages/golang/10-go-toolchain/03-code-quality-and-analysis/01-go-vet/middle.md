# go vet — Middle

## 1. What `go vet` really is

`go vet` is a **driver** that runs a fixed set of small analyzers against your packages and prints diagnostics. Each analyzer is a self-contained check (printf, shadow, structtag, ...). The driver typechecks your code, hands the typed AST to each analyzer, and collects the results.

It piggybacks on the build cache: vetting an unchanged package reuses cached analyzer results, so `go vet ./...` on a warm cache is nearly free.

---

## 2. The built-in analyzers

The standard set (run by default) includes:

| Analyzer | What it checks |
|----------|----------------|
| `printf` | Format verb vs argument type mismatches in printf-like functions |
| `shadow` | A declared variable hides an identically named outer one (opt-in) |
| `unreachable` | Statements that can never execute |
| `structtag` | Struct tags must follow `key:"value"` syntax |
| `nilfunc` | `f == nil` where `f` is a function and result is constant |
| `assign` | Useless `x = x` self-assignment |
| `lostcancel` | `cancel` from `context.WithCancel` is never called on some path |
| `httpresponse` | Deferring `resp.Body.Close()` before checking `err` from `http.Get` |
| `copylocks` | Passing or copying a struct that contains a `sync.Mutex` by value |
| `bools` | Suspicious boolean operations (`x && !x`, `x || x`) |
| `composites` | Composite literals without field names in cross-package types |
| `errorsas` | `errors.As` second argument must be a non-nil pointer |
| `loopclosure` | Capturing the loop variable in a goroutine (pre-Go 1.22 trap) |
| `unsafeptr` | Invalid `uintptr ↔ unsafe.Pointer` conversions |
| `tests` | Malformed test function signatures (e.g., `TestFoo(t *testing.B)`) |
| `unmarshal` | Passing a non-pointer to `json.Unmarshal` |
| `stringintconv` | `string(int)` (almost always a bug; want `strconv.Itoa`) |
| `framepointer` | Assembly that violates frame pointer rules |
| `cgocall` | Mishandled cgo pointer passing |

See the full list and one-liner descriptions: `go tool vet help` and `go doc cmd/vet`.

---

## 3. Enabling/disabling specific analyzers

Each analyzer has a boolean flag with its name. By default they are on; opt out per-analyzer:

```bash
go vet -printf=false ./...        # skip printf checks
go vet -shadow=true  ./...        # enable shadow explicitly (off by default in stdlib vet)
go vet -copylocks=false ./...
```

To run **only one** analyzer with everything else off, query `go tool vet`:

```bash
go tool vet -printf=true -all=false ./...
```

(`-all` is not a standard `go vet` flag — for fine control use `go tool vet` directly or a `vettool` plugin; see below.)

To skip vet entirely during a test:

```bash
go test -vet=off ./...
```

To pick a non-default subset for `go test` only:

```bash
go test -vet=printf,shadow ./...
go test -vet=all ./...
```

---

## 4. `-vettool`: plug in external analyzers

`go vet` can run an **external** vet-style tool with the same plumbing:

```bash
go vet -vettool=$(which shadow) ./...
go vet -vettool=$(which fieldalignment) ./...
```

Any binary built from `golang.org/x/tools/go/analysis/singlechecker` or `multichecker` is a valid `vettool`. The tool you point to defines its own analyzers; `go vet` handles package loading, caching, and reporting. This is how teams add checks like `fieldalignment`, `nilness`, or domain-specific custom analyzers without rolling their own driver.

---

## 5. `go test` runs vet automatically

`go test` runs a **defensive subset** of vet before executing the tests. The default `test` set is roughly: `atomic, bool, buildtags, directive, errorsas, ifaceassert, nilfunc, printf, stringintconv` (varies by Go version). These are the checks the team considered cheap and high-signal during testing.

If vet finds a problem, the package is marked `[vet]` and the tests do not run:

```bash
$ go test ./...
./svc_test.go:31:3: Errorf format %d has arg s of wrong type string
FAIL    example.com/svc [vet]
```

Options:

```bash
go test -vet=off ./...                  # skip vet entirely
go test -vet=all ./...                  # run the full vet set, not just defaults
go test -vet=printf,shadow ./...        # pick exactly which analyzers
```

For CI it is common to use `go test -vet=all ./...` so unit tests double as a thorough vet pass.

---

## 6. Exit codes and CI integration

`go vet` exits **non-zero** if any diagnostic is reported (and only then). No diagnostics → exit 0. This makes it trivial to wire into CI:

```yaml
# GitHub Actions snippet
- name: Vet
  run: go vet ./...
```

```makefile
.PHONY: vet
vet:
	go vet ./...
```

Pair it with `go build ./...` and `go test ./...` as the three gating commands. Vet runs in milliseconds on a warm cache, so it is cheap to keep required.

If you want vet to *warn but not fail*, capture output and process it manually — but the default behavior (fail on any diagnostic) is the recommended posture.

---

## 7. What vet is conservative about

A few examples of where vet stays silent on purpose:

- `printf` does not check arbitrary user-defined formatters unless they are recognized as printf-like (use `// +build vet` style annotations via `go vet -printf -funcs=...`).
- `shadow` only fires on declarations that hide outer ones; it is off by default in the stock vet because the patterns are sometimes intentional.
- `composites` ignores types within your own module unless explicitly enabled.

The unifying rule: vet only fires when it is sure. The price is missed bugs; the benefit is no false positives.

---

## 8. Trade-offs summary

| Concern | `go vet` | Heavier linter (e.g., `staticcheck`) |
|---------|----------|--------------------------------------|
| Bundled with Go | Yes | No |
| False positives | ~0 | Few |
| Coverage | Narrow (true bugs) | Wide (bugs + style + perf) |
| Speed | Very fast (uses build cache) | Slower |
| Required in CI by default | Often via `go test` | Opt-in |

---

## 9. Summary

`go vet` runs a curated set of high-confidence analyzers via a driver that shares the build cache. You can enable/disable individual analyzers with per-name boolean flags, plug in third-party tools via `-vettool=...`, and run `go test -vet=…` to control the subset `go test` invokes automatically. Exit code is non-zero on any diagnostic, which makes vet a one-line CI gate. Treat it as the always-on baseline and add `staticcheck`/`golangci-lint` on top for broader coverage.

---

## Further reading
- `go help vet`, `go doc cmd/vet`
- `go tool vet help` (full analyzer list and flags)
- `golang.org/x/tools/go/analysis`: https://pkg.go.dev/golang.org/x/tools/go/analysis

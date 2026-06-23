# go generate — Specification

> **Focus:** Precise reference for the `go generate` command — synopsis, directive syntax, flags, environment, discovery, and execution semantics.
>
> **Sources:**
> - `go help generate`
> - cmd/go documentation: https://pkg.go.dev/cmd/go#hdr-Generate_Go_files_by_processing_source
> - cmd/go source: `src/cmd/go/internal/generate/generate.go`

---

## 1. Synopsis

```
go generate [-run regexp] [-n] [-v] [-x] [build flags] [file.go... | packages]
```

`go generate` scans Go source files in the named packages (or file list) for `//go:generate` directives and executes each directive as an external command. It does not compile Go code itself and is **not** invoked by `go build` or `go test`.

---

## 2. Directive syntax

```
//go:generate command argument...
```

Exact rules:

- The directive must appear in a `//` line comment (not `/* */`).
- The literal prefix is `//go:generate` — **no space** between `//` and `go:generate`.
- The comment must start at column 1 — **no leading whitespace** before `//`.
- Exactly one space or tab follows `go:generate`; the rest of the line is the command.
- The directive is parsed line by line; blank lines and other comments between directives are ignored.
- Directives may appear anywhere in a Go file (top level, inside a function body comment, etc.).

Violations (leading space, leading whitespace, block comment form) are silently ignored — no warning, no error.

---

## 3. Flags

| Flag | Effect |
|------|--------|
| `-run regexp` | Execute only directives whose **full command line** matches the regex (substring match unless anchored) |
| `-n` | Print the commands that would be executed but do not run them (dry run) |
| `-x` | Print each command before executing it, with env variables already expanded |
| `-v` | Print the names of packages and files as they are scanned |
| `-skip regexp` | Skip directives whose command line matches the regex (Go 1.22+) |

Standard build flags (`-tags`, `-mod=...`, etc.) also affect discovery because they control which files the build context includes.

---

## 4. Environment variables injected into the generator

Before each `exec.Command`, `go generate` sets the following variables on the child process. Substitution into the directive line is done by `go generate` itself using `$VAR` and `${VAR}` syntax; unknown variables expand to the empty string.

| Variable | Value |
|----------|-------|
| `$GOARCH` | Target architecture (`amd64`, `arm64`, ...) |
| `$GOOS` | Target operating system |
| `$GOFILE` | Base name of the source file containing the directive |
| `$GOLINE` | 1-based line number of the directive in `$GOFILE` |
| `$GOPACKAGE` | Package name parsed from the file |
| `$GOROOT` | Active `GOROOT` |
| `$DOLLAR` | A literal `$` character (workaround because `$` is special) |
| Other env vars | `$PATH`, `$HOME`, etc. are inherited from the parent process |

The shell is **not** invoked. Directives are split into argv using `strconv.Unquote`-style quoting; pipes, redirections, and shell operators are not honored unless you explicitly invoke `sh -c '...'`.

---

## 5. Discovery rules

For each package in the argument set, `go generate`:

1. Resolves the package via the build context (`GOOS`, `GOARCH`, build tags, `-tags` flag).
2. Enumerates source files **included by the current build constraints**:
   - Files filtered out by `//go:build` lines are skipped.
   - Files filtered out by `_GOOS.go` / `_GOARCH.go` / `_GOOS_GOARCH.go` filename suffixes are skipped.
   - `_test.go` files are scanned.
3. Reads each surviving file line by line, matching the directive regex.
4. Executes matched directives in **source order within a file**, and files in deterministic order within a package.

Packages are processed sequentially; there is no built-in parallelism.

---

## 6. Execution semantics

| Concern | Behavior |
|---------|----------|
| Working directory | Directory of the source file containing the directive (not the caller's CWD) |
| Stdin | `/dev/null` |
| Stdout / stderr | Forwarded to `go generate`'s stdout/stderr |
| Signals | Propagated to the child |
| Variable expansion | Done by `go generate` before `exec.Command`; `$VAR` and `${VAR}` are substituted |
| Argv splitting | Whitespace-separated; quoted strings (`"..."`, `'...'`) are one argument |
| On non-zero exit | `go generate` aborts the whole run; remaining directives and packages are not processed |
| Exit code | `0` if all directives succeeded, non-zero otherwise |
| Cache | None — every directive runs every time |

There is no parallel execution and no incremental skipping. Reproducibility depends entirely on the generator producing deterministic output for the same inputs.

---

## 7. Interaction with `go build` and `go test`

`go generate` is **not** invoked by any other `go` subcommand. Generated files exist in the source tree only because someone ran `go generate` and committed the output. The standard contract:

1. The schema (e.g., `.proto`, `.sql`) is the source of truth.
2. Generated files are committed alongside the schema.
3. CI runs `go generate ./... && git diff --exit-code` to verify the committed artifact matches the schema under the pinned generator version.

`go build` compiles whatever `.go` files exist; it neither runs generators nor verifies them.

---

## 8. Module mode interaction

In module-aware mode (the default in Go 1.16+):

- `go run pkg@version` inside a directive resolves and fetches the tool via the module proxy, populates the module cache (`$GOPATH/pkg/mod`), and runs it. The current module's `go.mod` is **not** modified.
- A `tools.go` file with `//go:build tools` and blank imports can pin tool versions through the project's `go.mod` requirements.
- Go 1.24+ introduces the `tool` directive in `go.mod`; tools listed there are invoked via `go tool <name>` and tracked as first-class dependencies.

`$GOPROXY`, `$GOSUMDB`, and `go.sum` apply to `go run pkg@version` exactly as they do to ordinary module resolution.

---

## 9. Generated file conventions (community standard, not enforced by `go generate`)

| Convention | Purpose |
|------------|---------|
| Header `// Code generated <by> DO NOT EDIT.` on a line near the top | Marks the file as generated for `go vet`, linters, and code-review tools |
| Filename suffix `_gen.go`, `_string.go`, `.pb.go` | Visible signal in directory listings and diffs |
| `//line filename:lineno` directives | Map compile errors back to the schema source |
| gofmt-clean output | Required to pass standard CI lint steps |
| Deterministic output (sorted maps, no timestamps) | Required for `git diff --exit-code` verification |

These are conventions; `go generate` itself does not check them. The generator's author is responsible.

---

## 10. Exit behavior summary

| Situation | Exit |
|-----------|------|
| All directives succeed | `0` |
| A directive exits non-zero | Non-zero; remaining directives and packages are not processed |
| Directive regex unmatched (`-run=foo` with no matches) | `0` |
| No directives in any scanned file | `0` |
| Bad package pattern / unresolved import | Non-zero, with the usual `go` resolution error |

---

## 11. Non-goals / limitations

- Not a build step (not invoked by `go build` / `go test`).
- No incremental or cache layer of its own — every directive re-runs.
- No parallelism across packages.
- No shell — pipes and redirections require an explicit `sh -c '...'`.
- No introspection of generator output — `go generate` does not validate, format, or verify what the generator wrote.

---

## 12. Related references
- `go help generate`
- cmd/go: https://pkg.go.dev/cmd/go#hdr-Generate_Go_files_by_processing_source
- Go blog — Generating code: https://go.dev/blog/generate
- `go.mod` tool directive (Go 1.24): https://go.dev/issue/48429
- Generated file convention (`Code generated ... DO NOT EDIT.`): https://pkg.go.dev/cmd/go#hdr-Generated_code

# go generate — Find the Bug

Each scenario shows a directive or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Directive looks correct but never fires

```go
// go:generate stringer -type=Color
type Color int
```

```bash
$ go generate ./...
$ ls color_string.go
ls: color_string.go: No such file or directory
```

**Bug:** there is a space between `//` and `go:generate`. The Go tool requires the literal prefix `//go:generate`; anything else is treated as an ordinary comment and silently skipped.
**Fix:** remove the space — `//go:generate stringer -type=Color`. Same applies to leading whitespace before the `//`: the directive must start at column 1.

---

## Bug 2 — Works on your machine, breaks on the teammate's

```go
//go:generate stringer -type=State
```

```bash
$ go generate ./...
generate: stringer: executable file not found in $PATH
```

**Bug:** `stringer` is expected to be pre-installed globally, so the directive fails on any machine that never ran `go install golang.org/x/tools/cmd/stringer@...`.
**Fix:** invoke the tool through `go run` with a pinned version so the module cache fetches it on demand:
`//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=State`.

---

## Bug 3 — CI passes one day, fails the next, no code changed

```go
//go:generate go run golang.org/x/tools/cmd/stringer@latest -type=State
```

**Bug:** `@latest` resolves to whatever module version is newest at run time. A new `stringer` release can change formatting or behavior; the regenerated file then differs from what was committed and `git diff --exit-code` in CI fails.
**Fix:** pin a specific version: `@v0.24.0`. Bump it deliberately, with a commit that includes both the version change and the regenerated diff.

---

## Bug 4 — `protoc` cannot find the `.proto` file

```bash
$ pwd
/Users/me/repo
$ go generate ./api/v1/...
api/v1/user.proto: No such file or directory
```

The directive reads:

```go
//go:generate protoc -I=. --go_out=. user.proto
```

A developer assumes the working directory of the generator is the repo root (where they ran `go generate`).
**Bug:** the generator's CWD is the **source file's directory**, not the shell's CWD. From `api/v1/`, the relative path `user.proto` resolves correctly, but if the developer then adds `-I=/some/abs/repo/api/v1` thinking they must, they double-bind to the wrong path.
**Fix:** trust the per-file CWD. Keep paths in the directive relative to the source file. If you need a cross-package include path, use `$GOROOT`/`$GOPATH`-style absolutes or pre-compute them in a Makefile target.

---

## Bug 5 — Directive sits inside a never-active file

```go
//go:build windows
package mypkg

//go:generate go run ./cmd/gen -name=Foo
```

```bash
$ go generate ./...       # on macOS
# nothing happens, no error
```

**Bug:** the file is filtered out by the `//go:build windows` constraint on a non-Windows host, so the scanner never sees the directive.
**Fix:** move the directive into a constraint-free file (e.g., `generate.go` with no `//go:build` line), or generate explicitly with the matching environment: `GOOS=windows go generate ./...`. The first option is preferable when the generated code is portable.

---

## Bug 6 — Hand-edited generated file gets wiped

```go
// color_string.go (a developer added a special case here)
func (c Color) String() string {
    if c == Special { return "VERY SPECIAL" }   // hand-added
    // ... generated body ...
}
```

```bash
$ go generate ./...
# the hand-added line vanishes
```

**Bug:** the file is generated and overwritten on every run. The `// Code generated ... DO NOT EDIT.` header was a warning, not a suggestion.
**Fix:** put custom logic in a sibling file (e.g., `color_extra.go`) that wraps or shadows the generated `String()` (Go does not allow two methods with the same name, so define a different method or move the customization to the consumer side). Never edit a `_string.go`, `_gen.go`, or `.pb.go` file.

---

## Bug 7 — Regenerated output differs run-to-run

```go
// inside the custom generator
for name, val := range symbols {
    fmt.Fprintf(&buf, "const %s = %d\n", name, val)
}
```

```bash
$ go generate ./...
$ go generate ./...
$ git diff
- const Foo = 1
- const Bar = 2
+ const Bar = 2
+ const Foo = 1
```

**Bug:** Go map iteration order is intentionally randomized. The generator emits constants in a non-deterministic order, so every other CI run trips `git diff --exit-code`.
**Fix:** collect keys, sort them, then iterate:

```go
keys := make([]string, 0, len(symbols))
for k := range symbols { keys = append(keys, k) }
sort.Strings(keys)
for _, k := range keys { fmt.Fprintf(&buf, "const %s = %d\n", k, symbols[k]) }
```

Same rule applies to time stamps, random IDs, and PID-derived values: do not emit them.

---

## Bug 8 — `$GOFILE` does not contain what you expect

```go
//go:generate sh -c "cp $GOFILE /tmp/backup.go"
```

The developer expected an absolute path. The script silently copies into `/tmp` from the source directory's relative file.
**Bug:** `$GOFILE` is the **base name** of the source file (e.g., `color.go`), not an absolute path. The `cp` works only because the generator's CWD is the source directory and the relative path happens to resolve.
**Fix:** if you need an absolute path, compose it inside the generator using `pwd` (the generator's CWD is the source dir): `sh -c 'cp "$PWD/$GOFILE" /tmp/backup.go'`.

---

## Bug 9 — Generated file fails `gofmt -l` in CI

```go
// inside the custom generator
buf.WriteString("package foo\n\nfunc x() {return}\n")
os.WriteFile("x_gen.go", buf.Bytes(), 0o644)
```

```bash
$ gofmt -l ./...
x_gen.go
```

**Bug:** the generator writes raw bytes without running them through `go/format.Source`. Even minor whitespace deviations from gofmt rules fail the lint step.
**Fix:** always format before writing:

```go
out, err := format.Source(buf.Bytes())
if err != nil { log.Fatalf("format: %v\nraw:\n%s", err, buf.String()) }
os.WriteFile("x_gen.go", out, 0o644)
```

Printing the raw output on error helps diagnose syntactically invalid generation (a missing brace, an unbalanced paren).

---

## Bug 10 — Generated file is treated as hand-written by linters

A new contributor runs `golangci-lint` and gets dozens of warnings inside `user.pb.go`.

**Bug:** the file is generated, but its header is `// Generated by protoc...` (missing the magic phrase). Linters and `go vet` look for `// Code generated <anything> DO NOT EDIT.` to exempt the file; without the exact form, they treat it as ordinary code.
**Fix:** ensure every generator emits the canonical header as the first or second line:

```
// Code generated by protoc-gen-go. DO NOT EDIT.
```

For tools you do not control, configure the linter to also recognize the file by name/path. The header is the standard, conventional contract.

---

## How to approach these
1. Directive ignored? → check the literal prefix `//go:generate` (no space, no leading whitespace, no block comment).
2. Tool not found? → switch to `go run pkg@version`.
3. CI flaky? → pin versions, never `@latest`.
4. Path errors? → remember CWD is the source file's directory.
5. Directive invisible? → check the file's build constraints against the current environment.
6. Hand-edits lost? → put customizations outside generated files.
7. Diff churn run-to-run? → sort everything, omit timestamps.
8. `gofmt` failures? → always run `format.Source` before writing.
9. Lint noise on generated code? → emit the canonical `Code generated ... DO NOT EDIT.` header.

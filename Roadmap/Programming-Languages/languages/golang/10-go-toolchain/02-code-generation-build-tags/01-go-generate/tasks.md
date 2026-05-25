# go generate — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ (Task 8 mentions Go 1.24 specifically).

---

## Task 1: First directive

Create a package with a small `Color int` enum and a `stringer` directive pinned to a specific version.

```go
package main

//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color
type Color int

const (
    Red Color = iota
    Green
    Blue
)

func main() {
    println(Red.String())
}
```

**Acceptance criteria**
- [ ] `go generate ./...` runs without error.
- [ ] A new file `color_string.go` appears in the directory.
- [ ] `go run .` prints `Red`.
- [ ] `go.mod` is unchanged afterwards (`git diff go.mod` is empty).

---

## Task 2: Fix a missing-tool failure

Change the directive to use a bare `stringer` (as if it were installed globally):

```go
//go:generate stringer -type=Color
```

Confirm the failure on a fresh shell (one where `stringer` is not on `PATH`), then restore the `go run ...@version` form.

**Acceptance criteria**
- [ ] You reproduce an error like `stringer: executable file not found in $PATH`.
- [ ] You explain in one sentence why the `go run` form makes the directive portable.
- [ ] The fix uses a pinned version, not `@latest`.

---

## Task 3: Write a tiny custom generator

Add `cmd/gen/main.go` that reads its `-name` flag and writes a `_gen.go` file in the working directory containing a single constant. Use `go/format.Source` to gofmt the output and emit the `// Code generated ... DO NOT EDIT.` header.

In your package, add:

```go
//go:generate go run ./cmd/gen -name=Build
```

**Acceptance criteria**
- [ ] `go generate ./...` produces a `build_gen.go` file with the header.
- [ ] The file passes `gofmt -l` (no output means clean).
- [ ] Running `go generate` twice in a row produces a byte-identical file (`git diff --exit-code` clean after the second run).

---

## Task 4: Use `$GOFILE`, `$GOPACKAGE`, `$GOLINE`

Add this directive to any file:

```go
//go:generate sh -c "echo file=$GOFILE pkg=$GOPACKAGE line=$GOLINE"
```

Run `go generate -x ./...` and observe both the resolved command and the printed line.

**Acceptance criteria**
- [ ] `-x` prints the command with the variables already expanded.
- [ ] The output `file=...` matches the actual source filename.
- [ ] `line=...` equals the line number of the directive (1-based).
- [ ] You can describe in one sentence when a generator like `stringer` uses `$GOFILE` automatically.

---

## Task 5: Filter directives with `-run`

Add a second, slow-ish directive (e.g., a `sleep 2`) next to your `stringer` directive. Use `-run` to invoke only one of them.

```go
//go:generate go run golang.org/x/tools/cmd/stringer@v0.24.0 -type=Color
//go:generate sh -c "sleep 2 && echo slow"
```

**Acceptance criteria**
- [ ] `go generate -run="stringer" ./...` completes in well under 2 seconds.
- [ ] `go generate -run="slow" ./...` runs the second directive only.
- [ ] You can show that `-run` matches against the full directive command line, not the file path.

---

## Task 6: CI verification

Add a CI step (or a local script that mimics one) that runs `go generate ./...` and fails if anything changed.

```bash
go generate ./...
git diff --exit-code
```

Deliberately edit `color_string.go` by hand (e.g., change a string literal), then rerun the script to confirm it fails.

**Acceptance criteria**
- [ ] The script exits 0 on a clean tree.
- [ ] After hand-editing a generated file, the script exits non-zero.
- [ ] After regenerating, the script exits 0 again.
- [ ] You can explain why this check guards against forgotten regenerations after schema changes.

---

## Task 7: Cross-platform constraint pitfall

Create a file `gen_linux.go` containing a directive, and a sibling `gen_darwin.go` with a different one. Run `go generate ./...` on your host OS and observe which directive fired.

```go
// gen_linux.go
//go:build linux
package mypkg
//go:generate sh -c "echo linux directive"
```

```go
// gen_darwin.go
//go:build darwin
package mypkg
//go:generate sh -c "echo darwin directive"
```

**Acceptance criteria**
- [ ] On your host OS only the matching directive runs.
- [ ] `GOOS=linux go generate ./...` (no execution needed in the generator, just `echo`) runs the Linux directive on a non-Linux host.
- [ ] You can explain why a directive in a file behind a never-satisfied build constraint is effectively invisible.

---

## Task 8: Deterministic output

Modify the generator from Task 3 to walk a `map[string]int` and emit one constant per entry. First version: iterate the map directly. Second version: collect keys into a slice, `sort.Strings(keys)`, then iterate. Run `go generate ./...` ten times in a row.

**Acceptance criteria**
- [ ] First version: at least two of the ten runs produce a different file (`git diff` is non-empty between runs).
- [ ] Second version: all ten runs produce byte-identical output.
- [ ] You can explain in one sentence why map iteration order breaks the `git diff --exit-code` CI check.

---

## Task 9: Use the Go 1.24 `tool` directive (if on Go 1.24+)

Replace the inline `go run ...@version` for `stringer` with a `tool` directive in `go.mod`, then invoke it via `go tool`.

```
// go.mod
module example.com/app

go 1.24
tool golang.org/x/tools/cmd/stringer
```

```go
//go:generate go tool stringer -type=Color
```

**Acceptance criteria**
- [ ] `go mod tidy` records the tool dependency in `go.mod` / `go.sum`.
- [ ] `go generate ./...` still produces `color_string.go` correctly.
- [ ] You can explain when you would prefer this style over the inline `go run pkg@vX.Y.Z` form (many tools, central pin) and when not (one-off directive).

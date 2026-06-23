# go run — Find the Bug

Each scenario shows a command or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — "undefined" error with multiple files

```bash
$ go run main.go
./main.go:8:9: undefined: helper
```

**Bug:** `helper` is defined in `helper.go`, but `go run main.go` compiles only `main.go`.
**Fix:** run the package, not one file: `go run .` (or list all files: `go run main.go helper.go`).

---

## Bug 2 — Race detector silently does nothing

```bash
go run main.go -race
```

**Bug:** `-race` came after the file, so it is passed to the program as an argument; the build is **not** instrumented.
**Fix:** put build flags before the path: `go run -race main.go` (or `go run -race .`).

---

## Bug 3 — Program can't find its config file

```go
data, err := os.ReadFile("config.yaml") // works from the source dir, fails elsewhere
```

```bash
$ cd /tmp && go run ~/project/cmd/app
open config.yaml: no such file or directory
```

**Bug:** the program's working directory is the **caller's** CWD (`/tmp`), not the source directory. Relative paths resolve against where you invoked `go run`.
**Fix:** pass an absolute path/flag for the config, or `cd` into the right directory first. Do not assume CWD equals source location.

---

## Bug 4 — Dockerfile uses `go run` as entrypoint

```dockerfile
FROM golang:1.23
COPY . .
CMD ["go", "run", "."]
```

**Bug:** every container start recompiles and relinks; the image ships the full toolchain and source, is huge, slow to start, and a larger attack surface.
**Fix:** multi-stage build that compiles a static binary and runs it:

```dockerfile
FROM golang:1.23 AS build
COPY . .
RUN CGO_ENABLED=0 go build -o /app ./cmd/server
FROM gcr.io/distroless/static
COPY --from=build /app /app
ENTRYPOINT ["/app"]
```

---

## Bug 5 — Cross-compiled run fails to execute

```bash
$ GOOS=linux GOARCH=arm64 go run .
exec format error
```

**Bug:** `go run` cross-compiled for linux/arm64 but then tried to execute the foreign binary on the host (e.g., macOS/amd64).
**Fix:** use `go build` for cross-platform output, or provide an `-exec` runner (qemu, wasm exec script) if you really need to run it locally.

---

## Bug 6 — Non-reproducible CI from `@latest`

```bash
go run honnef.co/go/tools/cmd/staticcheck@latest ./...
```

**Bug:** `@latest` resolves to whatever is newest at run time; a new release can change lint results and break CI unexpectedly — builds are not reproducible.
**Fix:** pin a version: `go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...`.

---

## Bug 7 — Edited code but output unchanged

```bash
$ ./app          # ran a previously built binary, not go run
```

**Bug:** the developer expected fresh output but ran a stale `go build` artifact (`./app`) instead of recompiling. (`go run` would have recompiled.)
**Fix:** during iteration use `go run .` (always recompiles) or rebuild before running: `go build -o app && ./app`.

---

## Bug 8 — `go run` "ignores" my go.mod tool version

```bash
go run golang.org/x/tools/cmd/stringer@latest -type=Pin
```

**Bug:** the project pins `stringer` to a specific version in `go.mod`, but `tool@latest` resolves independently and may use a different version, producing inconsistent generated code.
**Fix:** use the exact version your project expects (`@v0.24.0`) or invoke via the project's pinned mechanism (`go.mod` tool directive / Makefile), so local and CI agree.

---

## Bug 9 — Slow inner loop with cgo

```bash
CGO_ENABLED=1 go run .   # relinks via the system linker every iteration → seconds per run
```

**Bug:** cgo forces the slower external linker on every `go run`, making the dev loop sluggish even though no cgo is needed.
**Fix:** set `CGO_ENABLED=0` when you do not use cgo, or build once and rerun the binary during tight iteration.

---

## How to approach these
1. Multiple files? → run the package (`go run .`), not one file.
2. A flag did nothing? → check it is *before* the path.
3. Can't find a file? → CWD is the caller's directory.
4. Slow/huge in production? → never `go run` as an entrypoint.
5. CI flaky? → pin tool versions, never `@latest`.

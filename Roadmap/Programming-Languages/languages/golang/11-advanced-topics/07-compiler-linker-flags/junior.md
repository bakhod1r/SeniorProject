# Compiler & Linker Flags — Junior

## 1. Why flags exist

`go build` knows how to build a Go program out of the box. But sometimes you want to:

- Make the binary smaller.
- Inject a version string.
- Debug a tricky bug.
- See what optimizations the compiler did.
- Build for a different operating system.

Flags let you do all of that. They're passed to `go build` (and most other go subcommands).

---

## 2. The most common: `-ldflags="-s -w"`

```bash
go build -ldflags="-s -w" ./cmd/app
```

`-s` strips the symbol table; `-w` strips debug info (DWARF). Result: ~10–20% smaller binary. Useful for release builds, not for debugging.

---

## 3. Injecting a version string

```go
// in main.go
package main

import "fmt"

var version = "dev"

func main() {
    fmt.Println("version:", version)
}
```

```bash
go build -ldflags="-X main.version=1.2.3" -o app .
./app
# version: 1.2.3
```

The `-X` flag sets a string variable at link time. Used everywhere to embed git commits, build dates, environment names.

---

## 4. Combining

```bash
go build \
  -trimpath \
  -ldflags="-s -w -X main.version=$(git rev-parse --short HEAD)" \
  -o app ./cmd/app
```

Common release-build incantation:

- `-trimpath`: cleans paths from the binary.
- `-s -w`: strips debug info.
- `-X main.version=...`: embeds the version.

---

## 5. Debug builds

```bash
go build -gcflags='all=-N -l' -o app ./cmd/app
delve exec ./app
```

`-N` disables optimizations, `-l` disables inlining. With these, your debugger (delve) can step through code at the source level cleanly. **Don't ship -N/-l binaries to production** — they're slower.

---

## 6. See what's happening: `-x`

```bash
go build -x ./cmd/app 2>&1 | head -30
```

Prints every command `go build` executes. Useful when you're trying to understand the toolchain or debug a strange build failure.

---

## 7. See optimization decisions: `-gcflags='-m'`

```bash
go build -gcflags='-m' ./...
```

Prints what the compiler decided about escapes and inlining for each file:

```
./main.go:10:6: can inline doIt
./main.go:11:9: inlining call to fmt.Println
./main.go:12:6: moved to heap: x
```

`-m=2` is more detailed; `-m=3` is exhaustive.

---

## 8. Build for another platform

```bash
GOOS=linux GOARCH=amd64 go build -o app-linux ./cmd/app
GOOS=windows GOARCH=amd64 go build -o app.exe ./cmd/app
GOOS=darwin GOARCH=arm64 go build -o app-mac ./cmd/app
```

These aren't `-flags` per se — they're environment variables — but they go together with build flags constantly.

---

## 9. `-race`

```bash
go test -race ./...
go build -race -o app ./cmd/app
```

Enables the race detector. Use this in tests and CI. The runtime overhead is 2–20×, so don't ship `-race` binaries.

---

## 10. A few flags worth remembering

| Flag | When |
|------|------|
| `-ldflags="-s -w"` | Release builds |
| `-ldflags="-X pkg.var=val"` | Inject build-time values |
| `-trimpath` | Reproducible builds |
| `-gcflags='all=-N -l'` | Debug builds |
| `-gcflags='-m'` | See escape decisions |
| `-race` | Test/debug for data races |
| `-x` | Show toolchain commands |
| `-pgo=auto` | Profile-guided optimization |

---

## 11. Summary

Flags adjust how `go build` produces a binary: smaller (strip), debuggable (no optimizations), versioned (link-time injection), profiled (PGO), or instrumented (race). Most teams memorize one release-build invocation and one debug-build invocation, and use IDE shortcuts for the rest.

---

## Further reading
- `go help build`
- `go help buildflags`

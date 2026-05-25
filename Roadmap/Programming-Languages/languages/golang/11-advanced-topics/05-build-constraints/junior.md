# Build Constraints — Junior

## 1. What are build constraints?

Build constraints (also called "build tags") are special comments at the top of a Go file that tell the compiler whether to include that file. They let you write code that depends on the operating system, processor, Go version, or any custom flag — without runtime checks.

A typical use: a file that only compiles on Linux.

```go
//go:build linux

package mypkg

// ... Linux-specific code ...
```

If you build this on macOS, the file is skipped entirely.

---

## 2. The new syntax (Go 1.17+)

```go
//go:build linux && amd64

package mypkg
```

Required:

- Starts with `//go:build` (no space before `go`).
- Goes **before** the `package` line.
- Followed by **one blank line** before `package`.

`gofmt` enforces these rules. If you write it wrong, `gofmt` either fixes it or refuses.

---

## 3. The legacy syntax

Older Go used:

```go
// +build linux,amd64

package mypkg
```

Note the space after `//` and the comma instead of `&&`. You may see both in older code:

```go
//go:build linux && amd64
// +build linux,amd64

package mypkg
```

`gofmt` keeps both in sync. For new code, just write `//go:build`.

---

## 4. Common tags

| Tag | Meaning |
|-----|---------|
| `linux`, `darwin`, `windows` | OS name |
| `amd64`, `arm64`, `arm` | CPU architecture |
| `cgo` | cgo is enabled |
| `race` | building with `-race` |
| `go1.21` | building with Go 1.21 or newer |
| `unix` | any unix-like OS |

Combine with `&&`, `||`, `!`:

```go
//go:build (linux || darwin) && !cgo
```

---

## 5. Filename suffixes — implicit constraints

```
fastpath_linux.go        // built only on Linux
fastpath_amd64.go        // built only on amd64
fastpath_linux_amd64.go  // built only on Linux/amd64
fastpath_test.go         // built only for `go test`
```

These filename suffixes work automatically — you don't need a `//go:build` line for them. They're great for cross-platform packages with a small per-OS file.

---

## 6. A complete tiny example

```go
// fast_linux.go
//go:build linux

package fast

func name() string { return "linux" }
```

```go
// fast_other.go
//go:build !linux

package fast

func name() string { return "other" }
```

```go
// main.go
package main

import (
    "fmt"
    "myapp/fast"
)

func main() {
    fmt.Println(fast.name())   // prints "linux" on Linux, "other" elsewhere
}
```

The build picks one of the two files based on `GOOS`.

---

## 7. Custom tags

You can invent your own tags:

```go
//go:build prod

package config

var APIBase = "https://api.example.com"
```

```go
//go:build !prod

package config

var APIBase = "http://localhost:8080"
```

To build with the prod tag:

```bash
go build -tags=prod ./...
```

Useful for environment-specific configuration without runtime checks.

---

## 8. Test-only files

Any file named `*_test.go` is only built when you run `go test`. This is **not** a build tag — it's a convention enforced by the toolchain.

```
mypkg/
  api.go         // always
  api_test.go    // only with `go test`
```

If you find yourself writing helper code "for testing", consider whether it should be in a `_test.go` file.

---

## 9. Common mistakes

| Mistake | Result |
|---------|--------|
| Missing blank line before `package` | Constraint ignored |
| Typo in OS name (e.g., `osx` instead of `darwin`) | File never compiled, no error |
| Putting `//go:build` after the `package` line | Ignored |
| Using both `//go:build` and a mismatched `// +build` | gofmt fixes; if mismatched, behavior is undefined |
| Confusing `darwin` with `macos` | Use `darwin` (Go's tag name) |

If your file isn't being compiled, check `go list -f '{{.IgnoredGoFiles}}' ./...`.

---

## 10. When you'll meet build constraints

- **Cross-platform packages.** A library that wraps OS-specific syscalls.
- **Performance-tuned builds.** A SIMD path on amd64 and a portable path elsewhere.
- **Feature flags at build time.** A `debug` tag that enables verbose logging.
- **Avoiding cgo.** A `!cgo` fallback in pure Go.
- **Gating new language features.** `//go:build go1.21` for code using `slices.SortFunc`.

---

## 11. Summary

Build constraints tell the compiler when to include a file. The modern syntax is `//go:build <expression>` followed by a blank line, before the `package` clause. Common uses are platform selection, cgo on/off, and custom build flags via `-tags=foo`. Filename suffixes (`_linux.go`, `_test.go`) provide automatic constraints without explicit tag lines.

---

## Further reading
- `go help buildconstraint`
- `cmd/go` docs: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- Go 1.17 release notes

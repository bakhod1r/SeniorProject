# go mod — Junior

## 1. What is `go mod`?

`go mod` is the command group that manages your project's **module** — its identity, its dependencies, and their versions. A module is a collection of Go packages defined by a `go.mod` file at its root. `go mod` creates and maintains that file (and its companion `go.sum`).

```bash
go mod init example.com/myapp     # create a new module
go mod tidy                        # fix up dependencies
```

Think of `go mod` as your project's dependency manager — like `package.json` + `npm` rolled into the Go toolchain.

---

## 2. Prerequisites
- Go 1.21+ (`go version`).
- Understanding that imports like `github.com/foo/bar` are external dependencies.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Module** | A versioned collection of packages with a `go.mod` at its root |
| **`go.mod`** | Declares the module path, Go version, and dependency requirements |
| **`go.sum`** | Cryptographic checksums of dependency content (integrity) |
| **Module path** | The import prefix for your module (e.g., `example.com/myapp`) |
| **Dependency** | An external module your code imports |
| **Semantic version** | A version like `v1.4.2` (major.minor.patch) |
| **Direct dependency** | One your code imports directly |
| **Indirect dependency** | A dependency of your dependencies |

---

## 4. Creating a module

Every Go project starts with a module:

```bash
mkdir myapp && cd myapp
go mod init example.com/myapp
```

This writes a minimal `go.mod`:

```
module example.com/myapp

go 1.23
```

The module path (`example.com/myapp`) is the import prefix for your packages and, if you publish it, the location others import it from.

---

## 5. Adding a dependency

Just import it in your code and let the tooling fetch it:

```go
import "github.com/google/uuid"
```

```bash
go mod tidy        # downloads it, adds it to go.mod and go.sum
```

Or add it explicitly:

```bash
go get github.com/google/uuid@latest
```

Either way, `go.mod` gains a `require` line and `go.sum` gains checksums.

---

## 6. The everyday subcommands

```bash
go mod init <path>     # create go.mod
go mod tidy            # add missing + remove unused dependencies (run this often!)
go mod download        # download dependencies into the module cache
go mod verify          # check downloaded deps match go.sum
```

**`go mod tidy` is the one you run most.** It makes `go.mod`/`go.sum` exactly match what your code actually imports — adding what is missing, removing what is unused.

---

## 7. A worked example

```bash
go mod init example.com/demo
```

`main.go`:

```go
package main

import (
	"fmt"

	"github.com/google/uuid"
)

func main() {
	fmt.Println(uuid.New())
}
```

```bash
go mod tidy        # fetches uuid, updates go.mod/go.sum
go run .           # prints a random UUID
```

After `tidy`, `go.mod` lists `github.com/google/uuid` under `require`.

---

## 8. What `go.mod` and `go.sum` are for

- **`go.mod`** — the truth about your module: its path, the Go version, and which dependency versions you require.
- **`go.sum`** — checksums proving each dependency's content has not changed since you first added it. **Commit both files** to version control.

Never edit `go.sum` by hand; the tooling manages it.

---

## 9. Common beginner mistakes

- **Not running `go mod tidy`.** Leftover or missing requires cause confusing build errors.
- **Editing `go.sum` manually.** Let `go mod tidy`/`go get` manage it.
- **Not committing `go.mod`/`go.sum`.** Both belong in version control for reproducible builds.
- **Wrong module path.** Use a path you control (and that matches your repo if you will publish).

---

## 10. Summary

`go mod` manages your module and its dependencies via `go.mod` (requirements) and `go.sum` (checksums). Start with `go mod init <path>`, add dependencies by importing and running `go mod tidy`, and commit both files. The single most useful subcommand is `go mod tidy`, which keeps your dependency list exactly matching your code.

---

## Further reading
- `go help mod`
- Tutorial: create a module — https://go.dev/doc/tutorial/create-module
- Modules reference: https://go.dev/ref/mod

# go install — Junior

## 1. What does `go install` do?

`go install` **compiles a program and copies the resulting executable into your `GOBIN` directory** so you can run it by name from anywhere — like installing a command-line tool. Unlike `go build` (which drops the binary in the current folder) or `go run` (which deletes it), `go install` puts a permanent, named binary on your `PATH`-accessible bin directory.

```bash
go install .
```

This builds the current `main` package and installs the executable into `$(go env GOBIN)` (or `$(go env GOPATH)/bin` if `GOBIN` is unset).

Think of it as *"build this tool and make it available as a command."*

---

## 2. Prerequisites
- Go installed (`go version` → 1.21+).
- A `package main` (libraries are not "installed" as commands).
- Your bin directory on `PATH` so the installed command can be found.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **GOBIN** | Directory where `go install` places executables |
| **GOPATH** | Root for Go's module cache and default `bin`; `$GOPATH/bin` is the fallback for installs |
| **PATH** | OS list of directories searched for commands |
| **Module-aware** | Resolving packages via `go.mod` and the module graph |
| **`@version`** | A suffix telling `go install` which version of a remote tool to fetch and install |
| **Executable name** | Defaults to the last path element of the package |

---

## 4. Setting up your PATH

Find where binaries go:

```bash
go env GOBIN      # may be empty
go env GOPATH     # e.g., /Users/you/go  → installs go to /Users/you/go/bin
```

Add it to your shell profile so installed tools are runnable:

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
# or, if GOBIN is set:
export PATH="$PATH:$(go env GOBIN)"
```

Without this, `go install` succeeds but the command is "not found."

---

## 5. A minimal worked example

```bash
mkdir greet && cd greet
go mod init example.com/greet
```

`main.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("hi from an installed tool")
}
```

Install and run from anywhere:

```bash
go install .
greet            # hi from an installed tool  (no path needed)
```

The binary is named `greet` (the directory/module name) and lives in your bin directory.

---

## 6. Installing remote tools (the most common use)

The everyday use of `go install` is grabbing third-party command-line tools:

```bash
go install golang.org/x/tools/cmd/stringer@latest
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

The `@version` suffix is **required** when installing outside your own module in modern Go. After install, run the tool by its name (`stringer`, `staticcheck`, etc.).

---

## 7. `go install` vs `go build` vs `go run`

| | `go install` | `go build` | `go run` |
|--|-------------|-----------|----------|
| Where binary goes | `GOBIN`/`$GOPATH/bin` | current dir (or `-o`) | temp, deleted |
| Runnable by name | Yes (if on PATH) | No (run by path) | N/A |
| Best for | Installing CLI tools | Producing artifacts | Quick one-off runs |

---

## 8. Common beginner mistakes

- **"command not found" after install.** Your bin directory is not on `PATH`. Add `$(go env GOPATH)/bin`.
- **Forgetting `@version`.** Installing a remote tool without `@latest`/`@vX.Y.Z` errors in modern Go.
- **Trying to install a library.** Only `main` packages produce installable commands.
- **Expecting it in the current folder.** It goes to the bin directory, not `.`. Use `go build` if you want it locally.

---

## 9. Uninstalling

There is no `go uninstall`. To remove a tool, delete its file:

```bash
rm "$(go env GOPATH)/bin/staticcheck"
```

---

## 10. Summary

`go install` compiles a `main` package and places the named executable in your bin directory so it runs as a command from anywhere. Its biggest use is installing remote CLI tools with `go install path@version`. Make sure your bin directory is on `PATH`, always include `@version` for remote installs, and remember libraries cannot be installed as commands.

---

## Further reading
- `go help install`
- `go env GOBIN`/`GOPATH`: `go help environment`
- cmd/go documentation: https://pkg.go.dev/cmd/go

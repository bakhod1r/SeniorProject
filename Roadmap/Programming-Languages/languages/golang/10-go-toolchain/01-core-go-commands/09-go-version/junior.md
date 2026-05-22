# go version — Junior

## 1. What does `go version` do?

`go version` **prints which version of the Go toolchain you are using**. It is the first command you run to confirm your setup and the version everyone asks for when you report a problem.

```bash
$ go version
go version go1.23.0 darwin/arm64
```

That tells you: the Go version (`go1.23.0`) and the platform it was built for (`darwin/arm64` = macOS on Apple Silicon).

It can also tell you what version of Go built a **compiled binary** — useful for checking deployed artifacts.

---

## 2. Prerequisites
- Go installed (that is what we are verifying).
- Knowing that Go releases are numbered like `go1.23.0`.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Toolchain** | The Go compiler, linker, and tools as a versioned bundle |
| **`go1.23.0`** | A Go version (major `1`, minor `23`, patch `0`) |
| **GOOS/GOARCH** | The operating system and CPU architecture (e.g., `linux/amd64`) |
| **Binary** | A compiled executable |
| **`-m`** | Flag to print module/version info embedded in a binary |
| **GOTOOLCHAIN** | Environment setting controlling which toolchain version is used |

---

## 4. The most common invocations

```bash
go version                 # the toolchain you're running
go version ./myapp         # the Go version that built the binary ./myapp
go version -m ./myapp      # the binary's Go version + module dependencies
```

The first is by far the most common — you run it constantly to confirm your environment.

---

## 5. Reading the output

```
go version go1.23.0 linux/amd64
            ^^^^^^^^ ^^^^^ ^^^^^
            version  OS    CPU
```

- `go1.23.0` — the exact toolchain version.
- `linux/amd64` — the platform (`GOOS/GOARCH`) this Go was built for / targets by default.

When you ask for help online, people want this line, because behavior can differ between versions.

---

## 6. Checking a built binary

`go version` can inspect an executable to see which Go built it:

```bash
go build -o myapp .
go version myapp        # myapp: go1.23.0
```

This is handy in operations: you can confirm a deployed binary was built with the expected Go version, even without the source.

---

## 7. The `-m` flag: a peek at dependencies

`go version -m <binary>` prints the version **and** the modules baked into the binary:

```bash
$ go version -m myapp
myapp: go1.23.0
	path    example.com/myapp
	mod     example.com/myapp  (devel)
	dep     github.com/google/uuid  v1.6.0  h1:...
	build   -trimpath=true
	build   vcs.revision=abc123
```

You do not need to fully understand this yet — just know that `-m` reveals what went into a binary, which is great for debugging "what version of that dependency shipped?"

---

## 8. Why versions matter

Go is famously backward-compatible, but:
- New language features require a new enough version.
- Some library behavior changes between versions.
- Your `go.mod` declares a minimum Go version (the `go 1.XX` line).

So `go version` is your quick check that you have a version new enough for the project.

---

## 9. Common beginner mistakes

- **Confusing `go version` (toolchain) with a project's version.** This is Go's own version, not your app's.
- **Forgetting OS/arch matters.** A `linux/amd64` toolchain on the line means that platform; cross-builds change the target.
- **Running an old Go for a new project.** If the project's `go.mod` says `go 1.23` and you have `go1.20`, upgrade.
- **Expecting `go version` to change your installed Go.** It only reports; switching versions is a separate setup step.

---

## 10. Summary

`go version` prints your Go toolchain version and platform (`go version go1.23.0 os/arch`), and can report which Go built a given binary (`go version <bin>`) or even its embedded module info (`go version -m <bin>`). It is the first command for confirming your setup and the line to share when asking for help. It only reports — it does not install or switch versions.

---

## Further reading
- `go help version`
- cmd/go: https://pkg.go.dev/cmd/go
- Go release history: https://go.dev/doc/devel/release

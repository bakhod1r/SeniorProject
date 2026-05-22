# go run — Junior

## 1. What does `go run` do?

`go run` **compiles and immediately executes** a Go program in one step. It builds your code into a temporary binary, runs it, and then throws the binary away. You never see the executable — it lives in a temporary directory and is deleted when the program exits.

Think of it as the fastest way to say *"run this code right now"* during development.

```bash
go run main.go
```

This compiles `main.go` (and the package it belongs to), runs the resulting program, and prints its output to your terminal.

---

## 2. Prerequisites
- Go installed (`go version` should print 1.21 or newer).
- A file with `package main` and a `func main()`.
- Basic familiarity with the terminal.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Compile** | Translate Go source into machine code |
| **Binary / executable** | The compiled program you can run |
| **Temporary binary** | The throwaway executable `go run` produces and deletes |
| **`package main`** | The special package that produces an executable |
| **`func main()`** | The entry point — where execution starts |
| **Build cache** | Where Go stores compiled packages to speed up later builds |
| **Arguments** | Values you pass *to your program* after the file name |

---

## 4. A minimal worked example

Create `hello.go`:

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello from go run!")
}
```

Run it:

```bash
go run hello.go
```

Output:

```
Hello from go run!
```

No `hello` file is left behind in your directory — that is the key difference from `go build`.

---

## 5. The most common invocations

```bash
# Run a single file
go run main.go

# Run a program made of several files in the current directory
go run .

# Run a program made of several files, listed explicitly
go run main.go helper.go

# Run a package by its import path
go run example.com/cmd/server
```

`go run .` is the form you will use most in real projects, because a program is usually split across multiple files in one package. Listing only `main.go` when your `main` function calls helpers in other files causes "undefined" errors.

---

## 6. Passing arguments to your program

Anything after the file/package is passed **to your program**, not to `go`:

```bash
go run main.go --name Alice --count 3
```

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("args:", os.Args[1:])
}
```

```bash
$ go run main.go a b c
args: [a b c]
```

Be careful with flags: `go run -race main.go arg` gives `-race` to the **Go tool** (a build flag), while `go run main.go -race` gives `-race` to **your program**. Order matters.

---

## 7. When do you use `go run`?

| Use `go run` when... | Use `go build` when... |
|----------------------|------------------------|
| Quickly testing a snippet or script | You want a reusable binary |
| Iterating in development | Shipping/deploying the program |
| Running a one-off tool | Running the program many times |
| Learning and experimenting | You need the file for a Docker image |

`go run` is great for the inner development loop. For anything you run repeatedly or deploy, prefer `go build` so you do not recompile every time.

---

## 8. A common beginner mistake

```bash
$ go run hello.go
# works

$ go run helper.go   # but main() is in main.go!
# package command-line-arguments is not a main package
```

If you split code across files, run the **directory**, not one file:

```bash
go run .
```

Another classic: editing the file but forgetting that `go run` always recompiles, so you *do* see your changes — unlike running a stale `go build` binary.

---

## 9. Seeing what it actually does

Add `-x` to print the commands `go run` executes under the hood (you will see a temporary directory and a compile + link step):

```bash
go run -x hello.go
```

You will notice the executable is created somewhere like `/tmp/go-buildXXXX/.../exe/hello` and removed afterward.

---

## 10. Summary

`go run` compiles and runs your program in one step, using a temporary binary it deletes afterward. Use `go run .` to include all files in your `main` package, and remember that arguments before the path go to the Go tool while arguments after go to your program. It is the fastest way to run code while developing, but for repeated runs or deployment you want `go build`.

---

## Further reading
- `go help run`
- `cmd/go` documentation: https://pkg.go.dev/cmd/go
- `os.Args`: https://pkg.go.dev/os#pkg-variables

# Hello World in Go — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What are the minimum requirements for a Go executable program?

**Answer:**
A Go executable requires exactly two things:
1. `package main` — declares this is an executable program (not a library)
2. `func main()` — the entry point function that the Go runtime calls when the program starts

The simplest valid Go executable:
```go
package main

func main() {}
```

This program compiles, runs, and does nothing.

---

### 2. What does `import "fmt"` do and what happens if you import a package but do not use it?

**Answer:**
`import "fmt"` makes the `fmt` package's exported functions (like `Println`, `Printf`, `Sprintf`) available in your file.

If you import a package but never use it, the Go compiler **rejects the code** with an error:
```
imported and not used: "fmt"
```

This is a deliberate design decision in Go to keep dependencies clean and prevent dead code. To suppress this temporarily during development, you can use a blank identifier:
```go
import _ "fmt" // Only for side effects (runs init() but no access to exports)
```

---

### 3. What is the difference between `fmt.Print`, `fmt.Println`, and `fmt.Printf`?

**Answer:**
```go
package main

import "fmt"

func main() {
    fmt.Print("Hello")           // Prints without newline
    fmt.Println("Hello")         // Prints with newline appended
    fmt.Printf("Hello, %s!", "Go") // Prints with format verbs, no automatic newline
}
```

| Function | Adds newline? | Supports format verbs? | Use case |
|----------|:---:|:---:|:---|
| `Print` | No | No | Inline output, prompts |
| `Println` | Yes | No | Simple line output |
| `Printf` | No | Yes | Formatted output with variables |

---

### 4. Why must the opening brace `{` be on the same line as `func main()` in Go?

**Answer:**
Go uses automatic semicolon insertion. The lexer inserts a semicolon after the closing `)` of `func main()` if the line ends there. This turns:
```go
func main()
{
```
into:
```go
func main();  // Semicolon inserted here!
{
```
Which is a syntax error. The opening brace must always be on the same line as the function signature.

---

### 5. How do you compile and run a Go program? What is the difference between `go run` and `go build`?

**Answer:**
- `go run main.go` — compiles the program to a temporary binary, runs it immediately, then deletes the binary. Used during development.
- `go build -o hello main.go` — compiles the program into a permanent binary file named `hello`. Used for deployment.

Key differences:
| | `go run` | `go build` |
|---|---|---|
| Creates permanent binary | No (temporary) | Yes |
| Compilation every time | Yes | Only once |
| Good for | Development | Production |

---

### 6. What does `func main()` return? Can it take arguments?

**Answer:**
`func main()` takes no arguments and returns nothing. This is different from C (`int main(int argc, char *argv[])`) or Java (`public static void main(String[] args)`).

To access command-line arguments in Go, you use `os.Args` (a `[]string` slice). To return an exit code, you call `os.Exit(code)`:

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("Args:", os.Args)
    os.Exit(0) // Exit with code 0 (success)
}
```

---

### 7. What happens if you write `fmt.println` (lowercase `p`) instead of `fmt.Println`?

**Answer:**
You get a compile error:
```
cannot refer to unexported name fmt.println
```

In Go, capitalization determines visibility (exported vs unexported). Only names starting with an uppercase letter are exported (public). `println` with a lowercase `p` is unexported (private to the `fmt` package) and cannot be accessed from outside.

---

## Middle Level

### 4. Explain the execution order of `init()` functions in Go. Can you have multiple `init()` functions?

**Answer:**
Yes, Go allows multiple `init()` functions — even within the same file. The execution order is:

1. **Imported packages** are initialized first (recursively, in dependency order)
2. **Package-level variables** are initialized in declaration order
3. **`init()` functions** run in the order they appear in the source file
4. If there are multiple files in a package, files are processed in **lexicographic order** (alphabetical by filename)
5. **`func main()`** runs last

```go
package main

import "fmt"

var x = computeX() // Runs first

func computeX() int {
    fmt.Println("1: package var")
    return 42
}

func init() {
    fmt.Println("2: first init")
}

func init() {
    fmt.Println("3: second init")
}

func main() {
    fmt.Println("4: main")
}
// Output: 1, 2, 3, 4
```

---

### 5. What is the difference between writing to `os.Stdout` and `os.Stderr`? Why does it matter?

**Answer:**
Both are file descriptors that output to the terminal by default, but they serve different purposes:

- **`os.Stdout` (fd 1)** — standard output for program results. Can be piped and redirected.
- **`os.Stderr` (fd 2)** — standard error for diagnostics and errors. Not captured by default pipes.

```bash
# Only stdout is piped to grep; stderr still shows on screen
./myapp | grep "result"

# Redirect each independently
./myapp > output.txt 2> errors.txt
```

**Why it matters in production:**
- Logging errors to stdout mixes them with program output, breaking pipes
- Containerized environments (Docker, Kubernetes) often capture stdout and stderr separately
- Monitoring tools can alert on stderr volume independently

```go
fmt.Println("data result")              // Goes to stdout
fmt.Fprintln(os.Stderr, "error: fail")  // Goes to stderr
```

---

### 6. What is the `run() error` pattern and why is it preferred over putting logic directly in `main()`?

**Answer:**
The pattern extracts all logic from `main()` into a separate `run()` function that returns an error:

```go
func run() error {
    // All application logic here
    return nil
}

func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

**Benefits:**
1. **Testability:** `run()` can be called from tests with controlled arguments; `main()` cannot
2. **Deferred cleanup:** Functions deferred inside `run()` always execute before the error is returned. If you use `log.Fatal` in `main()`, deferred functions are skipped (because `os.Exit` does not run defers)
3. **Clean error handling:** The return value signals success/failure without calling `os.Exit` in business logic
4. **Dependency injection:** `run()` can accept parameters like `io.Writer` for stdout, making it easier to test

---

### 7. How does `fmt.Printf` handle extra or missing arguments?

**Answer:**
```go
// Extra arguments — no compile error, but runtime annotation
fmt.Printf("Hello %s", "World", "Extra")
// Output: Hello World%!(EXTRA string=Extra)

// Missing arguments — no compile error, but runtime annotation
fmt.Printf("Hello %s %s", "World")
// Output: Hello World %!s(MISSING)

// Wrong verb type — no compile error at runtime, but go vet catches it
fmt.Printf("Age: %s", 42)
// Output: Age: %!s(int=42)
```

`go vet` catches many of these issues at compile time:
```bash
go vet ./...
# ./main.go:7:2: fmt.Printf call has arguments but no formatting directives
```

**Best practice:** Always run `go vet` in CI. Use `fmt.Println` when you do not need formatting.

---

### 8. What are the performance characteristics of `fmt.Println` compared to lower-level alternatives?

**Answer:**

| Method | Speed | Allocations | Use case |
|--------|-------|-------------|----------|
| `fmt.Println` | ~450 ns/op | 2 allocs | General purpose |
| `fmt.Fprintln(w, ...)` | ~320 ns/op | 2 allocs | Custom writer |
| `io.WriteString(w, s)` | ~25 ns/op | 0 allocs | Known strings |
| `w.Write([]byte)` | ~10 ns/op | 0 allocs | Raw bytes |

`fmt.Println` is slower because:
1. It boxes arguments into `interface{}` (allocation)
2. Creates a variadic `[]any` slice (allocation)
3. Uses reflection to determine the format for each type
4. Uses `sync.Pool` to reuse printer objects (amortized cost)

For hot paths (e.g., logging in a web server handling 100K rps), use `io.WriteString` or a structured logger like `slog` (Go 1.21+).

---

### 9. What does the `flag` package provide and when would you use it instead of `os.Args`?

**Answer:**

| Feature | `os.Args` | `flag` |
|---------|-----------|--------|
| Type safety | No (all strings) | Yes (String, Int, Bool, etc.) |
| Default values | Manual | Built-in |
| Usage/help message | Manual | Auto-generated (`-h`) |
| Named flags | No | Yes (`-name=value`) |
| Positional args | Direct | Via `flag.Args()` after `Parse()` |

Use `os.Args` for simple scripts with 1-2 positional arguments. Use `flag` for tools with named options and defaults. Use `cobra` or `urfave/cli` for complex CLI apps with subcommands.

```go
// flag example
name := flag.String("name", "World", "who to greet")
flag.Parse()
fmt.Printf("Hello, %s!\n", *name)
// Run: ./app -name=Gopher
// Run: ./app -h  (shows auto-generated usage)
```

---

## Senior Level

### 10. How would you design the `main` package of a production Go microservice?

**Answer:**
The `main` package should follow the **composition root** pattern:

```go
func main() {
    // 1. Load configuration (env, flags, config file)
    cfg := config.Load()

    // 2. Create logger
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

    // 3. Connect to dependencies (parallel if independent)
    db, err := database.Connect(cfg.DatabaseURL)
    if err != nil { logger.Error("db", "err", err); os.Exit(1) }
    defer db.Close()

    // 4. Wire dependencies (constructor injection)
    repo := postgres.NewUserRepo(db)
    svc := service.NewUserService(repo, logger)
    handler := http.NewHandler(svc, logger)

    // 5. Set up signal handling
    ctx, stop := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    // 6. Start server
    srv := &http.Server{Addr: cfg.Addr, Handler: handler}
    go func() { <-ctx.Done(); srv.Shutdown(context.Background()) }()

    // 7. Block until shutdown
    if err := srv.ListenAndServe(); err != http.ErrServerClosed {
        logger.Error("server", "err", err)
        os.Exit(1)
    }
}
```

**Key principles:**
- `main()` is a composition root — no business logic
- Dependencies flow inward (handler -> service -> repo)
- Interfaces defined where consumed, not where implemented
- Graceful shutdown via `signal.NotifyContext`
- All goroutines have a defined exit path

---

### 11. What happens under the hood when you call `fmt.Println("Hello")`? Trace the full call chain.

**Answer:**
1. `fmt.Println("Hello")` creates an `[]any{string("Hello")}` variadic slice
2. Calls `fmt.Fprintln(os.Stdout, args...)`
3. `Fprintln` gets a `*pp` (printer) from `sync.Pool`
4. `pp.doPrintln(args)` iterates arguments, uses reflection to format each value
5. For a string, it writes directly to `pp.buf` (a `[]byte`)
6. Appends `\n` to the buffer
7. Calls `os.Stdout.Write(pp.buf)` — the `io.Writer` interface
8. `os.File.Write` calls `internal/poll.FD.Write`
9. `poll.FD.Write` calls `syscall.Write(fd=1, buf)`
10. `syscall.Write` executes the `SYS_WRITE` syscall instruction
11. Linux kernel writes bytes to the terminal device
12. Returns `(n, err)` back up the chain
13. `pp` is returned to `sync.Pool` for reuse

**Allocations:** 2 — one for the `interface{}` boxing of the string, one for the `[]any` slice.

---

### 12. How do you handle graceful shutdown in Go? What signals should you handle and why?

**Answer:**
Handle **SIGTERM** (Kubernetes, Docker, systemd) and **SIGINT** (Ctrl+C):

```go
ctx, stop := signal.NotifyContext(context.Background(),
    syscall.SIGINT, syscall.SIGTERM)
defer stop()
```

**SIGKILL** cannot be caught — it is the kernel's last resort.

**Shutdown sequence:**
1. Receive signal -> cancel context
2. Stop accepting new work (close listeners)
3. Wait for in-flight work to complete (with timeout)
4. Close resources in reverse order of creation (flush logs -> close cache -> close DB)
5. Exit with code 0

**Common mistake:** Using `log.Fatal` or `os.Exit` directly — these skip deferred cleanup. Instead, return errors up to `main()` and let deferred functions run.

**Kubernetes-specific:** The default `terminationGracePeriodSeconds` is 30s. Set your shutdown timeout to 25s to leave 5s buffer before SIGKILL.

---

### 13. What is escape analysis and how does it affect `fmt.Println`?

**Answer:**
Escape analysis is the compiler's determination of whether a variable can live on the stack (fast, automatic cleanup) or must be moved to the heap (slower, requires GC).

For `fmt.Println`:
```bash
go build -gcflags="-m" main.go
# ./main.go:7:14: "Hello" escapes to heap
```

The string "Hello" escapes because:
1. `Println` accepts `...any` (interface)
2. Wrapping a value in an interface requires the compiler to create a pointer to the value
3. The compiler cannot prove the value does not outlive the stack frame
4. Therefore, it allocates on the heap

**Impact:** Each `fmt.Println` call causes ~48 bytes of heap allocation. In a hot path processing 100K requests/sec, this creates 4.8MB/s of garbage for GC.

**Mitigation:** Use `io.WriteString(w, "Hello\n")` for zero-allocation output in hot paths. Or use `slog` which uses structured logging with lazy evaluation.

---

### 14. How do you write a testable `main()` function?

**Answer:**
Use the `run()` pattern with injectable dependencies:

```go
package main

import (
    "io"
    "os"
)

func run(stdout io.Writer, args []string) error {
    if len(args) < 2 {
        return fmt.Errorf("usage: %s <name>", args[0])
    }
    fmt.Fprintf(stdout, "Hello, %s!\n", args[1])
    return nil
}

func main() {
    if err := run(os.Stdout, os.Args); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

```go
// main_test.go
package main

import (
    "bytes"
    "testing"
)

func TestRun(t *testing.T) {
    var buf bytes.Buffer
    err := run(&buf, []string{"app", "Gopher"})
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    want := "Hello, Gopher!\n"
    if got := buf.String(); got != want {
        t.Errorf("got %q, want %q", got, want)
    }
}

func TestRunMissingArg(t *testing.T) {
    var buf bytes.Buffer
    err := run(&buf, []string{"app"})
    if err == nil {
        t.Fatal("expected error for missing argument")
    }
}
```

---

### 15. What is the impact of `os.Exit` on deferred functions and how should you handle this?

**Answer:**
`os.Exit(code)` terminates the process **immediately**. Deferred functions in the calling goroutine (and all other goroutines) are **NOT executed**:

```go
func main() {
    defer fmt.Println("cleanup") // NEVER runs
    os.Exit(1)
}
```

This also applies to `log.Fatal` (which calls `os.Exit(1)` internally).

**Best practice:** Never use `os.Exit` or `log.Fatal` in business logic. Only call them at the very end of `main()`, after all deferred cleanup:

```go
func main() {
    code := 0
    defer func() { os.Exit(code) }() // Runs AFTER all other defers

    defer cleanup() // This will run before os.Exit

    if err := run(); err != nil {
        log.Println(err)
        code = 1
    }
}
```

Or simpler — just return from `main()` for exit code 0, and use `os.Exit` only for non-zero:
```go
func main() {
    if err := run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1) // No defers in main, so this is safe
    }
    // Implicit exit code 0
}
```

---

## Scenario-Based Questions

### 16. Your Go service in Kubernetes is dropping 2% of requests during deployments. How do you diagnose and fix this?

**Answer:**
Step-by-step approach:

1. **Check if the service handles SIGTERM:** Kubernetes sends SIGTERM before stopping the pod. If the service does not handle it, connections are dropped immediately.

2. **Implement graceful shutdown:**
```go
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
defer stop()

go func() {
    <-ctx.Done()
    srv.Shutdown(context.WithTimeout(context.Background(), 25*time.Second))
}()
```

3. **Add a readiness probe** that returns unhealthy when shutdown starts — this stops the load balancer from sending new requests before the pod is killed.

4. **Add a pre-stop hook** with a sleep (e.g., 5s) to allow the load balancer to drain connections:
```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]
```

5. **Verify `terminationGracePeriodSeconds`** is long enough (default 30s) for in-flight requests to complete.

---

### 17. You inherit a Go codebase where `main()` is 500 lines long. How do you refactor it?

**Answer:**
Step-by-step approach:

1. **Identify responsibilities:** Group the 500 lines into categories: config loading, dependency creation, server setup, signal handling, business logic.

2. **Extract `run() error`:** Move all logic into a `run(ctx context.Context) error` function. `main()` becomes 5-10 lines.

3. **Create a `Config` struct:** Extract all configuration loading into a `config.Load()` function.

4. **Define interfaces:** For each dependency (DB, cache, external API), define interfaces at the consumer site.

5. **Use constructor injection:** Create factory functions like `NewService(repo Repository, logger Logger)`.

6. **Add tests:** With the `run()` pattern and interfaces, you can now test the logic without running the actual `main()`.

7. **Add graceful shutdown:** Replace any `log.Fatal` calls with proper error returns and signal handling.

---

### 18. A junior developer asks: "Why do we need `package main`? Can I name it anything?" How do you explain?

**Answer:**
Explain with the building analogy:

"Go uses the package name to decide what to do with the code. `package main` is like the front door of a building — it tells Go 'this code should produce an executable program that people can run.'

Any other package name (like `package calculator`) tells Go 'this is a library — other programs can import and use my functions, but I cannot run by myself.'

You can name libraries anything, but for executables, the Go compiler specifically looks for `package main` and `func main()` as the starting point. This is defined in the Go specification and cannot be changed.

Internally, the Go linker resolves the symbol `main.main` — if it does not exist, the build fails."

---

### 19. Your production logging is causing 15% CPU overhead. How do you optimize it?

**Answer:**
Step-by-step approach:

1. **Profile first:** `go tool pprof -http=:8080 cpu.prof` to confirm `fmt.Printf` / `fmt.Fprintf` is the bottleneck.

2. **Replace `fmt.Println` with `slog` (Go 1.21+):** Structured logging with lazy evaluation — arguments are only formatted if the log level is enabled:
```go
slog.Info("request", "method", r.Method, "path", r.URL.Path)
```

3. **Use `io.WriteString` for fixed strings:** Zero allocations, no reflection.

4. **Buffer output with `bufio.Writer`:** Reduces syscall count:
```go
w := bufio.NewWriter(os.Stdout)
defer w.Flush()
```

5. **Use `slog.Handler` with level filtering:** Skip formatting entirely for disabled log levels.

6. **Benchmark the improvement:** Expect 10-50x speedup replacing `fmt.Printf` with pre-formatted `io.WriteString` in hot paths.

---

### 20. You need to build a CLI tool that is distributed as a single binary. What Go features make this possible and what are the trade-offs?

**Answer:**

**How Go achieves this:**
- Go compiles to a **statically linked binary** by default (no shared libraries needed)
- The Go runtime (scheduler, GC, networking) is embedded in the binary
- All imported packages are compiled into the binary
- Cross-compilation: `GOOS=linux GOARCH=amd64 go build` creates a Linux binary from macOS

**Trade-offs:**

| Benefit | Cost |
|---------|------|
| No runtime dependencies | Binary size is ~2-10 MB minimum |
| Easy deployment (just copy) | No shared library updates (must recompile) |
| Cross-compilation built-in | CGo disables static linking by default |
| Fast startup (~5ms) | Larger container images vs Alpine + interpreter |

**Optimization for distribution:**
```bash
# Minimum binary size
CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o myapp .
# Further: upx --best myapp (compresses ~60%)
```

---

## FAQ

### Q: What do interviewers actually look for in Go answers about Hello World / program structure?

**A:** Key evaluation criteria:

- **Junior:** Can explain `package main`, `import`, `func main()`. Knows `go run` vs `go build`. Understands basic `fmt` functions. Can fix simple compile errors.

- **Middle:** Understands `os.Stdout` vs `os.Stderr` separation. Knows the `init()` execution order. Uses the `run() error` pattern. Handles flags with the `flag` package. Understands `fmt.Printf` format verbs.

- **Senior:** Designs `main()` as a composition root with dependency injection. Implements graceful shutdown with signal handling. Knows escape analysis impact on `fmt.Println`. Can trace the full call chain from `Println` to syscall. Makes architectural decisions about configuration loading, parallel initialization, and testability.

### Q: Should I mention internal details like `runtime.main` in a junior interview?

**A:** No. For junior interviews, focus on practical skills: writing, compiling, and running Go programs. Internal details are appropriate for senior-level discussions when asked about performance, architecture, or "under the hood" questions.

### Q: What is the most common mistake candidates make when answering Go Hello World questions?

**A:** Confusing Go's design decisions with bugs or limitations:
- "Go should allow unused imports" — No, it is intentional for code hygiene
- "Opening braces should be allowed on the next line" — No, Go's semicolon insertion prevents this by design
- "main() should accept arguments like Java" — No, Go uses `os.Args` deliberately to keep the function signature simple

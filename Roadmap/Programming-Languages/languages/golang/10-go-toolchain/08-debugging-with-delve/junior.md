# Debugging with Delve — Junior

## 1. What is Delve?

Delve (`dlv`) is the **Go-aware debugger**. It understands goroutines, channels, interfaces, slices, maps, and the runtime in ways generic debuggers do not. `gdb` can technically read Go binaries, but its support is limited and frequently misleading because it does not understand the goroutine scheduler or Go's calling conventions. For real Go debugging, you use Delve.

Think of `dlv` as "an interactive REPL you point at a Go program so you can pause it, look around, and continue."

```bash
dlv debug ./...
```

This compiles your package with debug info, drops you into a prompt, and waits for your first command.

---

## 2. Installing Delve

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
dlv version
```

You need Go 1.21+ for current Delve versions (1.22+). On macOS, the first run may ask for permission to attach to processes; on Linux, attaching to a process you did not start may require `sudo` or a `ptrace_scope` change (covered in `senior.md`).

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Breakpoint** | A pause point in your program; execution stops when it hits that line/function |
| **Step** | Execute one statement |
| **Step into** | Step into a function call |
| **Step over** | Execute the call as a single step |
| **Continue** | Resume execution until the next breakpoint or exit |
| **Frame** | One entry in the call stack |
| **Goroutine** | A Go coroutine; Delve can list and switch between them |
| **REPL** | The `(dlv)` prompt where you type commands |
| **DAP** | Debug Adapter Protocol — how editors talk to Delve |

---

## 4. The four launch modes

```bash
dlv debug ./cmd/server      # compile + debug your package
dlv test ./pkg              # compile + debug a test binary
dlv exec ./app              # debug an already-built binary
dlv attach 12345            # attach to a running process by PID
```

`dlv debug` and `dlv test` build the binary for you with the right flags (`-gcflags='all=-N -l'` disables optimizations so locals stay visible). `dlv exec` and `dlv attach` work on existing binaries; if those were not built with debug info, things will look broken.

---

## 5. Your first session

Create `main.go`:

```go
package main

import "fmt"

func add(a, b int) int {
    sum := a + b
    return sum
}

func main() {
    x := 2
    y := 3
    result := add(x, y)
    fmt.Println("result:", result)
}
```

Start Delve and walk through it:

```bash
$ dlv debug .
Type 'help' for list of commands.
(dlv) break main.main
Breakpoint 1 set at 0x... for main.main() ./main.go:10
(dlv) continue
> main.main() ./main.go:10
(dlv) next        # x := 2
(dlv) next        # y := 3
(dlv) print x
2
(dlv) step        # step into add()
(dlv) print a
2
(dlv) print b
3
(dlv) continue
result: 5
```

That's the loop: set a breakpoint, continue, step, print, repeat.

---

## 6. Essential commands

| Command | Short | What it does |
|---------|-------|--------------|
| `help` | `h` | Show available commands |
| `break LOC` | `b` | Set a breakpoint (`main.go:12`, `main.main`, `pkg.Func`) |
| `breakpoints` | `bp` | List breakpoints |
| `clear N` | | Remove breakpoint N |
| `continue` | `c` | Resume execution |
| `next` | `n` | Step over (do not enter calls) |
| `step` | `s` | Step into the next call |
| `stepout` | `so` | Run until the current function returns |
| `print EXPR` | `p` | Evaluate an expression |
| `locals` | | Print local variables |
| `args` | | Print function arguments |
| `stack` | `bt` | Show the call stack |
| `frame N` | | Switch to frame N |
| `goroutines` | `grs` | List goroutines |
| `goroutine N` | `gr` | Switch to goroutine N |
| `list` | `ls` | Show source around the current line |
| `restart` | `r` | Reload and restart the program |
| `quit` | `q` | Exit Delve |

Memorize `b`, `c`, `n`, `s`, `p`, `bt`. That gets you 80% of the way.

---

## 7. Debugging a test

You usually debug a failing test, not the whole binary. `dlv test` builds the test binary and starts a session:

```bash
dlv test ./internal/parser
(dlv) break TestParseDate
(dlv) continue
(dlv) next
(dlv) print got
```

To debug a single test by name, pass test flags **after** `--`:

```bash
dlv test ./internal/parser -- -test.run TestParseDate -test.v
```

Anything before `--` is for Delve; anything after is for the test binary.

---

## 8. Attaching to a running process

Sometimes the bug only appears in a long-running program. Find the PID and attach:

```bash
$ pgrep -f myserver
12345
$ dlv attach 12345
(dlv) goroutines
(dlv) bt
(dlv) detach          # leave the program running, do not kill it
```

`detach` is important: by default, `quit` may kill the process you attached to. Use `detach` (or `quit` with the confirmation answered "no") when you want the program to keep running.

---

## 9. Common beginner mistakes

- Running `dlv exec ./app` on a stripped or optimized binary and being confused that variables show `<optimized out>`. Build with `go build -gcflags='all=-N -l'` for debugging.
- Forgetting that `dlv debug` rebuilds: editing source and immediately typing `continue` runs the **old** binary loaded into Delve. Use `restart` after edits.
- Quitting accidentally and killing the attached production process. Use `detach`.
- Treating Delve like gdb. Many commands have different names (`goroutines`, `bt`, `locals`).

---

## 10. Summary

Delve is the Go debugger you should reach for: install with `go install`, then start a session with `dlv debug`, `dlv test`, `dlv exec`, or `dlv attach`. Drive it with `break`, `continue`, `next`, `step`, and `print`. For tests, separate Delve flags and test flags with `--`. For attached processes, use `detach` so you do not kill them on exit.

---

## Further reading
- Delve documentation: https://github.com/go-delve/delve/tree/master/Documentation
- CLI reference: https://github.com/go-delve/delve/blob/master/Documentation/cli/README.md
- `dlv help` and `(dlv) help` inside the REPL

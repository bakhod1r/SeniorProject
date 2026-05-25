# Debugging with Delve — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and Delve 1.22+.

---

## Task 1: Install Delve and first session

Install `dlv` and start a session on a tiny program.

```go
// main.go
package main

import "fmt"

func main() {
    msg := "hello"
    fmt.Println(msg)
}
```

**Acceptance criteria**
- [ ] `go install github.com/go-delve/delve/cmd/dlv@latest` succeeds and `dlv version` prints 1.22 or later.
- [ ] `dlv debug .` drops you at the `(dlv)` prompt.
- [ ] `break main.main`, `continue`, `print msg` prints `"hello"`.
- [ ] `continue` runs the program to completion; `quit` exits Delve.

---

## Task 2: Set a breakpoint and inspect a local

Use the multi-line program from `junior.md` section 5 (the `add` function). Step through it.

**Acceptance criteria**
- [ ] You set a breakpoint at the first line of `add`.
- [ ] After hitting it, `args` prints `a` and `b` with the expected values.
- [ ] `next` advances one line; `print sum` shows the computed value.
- [ ] `stepout` returns to `main` and you can print `result`.

---

## Task 3: Conditional breakpoint

Write a loop that runs 100 times. Set a breakpoint that fires only when `i == 42`.

```go
for i := 0; i < 100; i++ {
    process(i) // break here only when i == 42
}
```

**Acceptance criteria**
- [ ] `break main.go:LINE if i == 42` is accepted.
- [ ] `continue` stops exactly once, with `print i` showing `42`.
- [ ] You change the condition to a hit count (`condition -hitcount BP 1 == 50`) and verify it fires on the 50th hit.

---

## Task 4: Switch between goroutines

Spawn three workers that each block on a channel. Inspect them.

```go
func worker(id int, ch chan int) {
    v := <-ch         // workers will block here
    fmt.Println(id, v)
}

func main() {
    ch := make(chan int)
    for i := 1; i <= 3; i++ {
        go worker(i, ch)
    }
    time.Sleep(time.Second) // give them time to block
    // breakpoint here
}
```

**Acceptance criteria**
- [ ] Set a breakpoint at the line after the `Sleep`, hit it.
- [ ] `goroutines` lists at least the three workers and shows them in `chan receive`.
- [ ] `goroutine N` switches to a worker; `bt` shows `main.worker`.
- [ ] `print id` (or `frame N; print id`) shows the correct worker ID.

---

## Task 5: Attach to a running server

Write a tiny HTTP server that handles `/hello`. Run it (`go run .`), find its PID, attach.

**Acceptance criteria**
- [ ] In one terminal: `go run ./cmd/server` is running and answers `curl localhost:8080/hello`.
- [ ] In another: `pgrep -f server` gives the PID; `dlv attach PID` succeeds.
- [ ] You set a function breakpoint on the HTTP handler; a subsequent `curl` triggers it.
- [ ] You use `detach` (not `quit`) and confirm the server keeps serving.

(On Linux you may need `sudo` or `echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope`.)

---

## Task 6: Headless mode + remote VS Code attach

Start Delve in headless DAP mode, then attach from VS Code (or Neovim with `nvim-dap-go`).

**Acceptance criteria**
- [ ] `dlv dap --listen=127.0.0.1:38697` is running.
- [ ] VS Code `launch.json` has a configuration with `"request": "attach"`, `"mode": "remote"`, and the right `port`.
- [ ] You set a breakpoint in the editor and it hits during execution.
- [ ] Disconnecting the editor does not kill the program (`--accept-multiclient` if you want the server to survive).

---

## Task 7: Headless JSON-RPC + remote `dlv connect`

Same idea but with the native protocol.

**Acceptance criteria**
- [ ] `dlv debug --headless --listen=:2345 --api-version=2 --accept-multiclient ./cmd/server` is running.
- [ ] From another shell, `dlv connect :2345` opens a `(dlv)` prompt.
- [ ] `continue`, breakpoint, `print` all work over the connection.
- [ ] You disconnect the client; the server stays up; you reconnect and resume.

---

## Task 8: Debug a core dump with `dlv core`

Make a program panic, capture a core, debug it offline.

```go
func main() {
    var p *int
    fmt.Println(*p) // nil dereference
}
```

**Acceptance criteria**
- [ ] `ulimit -c unlimited` set; you run the program with `go build -gcflags='all=-N -l' -o app . && ./app`.
- [ ] A core file is written (or use `gcore PID` on a live process if your OS does not write cores by default).
- [ ] `dlv core ./app core.PID` opens the session.
- [ ] `goroutines` and `bt` show the panicking goroutine and frame; `print p` shows `nil` (or unreadable, depending on optimization).
- [ ] You confirm that `continue` and `next` are rejected (core is read-only).

---

## Task 9: Debug a single test with `dlv test`

Pick a package with a failing or interesting test. Debug only that test.

**Acceptance criteria**
- [ ] `dlv test ./internal/parser -- -test.run TestParseDate -test.v` starts a session.
- [ ] You set a breakpoint inside `TestParseDate`.
- [ ] `continue` stops at the breakpoint; `print got`, `print want` show the values.
- [ ] `restart` re-runs the test cleanly without exiting Delve.

# go tool — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: List the tool catalog

Discover what `go tool` ships on your machine.

**Acceptance criteria**
- [ ] `go tool` (no arguments) prints a list of tools.
- [ ] `ls "$(go env GOTOOLDIR)"` shows the same names as real files.
- [ ] You can name the directory in the form `$GOROOT/pkg/tool/<GOOS_GOARCH>/`.

---

## Task 2: Inspect symbols with `nm`

Build a small binary and look inside.

```go
// hello.go
package main
import "fmt"
func greet(name string) { fmt.Println("hi,", name) }
func main() { greet("world") }
```

**Acceptance criteria**
- [ ] `go build -o hello hello.go` produces `./hello`.
- [ ] `go tool nm hello | grep main.greet` shows a `T` (text) symbol.
- [ ] `go tool nm -size hello | sort -k2 -nr | head` lists the biggest symbols in the binary.

---

## Task 3: Disassemble one function with `objdump`

Use a regex to focus on a single function.

**Acceptance criteria**
- [ ] `go tool objdump -s '^main\.greet$' hello` prints the disassembly only for `main.greet`.
- [ ] You can identify a `CALL` instruction in the output.
- [ ] Re-running with `go build -gcflags='all=-N -l' -o hello hello.go` produces longer, less-optimized assembly.

---

## Task 4: Check a build ID

Verify the identity of an artifact.

**Acceptance criteria**
- [ ] `go tool buildid hello` prints a non-empty ID string.
- [ ] Rebuilding without changes (and same flags) keeps the ID stable: `go build -o hello hello.go && go tool buildid hello` matches the previous value.
- [ ] Adding `-ldflags='-X main.x=now'` changes the build ID.

---

## Task 5: Generate coverage and view it in a browser

Run a test, then open the HTML report.

```go
// math.go
package mathx
func Add(a, b int) int { return a + b }
func Sub(a, b int) int { return a - b }
```

```go
// math_test.go
package mathx
import "testing"
func TestAdd(t *testing.T) { if Add(2, 3) != 5 { t.Fail() } }
```

**Acceptance criteria**
- [ ] `go test -coverprofile=cover.out ./...` creates `cover.out`.
- [ ] `go tool cover -func=cover.out` prints a per-function table with a `total:` line.
- [ ] `go tool cover -html=cover.out -o coverage.html` produces an HTML file that opens in a browser and shows `Sub` in red (uncovered).

---

## Task 6: List supported targets

Use `dist list` to enumerate cross-compilation targets.

**Acceptance criteria**
- [ ] `go tool dist list | head` prints `GOOS/GOARCH` pairs.
- [ ] `go tool dist list -json | jq 'length'` returns an integer (target count) — verifying machine-readable output works.
- [ ] You can confirm `linux/arm64` and `darwin/arm64` are in the list.

---

## Task 7: Use `test2json` in a script

Capture structured test events for a downstream tool.

**Acceptance criteria**
- [ ] `go test -json ./... > events.jsonl` produces one JSON object per line.
- [ ] `jq -r 'select(.Action=="fail") | .Test' events.jsonl` prints the names of failed tests (zero if all pass).
- [ ] `go test -v ./... | go tool test2json > events2.jsonl` produces the same shape — confirming `test2json` is what `-json` uses under the hood.

---

## Task 8: Run `pprof` on a profile

Generate and analyze a CPU profile.

```go
// bench_test.go
package mathx
import "testing"
func BenchmarkAdd(b *testing.B) { for i := 0; i < b.N; i++ { _ = Add(i, i) } }
```

**Acceptance criteria**
- [ ] `go test -cpuprofile=cpu.out -bench=. ./...` produces `cpu.out`.
- [ ] `go tool pprof -top cpu.out` prints a non-empty top list.
- [ ] `go tool pprof -http=:0 cpu.out` opens a browser UI (an arbitrary free port is chosen) and you can navigate the flame graph.

---

## Task 9: Open a trace

Visualize the runtime tracer.

**Acceptance criteria**
- [ ] `go test -trace=trace.out -run=TestAdd ./...` produces `trace.out`.
- [ ] `go tool trace trace.out` starts a local HTTP server and prints its URL.
- [ ] You can navigate to "View trace" and see at least one goroutine timeline.

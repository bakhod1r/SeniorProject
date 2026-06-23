# Go `goto` Statement — Tasks

> **Learning philosophy:** These tasks are primarily **refactoring exercises**. You will be shown code that uses `goto`, asked to understand what it does, and then refactor it to clean, idiomatic Go without `goto`. A few tasks ask you to write code that demonstrates why `goto` causes problems.

---

## Task 1: Refactor `goto` Loop to `for` Loop (Beginner)

**Goal:** Understand how a `goto`-based loop works, then rewrite it using a `for` loop.

**Starter code:**
```go
package main

import "fmt"

// Step 1: Read this and trace the execution manually.
// Step 2: Rewrite using a for loop.
func countDown() {
    n := 10
start:
    if n < 0 {
        goto done
    }
    fmt.Println(n)
    n--
    goto start
done:
    fmt.Println("Lift off!")
}

// TODO: Implement this version using a for loop
func countDownClean() {
    // Your implementation here
}

func main() {
    fmt.Println("--- goto version ---")
    countDown()
    fmt.Println("--- for loop version ---")
    countDownClean()
    // Both should produce identical output
}
```

**Expected output:**
```
10 9 8 7 6 5 4 3 2 1 0 Lift off!
```

---

## Task 2: Refactor `goto` Error Handling to `return` (Beginner)

**Goal:** Replace the C-style `goto fail` pattern with idiomatic Go `return` statements. Also improve error messages.

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
)

// BAD: C-style goto fail
func validateUser(name string, age int, email string) error {
    if name == "" {
        goto fail
    }
    if age < 0 || age > 150 {
        goto fail
    }
    if email == "" {
        goto fail
    }
    return nil

fail:
    return errors.New("validation failed")
}

// TODO: Rewrite without goto, with specific error messages for each failure
func validateUserClean(name string, age int, email string) error {
    // Your implementation here
    return nil
}

func main() {
    tests := []struct{ name string; age int; email string }{
        {"Alice", 30, "alice@example.com"},
        {"", 30, "bob@example.com"},
        {"Carol", -1, "carol@example.com"},
        {"Dave", 25, ""},
    }
    for _, t := range tests {
        err := validateUserClean(t.name, t.age, t.email)
        fmt.Printf("validate(%q, %d, %q) = %v\n", t.name, t.age, t.email, err)
    }
}
```

---

## Task 3: Refactor `goto` Cleanup to `defer` (Beginner–Intermediate)

**Goal:** Replace `goto cleanup` with `defer`. Understand why `defer` is safer and handles future code additions better.

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
)

type Connection struct{ name string }
func (c *Connection) Close() { fmt.Println("closing connection:", c.name) }

type Transaction struct{ id int }
func (t *Transaction) Rollback() { fmt.Println("rolling back transaction:", t.id) }
func (t *Transaction) Commit() error { return nil }

func openConnection(name string) (*Connection, error) {
    return &Connection{name}, nil
}

func beginTx(c *Connection) (*Transaction, error) {
    return &Transaction{id: 42}, nil
}

func insertData(tx *Transaction, data string) error {
    if data == "" { return errors.New("empty data") }
    fmt.Println("inserted:", data)
    return nil
}

// BAD: goto cleanup
func processData(connName, data string) error {
    conn, err := openConnection(connName)
    if err != nil { goto fail }

    tx, err := beginTx(conn)
    if err != nil { conn.Close(); goto fail }

    if err = insertData(tx, data); err != nil {
        tx.Rollback()
        conn.Close()
        goto fail
    }

    if err = tx.Commit(); err != nil {
        tx.Rollback()
        conn.Close()
        goto fail
    }

    conn.Close()
    return nil

fail:
    return err
}

// TODO: Rewrite using defer for cleanup
func processDataClean(connName, data string) error {
    // Your implementation here
    return nil
}

func main() {
    fmt.Println("--- valid data ---")
    processDataClean("prod-db", "hello world")
    fmt.Println("\n--- empty data ---")
    processDataClean("prod-db", "")
}
```

---

## Task 4: Refactor `goto` Exit from Nested Loop (Intermediate)

**Goal:** Replace `goto` used to exit nested loops with a labeled `break` OR a return from a function. Implement both approaches.

**Starter code:**
```go
package main

import "fmt"

type Cell struct{ row, col, value int }

// BAD: goto to exit nested loops
func findNegativeGoto(matrix [][]int) *Cell {
    var found *Cell
    for i, row := range matrix {
        for j, val := range row {
            if val < 0 {
                found = &Cell{i, j, val}
                goto done
            }
        }
    }
done:
    return found
}

// TODO: Rewrite using labeled break
func findNegativeLabeledBreak(matrix [][]int) *Cell {
    // Your implementation here
    return nil
}

// TODO: Rewrite using function extraction + return
func findNegativeReturn(matrix [][]int) *Cell {
    // Your implementation here
    return nil
}

func main() {
    matrix := [][]int{
        {1, 2, 3},
        {4, -5, 6},
        {7, 8, 9},
    }

    r1 := findNegativeLabeledBreak(matrix)
    r2 := findNegativeReturn(matrix)

    fmt.Printf("labeled break: row=%d col=%d value=%d\n", r1.row, r1.col, r1.value)
    fmt.Printf("function return: row=%d col=%d value=%d\n", r2.row, r2.col, r2.value)
    // Expected: row=1 col=1 value=-5
}
```

---

## Task 5: Refactor a State Machine from `goto` to `switch` (Intermediate)

**Goal:** Refactor a `goto`-based state machine to use a `switch` statement with a state variable. This is a common pattern in parsers and protocol implementations.

**Starter code:**
```go
package main

import (
    "fmt"
    "unicode"
)

// Token types
type TokenType int
const (
    NUMBER TokenType = iota
    IDENT
    WHITESPACE
    UNKNOWN
)

type Token struct {
    Type  TokenType
    Value string
}

// BAD: goto state machine
func lexGoto(input string) []Token {
    var tokens []Token
    i := 0

start:
    if i >= len(input) { goto eof }
    if unicode.IsSpace(rune(input[i])) { i++; goto start }
    if unicode.IsDigit(rune(input[i])) { goto number }
    if unicode.IsLetter(rune(input[i])) { goto ident }
    i++
    goto start

number:
    start := i
    for i < len(input) && unicode.IsDigit(rune(input[i])) { i++ }
    tokens = append(tokens, Token{NUMBER, input[start:i]})
    goto start

ident:
    startI := i
    for i < len(input) && unicode.IsLetter(rune(input[i])) { i++ }
    tokens = append(tokens, Token{IDENT, input[startI:i]})
    goto start

eof:
    return tokens
}

// TODO: Rewrite using switch + state enum (no goto)
func lexSwitch(input string) []Token {
    // Your implementation here
    return nil
}

func main() {
    input := "hello 42 world 123"
    tokens := lexSwitch(input)
    for _, t := range tokens {
        fmt.Printf("{Type:%d Value:%q}\n", t.Type, t.Value)
    }
}
```

---

## Task 6: Demonstrate `goto` Bypassing Code (Intermediate)

**Goal:** Write a test that proves `goto` can accidentally bypass critical code. Then fix it.

```go
package main

import "fmt"

type AuditLog struct{ entries []string }
func (a *AuditLog) Record(msg string) { a.entries = append(a.entries, msg) }

var audit = &AuditLog{}

// This function has a goto that silently skips audit logging.
// Task:
// 1. Run this and observe that audit.entries is empty after processEvent("bad")
// 2. Explain WHY audit logging is skipped
// 3. Fix by removing the goto (use return or continue in a loop)

func processEvent(event string) error {
    if event == "" {
        goto done
    }

    if event == "bad" {
        fmt.Println("bad event, skipping")
        goto done
    }

    audit.Record("processed: " + event)  // SKIPPED for "bad" events
    fmt.Println("processed:", event)

done:
    return nil
}

// TODO: Rewrite processEvent without goto, ensuring ALL events are audited
// (even bad ones — record "skipped: bad event" in the audit log)
func processEventClean(event string) error {
    // Your implementation here
    return nil
}

func main() {
    events := []string{"login", "bad", "logout", ""}
    audit.entries = nil
    for _, e := range events {
        processEventClean(e)
    }
    fmt.Println("\nAudit log:")
    for _, entry := range audit.entries {
        fmt.Println(" -", entry)
    }
}
```

---

## Task 7: Refactor a Parser with Multiple `goto` Paths (Advanced)

**Goal:** Refactor a complex function with multiple `goto` statements to clean, idiomatic Go. Preserve the error messages (make them better).

**Starter code:**
```go
package main

import (
    "errors"
    "fmt"
    "strconv"
    "strings"
)

type Config struct {
    Host string
    Port int
    Name string
}

// BAD: multiple goto patterns
func parseConfigGoto(s string) (Config, error) {
    var cfg Config
    parts := strings.Split(s, ";")
    if len(parts) != 3 {
        goto invalidFormat
    }

    cfg.Host = strings.TrimSpace(parts[0])
    if cfg.Host == "" {
        goto missingHost
    }

    port, err := strconv.Atoi(strings.TrimSpace(parts[1]))
    if err != nil {
        goto invalidPort
    }
    if port < 1 || port > 65535 {
        goto portOutOfRange
    }
    cfg.Port = port

    cfg.Name = strings.TrimSpace(parts[2])
    if cfg.Name == "" {
        goto missingName
    }

    return cfg, nil

invalidFormat:
    return Config{}, errors.New("config must be 'host;port;name'")
missingHost:
    return Config{}, errors.New("host is required")
invalidPort:
    return Config{}, errors.New("port must be a number")
portOutOfRange:
    return Config{}, errors.New("port must be 1-65535")
missingName:
    return Config{}, errors.New("name is required")
}

// TODO: Rewrite without goto — identical behavior, identical error messages
func parseConfigClean(s string) (Config, error) {
    // Your implementation here
    return Config{}, nil
}

func main() {
    inputs := []string{
        "localhost;8080;myapp",
        "localhost;8080",         // wrong format
        ";8080;myapp",            // missing host
        "localhost;abc;myapp",    // invalid port
        "localhost;99999;myapp",  // port out of range
        "localhost;8080;",        // missing name
    }
    for _, input := range inputs {
        cfg, err := parseConfigClean(input)
        if err != nil {
            fmt.Printf("ERROR: %v\n", err)
        } else {
            fmt.Printf("OK: %+v\n", cfg)
        }
    }
}
```

---

## Task 8: Benchmark `goto` Loop vs `for` Loop (Advanced)

**Goal:** Write benchmarks comparing a `goto`-based loop to a `for` loop. Document whether there is a performance difference and explain the result.

```go
package bench_test

import "testing"

// goto-based loop
func sumGoto(n int) int {
    sum := 0
    i := 0
loop:
    if i >= n { goto done }
    sum += i
    i++
    goto loop
done:
    return sum
}

// for loop
func sumFor(n int) int {
    sum := 0
    for i := 0; i < n; i++ {
        sum += i
    }
    return sum
}

// TODO: Write BenchmarkSumGoto and BenchmarkSumFor
// Run with: go test -bench=. -benchmem
// Document the results and explain WHY they are the same or different

func BenchmarkSumGoto(b *testing.B) {
    // Your implementation here
}

func BenchmarkSumFor(b *testing.B) {
    // Your implementation here
}

// BONUS: Write a version that sums a slice using goto vs for range
// and benchmark those too. Do the results differ?
// Hint: BCE (bounds check elimination) may make for range faster
func sumSliceGoto(arr []int) int {
    // Your implementation
    return 0
}

func sumSliceFor(arr []int) int {
    sum := 0
    for _, v := range arr {
        sum += v
    }
    return sum
}
```

---

## Task 9: Write a `goto`-to-`return` Refactoring Tool (Advanced)

**Goal:** Write a simple Go program that reads a Go source file and reports all `goto` statements with their line numbers and the refactoring suggestion.

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
)

// TODO: Implement analyzeFile which:
// 1. Parses the given Go source file
// 2. Finds all goto statements
// 3. Prints: "Line N: goto <label> — consider using for/return/defer/break"
// 4. Prints a count of total goto statements found
func analyzeFile(filename string) error {
    fset := token.NewFileSet()
    // TODO: parse the file
    // TODO: inspect AST for *ast.BranchStmt with Tok == token.GOTO
    // TODO: print findings
    _ = fset
    return nil
}

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: gotofinder <file.go>")
        os.Exit(1)
    }
    if err := analyzeFile(os.Args[1]); err != nil {
        fmt.Println("Error:", err)
        os.Exit(1)
    }
}
```

Test your tool against the starter code from Task 1 above.

---

## Task 10: Real-World Refactoring: HTTP Handler (Advanced)

**Goal:** Refactor a complete HTTP handler that uses `goto` for error handling. Preserve all behavior, improve error messages, add proper HTTP status codes.

```go
package main

import (
    "encoding/json"
    "errors"
    "fmt"
    "net/http"
    "strconv"
)

type User struct {
    ID   int
    Name string
    Age  int
}

var userDB = map[int]User{
    1: {1, "Alice", 30},
    2: {2, "Bob", 25},
}

// BAD: goto-based HTTP handler
func getUserHandler(w http.ResponseWriter, r *http.Request) {
    var (
        idStr string
        id    int
        user  User
        ok    bool
        err   error
        data  []byte
    )

    idStr = r.URL.Query().Get("id")
    if idStr == "" {
        goto missingID
    }

    id, err = strconv.Atoi(idStr)
    if err != nil {
        goto invalidID
    }

    user, ok = userDB[id]
    if !ok {
        goto notFound
    }

    data, err = json.Marshal(user)
    if err != nil {
        goto serverError
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write(data)
    return

missingID:
    http.Error(w, "missing id parameter", http.StatusBadRequest)
    return
invalidID:
    http.Error(w, "id must be a number", http.StatusBadRequest)
    return
notFound:
    http.Error(w, "user not found", http.StatusNotFound)
    return
serverError:
    http.Error(w, "internal error", http.StatusInternalServerError)
    return
}

// TODO: Rewrite getUserHandlerClean without goto
// Requirements:
// - Same behavior
// - Use early returns
// - Improve error messages (include the invalid value in the message)
// - Optional: wrap errors with fmt.Errorf for better context
func getUserHandlerClean(w http.ResponseWriter, r *http.Request) {
    // Your implementation here
}

func main() {
    // Test with: curl "http://localhost:8080/user?id=1"
    http.HandleFunc("/user", getUserHandlerClean)
    fmt.Println("Server at :8080")
    if err := http.ListenAndServe(":8080", nil); !errors.Is(err, http.ErrServerClosed) {
        fmt.Println("error:", err)
    }
}
```

---

## Task 11: Implement a Retry Loop Without `goto` (Intermediate)

**Goal:** The following code uses `goto` for retry logic. Refactor it to a clean `for` loop with proper exponential backoff.

```go
package main

import (
    "errors"
    "fmt"
    "math/rand"
    "time"
)

var ErrTransient = errors.New("transient error")
var ErrFatal = errors.New("fatal error")

func unreliableOperation() error {
    r := rand.Intn(3)
    if r == 0 { return nil }
    if r == 1 { return ErrTransient }
    return ErrFatal
}

// BAD: goto retry
func doWithRetryGoto(maxRetries int) error {
    attempt := 0
retry:
    attempt++
    if attempt > maxRetries {
        return fmt.Errorf("failed after %d attempts", maxRetries)
    }
    err := unreliableOperation()
    if err == nil { return nil }
    if errors.Is(err, ErrFatal) { return err }
    fmt.Printf("attempt %d failed: %v, retrying\n", attempt, err)
    time.Sleep(time.Duration(attempt) * 50 * time.Millisecond)
    goto retry
}

// TODO: Rewrite without goto
// Requirements:
// - Same retry logic (max attempts, fatal vs transient distinction)
// - Same exponential backoff
// - Use for loop
func doWithRetryClean(maxRetries int) error {
    // Your implementation here
    return nil
}

func main() {
    rand.Seed(time.Now().UnixNano())
    err := doWithRetryClean(5)
    if err != nil {
        fmt.Println("Final error:", err)
    } else {
        fmt.Println("Success!")
    }
}
```

---

## Task 12: Document and Explain Legitimate `goto` Usage (Advanced)

**Goal:** Find a real example of `goto` in the Go standard library or a well-known Go project. Explain:
1. What the `goto` does
2. Why it was used instead of a structured alternative
3. Whether you think it could be refactored
4. What the risks would be of refactoring it

```go
// Research task — no starter code

// Hints for finding goto usage in the Go ecosystem:
// 1. In the Go source tree:
//    grep -rn "goto" src/

// 2. In goyacc generated files:
//    grep -rn "goto" src/cmd/goyacc/

// 3. In crypto packages:
//    grep -rn "goto" src/crypto/

// Template for your answer:
// ---
// Location: <package and file>
// Code snippet:
//   <copy the relevant code here>
//
// What it does:
//   <explain>
//
// Why goto was used:
//   <explain>
//
// Could it be refactored?
//   <yes/no and why>
//
// Refactoring risks:
//   <list>
// ---
```

---

*All tasks focus on understanding, critically analyzing, and refactoring `goto` to clean Go code. The goal is not to master `goto` but to master the art of recognizing and eliminating it.*

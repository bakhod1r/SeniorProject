# Error Handling Basics — Find the Bug

> Each snippet contains a real-world bug related to error handling. Find it, explain it, fix it.

---

## Bug 1 — Swallowed error

```go
func ReadConfig(path string) Config {
    data, err := os.ReadFile(path)
    if err != nil {
        return Config{}
    }
    var cfg Config
    json.Unmarshal(data, &cfg)
    return cfg
}
```

**Bug:** Two errors swallowed:
1. The read error returns an empty config silently — caller cannot distinguish "no file" from "empty config."
2. `json.Unmarshal`'s error is ignored — corrupt data produces an apparently-valid empty config.

**Fix:**
```go
func ReadConfig(path string) (Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return Config{}, fmt.Errorf("read %q: %w", path, err)
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return Config{}, fmt.Errorf("parse %q: %w", path, err)
    }
    return cfg, nil
}
```

---

## Bug 2 — Wrong default

```go
func GetUser(id int) (*User, error) {
    u, err := db.LookUp(id)
    if err != nil {
        return &User{}, err
    }
    return u, nil
}
```

**Bug:** Returns a pointer to an empty User on error. Caller cannot tell from the value whether the lookup succeeded.

**Fix:** return `nil`:
```go
return nil, err
```

---

## Bug 3 — Comparing wrapped errors with `==`

```go
err := process()
if err == io.EOF {
    return nil
}
return err
```

**Bug:** If `err` was wrapped (`fmt.Errorf("...: %w", io.EOF)`), `err == io.EOF` is false. The check fails silently.

**Fix:** use `errors.Is`:
```go
if errors.Is(err, io.EOF) {
    return nil
}
```

---

## Bug 4 — Wrapping with `%v` instead of `%w`

```go
if err != nil {
    return fmt.Errorf("read failed: %v", err)
}
```

**Bug:** `%v` formats the error as a string. The original is lost — `errors.Is` and `errors.As` can no longer find it.

**Fix:** use `%w`:
```go
return fmt.Errorf("read failed: %w", err)
```

---

## Bug 5 — Typed-nil interface

```go
type MyErr struct{ Msg string }
func (e *MyErr) Error() string { return e.Msg }

func validate(x int) error {
    var e *MyErr
    if x < 0 {
        e = &MyErr{"negative"}
    }
    return e
}

func main() {
    if err := validate(5); err != nil {
        fmt.Println("got error:", err)  // BUG: this fires!
    }
}
```

**Bug:** `validate(5)` returns a typed nil `*MyErr` wrapped in a non-nil interface. `err != nil` is true.

**Fix:** explicit nil:
```go
func validate(x int) error {
    if x < 0 {
        return &MyErr{"negative"}
    }
    return nil
}
```

---

## Bug 6 — Discarded Close error on a writer

```go
func Save(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()
    _, err = f.Write(data)
    return err
}
```

**Bug:** `f.Close` may fail (network FS, full disk on flush), but its error is discarded. A successful `Write` followed by a failing `Close` returns nil — caller thinks the file was saved.

**Fix:**
```go
func Save(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr
        }
    }()
    _, err = f.Write(data)
    return err
}
```

---

## Bug 7 — Logging *and* returning

```go
func process(x string) error {
    if err := step1(x); err != nil {
        log.Printf("step1 failed: %v", err)
        return err
    }
    if err := step2(x); err != nil {
        log.Printf("step2 failed: %v", err)
        return err
    }
    return nil
}

// caller
if err := process("a"); err != nil {
    log.Printf("process failed: %v", err)
    return err
}
```

**Bug:** Each error is logged twice (once inside, once by caller). For deeply nested code, errors get logged 5+ times — log amplification.

**Fix:** log once at the top of the request, return everywhere else.

---

## Bug 8 — Reusing err in loop without context

```go
for _, item := range items {
    if err := process(item); err != nil {
        return err
    }
}
```

**Bug:** When an error is returned, the caller has no idea *which* item failed.

**Fix:**
```go
for i, item := range items {
    if err := process(item); err != nil {
        return fmt.Errorf("item %d (%v): %w", i, item, err)
    }
}
```

---

## Bug 9 — Endless retry on permanent error

```go
func fetchWithRetry(url string) ([]byte, error) {
    for {
        resp, err := http.Get(url)
        if err == nil {
            defer resp.Body.Close()
            return io.ReadAll(resp.Body)
        }
        time.Sleep(time.Second)
    }
}
```

**Bugs:**
1. Infinite retry — never gives up.
2. No distinction between transient (5xx, network) and permanent (404, malformed URL) errors.
3. `defer resp.Body.Close()` inside a loop accumulates defers (only fires on return).

**Fix:**
```go
func fetchWithRetry(ctx context.Context, url string, attempts int) ([]byte, error) {
    var last error
    for i := 0; i < attempts; i++ {
        body, err := fetchOnce(ctx, url)
        if err == nil {
            return body, nil
        }
        if !isTransient(err) {
            return nil, err
        }
        last = err
        select {
        case <-ctx.Done():
            return nil, ctx.Err()
        case <-time.After(time.Second << i):
        }
    }
    return nil, fmt.Errorf("after %d attempts: %w", attempts, last)
}

func fetchOnce(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

---

## Bug 10 — Sentinel comparison with mismatched type

```go
var ErrNotFound = errors.New("not found")

func find(id int) error {
    return fmt.Errorf("look up %d: not found", id)
}

if errors.Is(find(7), ErrNotFound) {
    // BUG: never true
}
```

**Bug:** The error returned does not wrap `ErrNotFound`; it just *contains the same string*. `errors.Is` checks identity, not text.

**Fix:** wrap the sentinel:
```go
return fmt.Errorf("look up %d: %w", id, ErrNotFound)
```

---

## Bug 11 — Defer in a loop

```go
func processFiles(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            return err
        }
        defer f.Close()  // BUG
        // ... use f ...
    }
    return nil
}
```

**Bug:** All `defer`s run only when the function returns, so files stay open until the last iteration. With thousands of files, you exhaust file descriptors.

**Fix:** wrap each iteration in a function:
```go
for _, p := range paths {
    if err := processOne(p); err != nil {
        return err
    }
}

func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil { return err }
    defer f.Close()
    // ...
    return nil
}
```

---

## Bug 12 — Panic instead of error for user input

```go
func ParseAge(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic(err)
    }
    return n
}
```

**Bug:** Panics on user input. The caller cannot recover gracefully; the entire program may crash on a typo.

**Fix:** return an error.
```go
func ParseAge(s string) (int, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("parse age: %w", err)
    }
    return n, nil
}
```

---

## Bug 13 — Comparing errors by message

```go
if err.Error() == "file not found" {
    // ...
}
```

**Bug:** Brittle — depends on exact string. Breaks on locale, version changes, or wrapping.

**Fix:** use `errors.Is` with a sentinel:
```go
if errors.Is(err, fs.ErrNotExist) { /* ... */ }
```

---

## Bug 14 — Goroutine error lost

```go
go func() {
    if err := work(); err != nil {
        // BUG: where does this go?
    }
}()
```

**Bug:** The goroutine cannot return an error to the caller. Without a channel, errgroup, or shared state, the error is silently lost.

**Fix:**
```go
errCh := make(chan error, 1)
go func() {
    errCh <- work()
}()
// later
if err := <-errCh; err != nil { /* handle */ }
```

Or use `errgroup`.

---

## Bug 15 — Naked return shadowing err

```go
func Load(path string) (cfg *Config, err error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return
    }
    if err := json.Unmarshal(data, &cfg); err != nil {  // BUG: shadowing
        return
    }
    return
}
```

**Bug:** The inner `err` shadows the named return `err`. The outer `err` is never set; the function returns `cfg=nil, err=nil` even on Unmarshal failure.

**Fix:** use `=`, not `:=`:
```go
if err = json.Unmarshal(data, &cfg); err != nil {
    return
}
```

Or even better, name your inner check distinctly:
```go
if jerr := json.Unmarshal(data, &cfg); jerr != nil {
    return nil, fmt.Errorf("parse: %w", jerr)
}
```

---

## Bug 16 — Returning a generic error

```go
func openOrConnect(path string) error {
    if _, err := os.Stat(path); err == nil {
        return openLocal(path)
    }
    return errors.New("error")  // BUG: useless
}
```

**Bug:** The error message says nothing. The caller cannot understand what failed.

**Fix:** include context, and prefer wrapping any underlying cause:
```go
return fmt.Errorf("open %q: file does not exist", path)
```

---

## Bug 17 — Releasing the wrong resource

```go
mu.Lock()
defer mu.Unlock()
data, err := fetch()
if err != nil {
    mu.Unlock()  // BUG: double-unlock at return
    return err
}
return process(data)
```

**Bug:** `defer mu.Unlock()` already handles all paths. Manual `Unlock` plus the deferred one means a double unlock — usually a panic.

**Fix:** remove the manual call.

---

## Bug 18 — Multi-return ignored partially

```go
io.WriteString(os.Stdout, "hello\n")
```

**Bug:** Both returns ignored, including the error. If stdout is closed/redirected to a broken pipe, this silently fails. Linters like `errcheck` will warn.

**Fix:** `_, _ = io.WriteString(os.Stdout, "hello\n")` to mark the choice as deliberate, or check the error if it matters.

# 8.2 `flag` — Find the Bug

> Each section is a short snippet that compiles, looks reasonable, and
> is wrong. Read it, decide what's broken, then read the analysis.
> These are real bugs. They show up in code reviews, in production
> incidents, and in the comments of GitHub issues filed against
> stdlib-using CLIs.

## 1. The default-forever variable

```go
package main

import (
    "flag"
    "log"
)

var port = flag.Int("port", 8080, "listen port")

func init() {
    log.Printf("starting on port %d", *port)
}

func main() {
    flag.Parse()
    serve(*port)
}
```

### What's wrong

The log line in `init()` runs before `main`, which means before
`flag.Parse`. `*port` is `8080` regardless of what the user typed.
The startup message lies, then the actual `serve` call uses the
correct value. Two-line discrepancy in the logs, an angry on-call
engineer.

The fix: never read flag values from `init()`. Read them from `main`,
after `Parse`, or pass them into functions explicitly.

## 2. The missing `=` for booleans

```go
var debug = flag.Bool("debug", true, "enable debug logging")

func main() {
    flag.Parse()
    if *debug {
        log.SetOutput(debugWriter)
    }
}
```

User runs:

```
$ ./app -debug false other.txt
```

User expects: debug off, `other.txt` as a positional arg.
Actual: debug *on* (default was true, `-debug` mentioned), `false` and
`other.txt` both in `flag.Args()`.

### What's wrong

The space form `-debug false` doesn't work for bool flags. The parser
sees `-debug` with no `=`, sees that the type is bool, and treats the
flag as set to `true`. The next token (`false`) goes into the
positional arg list. The user's intent of "turn debug off" is silently
lost.

The fix is documentation, not code: every CLI's help should call out
that bool flags require `-debug=false` to disable. The parser will
not change.

## 3. The flag defined after Parse

```go
func main() {
    flag.Parse()
    quiet := flag.Bool("quiet", false, "suppress output")
    if *quiet {
        log.SetOutput(io.Discard)
    }
}
```

### What's wrong

`flag.Bool` is called *after* `flag.Parse`. The flag is registered,
but `Parse` already finished walking `os.Args[1:]` and returned. The
new flag has no chance to be set; `*quiet` keeps its default of
`false` no matter what the user typed.

A worse variant: `Parse` saw `-quiet` on the command line, found no
such flag, and exited 2 with "flag provided but not defined: -quiet"
before ever reaching the `flag.Bool` line. The user sees an error
that contradicts the binary they're running.

The fix: define every flag at package scope or at the very top of
`main`, then call `Parse`.

## 4. Sharing a `*FlagSet` across goroutines

```go
fs := flag.NewFlagSet("worker", flag.ContinueOnError)
addr := fs.String("addr", ":8080", "")

var wg sync.WaitGroup
for _, args := range argSets {
    wg.Add(1)
    go func(a []string) {
        defer wg.Done()
        fs.Parse(a) // each goroutine parses its own slice
        process(*addr)
    }(args)
}
wg.Wait()
```

### What's wrong

Multiple goroutines call `fs.Parse` on the same `*FlagSet`. `Parse`
mutates internal state (the "actual" map of which flags were set),
and writes to `*addr` through the `Value`. Two goroutines parsing
concurrently race on those writes. The race detector catches it; the
production symptom is a value torn between two CLIs' inputs.

The fix: build a fresh `*FlagSet` per goroutine. The flag definitions
are cheap to repeat. If the goroutines are parsing identical schemas
with different values, factor a `newFlagSet()` helper.

## 5. The library that calls `flag.Parse`

```go
// in a library package
func init() {
    flag.StringVar(&libConfig, "lib-config", "", "library config")
    flag.Parse() // ensure config is loaded before main runs
}
```

### What's wrong

A library has no business calling `flag.Parse`. By the time the
application's `main` runs, the library has already consumed
`os.Args[1:]` and the application's own `flag.X` definitions —
declared *after* the library's `init` but read by the parser running
inside that `init` — have not yet been registered. The application's
flags will fail to parse.

Even if the application did happen to run before the library's init
(it won't), parsing twice produces undefined behavior for `Visit` and
for accumulating custom flag types.

The fix: libraries provide a constructor or a `RegisterFlags(fs *flag.FlagSet)`
helper that the application calls. The library never touches
`os.Args` or `flag.Parse`.

## 6. Defining the same flag twice

```go
// pkgA/init.go
func init() { flag.String("port", "8080", "listen port") }

// pkgB/init.go
func init() { flag.String("port", "9090", "listen port (alt)") }

// main.go
import (
    _ "myapp/pkgA"
    _ "myapp/pkgB"
)

func main() {
    flag.Parse()
}
```

### What's wrong

Package init order in Go is "imports first, then this package's
init, in source order." When `pkgB`'s init runs after `pkgA`'s, the
second `flag.String("port", ...)` panics with `flag redefined: port`.
The binary won't even start.

The fix: don't register flags from libraries. If you must, namespace
them (`-pkga.port`, `-pkgb.port`) so they don't collide. The package
panics on collision precisely to surface this kind of latent bug at
startup rather than as silent override.

## 7. Forgetting to set `flag.CommandLine.Usage`

```go
func main() {
    flag.Parse()
    if flag.NArg() == 0 {
        fmt.Fprintln(os.Stderr, "usage: app [flags] file ...")
        os.Exit(2)
    }
    process(flag.Args())
}
```

### What's wrong

When the user passes `-h`, `flag` calls `flag.Usage()`. The default
usage prints `Usage of <program>:` and the flag table, but no
synopsis of how to use the program. The user sees:

```
Usage of ./app:
  -v    enable verbose logging
```

…and has to guess that positional file arguments are expected. The
custom usage line in the `if` branch is unreachable from the help
flow.

The fix: set `flag.Usage` to a function that prints both the synopsis
and `flag.PrintDefaults()`:

```go
flag.Usage = func() {
    fmt.Fprintln(flag.CommandLine.Output(), "usage: app [flags] file ...")
    flag.PrintDefaults()
}
```

## 8. Parsing subcommand flags from the wrong slice

```go
func main() {
    flag.Parse() // global
    if flag.NArg() < 1 {
        usage()
        os.Exit(2)
    }
    switch flag.Arg(0) {
    case "serve":
        fs := flag.NewFlagSet("serve", flag.ExitOnError)
        addr := fs.String("addr", ":8080", "")
        fs.Parse(os.Args[1:]) // BUG: should be os.Args[2:]
        serve(*addr)
    }
}
```

### What's wrong

`fs.Parse(os.Args[1:])` includes the subcommand name itself
(`os.Args[1]` is `"serve"`). Since `"serve"` doesn't start with `-`,
`Parse` stops immediately, treats `"serve"` as the first positional
arg, and never sees `-addr=:9090`. The user's flag is silently
ignored.

The fix: pass `os.Args[2:]` (or, better, `flag.Args()[1:]` so the
slice tracks whatever the global parser left over). The choice
between the two depends on whether the global `flag.Parse` consumed
any global flags before the subcommand name.

## 9. Custom `Value.Set` that doesn't return an error

```go
type ports []int

func (p *ports) String() string {
    return fmt.Sprintf("%v", *p)
}

func (p *ports) Set(s string) error {
    n, _ := strconv.Atoi(s) // ignore error
    *p = append(*p, n)
    return nil
}
```

### What's wrong

`strconv.Atoi("not-a-number")` returns `(0, err)`. The error is
discarded; `Set` appends `0` and returns nil. The user types
`-port=foo` and the value is silently zero. Worse, in a port list,
the program now binds to port 0 (which on Linux means "ask the kernel
to pick"), behavior the user never asked for.

The fix: return the error from `Set`. The package will format it
into `invalid value "foo" for flag -port: <err>` and behave according
to the `ErrorHandling` mode.

```go
func (p *ports) Set(s string) error {
    n, err := strconv.Atoi(s)
    if err != nil { return err }
    *p = append(*p, n)
    return nil
}
```

## 10. Reading `flag.Args()` after a parse error

```go
func main() {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    addr := fs.String("addr", ":8080", "")
    if err := fs.Parse(os.Args[1:]); err != nil {
        log.Printf("parse error: %v, continuing with addr=%s and args=%v",
            err, *addr, fs.Args())
        // continue anyway
    }
    serve(*addr, fs.Args())
}
```

### What's wrong

After a parse error, the state of `*addr` and `fs.Args()` is partial.
`Parse` stops at the first error, so flags before the bad one are
set, and flags after it are not. `fs.Args()` contains whatever
remained when the error happened — it's not the "user's positional
args," it's "everything Parse hadn't reached yet."

Continuing with these values runs the program with arguments the
user didn't intend. The right move is to abort:

```go
if err := fs.Parse(os.Args[1:]); err != nil {
    log.Fatalf("parse error: %v", err)
}
```

If you really want partial-success behavior, document carefully what
"partial" means and write tests that pin it down. Most code
shouldn't try.

## 11. The accumulated default in a slice flag

```go
type tagList []string

func (t *tagList) String() string { return strings.Join(*t, ",") }
func (t *tagList) Set(v string) error {
    *t = append(*t, v)
    return nil
}

var tags = tagList{"default"}

func init() {
    flag.Var(&tags, "tag", "tag")
}

func main() {
    flag.Parse()
    fmt.Println("tags:", tags)
}
```

User runs `./app -tag=foo`. Expected: `[foo]`. Actual: `[default
foo]`.

### What's wrong

The `tags` slice was initialized with `"default"` to set a default,
which `flag.PrintDefaults` will display. But the slice's `Set` method
*appends* — it doesn't reset on first use. The user's flag adds to
the default rather than replacing it.

Two fixes, depending on intent:

- "Default of nothing, accept zero or more `-tag` flags": initialize
  the slice empty.
- "Default of `default`, but any `-tag` flag replaces the default":
  track a `set` boolean inside the `Value` and clear the slice on
  the first `Set` call.

```go
type tagList struct {
    items []string
    set   bool
}
func (t *tagList) Set(v string) error {
    if !t.set { t.items = nil; t.set = true }
    t.items = append(t.items, v)
    return nil
}
```

## 12. Using `os.Args` instead of `flag.Args`

```go
func main() {
    flag.Parse()
    for _, path := range os.Args[1:] { // BUG
        process(path)
    }
}
```

### What's wrong

`os.Args[1:]` includes the flag tokens. If the user runs
`./app -v file1 file2`, the loop processes `-v`, `file1`, and
`file2`. The first call to `process("-v")` either fails with
"file not found" or, depending on `process`, does something
unexpected.

The fix: use `flag.Args()` for positional arguments after parsing:

```go
for _, path := range flag.Args() {
    process(path)
}
```

`flag.Args()` is what's left after `Parse` consumed the flags; it's
the "user's actual positional arguments."

## 13. The `--` not at the end

```go
$ grep -v -- foo file.txt
```

User intent: pass `foo` as a literal (in case it starts with `-`),
and `file.txt` as the file to search.

```go
flag.Parse()
pattern := flag.Arg(0)
file := flag.Arg(1)
```

### What's wrong

The bare `--` ends flag parsing. After Parse, `flag.Args()` is
`["foo", "file.txt"]` — the `--` is consumed and not included. Code
that reads `flag.Arg(0)` as `--` and skips ahead is wrong: there is
no `--` to skip. The example above is *correct*; the bug is in code
that defensively does:

```go
args := flag.Args()
if len(args) > 0 && args[0] == "--" {
    args = args[1:] // wrong: -- is already gone
}
```

That `if` block never executes (the `--` was eaten by `Parse`). The
defensive code is harmless but misleading. The package handles `--`
for you.

## 14. The flag set whose `Output` is never set

```go
func TestParseError(t *testing.T) {
    fs := flag.NewFlagSet("t", flag.ContinueOnError)
    fs.String("addr", ":80", "")
    err := fs.Parse([]string{"-bogus"})
    if err == nil { t.Fatal("expected error") }
    // test continues
}
```

### What's wrong

`fs` was created with `flag.ContinueOnError`. When `Parse` fails on
`-bogus`, the package writes `flag provided but not defined: -bogus`
plus the usage block to `fs.Output()`. The default output is
`os.Stderr` — which is the test binary's stderr — which `go test`
displays at the end of the test run.

The test passes (`err != nil`), but the test output is polluted with
parser noise that has nothing to do with the test's intent. Worse, in
a CI log of 100 tests, the noise triggers false grep hits when
someone searches for "flag provided but not defined."

The fix: silence the output during the test:

```go
fs.SetOutput(io.Discard)
```

For tests that *do* want to assert on the output, use a
`bytes.Buffer` and check its contents.

## 15. The race between `flag.Set` and a reader

```go
go func() {
    for {
        time.Sleep(5 * time.Second)
        if v, ok := os.LookupEnv("APP_LEVEL"); ok {
            flag.Set("log-level", v)
        }
    }
}()

func main() {
    flag.Parse()
    for {
        currentLevel := *logLevel // race
        process(currentLevel)
    }
}
```

### What's wrong

A background goroutine calls `flag.Set` to "live-reload" a config
value. The main goroutine reads `*logLevel` in a loop. `flag.Set`
calls `Value.Set` which writes to the underlying variable. Two
goroutines write/read the same variable without synchronization —
classic data race.

The fix: don't use `flag` for hot-reload. Read the env var directly
in the loop with `os.LookupEnv`, or wrap the value in a `sync/atomic`
container or a mutex-protected struct. `flag` was designed for
parse-once-at-startup semantics.

If you really need both — flag-based startup *and* env-based reload —
write a typed wrapper:

```go
type atomicLevel struct{ v atomic.Int32 }
func (a *atomicLevel) Set(s string) error { /* parse, store */ }
func (a *atomicLevel) Load() int32 { return a.v.Load() }
```

Use it as the flag's backing `Value` and read via `Load()` everywhere
else. Now there's no race.

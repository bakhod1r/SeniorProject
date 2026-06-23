# 8.2 `flag` — Middle

> **Audience.** You're past `flag.String` and you've started to feel
> the limits — you want a flag that takes a comma-separated list, a
> CLI with `serve` and `migrate` subcommands, environment-variable
> fallback for container deployments, and a `main` you can actually
> test. This file covers the `flag.Value` interface, `*FlagSet` for
> isolation, custom `Usage`, env precedence, and the testability
> patterns you reach for in production code.

## 1. The `flag.Value` interface

Anything that satisfies this two-method interface can be a flag:

```go
type Value interface {
    String() string
    Set(string) error
}
```

`String()` is what `flag.PrintDefaults` shows as the current value (and
what `%v` formats it as). `Set(s)` is called once per occurrence of the
flag on the command line, with the raw string the user typed. Return an
error to reject the input — `flag` will format it as
`invalid value "X" for flag -name: <error>` and (in `ExitOnError`
mode) exit.

A custom `int` clamped to [0, 100]:

```go
type percent int

func (p *percent) String() string { return fmt.Sprintf("%d%%", int(*p)) }

func (p *percent) Set(s string) error {
    n, err := strconv.Atoi(strings.TrimSuffix(s, "%"))
    if err != nil {
        return fmt.Errorf("not a number: %w", err)
    }
    if n < 0 || n > 100 {
        return fmt.Errorf("must be between 0 and 100")
    }
    *p = percent(n)
    return nil
}

var quality percent = 80

func init() {
    flag.Var(&quality, "quality", "JPEG quality, 0-100")
}
```

`flag.Var` is the registration function for any `Value`. Always pass a
pointer (the receiver of `Set` must mutate the underlying value), and
always set the default by initializing the variable *before* the
`flag.Var` call.

## 2. The companion: `flag.Getter`

```go
type Getter interface {
    Value
    Get() interface{}
}
```

`Getter` adds a typed `Get()` returning `interface{}`. The built-in
flag types implement it; custom types can opt in. The only `flag`
function that uses `Getter` is `(f *Flag).Value.(Getter).Get()` —
useful for code that walks `flag.VisitAll` and wants the typed value
instead of the string form. You can ignore `Getter` until you
implement a CLI introspection feature; most custom flags satisfy
`Value` only and are fine.

## 3. Repeating flags: the `StringSlice` pattern

`flag` does not have a built-in slice type. To accept `-tag=foo
-tag=bar`, write a `Value` that appends on each `Set`:

```go
type stringSlice []string

func (s *stringSlice) String() string {
    if s == nil {
        return ""
    }
    return strings.Join(*s, ",")
}

func (s *stringSlice) Set(v string) error {
    *s = append(*s, v)
    return nil
}

var tags stringSlice

func init() {
    flag.Var(&tags, "tag", "tag to attach (repeatable)")
}
```

Now `-tag a -tag b -tag c` produces `tags == []string{"a", "b", "c"}`.
The flag does *not* split on commas by default; `-tag=a,b,c` would put
the literal string `"a,b,c"` into the slice. If you want
comma-splitting too:

```go
func (s *stringSlice) Set(v string) error {
    parts := strings.Split(v, ",")
    *s = append(*s, parts...)
    return nil
}
```

Now `-tag=a,b -tag=c` yields `[a b c]`. Pick one convention and document
it in the usage string — mixing both behaviors silently is the path to
bug reports.

## 4. Enumerated values

A flag that accepts only a fixed set of strings:

```go
type logLevel string

const (
    levelDebug logLevel = "debug"
    levelInfo  logLevel = "info"
    levelWarn  logLevel = "warn"
    levelError logLevel = "error"
)

var validLevels = []logLevel{levelDebug, levelInfo, levelWarn, levelError}

func (l *logLevel) String() string { return string(*l) }

func (l *logLevel) Set(s string) error {
    for _, v := range validLevels {
        if string(v) == s {
            *l = v
            return nil
        }
    }
    return fmt.Errorf("must be one of %v", validLevels)
}

var level = levelInfo

func init() {
    flag.Var(&level, "log-level", "log verbosity (debug|info|warn|error)")
}
```

The error message names the valid choices. The default value is set by
initializing `level = levelInfo` before `flag.Var`; the package never
calls `Set` for default values, so you must assign yourself.

## 5. Custom types from the standard library

Common case: a flag whose value is a `net.IP`, `time.Time`, or
`*url.URL`. Wrap and forward.

```go
type ipFlag struct{ ip *net.IP }

func (f ipFlag) String() string {
    if f.ip == nil || *f.ip == nil {
        return ""
    }
    return f.ip.String()
}

func (f ipFlag) Set(s string) error {
    parsed := net.ParseIP(s)
    if parsed == nil {
        return fmt.Errorf("not a valid IP")
    }
    *f.ip = parsed
    return nil
}

var bind net.IP = net.IPv4(127, 0, 0, 1)

func init() {
    flag.Var(ipFlag{&bind}, "bind", "address to bind to")
}
```

The wrapper struct holds a pointer to the real variable so the original
can keep its natural type for use elsewhere in the program. This avoids
peppering `*` everywhere in the rest of the code.

## 6. Defining a flag set: `flag.NewFlagSet`

`flag.CommandLine` is fine for `main`, but for subcommands and tests
you want isolated flag sets:

```go
fs := flag.NewFlagSet("serve", flag.ContinueOnError)
addr := fs.String("addr", ":8080", "listen address")
tls  := fs.Bool("tls", false, "enable TLS")

if err := fs.Parse(os.Args[2:]); err != nil {
    return err
}
```

The constructor takes a name (used in the default usage message) and an
`ErrorHandling` mode (we'll get to those in section 9). The returned
`*FlagSet` has the same defining methods as the global flag — `String`,
`Int`, `Var`, `Parse`, `NArg`, `Args`, etc.

`*FlagSet` is *not* safe for concurrent use. One goroutine should own
parsing.

## 7. Subcommands with multiple `*FlagSet`s

Here's the standard hand-rolled subcommand skeleton:

```go
package main

import (
    "flag"
    "fmt"
    "os"
)

func main() {
    if len(os.Args) < 2 {
        usage()
        os.Exit(2)
    }
    switch os.Args[1] {
    case "serve":
        serveCmd(os.Args[2:])
    case "migrate":
        migrateCmd(os.Args[2:])
    case "help", "-h", "--help":
        usage()
    default:
        fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
        usage()
        os.Exit(2)
    }
}

func usage() {
    fmt.Fprintln(os.Stderr, "usage: app <command> [flags]")
    fmt.Fprintln(os.Stderr, "commands:")
    fmt.Fprintln(os.Stderr, "  serve    run the HTTP server")
    fmt.Fprintln(os.Stderr, "  migrate  apply database migrations")
}

func serveCmd(args []string) {
    fs := flag.NewFlagSet("serve", flag.ExitOnError)
    addr := fs.String("addr", ":8080", "listen address")
    fs.Parse(args)
    fmt.Println("serving on", *addr)
}

func migrateCmd(args []string) {
    fs := flag.NewFlagSet("migrate", flag.ExitOnError)
    dir := fs.String("dir", "./migrations", "migration directory")
    fs.Parse(args)
    fmt.Println("migrating from", *dir)
}
```

Three points:

1. The dispatch happens *before* any flag parsing. `os.Args[1]` is the
   subcommand name; `os.Args[2:]` is what the subcommand sees.
2. Each subcommand owns its own `*FlagSet`. There is no flag pollution
   between them.
3. Global flags (e.g., `--config` shared by all subcommands) belong on
   `flag.CommandLine`, parsed once before dispatch — but be careful, the
   global parser stops at the first non-flag argument, which means
   `app --config=x serve` works and `app serve --config=x` doesn't.
   Most projects either skip global flags or duplicate them per
   subcommand.

## 8. Customizing `Usage` per `FlagSet`

Each `FlagSet` has its own `Usage` field. Replace it for richer help:

```go
func serveCmd(args []string) {
    fs := flag.NewFlagSet("serve", flag.ExitOnError)
    addr := fs.String("addr", ":8080", "listen address")
    fs.Usage = func() {
        fmt.Fprintln(fs.Output(), "usage: app serve [flags]")
        fmt.Fprintln(fs.Output(), "Run the HTTP server.")
        fmt.Fprintln(fs.Output(), "\nFlags:")
        fs.PrintDefaults()
    }
    fs.Parse(args)
    _ = addr
}
```

`fs.Output()` returns the current output writer (defaulting to
`os.Stderr`). `fs.PrintDefaults()` writes the per-flag table for *this*
flag set, not the global one.

For the global `flag.CommandLine`, you can either set `flag.Usage` or
`flag.CommandLine.Usage` — they are the same field. Changing one
changes the other.

## 9. `ErrorHandling` modes

`flag.NewFlagSet` takes one of three modes:

| Mode | Behavior on parse error |
|------|-------------------------|
| `flag.ContinueOnError` | `Parse` returns the error to you |
| `flag.ExitOnError` | Print error + usage, call `os.Exit(2)` |
| `flag.PanicOnError` | Print error + usage, panic with the error |

The global `flag.CommandLine` defaults to `ExitOnError`. In tests and
libraries, almost always use `ContinueOnError` — you want to handle
errors yourself, not have your test runner exit:

```go
fs := flag.NewFlagSet("test", flag.ContinueOnError)
fs.SetOutput(io.Discard) // suppress noise during tests
addr := fs.String("addr", ":80", "")
err := fs.Parse([]string{"-addr=bad value: not a flag"})
if err != nil {
    // handle here, no os.Exit
}
_ = addr
```

`PanicOnError` is rarely useful. It's there for code that wants
`recover()` semantics around CLI parsing — almost no production code
does.

## 10. Environment-variable fallback

`flag` has no native env-var support. The standard idiom is to layer it
in front of `flag.Parse`, with command-line flags overriding env vars:

```go
func envOr(name, def string) string {
    if v, ok := os.LookupEnv(name); ok {
        return v
    }
    return def
}

var (
    addr  = flag.String("addr", envOr("APP_ADDR", ":8080"), "listen address")
    debug = flag.Bool("debug", envOr("APP_DEBUG", "") == "true", "verbose logging")
)
```

The default is computed *before* `flag.Parse`; if the user passes
`-addr=:9090`, that takes precedence. If they don't, the env var wins.
If both are absent, the literal default applies.

This pattern is one-directional (env feeds flag, not the other way).
For a more rigorous "CLI > env > config-file > default" precedence, see
[professional.md](professional.md).

For per-flag env binding without losing the type-checked default, use a
helper:

```go
func intFlag(name string, def int, env, usage string) *int {
    if v, ok := os.LookupEnv(env); ok {
        if n, err := strconv.Atoi(v); err == nil {
            def = n
        }
    }
    return flag.Int(name, def, usage+" [env "+env+"]")
}

var port = intFlag("port", 8080, "APP_PORT", "listen port")
```

The usage string now advertises the env var too, which keeps
documentation honest.

## 11. Walking flags: `Visit` and `VisitAll`

Two helpers iterate over registered flags:

```go
flag.VisitAll(func(f *flag.Flag) {
    fmt.Printf("%s = %v (default %s)\n", f.Name, f.Value, f.DefValue)
})

flag.Visit(func(f *flag.Flag) {
    fmt.Printf("user set: %s = %v\n", f.Name, f.Value)
})
```

- `VisitAll` walks every registered flag in lexical order, whether the
  user set it or not.
- `Visit` walks only the flags the user actually passed on the command
  line.

`Visit` is the answer to "which flags did the user explicitly set?",
which is the closest you get to required-flag detection or to
distinguishing "default" from "explicitly set to default". Combine it
with a `set := map[string]bool{}` to make the answer indexable:

```go
set := map[string]bool{}
flag.Visit(func(f *flag.Flag) { set[f.Name] = true })

if !set["config"] {
    fmt.Fprintln(os.Stderr, "missing required flag: -config")
    os.Exit(2)
}
```

That's how you make a flag "required" in `flag` — there is no built-in
mechanism, but `Visit` plus a check is six lines.

## 12. Required flags as a helper

Wrap the pattern from section 11 once, use it everywhere:

```go
func requireFlags(fs *flag.FlagSet, names ...string) error {
    set := map[string]bool{}
    fs.Visit(func(f *flag.Flag) { set[f.Name] = true })
    var missing []string
    for _, n := range names {
        if !set[n] {
            missing = append(missing, "-"+n)
        }
    }
    if len(missing) > 0 {
        return fmt.Errorf("required flag(s) missing: %v", missing)
    }
    return nil
}

func main() {
    cfg := flag.String("config", "", "path to config file")
    flag.Parse()
    if err := requireFlags(flag.CommandLine, "config"); err != nil {
        fmt.Fprintln(os.Stderr, err)
        flag.Usage()
        os.Exit(2)
    }
    _ = cfg
}
```

Document the required flags in your `Usage` so the help message reflects
reality. The package will not do this for you.

## 13. Testable `main`: pass `args` and `out` explicitly

The straightforward `main` is impossible to test:

```go
// hard to test
func main() {
    flag.Parse()
    run(*verbose, flag.Args())
}
```

Refactor: hoist parsing into a function that accepts the slice and the
writers. `main` becomes a six-line glue layer.

```go
func run(args []string, out, errOut io.Writer) int {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    fs.SetOutput(errOut)
    verbose := fs.Bool("v", false, "verbose")
    if err := fs.Parse(args); err != nil {
        return 2
    }
    if *verbose {
        fmt.Fprintln(out, "running verbosely")
    }
    fmt.Fprintln(out, "args:", fs.Args())
    return 0
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
```

Now the test:

```go
func TestRun(t *testing.T) {
    var out, err bytes.Buffer
    code := run([]string{"-v", "x", "y"}, &out, &err)
    if code != 0 {
        t.Fatalf("exit %d, stderr=%q", code, err.String())
    }
    if !strings.Contains(out.String(), "args: [x y]") {
        t.Errorf("unexpected stdout: %q", out.String())
    }
}
```

No globals, no race between tests, no `os.Exit`, no captured stderr to
disentangle. Each test gets a fresh `*FlagSet` and writes to a fresh
buffer. This is the same testability principle from
[`01-io-and-file-handling/junior.md`](../01-io-and-file-handling/junior.md)
section 18 — accept interfaces, return values, push side effects to the
edges.

## 14. Preserving order between flags and positional args

By default, `Parse` stops at the first non-flag argument. So:

```
$ ./app -v file.txt -x
```

If `-x` is a registered flag, it's *not* parsed — `-x` is part of
`flag.Args()` because it came after `file.txt`. This is the standard
Go convention; it matches the `go` tool's own behavior.

If you want flags and positional arguments to interleave freely, you
have two options:

1. **Pre-process `os.Args`** to move all flags to the front before
   calling `Parse`. Doable but error-prone — you'd duplicate the parser
   to know what's a flag.
2. **Loop on `Parse`**, slicing the remaining args after each call:

   ```go
   args := os.Args[1:]
   for {
       fs := flag.NewFlagSet("app", flag.ContinueOnError)
       fs.SetOutput(io.Discard)
       fs.String("v", "", "")  // re-register flags
       if err := fs.Parse(args); err != nil { break }
       if fs.NArg() == 0 { break }
       positional = append(positional, fs.Arg(0))
       args = fs.Args()[1:]
   }
   ```

   This is clunky but functional. Most CLIs accept the standard
   convention and document "put flags before file arguments."

## 15. Combining a global flag and subcommands

The pattern most internal tools settle on:

```go
var verbose = flag.Bool("v", false, "verbose logging")

func main() {
    flag.Parse() // global flags only
    args := flag.Args()
    if len(args) == 0 {
        usage()
        os.Exit(2)
    }
    switch args[0] {
    case "serve":
        serveCmd(args[1:])
    case "migrate":
        migrateCmd(args[1:])
    default:
        fmt.Fprintf(os.Stderr, "unknown command %q\n", args[0])
        os.Exit(2)
    }
}
```

`-v` works as `app -v serve --port=80` but not as `app serve -v
--port=80`. If both placements should work, declare `-v` on each
subcommand `*FlagSet` too, sharing a `*bool` via `BoolVar`:

```go
var verbose bool

func init() { flag.BoolVar(&verbose, "v", false, "verbose") }

func serveCmd(args []string) {
    fs := flag.NewFlagSet("serve", flag.ExitOnError)
    fs.BoolVar(&verbose, "v", verbose, "verbose")
    // ...
}
```

The default for the subcommand-level `-v` is the current value of
`verbose` (set by the global parse), so the global value carries through
unless overridden.

## 16. Deferred default values via `flag.Value`

A useful trick: since `Set` is called by the parser, you can compute a
default lazily. Combine with env vars:

```go
type defaulted struct {
    set   bool
    value string
}

func (d *defaulted) String() string { return d.value }
func (d *defaulted) Set(s string) error {
    d.value = s
    d.set = true
    return nil
}

var addr defaulted

func init() {
    addr.value = ":8080" // baseline default
    flag.Var(&addr, "addr", "listen address")
}

func main() {
    flag.Parse()
    if !addr.set {
        if env, ok := os.LookupEnv("APP_ADDR"); ok {
            addr.value = env
        }
    }
    fmt.Println("listening on", addr.value)
}
```

The `set` field tells you whether the user explicitly passed `-addr`.
If they didn't, you fall back to `APP_ADDR`, then to the literal default.
This is the precedence "CLI > env > default" with one struct.

## 17. Capturing the subcommand name in errors

When parsing fails inside a subcommand, the default error message is
`flag provided but not defined: -bad`. Useful, but ambiguous in a
multi-command CLI. The subcommand name is in `fs.Name()`:

```go
fs := flag.NewFlagSet("serve", flag.ContinueOnError)
fs.SetOutput(io.Discard)
if err := fs.Parse(args); err != nil {
    return fmt.Errorf("%s: %w", fs.Name(), err)
}
```

Wrap the error with the subcommand name to make debugging tractable.
Suppressing the default stderr output (via `SetOutput(io.Discard)`)
prevents the duplicate "flag provided but not defined" line that the
parser would otherwise print.

## 18. Reading a config file into flags

A common pattern: load a YAML/TOML/JSON config first, then let the
command line override.

```go
type Config struct {
    Addr  string
    Quiet bool
}

func loadConfig(path string) (*Config, error) { /* ... */ return &Config{}, nil }

func main() {
    cfgPath := flag.String("config", "", "config file path")
    flag.Parse()

    cfg := &Config{Addr: ":8080"} // built-in defaults
    if *cfgPath != "" {
        loaded, err := loadConfig(*cfgPath)
        if err != nil {
            fmt.Fprintln(os.Stderr, err)
            os.Exit(2)
        }
        cfg = loaded
    }

    // Re-parse with config values as the new defaults.
    fs := flag.NewFlagSet("app", flag.ExitOnError)
    fs.StringVar(&cfg.Addr, "addr", cfg.Addr, "listen address")
    fs.BoolVar(&cfg.Quiet, "quiet", cfg.Quiet, "suppress logs")
    fs.Parse(os.Args[1:]) // command-line overrides config

    fmt.Printf("%+v\n", cfg)
}
```

Two parses: the first to find the config file (one flag), the second
to use the config values as defaults for everything else. The price is
a slightly awkward two-phase init; the benefit is a clear precedence
chain. [professional.md](professional.md) extends this to a fully
deterministic merge with explicit env-var ordering.

## 19. Suppressing the auto-help on a custom `FlagSet`

By default, every `*FlagSet` reacts to `-h` and `--help` by calling
`Usage` and returning `flag.ErrHelp` from `Parse`. In `ContinueOnError`
mode, you can detect this:

```go
err := fs.Parse(args)
if errors.Is(err, flag.ErrHelp) {
    return 0 // help requested, exit cleanly
}
if err != nil {
    return 2
}
```

This keeps `-h` from triggering an "error" exit code while still
letting you handle real parse errors. In `ExitOnError` mode, `-h`
already exits with status 0; in `ContinueOnError`, you have to decide.

## 20. Concurrency rules

`*flag.FlagSet` is not safe for concurrent use. Two goroutines calling
`fs.Parse` on the same set race. Two goroutines reading flag values
*after* a single `Parse` are fine — the values are stable strings or
basic types and `Parse` happens-before any subsequent reads (assuming
the reads are sequenced correctly with respect to the goroutine that
called `Parse`).

`flag.CommandLine` is the same: parse once from `main`, then read
freely. If you need to reparse (a hot-reload scenario), serialize
through a mutex, or build a new `*FlagSet` from scratch.

## 21. Putting it together: a small `kvtool`

A subcommand-driven tool with custom flag types, env fallback, and a
testable `run` function:

```go
package main

import (
    "errors"
    "flag"
    "fmt"
    "io"
    "os"
    "strings"
)

type kvList []string

func (k *kvList) String() string { return strings.Join(*k, ",") }
func (k *kvList) Set(s string) error {
    if !strings.Contains(s, "=") {
        return fmt.Errorf("expected key=value, got %q", s)
    }
    *k = append(*k, s)
    return nil
}

func envOr(name, def string) string {
    if v, ok := os.LookupEnv(name); ok {
        return v
    }
    return def
}

func run(args []string, out, errOut io.Writer) int {
    if len(args) == 0 {
        fmt.Fprintln(errOut, "usage: kvtool <set|list> [flags]")
        return 2
    }
    switch args[0] {
    case "set":
        return setCmd(args[1:], out, errOut)
    case "list":
        return listCmd(args[1:], out, errOut)
    default:
        fmt.Fprintf(errOut, "unknown command %q\n", args[0])
        return 2
    }
}

func setCmd(args []string, out, errOut io.Writer) int {
    fs := flag.NewFlagSet("set", flag.ContinueOnError)
    fs.SetOutput(errOut)
    var pairs kvList
    fs.Var(&pairs, "kv", "key=value pair (repeatable)")
    file := fs.String("file", envOr("KV_FILE", "kv.db"), "store file")
    if err := fs.Parse(args); err != nil {
        if errors.Is(err, flag.ErrHelp) {
            return 0
        }
        return 2
    }
    fmt.Fprintf(out, "writing %d pair(s) to %s\n", len(pairs), *file)
    for _, p := range pairs {
        fmt.Fprintln(out, "  ", p)
    }
    return 0
}

func listCmd(args []string, out, errOut io.Writer) int {
    fs := flag.NewFlagSet("list", flag.ContinueOnError)
    fs.SetOutput(errOut)
    file := fs.String("file", envOr("KV_FILE", "kv.db"), "store file")
    if err := fs.Parse(args); err != nil {
        if errors.Is(err, flag.ErrHelp) {
            return 0
        }
        return 2
    }
    fmt.Fprintf(out, "listing %s\n", *file)
    return 0
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
```

A test against the same `run`:

```go
func TestSetCmd(t *testing.T) {
    var out, errOut bytes.Buffer
    code := run([]string{"set", "-kv", "a=1", "-kv", "b=2"}, &out, &errOut)
    if code != 0 {
        t.Fatalf("exit %d, stderr=%q", code, errOut.String())
    }
    if !strings.Contains(out.String(), "writing 2 pair(s)") {
        t.Errorf("unexpected output: %q", out.String())
    }
}
```

No globals, no `os.Exit` from the test, no captured stderr from the
process — the entire CLI is exercisable as a function.

## 22. What to read next

- [senior.md](senior.md) — exact parse semantics, the `init()`/
  `testing.M` story, and how `go test` itself uses `flag`.
- [professional.md](professional.md) — full subcommand framework,
  config merge, env precedence, completion generation.
- [find-bug.md](find-bug.md) — drills based on the bugs in this file.
- [tasks.md](tasks.md) — exercises that practice custom `Value` types
  and subcommand layout.

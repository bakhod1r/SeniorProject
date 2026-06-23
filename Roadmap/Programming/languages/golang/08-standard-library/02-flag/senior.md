# 8.2 `flag` — Senior

> **Audience.** You've shipped CLIs with subcommands, custom `Value`
> types, and env fallback. You've also been bitten — by a flag that
> didn't override its default, by a test that fought the global
> `flag.CommandLine`, by `go test` swallowing your `-foo` flag for
> reasons unclear. This file is the precise picture: how the parser
> walks `os.Args`, the exact error semantics, the interaction with
> `init()` and `testing.M`, and the architectural choices that keep a
> CLI sane at scale.

## 1. The parse algorithm, exactly

`(f *FlagSet).Parse(args []string)` runs a small loop:

1. Drop the program name? **No** — `Parse` does not look at `args[0]`
   specially. The caller is responsible for slicing past the program
   name (which is why every example uses `os.Args[1:]`, never
   `os.Args`).
2. Read `args[i]`. If it doesn't start with `-`, or it is exactly `-`,
   stop parsing and treat the rest as positional arguments.
3. If it is exactly `--`, advance past it and stop parsing flags.
4. Strip leading `-` (one or two).
5. Find the first `=`. If present, split into name and value; the
   value is the rest of the string. If absent, the name is the whole
   thing.
6. Look up the name in the `FlagSet`. If not present, error with
   `flag provided but not defined: -<name>`.
7. If the flag is a `boolFlag` (a `Value` whose underlying type
   implements `IsBoolFlag() bool` returning true), and there was no
   `=`, the value is `"true"`. Otherwise, if there was no `=`, the
   value is `args[i+1]` and `i` is advanced.
8. Call `f.Value.Set(value)`. If it returns an error, fail with
   `invalid value "<value>" for flag -<name>: <err>`.
9. Move to the next argument.

That's the whole parser. A few things become obvious once you see it
written out:

- **The space form needs the next argument.** `-name value` advances
  twice; `-name=value` advances once. If `-name` is the last argument
  and isn't a boolean, Parse errors with `flag needs an argument`.
- **Boolean flags peek at their type.** The `IsBoolFlag()` method is
  the runtime hook that tells the parser "no value follows by
  default." Custom `Value` types can opt in by implementing it.
- **Stop conditions terminate cleanly.** `-`, `--`, or any non-flag
  argument ends the loop and goes into `f.Args()`.
- **No abbreviation matching, no fuzzy lookup.** The name must match
  exactly.

## 2. `IsBoolFlag` and custom boolean-like types

If you want `Set` to be optional (so `-feature` works without `=true`),
make your type implement:

```go
type boolFlag interface {
    Value
    IsBoolFlag() bool
}
```

```go
type onOff bool

func (o *onOff) String() string {
    if o == nil { return "false" }
    return strconv.FormatBool(bool(*o))
}
func (o *onOff) Set(s string) error {
    v, err := strconv.ParseBool(s)
    if err != nil { return err }
    *o = onOff(v)
    return nil
}
func (o *onOff) IsBoolFlag() bool { return true }
```

Now `flag.Var(&toggle, "feature", "...")` accepts both `-feature` and
`-feature=false`. Without `IsBoolFlag`, the parser would consume the
next argument when the user typed `-feature` alone.

The downside: same `-feature value` quirk as built-in booleans. The
space-separated form is interpreted as `-feature=true` plus `"value"`
as a positional argument.

## 3. The `-h`, `--help` path

When the parser encounters `-h` or `--help` and the flag set has not
explicitly registered a flag with that name, it does *not* error.
Instead:

1. Calls `f.Usage()` (which by default calls
   `f.defaultUsage()` — the auto-generated table).
2. Returns `flag.ErrHelp` from `Parse`.

In `ContinueOnError` mode, your code receives `flag.ErrHelp`. The
right thing to do is exit cleanly:

```go
if err := fs.Parse(args); err != nil {
    if errors.Is(err, flag.ErrHelp) {
        return 0
    }
    return 2
}
```

In `ExitOnError` mode (`flag.CommandLine`'s default), `-h` calls
`os.Exit(0)` after `Usage`. This is one of the few cases where the
package exits cleanly rather than with status 2.

If you register your own `-h` flag, the auto-help disappears for that
flag set. The user's `-h` will be parsed against your registration. The
package's `Usage` is still callable, just no longer wired to `-h`.

## 4. The exact errors `Parse` returns

`Parse` returns one of (when `ErrorHandling != ExitOnError`):

| Error | When |
|-------|------|
| `nil` | All arguments parsed |
| `flag.ErrHelp` | `-h` or `--help` was seen |
| Wrapped `errParse` | A bad value, e.g. `-port=abc` |
| Wrapped `*errors.errorString` "flag provided but not defined: ..." | Unknown flag name |
| Wrapped `*errors.errorString` "flag needs an argument: ..." | Non-bool flag with no value and no following arg |
| Wrapped `*errors.errorString` "bad flag syntax: ..." | A `-` followed by `=` (e.g., `-=foo`) or `--=foo` |

The errors are not exported types (with the exception of `ErrHelp`).
You can match them with `errors.Is(err, flag.ErrHelp)` for help; for
the rest, you typically don't need to switch on them — printing the
error message is enough. The package's own help flow does this for you.

## 5. `flag.Parse` and `init()`

A common mistake: defining flags in `init()` of a library, then having
the application call `flag.Parse` and find unfamiliar `-foo` flags
listed in its help output.

The mechanic: `init()` functions of imported packages run before
`main`. Each `flag.String` call inside an `init()` registers a flag on
the global `flag.CommandLine` *before* the application has any chance
to weigh in. By the time `main` runs `flag.Parse`, the flag set
already includes flags from every transitive dependency that touched
the global.

The `glog` and `klog` packages are the famous offenders here — both
register a half-dozen flags at import time. The pattern that mitigates
this:

1. Libraries should never call `flag.X` on the global `flag.CommandLine`.
2. Libraries that need configurable knobs should expose a function the
   application calls explicitly:

   ```go
   // in the library
   func RegisterFlags(fs *flag.FlagSet) {
       fs.Int("workers", 4, "concurrent workers")
   }

   // in the application
   func main() {
       lib.RegisterFlags(flag.CommandLine)
       flag.Parse()
   }
   ```

3. If you have to import a library that pollutes the global, you can
   filter its flags out of your `Usage` or override their defaults
   before `Parse`.

The standard library itself follows the rule. `net/http` does not
register flags. `database/sql` does not register flags. Only `testing`
does, and it does so for a reason — see section 9.

## 6. `flag.CommandLine`, `flag.Parsed`, `flag.Set`

Three less-used global helpers worth knowing:

- `flag.Parsed() bool` — true after `flag.Parse` has run on
  `flag.CommandLine`. Useful in libraries that want to assert "the
  application has parsed flags before calling me." Don't rely on this
  for ordering — it tells you "yes, parse happened" but not "yes, the
  arguments you care about were processed." Better to require explicit
  registration.

- `flag.Set(name, value string) error` — programmatically set a flag's
  value, as if the user had typed it. This calls the underlying
  `Value.Set`. Tests use it heavily:

  ```go
  flag.Set("config", "/tmp/test.yaml")
  ```

  It works whether or not `Parse` has been called; it's a direct
  writeback through the `Value` interface.

- `flag.Lookup(name) *flag.Flag` — find a registered flag by name,
  return `nil` if absent. The returned `*flag.Flag` exposes
  `.Name`, `.Usage`, `.Value`, and `.DefValue` (the *string* form of
  the default).

Together these let you introspect or mutate flags from anywhere in the
program. They are also how completion generators discover available
flags.

## 7. `testing.M` and `flag.Parse` — the dance

`go test` builds a binary that includes a `TestMain` (yours, if you
wrote one; the default otherwise). The default `TestMain` calls
`testing.Main` which calls `flag.Parse`. *Before* that, the `testing`
package's `init` registers all its `-test.*` flags on the global
`flag.CommandLine`.

This means:

1. Inside a `TestXxx` function, any flag you defined at package scope
   is already parsed — `flag.Parsed()` returns true.
2. Flags you want to add for tests must be registered *before*
   `flag.Parse` runs. Putting them at package scope (or in a `TestMain`
   that calls `flag.Parse` itself) is the only way.
3. `go test -my.flag=foo` works only if `my.flag` is registered. The
   `go test` binary inherits all flags from your test code's globals.

A `TestMain` that lets you customize:

```go
func TestMain(m *testing.M) {
    // register custom flags here, before Parse
    flag.Bool("integration", false, "run integration tests")
    flag.Parse()
    os.Exit(m.Run())
}
```

If you forget `flag.Parse()` in your `TestMain`, the `testing` package
will *not* parse for you, and `-test.run`, `-test.v`, and friends will
appear as undefined flags. Whenever you write `TestMain`, parse flags.

## 8. The `-args` separator

`go test ./... -- -my.flag=foo` is wrong. The right form is `go test
./... -args -my.flag=foo`. The `-args` token tells `go test` to stop
consuming flags itself and pass the rest to the test binary. From the
test binary's perspective, those arguments arrive as `os.Args[1:]` and
the test binary's own `flag.Parse` (in `testing.Main`) sees them
normally.

This is `go test`'s convention; the `flag` package itself has no
special knowledge of `-args`. Inside a test binary, the args after
`-args` look like ordinary CLI arguments.

## 9. How `go test` registers its flags

The `testing` package has a long `init` that calls `flag.Var` for every
`-test.*` flag (`-test.run`, `-test.v`, `-test.bench`, `-test.timeout`,
etc.). They're all registered on the global `flag.CommandLine`.

The `go test` driver then translates user-friendly forms (`-v`,
`-run=Foo`) into the prefixed form (`-test.v=true`,
`-test.run=Foo`) before running the binary. Inside the binary,
`flag.Parse` sees the long form and dispatches normally.

The implication for your own tests: if you register a flag named
`run` or `v` at package scope, you collide with the testing
infrastructure's translated names. Avoid the short ones — prefix yours
with the package name, or use longer names.

## 10. Resetting a flag set: there isn't a public API

`*FlagSet` has no public `Reset` or `Clear`. To re-parse a different
slice of arguments, you have two options:

1. Construct a new `*FlagSet` from scratch and re-register every flag.
2. Use the unexported `actual` map directly via `Visit` — but the map
   itself is unexported, so you can't clear it without reflection.

The recommended pattern is option 1. For tests that want to parse
multiple times, define a helper that builds a fresh `*FlagSet`:

```go
func newAppFlags() (*flag.FlagSet, *string, *bool) {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    addr := fs.String("addr", ":8080", "")
    quiet := fs.Bool("quiet", false, "")
    return fs, addr, quiet
}

func TestParse(t *testing.T) {
    cases := []struct {
        args     []string
        wantAddr string
    }{
        {[]string{}, ":8080"},
        {[]string{"-addr=:9090"}, ":9090"},
    }
    for _, c := range cases {
        fs, addr, _ := newAppFlags()
        if err := fs.Parse(c.args); err != nil {
            t.Fatal(err)
        }
        if *addr != c.wantAddr { /* ... */ }
    }
}
```

A new `*FlagSet` per test case is cheap. There's no shared state, no
order dependencies, and tests can run in parallel.

## 11. Subcommand dispatching architectures

Three common shapes:

### a) Switch in `main`

```go
switch os.Args[1] {
case "serve":   serveCmd(os.Args[2:])
case "migrate": migrateCmd(os.Args[2:])
}
```

Trivial, scales to a handful of commands, awkward beyond that. Each
new command is a new case plus a new function. No common middleware.

### b) Map of name → handler

```go
type cmd struct {
    summary string
    run     func(args []string) int
}

var commands = map[string]cmd{
    "serve":   {"run the HTTP server", serveCmd},
    "migrate": {"apply database migrations", migrateCmd},
}

func main() {
    if len(os.Args) < 2 {
        usage()
        os.Exit(2)
    }
    c, ok := commands[os.Args[1]]
    if !ok {
        fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
        usage()
        os.Exit(2)
    }
    os.Exit(c.run(os.Args[2:]))
}

func usage() {
    fmt.Fprintln(os.Stderr, "commands:")
    var names []string
    for n := range commands { names = append(names, n) }
    slices.Sort(names)
    for _, n := range names {
        fmt.Fprintf(os.Stderr, "  %-10s %s\n", n, commands[n].summary)
    }
}
```

The map of `cmd` structs scales to dozens. Each command exposes a
function and a summary. Help output is auto-generated from the map.
Adding a command is one entry. This is the shape most production CLIs
end up with before they reach for `cobra`.

### c) Tree of `*FlagSet`s

For nested subcommands (`app remote add origin url`), build a tree.
Each node has its own `*FlagSet` and its own children map. Walk the
tree as you walk `os.Args`. This is essentially what `cobra` does
internally, simplified. Once you write it twice, `cobra` looks
appealing.

## 12. Distinguishing "user set" vs "default" — three options

`flag` doesn't track per-flag "was this set by the user" — but you can
recover it three ways:

1. **`Visit` after `Parse`.** Walks only the flags the user set. Build
   a `map[string]bool` for O(1) lookup later.

2. **Sentinel default.** Set the default to a value that can never be
   chosen legitimately — e.g., `-1` for a port. Check `if *port == -1`
   to know "not set."

3. **Custom `Value` that records.** Implement a `Value` whose `Set`
   flips an internal `set` boolean. Read the boolean to know the user's
   intent.

Option 1 is the most general. Option 2 works for closed value
domains. Option 3 lets you keep the flag's natural type while still
learning whether the user typed it.

The need for "user set vs default" comes up in three places:

- **Required flag enforcement** — print "missing -config" if not set.
- **Precedence merging** — only override env-var/config-file values
  when the user explicitly typed the flag.
- **Diagnostic logging** — print "running with: addr=:8080 (default)"
  vs "running with: addr=:80 (cmdline)".

Pick the simplest mechanism that works for your case. Option 1 is the
default answer.

## 13. The `Output` field and where errors go

Each `*FlagSet` has an output writer (default `os.Stderr`). Every
internal write — usage, error messages, the auto-help — goes through
it.

```go
fs.SetOutput(io.Discard) // silence
fs.SetOutput(&buf)       // capture in tests
fs.SetOutput(os.Stdout)  // bend to your will
```

For the global flag set, `flag.CommandLine.SetOutput(...)` and reading
it via `flag.CommandLine.Output()` work. There is no `flag.SetOutput`
shorthand at the package level.

In tests, capturing into a `bytes.Buffer` is the standard technique:

```go
var buf bytes.Buffer
fs := flag.NewFlagSet("t", flag.ContinueOnError)
fs.SetOutput(&buf)
err := fs.Parse([]string{"-bad"})
if !strings.Contains(buf.String(), "flag provided but not defined: -bad") {
    t.Errorf("unexpected output: %q", buf.String())
}
```

This is also how you write tests for custom usage messages — set the
output to a buffer, call `fs.Usage()`, assert on the content.

## 14. `PrintDefaults` formatting rules

`PrintDefaults` walks the flag set in lexical name order and prints
each flag in a fixed format:

```
  -name string
        usage description (default "value")
```

The leading two spaces, the type name on the same line, the indented
description on the next line, the optional `(default ...)` suffix.

Three formatting subtleties:

1. **The type name is derived from the `Value`'s `Get()` return
   type** if it implements `Getter`. Otherwise it's omitted, leaving
   only `-name`.

2. **The default suffix appears only if the flag's `DefValue` is not
   the zero value of its type.** `DefValue` is the string the package
   captured at registration time by calling `Value.String()` once
   immediately after `flag.Var`. (For built-in types, this is just
   `fmt.Sprintf("%v", default)`.)

3. **You can hide flags by registering a custom `Usage` or by
   filtering output.** The package itself has no "hidden flag" concept,
   but `PrintDefaults` walks the same set returned by `VisitAll`, so
   you can either re-implement `Usage` to skip flags or set their
   `Usage` field to start with a special marker your custom `Usage`
   recognizes.

## 15. Getting `os.Exit` out of your tests

The `flag` package's `ExitOnError` mode calls `os.Exit` directly. In
tests, that kills the test process. Two patterns:

1. **Use `ContinueOnError` everywhere except the literal global
   default.** Your test code constructs its own `*FlagSet`s with
   `ContinueOnError`. The application's `flag.CommandLine` keeps
   `ExitOnError` for the user-facing binary.

2. **Refactor `main` into a `run(args, out, errOut) int` function.**
   `main` becomes `os.Exit(run(...))`. Tests call `run` directly. The
   test never invokes `os.Exit`, and you can assert on the return
   code as a normal value. This is the pattern from middle.md
   section 13.

The two patterns combine: write `run` to take a `*FlagSet` (or
construct one inside with `ContinueOnError`), and `main` constructs
the global flag set or calls `flag.Parse`. Either way, your test
process never exits.

## 16. The `flag.Flag` struct

Every registered flag is internally a `*flag.Flag`:

```go
type Flag struct {
    Name     string
    Usage    string
    Value    Value
    DefValue string // string form of the default
}
```

That's all four exported fields. There's no `Required`, no
`Hidden`, no `Group`, no `EnvVar`. To attach metadata (a category, an
env-var name for help display, an alias list), you wrap the `Value` in
a struct that holds the extra data, and walk `VisitAll` looking up
the wrapper type with a type assertion.

```go
type taggedValue struct {
    flag.Value
    EnvVar string
}

// In your custom Usage:
flag.VisitAll(func(f *flag.Flag) {
    extra := ""
    if tv, ok := f.Value.(*taggedValue); ok && tv.EnvVar != "" {
        extra = fmt.Sprintf(" [env %s]", tv.EnvVar)
    }
    fmt.Fprintf(out, "  -%s\t%s%s\n", f.Name, f.Usage, extra)
})
```

This is the pattern `cobra` formalizes. With `flag` you build it by
hand or live without it.

## 17. `flag.Var` ordering and defaults

`flag.Var(value, name, usage)` captures the value's *current* string
form as `DefValue`. So:

```go
var ports stringSlice
flag.Var(&ports, "port", "ports") // DefValue = ""
ports = append(ports, "8080")     // does not update DefValue
```

The help output will show `(default "")` even though the slice now has
a value. To set defaults that show up in help, mutate the value
*before* the `flag.Var` call:

```go
ports := stringSlice{"8080"}
flag.Var(&ports, "port", "ports") // DefValue = "8080"
```

Same rule for any custom type. The package snapshots the default once.

## 18. Concurrency, exactly

The full picture for `*flag.FlagSet`:

- Multiple goroutines registering flags on the same `*FlagSet`: race.
- Multiple goroutines calling `Parse` on the same `*FlagSet`: race.
- One goroutine calls `Parse`; others read flag values *after* a
  happens-before edge (channel send, mutex unlock, sync.WaitGroup
  Done): safe; values are stable basic types.
- One goroutine calls `Parse`; another goroutine calls `flag.Set`
  concurrently: race on the underlying `Value`.
- Multiple goroutines calling `flag.Lookup` on a stable, fully-
  registered `*FlagSet`: safe (read-only access to the internal map,
  but only if no concurrent writes).

In practice: parse once, then treat the flag set as immutable. If you
need runtime mutation (config reload), serialize.

## 19. Library vs application boundary

The most important design rule for `flag`:

> A library must not call `flag.X` at package scope or in `init()`.

If your library wants to be configurable, expose:

- A `Config` struct.
- A constructor that takes the `Config` (or applies defaults).
- Optionally, a `RegisterFlags(fs *flag.FlagSet, cfg *Config)` helper
  that the application calls explicitly.

This is the difference between a library and a "framework that took
over your CLI." Code that violates this rule (looking at you, `glog`,
`klog`) creates the kind of CLI where running a binary surfaces flags
from libraries the user has no idea their program imports. The
standard library follows the rule. So should yours.

If you must import a polluting library, the mitigation is to filter
out unwanted flags before printing usage:

```go
hidden := map[string]bool{"vmodule": true, "logtostderr": true}
flag.Usage = func() {
    flag.VisitAll(func(f *flag.Flag) {
        if hidden[f.Name] { return }
        fmt.Fprintf(flag.CommandLine.Output(), "  -%s  %s\n", f.Name, f.Usage)
    })
}
```

The flags still exist and still parse; they just don't appear in your
help. Imperfect but workable.

## 20. The anti-pattern: parsing in a library

A library function should never call `flag.Parse`:

```go
// WRONG — turns the library into a CLI
func init() {
    flag.Parse()
}
```

This:

1. Steals `os.Args` parsing from the application.
2. Errors on flags the application defined after the library's `init`
   ran.
3. Makes the library's behavior depend on the binary it's linked into.

If you're writing a library, do not call `flag.Parse`. If you need
configuration before the application's `flag.Parse`, use environment
variables or a constructor argument. Save `flag.Parse` for `main`.

## 21. Behavior on `Parse` failure mid-stream

If `Parse` errors on the third argument out of ten, the previously
parsed flags are *already set*. The error doesn't roll back. The
remaining arguments are not processed.

```go
fs := flag.NewFlagSet("t", flag.ContinueOnError)
a := fs.Int("a", 0, "")
b := fs.Int("b", 0, "")
err := fs.Parse([]string{"-a=1", "-b=bad", "-a=99"})
// err != nil
// *a == 1 (set before -b failed)
// *b == 0 (failed parse never assigned)
// the second -a=99 was never processed
```

This matters when your code reads flag values even after a parse
error — perhaps because you're doing diagnostic logging. Don't trust
flag values after a non-nil `Parse` return; either re-run with a
corrected slice or treat the entire run as failed.

## 22. Compatibility and stability

The `flag` package is one of Go's most stable. Its API has barely
moved since Go 1.0. The few additions:

- `Func(name, usage string, fn func(string) error)` (Go 1.16) — a
  shorthand for declaring a `Value` with just a `Set` function. No
  `String`/`Get`. Useful for one-off "do this when set" actions:

  ```go
  flag.Func("trace", "enable tracing to FILE", func(s string) error {
      return startTracing(s)
  })
  ```

- `BoolFunc(name, usage string, fn func(string) error)` (Go 1.21) —
  same idea for bool-style flags (no value required).

- `TextVar(p TextUnmarshaler, name string, value TextMarshaler, usage)`
  (Go 1.19) — register any type that implements
  `encoding.TextMarshaler`/`TextUnmarshaler`, e.g. `time.Time`,
  `netip.Addr`, `big.Float`. Saves writing a `Value` wrapper.

These are the only meaningful additions in the last decade. The
package is done. Code you write today will work on Go versions for
years.

## 23. What to read next

- [professional.md](professional.md) — building a small subcommand
  framework, deterministic env precedence, completion generation.
- [specification.md](specification.md) — the formal reference distilled.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.
- [optimize.md](optimize.md) — the structural choices that keep `flag`
  code clean even when the topic isn't performance.

External references worth knowing:

- *The Go Programming Language* (Donovan & Kernighan), section 2.3.2 —
  the original `flag` walk-through.
- The `cmd/go` source — `src/cmd/go/main.go` is a real-world `flag`
  user, dispatching subcommands manually with no third-party
  dependencies.
- The `testing` package source — `src/testing/testing.go` shows how
  the testing infrastructure registers and parses its `-test.*` flags.

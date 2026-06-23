# 8.2 `flag` — Junior

> **Audience.** You can write a Go program with `os.Args[1:]` but the
> result feels brittle. Boolean toggles parse wrong, the help message
> doesn't exist, and any time you add a fourth argument the parsing
> code grows another `if` branch. By the end of this file you will know
> the eight functions that cover 90% of `flag` use, the rule that turns
> half the bugs into compile errors, and the shape of a small but real
> CLI program.

## 1. Why not just `os.Args[1:]`?

`os.Args` is a `[]string`. The first element is the program name; the
rest are whatever the shell handed you, in order. Parsing them by hand
gets ugly fast.

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func main() {
    if len(os.Args) < 3 {
        fmt.Fprintln(os.Stderr, "usage: prog <count> <name>")
        os.Exit(2)
    }
    count, err := strconv.Atoi(os.Args[1])
    if err != nil {
        fmt.Fprintln(os.Stderr, "count must be an integer")
        os.Exit(2)
    }
    name := os.Args[2]
    for i := 0; i < count; i++ {
        fmt.Println("hello,", name)
    }
}
```

This is fine for a two-argument throwaway. As soon as you want optional
flags (`--verbose`), default values, or a `-h` that prints documentation,
hand-rolled parsing turns into a small interpreter. The standard
library already has one.

## 2. The four-line program

```go
package main

import (
    "flag"
    "fmt"
)

var name = flag.String("name", "world", "who to greet")

func main() {
    flag.Parse()
    fmt.Println("hello,", *name)
}
```

What just happened:

- `flag.String("name", "world", "who to greet")` registered a flag
  called `name`, with default value `"world"` and a one-line description
  used in the help output. It returned a `*string` that points at a
  package-level variable the `flag` package owns.
- `flag.Parse()` walked `os.Args[1:]`, matched the `-name=...` or
  `-name ...` arguments against the registered flags, and assigned to
  the variable.
- `*name` dereferences the pointer to get the parsed value.

Run it:

```
$ ./greet
hello, world
$ ./greet -name=Bakhodir
hello, Bakhodir
$ ./greet -name Bakhodir
hello, Bakhodir
$ ./greet -h
Usage of ./greet:
  -name string
        who to greet (default "world")
```

The `-h` and `--help` flags are handled automatically: `flag` prints a
generated usage block to `os.Stderr` and exits with status 2.

## 3. The cardinal rule: `flag.Parse` runs first

Every flag-defining call (`flag.String`, `flag.Int`, `flag.Var`, etc.)
returns a pointer immediately, but the pointer holds the *default*
value until `flag.Parse` runs. Reading the variable before `Parse`
gives you the default, not the user input.

```go
var port = flag.Int("port", 8080, "listen port")

func main() {
    log.Println("starting on", *port) // BUG: prints 8080 always
    flag.Parse()
}
```

The fix is a one-line move: every read of a flag variable must come
*after* `flag.Parse()`. As a habit, put `flag.Parse()` as the very first
statement in `main`.

```go
func main() {
    flag.Parse()
    log.Println("starting on", *port) // correct
}
```

The reverse mistake — defining a flag *after* `Parse` — is also broken.
The new flag is registered but never gets a chance to be parsed; it
keeps its default forever. Define all flags at package scope or at the
top of `main`, then call `Parse`.

## 4. The pointer style and the variable style

`flag.String("name", "world", "...")` gives you a `*string`. There is
also a `flag.StringVar` form that writes into a variable you already
have:

```go
var name string

func init() {
    flag.StringVar(&name, "name", "world", "who to greet")
}

func main() {
    flag.Parse()
    fmt.Println("hello,", name) // no dereference
}
```

`StringVar` (and `IntVar`, `BoolVar`, `DurationVar`, `Float64Var`,
`Int64Var`, `Uint64Var`, `Uint64Var`) is mostly a style choice. Use it
when:

- The variable wants to live in a struct field.
- You want to spell out the type rather than read it from the call.
- Multiple flags should write into the same variable (rare, usually a
  smell, but legal).

Otherwise the pointer-returning form is more compact.

## 5. The built-in types

The `flag` package ships with one defining function per common type.
Each comes in a pointer-returning form and a `*Var` form.

| Type | Pointer form | Var form |
|------|--------------|----------|
| `string` | `flag.String(name, def, usage)` | `flag.StringVar(&v, ...)` |
| `int` | `flag.Int(name, def, usage)` | `flag.IntVar(&v, ...)` |
| `int64` | `flag.Int64(...)` | `flag.Int64Var(...)` |
| `uint` | `flag.Uint(...)` | `flag.UintVar(...)` |
| `uint64` | `flag.Uint64(...)` | `flag.Uint64Var(...)` |
| `bool` | `flag.Bool(...)` | `flag.BoolVar(...)` |
| `float64` | `flag.Float64(...)` | `flag.Float64Var(...)` |
| `time.Duration` | `flag.Duration(...)` | `flag.DurationVar(...)` |
| anything else | `flag.Var(value, name, usage)` | (same) |

`flag.Var` takes a value that satisfies the `flag.Value` interface,
which is two methods (`String()` and `Set(string) error`). Custom flag
types live there — covered in [middle.md](middle.md). For now,
everything you need is in the table above.

## 6. Numbers and durations

```go
var (
    port    = flag.Int("port", 8080, "listen port")
    timeout = flag.Duration("timeout", 30*time.Second, "request timeout")
    rate    = flag.Float64("rate", 1.0, "messages per second")
)
```

The parse rules come from `strconv` and `time.ParseDuration`:

- Integers accept decimal (`8080`), hex (`0x1f90`), octal (`0o17620`),
  and binary (`0b1111100110000`). Negative numbers work for signed
  types only.
- Floats accept the usual `1.5`, `1e6`, and `0x1p-2` (hex float).
- Durations are spelled with units: `300ms`, `1.5h`, `45s`, `2h45m`.
  Bare integers are *not* durations — `flag.Duration("timeout", ...)`
  with `-timeout=30` is a parse error.

```
$ ./prog -port=80 -timeout=2s -rate=10
$ ./prog -port=foo
invalid value "foo" for flag -port: parse error
Usage of ./prog: ...
exit status 2
```

A bad value goes to `os.Stderr` along with the usage, and the program
exits with status 2.

## 7. Boolean flags and their one weird quirk

```go
var verbose = flag.Bool("verbose", false, "enable verbose logging")

func main() {
    flag.Parse()
    if *verbose {
        log.SetFlags(log.LstdFlags | log.Lshortfile)
    }
}
```

A boolean flag is set just by mentioning it: `-verbose` is the same as
`-verbose=true`. To turn one off explicitly (only meaningful if the
default is `true`), you must use `-verbose=false`. The form `-verbose
false` (with a space) does *not* work for booleans:

```
$ ./prog -verbose false
# parses as: -verbose=true (default), with "false" as a positional arg
```

This is the single sharpest edge in the package. The parser sees
`-verbose` and, because it knows the flag is a `bool`, decides "no
explicit value, treat as true." It then takes `false` as a positional
argument. Always use `=` for boolean flags when you need to override
them: `-verbose=false`.

For all *non*-boolean flags the space form `-name value` works fine; it
only fails for booleans.

## 8. Reading non-flag arguments

After `flag.Parse()`, the leftover arguments are available through
helpers:

```go
flag.Parse()
fmt.Println("flags parsed:", flag.NFlag())
fmt.Println("positional:", flag.NArg(), flag.Args())
fmt.Println("first positional:", flag.Arg(0)) // "" if missing
```

`flag.Args()` returns a `[]string` of arguments that were not flags.
`flag.NArg()` is its length. `flag.Arg(i)` is bounds-checked — out-of-
range returns the empty string.

A typical pattern: optional flags, then one or more file arguments.

```go
var verbose = flag.Bool("v", false, "verbose")

func main() {
    flag.Parse()
    if flag.NArg() == 0 {
        fmt.Fprintln(os.Stderr, "usage: prog [-v] file ...")
        os.Exit(2)
    }
    for _, path := range flag.Args() {
        process(path)
    }
}
```

`flag` stops collecting flags at the first non-flag argument. Anything
after that — even something that looks like a flag — is passed through
as a positional argument. This is how `prog -v -- -not-a-flag` keeps
`-not-a-flag` out of the parser: the bare `--` marks the end of flags.

## 9. Single dash, double dash

`flag` accepts both `-name` and `--name`. The two are exactly
equivalent:

```
./prog -name=Bakhodir
./prog --name=Bakhodir
./prog -name Bakhodir
./prog --name Bakhodir
```

This differs from GNU `getopt` conventions, where `-n` is short and
`--name` is long. The standard `flag` package has no notion of short
flags. If you want a short alias, you register two flags that share a
variable:

```go
var verbose bool

func init() {
    flag.BoolVar(&verbose, "verbose", false, "enable verbose logging")
    flag.BoolVar(&verbose, "v", false, "shorthand for -verbose")
}
```

Now both `-v` and `-verbose` set the same variable. The help output
lists them as separate entries; that's the price.

## 10. The auto-generated usage message

`flag` prints a usage block when:

- The user passes `-h` or `--help` (or any unknown flag).
- You call `flag.Usage()` yourself.
- The parser hits a malformed flag and the default `ErrorHandling` mode
  (`ExitOnError`) kicks in.

The default usage prints `Usage of <program>:` followed by every
registered flag with its type, default, and description. That is often
enough for small tools.

When you want a richer usage — a one-line synopsis at the top, an
"EXAMPLES" section, etc. — replace `flag.Usage`:

```go
func init() {
    flag.Usage = func() {
        fmt.Fprintf(flag.CommandLine.Output(), "usage: %s [flags] file ...\n", os.Args[0])
        fmt.Fprintln(flag.CommandLine.Output(), "Process files with optional flags.")
        fmt.Fprintln(flag.CommandLine.Output())
        flag.PrintDefaults() // the auto-generated table
    }
}
```

`flag.PrintDefaults` is the function that produces the per-flag table,
and you can call it from inside your custom `Usage` to keep the table
without rewriting it.

## 11. Where the usage goes

By default, usage and error messages go to `os.Stderr`. You can change
the destination:

```go
flag.CommandLine.SetOutput(os.Stdout)
```

Or, for a custom `FlagSet` (see [middle.md](middle.md)):

```go
fs := flag.NewFlagSet("sub", flag.ExitOnError)
fs.SetOutput(io.Discard) // suppress all output during testing
```

In tests you usually want to capture usage in a buffer instead of
spraying it to the test log. `flag.CommandLine.SetOutput(&buf)` does
that.

## 12. Exit codes from `flag`

The default behavior on parse errors is `flag.ExitOnError`, which:

- Prints the error to the configured output (default `os.Stderr`).
- Prints the usage block.
- Calls `os.Exit(2)`.

The exit code is fixed at 2, matching the Unix convention for "command
line usage error." If you want different behavior — to handle the error
yourself, return it from `main`, or panic — you create your own
`*FlagSet` with a different `ErrorHandling` mode. Covered in
[middle.md](middle.md) and [senior.md](senior.md).

For now, accept that `flag.Parse()` either succeeds or terminates the
process. There is no third outcome with the global flag set.

## 13. Putting it together: a small `head` clone

```go
package main

import (
    "bufio"
    "flag"
    "fmt"
    "io"
    "os"
)

var (
    n     = flag.Int("n", 10, "number of lines to print")
    quiet = flag.Bool("q", false, "suppress filename headers")
)

func head(in io.Reader, out io.Writer, lines int) error {
    s := bufio.NewScanner(in)
    for i := 0; i < lines && s.Scan(); i++ {
        if _, err := fmt.Fprintln(out, s.Text()); err != nil {
            return err
        }
    }
    return s.Err()
}

func main() {
    flag.Parse()
    paths := flag.Args()
    if len(paths) == 0 {
        if err := head(os.Stdin, os.Stdout, *n); err != nil {
            fmt.Fprintln(os.Stderr, err)
            os.Exit(1)
        }
        return
    }
    for i, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            fmt.Fprintln(os.Stderr, err)
            os.Exit(1)
        }
        if !*quiet && len(paths) > 1 {
            if i > 0 {
                fmt.Println()
            }
            fmt.Printf("==> %s <==\n", p)
        }
        if err := head(f, os.Stdout, *n); err != nil {
            f.Close()
            fmt.Fprintln(os.Stderr, err)
            os.Exit(1)
        }
        f.Close()
    }
}
```

Two flags, one positional list of files, sane defaults, automatic
help. The `head` function takes `io.Reader` / `io.Writer` so it's
testable without touching the filesystem — same shape as the I/O
examples in [`01-io-and-file-handling/junior.md`](../01-io-and-file-handling/junior.md).

## 14. Defining a flag twice — what happens

If two calls register the same name on the same `FlagSet`, the second
call panics:

```go
flag.String("port", "8080", "...")
flag.String("port", "9090", "...") // panic: flag redefined: port
```

The panic message is `flag redefined: <name>`. This catches you when
two packages independently register the same global flag (e.g., a
library you imported registers `-config`, and so do you). The standard
library deliberately does not silently override; it forces you to
rename.

If you need a flag whose presence is optional — set in some builds,
absent in others — use a custom `*FlagSet` per package and merge
manually. The shared global namespace is opt-in via `flag.CommandLine`.

## 15. The global `flag.CommandLine`

Everything you've called as `flag.X` is a thin wrapper over a package-
level `*FlagSet` named `flag.CommandLine`. These two snippets are
equivalent:

```go
flag.String("name", "world", "...")
flag.Parse()
```

```go
flag.CommandLine.String("name", "world", "...")
flag.CommandLine.Parse(os.Args[1:])
```

The global form is convenient. The explicit form is necessary the
moment you want a second `FlagSet` for a subcommand, or you want to
parse a slice that isn't `os.Args[1:]` (very common in tests). You
will graduate to `*FlagSet` in [middle.md](middle.md); for now, know
that `flag.X` is just sugar for `flag.CommandLine.X`.

## 16. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| Flag value is always the default | Reading the variable before `flag.Parse()` |
| `flag provided but not defined: -foo` | Mistyped flag, or defined after `Parse` |
| `flag redefined: foo` panic | Two registrations on the same `FlagSet` |
| `-verbose false` doesn't disable | Boolean flag needs `-verbose=false` (with `=`) |
| Help message shows wrong default | Default literal in `flag.X(name, def, ...)` is the type's zero value, not what you assigned later |
| `flag.NArg() == 0` even though args were passed | Args looked like flags and were rejected; check for `flag provided but not defined` on stderr |
| `flag.Parse` exits the program | Default `ExitOnError` mode; switch to `ContinueOnError` and handle yourself |

## 17. What `flag` does not do

It's worth knowing the wall before you walk into it:

- **No required flags.** Every flag has a default. If you need
  required behavior, check after `Parse` and exit with a usage error
  yourself.
- **No short/long pairs.** `-v` and `--verbose` are independent
  registrations.
- **No abbreviation matching.** `-ver` is not the same as `-verbose`
  even if no other flag starts with `ver`.
- **No environment-variable fallback.** You wire it manually
  (covered in [middle.md](middle.md)).
- **No subcommands.** You build them with one `*FlagSet` per
  subcommand.
- **No completion generation.** You write a separate command for that.
- **No grouping in the help.** All flags appear in one list, sorted by
  name.
- **No `--` short option of its own**; bare `--` ends flag parsing,
  which is a feature, not a flag.

When you outgrow these, the usual graduation path is `cobra` (Kubernetes,
Hugo, GitHub CLI) or `urfave/cli` (smaller, lighter). For most internal
tools, you never need to graduate — `flag` plus thirty lines of glue is
enough.

## 18. What to read next

- [middle.md](middle.md) — custom `flag.Value` types, `*FlagSet` for
  subcommands, env-var fallback, testable `main`.
- [senior.md](senior.md) — exact parse rules, the `init()`/`testing.M`
  story, and how `go test` itself uses `flag`.
- [tasks.md](tasks.md) — exercises that put junior material into
  practice.
- The official package doc:
  [`flag`](https://pkg.go.dev/flag).

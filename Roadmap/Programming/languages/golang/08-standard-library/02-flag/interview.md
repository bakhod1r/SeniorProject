# 8.2 `flag` — Interview

A bank of interview questions on the standard `flag` package. Each
answer is the four-to-ten-line version a competent candidate is
expected to give. Use them to rehearse, to interview with, or to
pressure-test your own understanding.

## 1. Why must `flag.Parse()` come before reading flag variables?

Each `flag.X` call returns a pointer to a variable that holds the
*default* value. The actual user input isn't applied until `Parse`
walks `os.Args[1:]` and calls `Value.Set` on each registered flag. If
you read the variable before `Parse`, you get the literal default —
quietly wrong. Convention: `flag.Parse()` is the first statement in
`main`, before any flag is read.

## 2. How do you make a flag required?

`flag` has no required-flag concept. After `Parse`, walk `flag.Visit`
to find which flags the user actually set, then check your required
list against that set:

```go
set := map[string]bool{}
flag.Visit(func(f *flag.Flag) { set[f.Name] = true })
if !set["config"] {
    fmt.Fprintln(os.Stderr, "missing required flag: -config")
    flag.Usage()
    os.Exit(2)
}
```

Six lines of glue; the package itself stays minimal.

## 3. Why doesn't `-flag value` work for boolean flags?

The parser inspects the flag's type before deciding whether to consume
the next argument. For boolean flags (any `Value` whose
`IsBoolFlag()` returns true), the mere presence of `-flag` is
interpreted as `-flag=true`, and the next token is left as a positional
argument. So `-verbose false` parses as `verbose=true` plus `"false"`
as a positional. To set a boolean to `false` explicitly, you must use
the `=` form: `-verbose=false`.

## 4. What's the difference between `flag.String` and `flag.StringVar`?

`flag.String(name, def, usage)` returns a `*string` pointing at a
package-managed variable. `flag.StringVar(&v, name, def, usage)` writes
into a variable you already own. The Var form is useful when the
variable lives in a struct field, when you want the type spelled
explicitly, or when two flags should write to the same variable
(short alias pattern). Same semantic; different storage ownership.

## 5. How do you implement subcommands without third-party libraries?

Switch on `os.Args[1]`, then construct a per-subcommand `*FlagSet`
seeded with `os.Args[2:]`:

```go
switch os.Args[1] {
case "serve":
    fs := flag.NewFlagSet("serve", flag.ExitOnError)
    addr := fs.String("addr", ":8080", "")
    fs.Parse(os.Args[2:])
    serve(*addr)
case "migrate":
    fs := flag.NewFlagSet("migrate", flag.ExitOnError)
    dir := fs.String("dir", "./migrations", "")
    fs.Parse(os.Args[2:])
    migrate(*dir)
}
```

Each subcommand has isolated flags. The `cmd/go` source uses exactly
this pattern.

## 6. What happens if you define the same flag name twice?

The second `flag.X` call panics with `flag redefined: <name>`. This
catches the case where two libraries (or one library and the
application) both register a global flag with the same name. The
package deliberately doesn't silently override.

## 7. How do you write a custom comma-separated flag?

Implement `flag.Value`:

```go
type stringSlice []string
func (s *stringSlice) String() string { return strings.Join(*s, ",") }
func (s *stringSlice) Set(v string) error {
    *s = append(*s, strings.Split(v, ",")...)
    return nil
}

var tags stringSlice
flag.Var(&tags, "tag", "tag (comma-separated, repeatable)")
```

Now `-tag a,b -tag c` produces `[a b c]`. The package calls `Set` once
per occurrence.

## 8. How do you add environment-variable fallback?

`flag` has none built in. The standard idiom: compute the default
from the env var before registering the flag.

```go
def := ":8080"
if v, ok := os.LookupEnv("APP_ADDR"); ok { def = v }
addr := flag.String("addr", def, "listen address")
```

CLI input still wins because `Parse` overwrites the registered default
when the user passes `-addr`. Use `os.LookupEnv` (not `os.Getenv`) so
you can distinguish "unset" from "set to empty."

## 9. What's the difference between `Visit` and `VisitAll`?

`Visit(fn)` walks only the flags the user actually set on the command
line. `VisitAll(fn)` walks every registered flag, set or not. `Visit`
is how you implement required-flag detection or "explicitly set vs
default" logic. `VisitAll` is how `PrintDefaults` builds the help
table.

## 10. What does `flag.Parse()` do if you call it twice?

It re-parses the same `os.Args[1:]` against the same `*FlagSet`. The
flag values are reassigned by `Value.Set` calls; if your `Set`
appends (like the `stringSlice` example), you'll get duplicates.
There's no built-in idempotency. In tests, build a fresh `*FlagSet`
each time instead of reparsing.

## 11. What is `flag.ErrHelp` and when do you see it?

`flag.ErrHelp` is the sentinel error `Parse` returns (in
`ContinueOnError` mode) when the user passed `-h` or `--help` and no
flag of that name is registered. Treat it as success:

```go
if err := fs.Parse(args); errors.Is(err, flag.ErrHelp) { return 0 }
```

In `ExitOnError` mode the package calls `os.Exit(0)` for help
internally; you never see the sentinel.

## 12. What are the three `ErrorHandling` modes?

- `flag.ContinueOnError` — `Parse` returns the error to you. The
  right choice for libraries and tests.
- `flag.ExitOnError` — print error and usage, then `os.Exit(2)`. The
  default for `flag.CommandLine`.
- `flag.PanicOnError` — print error and usage, then panic with the
  error. Niche; useful when callers want to `recover` around parsing.

## 13. Why might a flag value never be applied?

Three usual causes: (1) you read the variable before `flag.Parse`;
(2) the flag was defined *after* `Parse` ran; (3) `Parse` errored on
an earlier argument and stopped before reaching this flag. In case 3,
flags parsed earlier are already set, but later ones aren't; never
trust flag values after a non-nil `Parse` return.

## 14. How do you make a `-v` short alias for `-verbose`?

Register two flags that share the same backing variable:

```go
var verbose bool
flag.BoolVar(&verbose, "verbose", false, "enable verbose logging")
flag.BoolVar(&verbose, "v", false, "shorthand for -verbose")
```

Both names appear in the help output. There is no built-in alias
mechanism; this is the idiom.

## 15. Why shouldn't a library call `flag.Parse`?

`flag.Parse` consumes `os.Args[1:]`, which belongs to the application.
A library that parses steals the command line from `main`, errors on
flags the application defined later, and ties the library's behavior
to the binary it's linked into. Libraries should accept config via
constructors or expose a `RegisterFlags(fs *flag.FlagSet)` helper for
the application to call.

## 16. What's the rule for `defer fs.Close()` on a `*FlagSet`?

There is none. `*FlagSet` holds no OS resources — no file descriptors,
no goroutines, nothing to close. The `Close` method does not exist.
The struct is plain memory; the GC reclaims it.

## 17. How do you suppress flag output in tests?

`fs.SetOutput(io.Discard)` for a custom flag set, or
`flag.CommandLine.SetOutput(io.Discard)` for the global. To assert on
the output, use `&bytes.Buffer{}` instead of `io.Discard` and check
its contents after the test action.

## 18. What does `flag.Args()` contain?

The positional arguments left over after `Parse` consumed the flags.
Parsing stops at the first non-flag argument, at `--`, or at `-` —
everything from that point on, plus the explicit terminator if any,
is in `Args()`.

## 19. How does `flag` interact with `testing.M`?

The `testing` package registers all its `-test.*` flags on
`flag.CommandLine` in its `init`. When `testing.Main` runs, it calls
`flag.Parse` to consume both its own flags and any you registered at
package scope. If you write a custom `TestMain`, you must call
`flag.Parse` yourself before `m.Run()` — otherwise `-test.run`,
`-test.v`, and your own flags are all undefined.

## 20. Can two goroutines parse a `*FlagSet` concurrently?

No. `*FlagSet` is not safe for concurrent writes. `Parse` mutates
internal state; flag definition mutates an internal map. Either
serialize, or give each goroutine its own `*FlagSet`. Reads of
already-parsed flag values from multiple goroutines are safe if a
happens-before edge sequences them after the parse.

## 21. What does `--` do in the argument list?

Bare `--` ends flag parsing. Everything after it is treated as a
positional argument, even tokens that look like flags. Example:
`grep -v -- -pattern file.txt` lets `-pattern` be searched for as a
literal string instead of being interpreted as a `-p` flag.

## 22. What's the difference between `-name=value` and `-name value`?

For non-bool flags they're equivalent. For bool flags, `-name=value`
is required if you want to set a value other than `true`; `-name
value` parses as `-name=true` plus `"value"` as a positional argument.
This is the single sharpest edge in the package.

## 23. How do you customize the auto-generated usage message?

Replace the `Usage` field on the `*FlagSet`:

```go
flag.Usage = func() {
    fmt.Fprintf(flag.CommandLine.Output(), "usage: %s [flags] file ...\n", os.Args[0])
    flag.PrintDefaults()
}
```

`PrintDefaults` writes the per-flag table; call it from inside your
custom function to keep the table without rewriting it.

## 24. What does `flag.Func` do?

`flag.Func(name, usage, fn)` (Go 1.16+) registers a flag whose only
behavior is calling `fn(value)` on each occurrence. No backing
variable, no `Value` to write. Useful for "do this side effect when
the flag is set" — enabling tracing, registering a callback, parsing
into a structure outside the flag system.

```go
flag.Func("trace", "enable tracing to FILE", startTrace)
```

## 25. What does `flag.Set` do?

`flag.Set(name, value)` programmatically sets a flag's value, as if
the user had typed it. It calls the underlying `Value.Set`. Tests use
it to inject values without building a parse argv:

```go
flag.Set("config", "/tmp/test.yaml")
```

It works whether or not `Parse` has been called — it's a direct write
through the `Value` interface.

## 26. How do you handle `-h` cleanly with `ContinueOnError`?

Detect `flag.ErrHelp` and return success:

```go
if err := fs.Parse(args); err != nil {
    if errors.Is(err, flag.ErrHelp) { return 0 }
    return 2
}
```

In `ExitOnError` mode the package handles `-h` by exiting 0
internally, so this dance is only needed in `ContinueOnError`.

## 27. When should you graduate from `flag` to `cobra`?

When at least two of: (a) you have three-or-more-level subcommands;
(b) you want auto-generated shell completions for multiple shells;
(c) you want typo suggestions ("did you mean serve?"); (d) you want
docs (man pages, Markdown) generated from the command tree; (e) you
want pre/post hooks across all subcommands. For a tool with three
flags and one subcommand, `flag` plus thirty lines of glue is
cheaper.

## 28. How do you implement a flag that reads from a file?

Wrap a `flag.Value` whose `Set` opens the file and reads it:

```go
type fileFlag struct{ contents []byte }
func (f *fileFlag) String() string { return "" }
func (f *fileFlag) Set(path string) error {
    b, err := os.ReadFile(path)
    if err != nil { return err }
    f.contents = b
    return nil
}

var key fileFlag
flag.Var(&key, "key-file", "path to private key")
```

The user types `-key-file=/etc/key.pem`; the `Value` reads the file
during `Parse`. Good for credentials and certificates.

## 29. What does `f.PrintDefaults()` print exactly?

Each registered flag, in lexical name order, two lines per flag:

```
  -name type
        usage description (default "value")
```

The type name appears if the underlying `Value` implements `Getter`
and the `Get()` return type is a recognized base type. The default
suffix appears only if `DefValue` is not the type's zero value.
That's the entire format; there's no per-flag customization without
rewriting `Usage` from scratch.

## 30. Can you use `flag` and `pflag` together?

`pflag` (used by `cobra`) is a near-API-compatible replacement for
`flag` with POSIX-style short flags, slice types, and grouping. You
can register the standard library's flag set into `pflag` with
`pflag.CommandLine.AddGoFlagSet(flag.CommandLine)` — `klog`'s flags
get bridged into `cobra` apps this way. Going the other direction
(`pflag` flags into `flag`) isn't supported. For new code, pick one
and stay there.

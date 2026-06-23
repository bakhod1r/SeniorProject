# 8.2 `flag` — Specification

> A formal reference for the `flag` package: every defining function,
> the parse rules, the error semantics, and the `*FlagSet` method
> table. This file is for lookup, not for reading top to bottom.

## Defining flags

All defining functions exist in two forms — pointer-returning and
`*Var` — and on both `flag.CommandLine` (via the package-level
shorthand) and `*flag.FlagSet` (as methods). The signatures are:

| Pointer form | Var form | Returns / Writes |
|--------------|----------|------------------|
| `String(name, default, usage string) *string` | `StringVar(p *string, name, default, usage string)` | string |
| `Int(name string, default int, usage string) *int` | `IntVar(p *int, name string, default int, usage string)` | int |
| `Int64(name string, default int64, usage string) *int64` | `Int64Var(p *int64, name string, default int64, usage string)` | int64 |
| `Uint(name string, default uint, usage string) *uint` | `UintVar(p *uint, name string, default uint, usage string)` | uint |
| `Uint64(name string, default uint64, usage string) *uint64` | `Uint64Var(p *uint64, name string, default uint64, usage string)` | uint64 |
| `Bool(name string, default bool, usage string) *bool` | `BoolVar(p *bool, name string, default bool, usage string)` | bool |
| `Float64(name string, default float64, usage string) *float64` | `Float64Var(p *float64, name string, default float64, usage string)` | float64 |
| `Duration(name string, default time.Duration, usage string) *time.Duration` | `DurationVar(p *time.Duration, name string, default time.Duration, usage string)` | time.Duration |
| `Var(value Value, name, usage string)` | (same) | (caller-owned) |
| `Func(name, usage string, fn func(string) error)` | (same; Go 1.16+) | (no storage) |
| `BoolFunc(name, usage string, fn func(string) error)` | (same; Go 1.21+) | (no storage; bool-style) |
| `TextVar(p TextUnmarshaler, name string, default TextMarshaler, usage string)` | (same; Go 1.19+) | any `encoding.TextUnmarshaler` |

Behavior contract for every defining function:

- Registers the flag on the receiver `*FlagSet` (or `flag.CommandLine`).
- Panics with `flag redefined: <name>` if a flag of the same name is
  already registered on the same `FlagSet`.
- The flag's `DefValue` is set to the result of `Value.String()` called
  immediately after registration. For built-in types this is
  `fmt.Sprintf("%v", default)`.
- For `Func` / `BoolFunc`, the registered `Value` is internally a
  type that calls the user's function on `Set` and returns `""` from
  `String`.

## The `Value` and `Getter` interfaces

```go
type Value interface {
    String() string
    Set(string) error
}

type Getter interface {
    Value
    Get() interface{}
}
```

- `String()` is called for display in `PrintDefaults` and to capture
  `DefValue` at registration. Must work on a zero value (the package
  may call it on a nil-pointer receiver during type discovery).
- `Set(s)` is called once per occurrence of the flag on the command
  line. It must mutate the underlying value and return an error to
  reject the input.
- `Get()` (optional, via `Getter`) returns the typed value. Used by
  callers walking `VisitAll` who want the typed value rather than the
  string form.

Optional `IsBoolFlag() bool` method on a `Value`: returning true tells
the parser this flag does not require an argument (the flag's mere
presence sets it to `"true"`). Built-in `bool` flags implement this.

## The `boolFlag` interface (unexported)

The parser tests for this interface internally:

```go
type boolFlag interface {
    Value
    IsBoolFlag() bool
}
```

Any custom `Value` that returns `true` from `IsBoolFlag()` is treated
as bool-style by the parser.

## Parse rules

For arguments `args[0:]` passed to `Parse`:

1. If `args[i]` does not start with `-`, or is exactly `-`, parsing
   stops; `args[i:]` becomes positional arguments.
2. If `args[i]` is `--` exactly, parsing stops; `args[i+1:]` becomes
   positional arguments.
3. Strip one or two leading `-` characters from `args[i]`. (Both
   `-name` and `--name` are accepted, equivalently.)
4. Find the first `=`. If present, split on it: the part before is
   the flag name, the part after is the value, and parsing for this
   token is complete.
5. If no `=`:
   - Look up the flag by the remaining name.
   - If the flag's `Value` implements `IsBoolFlag() bool` returning
     `true`, the value is `"true"`.
   - Otherwise, the value is `args[i+1]`, and `i` advances by 2 instead
     of 1. If no `args[i+1]` exists, error with `flag needs an argument`.
6. Call `Value.Set(value)`. On error, surface as
   `invalid value "<value>" for flag -<name>: <err>`.
7. Continue with `args[i+1]` (or `args[i+2]` after consuming a
   space-separated value).

Special token: `-h` and `--help`, when no flag of that name is
registered, call `Usage` and return `flag.ErrHelp` from `Parse`.

## Error semantics by `ErrorHandling` mode

`flag.NewFlagSet(name, mode)` accepts:

| Mode | On parse error |
|------|----------------|
| `flag.ContinueOnError` | `Parse` returns the error to the caller. No exit, no panic. |
| `flag.ExitOnError` | Print error message + usage to `Output()`. Call `os.Exit(2)`. (For `-h`, `os.Exit(0)`.) |
| `flag.PanicOnError` | Print error message + usage. Panic with the error value. |

The global `flag.CommandLine` is constructed with `ExitOnError`.

Errors returned by `Parse` (in `ContinueOnError` mode):

| Error | When |
|-------|------|
| `nil` | All arguments parsed successfully |
| `flag.ErrHelp` | `-h` or `--help` was seen and no such flag is registered |
| `errors.New("flag provided but not defined: -<name>")` | Unknown flag name |
| `errors.New("flag needs an argument: -<name>")` | Non-bool flag at end of args, or non-bool flag with `=` and no value |
| `errors.New("invalid boolean value \"<v>\" for -<name>: <err>")` | Bool flag with malformed `=value` |
| `errors.New("invalid value \"<v>\" for flag -<name>: <err>")` | Any other typed flag where `strconv` parsing or `Value.Set` failed |
| `errors.New("bad flag syntax: <token>")` | Malformed token like `-=foo` or `--=foo` |

`errors.Is(err, flag.ErrHelp)` is the only sentinel comparison the
package documents. The other messages are formatted strings — match
on substring if you must, but prefer not matching at all.

## `*FlagSet` methods

| Method | Returns | Notes |
|--------|---------|-------|
| `Parse(args []string) error` | error | Parses according to rules above |
| `Parsed() bool` | bool | True after a successful or failed `Parse` |
| `Args() []string` | []string | Positional args after parsing |
| `NArg() int` | int | `len(Args())` |
| `Arg(i int) string` | string | i-th positional, `""` if out of range |
| `NFlag() int` | int | Number of flags the user actually set |
| `Lookup(name string) *Flag` | `*Flag` | nil if not registered |
| `Set(name, value string) error` | error | Programmatically set a flag's value |
| `Visit(fn func(*Flag))` | — | Walk only flags the user set, in lexical order |
| `VisitAll(fn func(*Flag))` | — | Walk all registered flags, in lexical order |
| `PrintDefaults()` | — | Write the per-flag usage table to `Output()` |
| `SetOutput(w io.Writer)` | — | Change the destination for usage and errors |
| `Output() io.Writer` | io.Writer | Current output (defaults to `os.Stderr`) |
| `Name() string` | string | The name passed to `NewFlagSet` |
| `Init(name string, mode ErrorHandling)` | — | Re-initialize an existing FlagSet (rarely needed) |
| `ErrorHandling() ErrorHandling` | — | The mode passed to `NewFlagSet` |

The package-level functions `flag.X` are aliases for
`flag.CommandLine.X`. There is no `flag.SetOutput` shorthand; use
`flag.CommandLine.SetOutput`.

## The `Flag` struct

```go
type Flag struct {
    Name     string // flag name, no leading "-"
    Usage    string // help text
    Value    Value  // underlying Value (call Get() if it's also a Getter)
    DefValue string // default value as a string, captured at registration
}
```

These four fields are the entire public surface of a registered flag.
`DefValue` is a string for display; the actual default lives in
`Value` (and was stringified once at registration time).

## Type-coercion rules per built-in

| Defining function | Parse function used | Notes |
|-------------------|---------------------|-------|
| `Int`, `IntVar` | `strconv.ParseInt(s, 0, 64)` | Base-prefix aware (`0x`, `0o`, `0b`) |
| `Int64`, `Int64Var` | `strconv.ParseInt(s, 0, 64)` | Same as above |
| `Uint`, `UintVar` | `strconv.ParseUint(s, 0, 64)` | No negatives |
| `Uint64`, `Uint64Var` | `strconv.ParseUint(s, 0, 64)` | Same |
| `Float64`, `Float64Var` | `strconv.ParseFloat(s, 64)` | Accepts decimals, scientific, hex floats |
| `Bool`, `BoolVar` | `strconv.ParseBool(s)` | Accepts `1`, `t`, `T`, `TRUE`, `true`, `True`, `0`, `f`, `F`, `FALSE`, `false`, `False` |
| `Duration`, `DurationVar` | `time.ParseDuration(s)` | Requires a unit; `30s`, `1.5h`, `45m`, `2h45m` |
| `String`, `StringVar` | (no coercion) | Raw string |

`flag.Var` performs no coercion — your `Value.Set` does whatever
parsing it wants.

## Package-level globals

| Identifier | Type | Notes |
|------------|------|-------|
| `flag.CommandLine` | `*FlagSet` | The default flag set; package-level `flag.X` calls operate on it |
| `flag.Usage` | `func()` | Alias for `flag.CommandLine.Usage`; replaceable |
| `flag.ErrHelp` | `error` | Sentinel returned by `Parse` when `-h`/`--help` seen |
| `flag.ContinueOnError` | `ErrorHandling` (= 0) | |
| `flag.ExitOnError` | `ErrorHandling` (= 1) | |
| `flag.PanicOnError` | `ErrorHandling` (= 2) | |

## What the package does *not* provide

- Required flags (build with `Visit` after `Parse`).
- Short/long flag pairs (register two flags sharing a `Var`).
- Abbreviation matching (every name must be exact).
- Environment-variable fallback (compose with `os.LookupEnv` before
  `Parse`).
- Subcommand dispatch (build with multiple `*FlagSet` and a switch on
  `os.Args`).
- Mutual exclusion or dependency rules between flags (validate after
  `Parse`).
- Shell completions (build with a hidden subcommand or graduate to
  `cobra`).
- Hidden / deprecated flag attributes (filter in custom `Usage`).

## Compatibility notes

- `flag.Func` added in Go 1.16.
- `flag.TextVar` added in Go 1.19.
- `flag.BoolFunc` added in Go 1.21.
- All other functions and methods in this reference have been stable
  since Go 1.0 with no signature changes.

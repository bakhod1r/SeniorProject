# 8.2 `flag` — Optimize

> `flag` runs once at process startup and parses a few dozen
> arguments. The CPU it consumes is invisible. Nothing in this
> package will ever be your bottleneck. So this file is honest about
> that — and instead focuses on the structural choices that keep
> `flag` code clean, allocation-conscious in the few places where
> repeated parsing matters, and free of the kind of test friction
> that makes engineers reach for heavier alternatives.

## 1. The honest baseline

A typical `flag.Parse` run with a dozen flags and a hundred command-
line tokens takes **single-digit microseconds**. The work is:

- One map lookup per flag occurrence (the registered-flags map).
- One `Value.Set` call per occurrence.
- A handful of slice grows for the `actual` set.

Compare the cost of `flag.Parse` to anything else `main` does — open
a config file, dial a database, allocate a logger — and you'll find
`flag` rounding to zero in every profile.

If you were considering an optimization to `flag` parsing in your
production code path, stop. Look elsewhere. The exceptions are
narrow: high-frequency invocation in test loops, or constructing
large flag sets dynamically. Both are addressed below.

## 2. Init-time allocations

Every `flag.X` call does:

1. Allocates a `*flag.Flag` struct.
2. Captures the default by calling `Value.String()` and storing the
   result.
3. Inserts into the flag set's internal map.

For a CLI with twenty flags, that's twenty small allocations at
startup. Invisible. Even a CLI with a hundred flags is invisible.

Two things can shift this:

- **Custom `Value` types whose `String()` method allocates a lot.**
  If your `String()` builds a long string (joining a slice of paths,
  pretty-printing a struct), the work happens at registration time
  too, and again every time `PrintDefaults` runs. Keep `String()`
  cheap.

- **Dynamic flag generation.** Some test harnesses register a flag
  per parameterized case. With a thousand cases, you get a thousand
  flag registrations per run. Reuse a single `*FlagSet` across cases
  if possible (re-parse different argvs against the same set), or
  accept the cost.

## 3. Reusing a `*FlagSet` in test loops

A test that benchmarks parse behavior:

```go
func BenchmarkParse(b *testing.B) {
    args := []string{"-addr=:9090", "-workers=8", "-quiet"}
    for i := 0; i < b.N; i++ {
        fs := flag.NewFlagSet("bench", flag.ContinueOnError)
        fs.SetOutput(io.Discard)
        fs.String("addr", ":8080", "")
        fs.Int("workers", 4, "")
        fs.Bool("quiet", false, "")
        fs.Parse(args)
    }
}
```

This allocates a fresh `*FlagSet` and three flags every iteration.
For benchmarking the parser itself, that's fine — `flag.Parse` is
the only thing under test. For benchmarks that are *using* `flag` to
configure something else, you can hoist the registration:

```go
func BenchmarkUseConfig(b *testing.B) {
    fs := flag.NewFlagSet("bench", flag.ContinueOnError)
    fs.SetOutput(io.Discard)
    addr := fs.String("addr", ":8080", "")
    fs.Parse([]string{"-addr=:9090"})

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        runWithAddr(*addr)
    }
}
```

The flag set is built once. The benchmark loop runs the *thing being
benchmarked*, not the flag setup. The `b.ResetTimer()` excludes the
setup from the reported time.

There's no public `Reset` method on `*FlagSet` — re-parsing on the
same set isn't supported as a clean operation, especially with
custom `Value` types that accumulate. The right pattern is "fresh
set per parse" or "set up once, use repeatedly without reparse."

## 4. Avoiding `flag.CommandLine` in libraries

This is structural, not allocation-related, but it's the single
biggest factor in keeping `flag`-based code maintainable.

Bad:

```go
// in a library
var workers = flag.Int("workers", 4, "concurrent workers")

func DoWork() { /* uses *workers */ }
```

The library has registered a global flag. Any application importing
this library now has `-workers` whether it wanted it or not. Tests
of the library can't run multiple cases with different worker counts
without monkey-patching the global.

Good:

```go
// in a library
type Config struct{ Workers int }

func DoWork(cfg Config) { /* uses cfg.Workers */ }

// optional
func RegisterFlags(fs *flag.FlagSet, cfg *Config) {
    fs.IntVar(&cfg.Workers, "workers", 4, "concurrent workers")
}
```

The library exposes a `Config` and an optional helper to register
flags into a flag set the application owns. Tests construct their
own `Config` directly. Applications can choose to call
`RegisterFlags(flag.CommandLine, &cfg)` or use a custom flag set.

The library has zero global state. The "performance" win — really a
maintainability win — is enormous: tests parallelize, multiple
configurations coexist, the library's behavior is reproducible
without the surrounding binary.

## 5. The fast path for high-frequency parsing

Some integration test suites run the CLI hundreds of times per
second. Each run forks a process, executes `main`, parses flags. The
overhead is dominated by `os/exec`, fork, and process startup —
*not* by `flag.Parse` itself.

If you're running tests that frequently:

1. Move to in-process tests against a `run(args, out, errOut) int`
   function. No fork, no parse-binary overhead, no process creation.
2. The `flag` work is now in-process and effectively free.

This is the same `run` shape from
[middle.md](middle.md) section 13 and
[professional.md](professional.md) section 9. The performance
benefit (compared to forking the binary) is 100-1000x; the
flag-specific contribution is incidental.

## 6. Custom `Value` performance

If your custom `Value` is allocating per-character on `Set`, the
allocations show up if you call `Set` thousands of times (test
loops, dynamic-flag scenarios). Two patterns:

- **Pre-allocate the destination.** If the value accumulates into a
  slice, give it an initial capacity hint:

  ```go
  type pairs struct{ items []kv }
  func newPairs() *pairs { return &pairs{items: make([]kv, 0, 16)} }
  ```

- **Avoid `fmt.Sprintf` in `String()` for fast paths.** If `String()`
  is called a million times during repeated `PrintDefaults`,
  `fmt.Sprintf` dominates. Build the string with `strings.Builder`
  or pre-compute and cache.

Neither matters in normal CLI usage. They matter in test loops or in
debugging tools that walk the flag set to render UI.

## 7. `PrintDefaults` cost

`PrintDefaults` does:

1. Walk the flag set in lexical order (one allocation for the
   sorted slice).
2. For each flag, call `Value.String()` once.
3. Format the help line (allocates a string).
4. Write to the output.

For a hundred-flag CLI, this is a few hundred allocations and a
microsecond or two. Called once per `-h`, the cost is invisible. If
you call it thousands of times (e.g., for shell completion
generation), cache the output.

```go
var cachedHelp string
func once() string {
    if cachedHelp == "" {
        var buf bytes.Buffer
        flag.CommandLine.SetOutput(&buf)
        flag.PrintDefaults()
        flag.CommandLine.SetOutput(os.Stderr)
        cachedHelp = buf.String()
    }
    return cachedHelp
}
```

Build the help once at startup, serve from the cache. Same pattern
applies to any computed metadata (subcommand listings, completion
menus).

## 8. Memory: long-lived flag values

A `flag.String` registers a `*string` that lives for the program's
lifetime. The value is a few bytes plus the string contents. For
twenty flags, total memory is hundreds of bytes — invisible.

The pattern that *can* matter: a flag that holds a large value (a
file's contents read in `Set`, a parsed certificate, a complex
in-memory structure). The flag's `Value` is reachable from the
`*FlagSet`, which is reachable from `flag.CommandLine`, which is a
package global — so the value lives until the process exits.

If you want the flag's value to be GC'able after use, copy the
contents into a local variable, then nil out the flag's storage:

```go
contents := someFileFlag.contents
someFileFlag.contents = nil // help GC
```

Rarely necessary. Useful if your CLI loads a multi-megabyte file via
a flag and then doesn't need it.

## 9. Init order and cold-start time

Every package-scope `flag.X` call runs in a `var` initializer or in
`init()`. Both happen before `main`. For a CLI with a deep import
tree that registers dozens of flags from libraries, init time can
add up — not because of `flag` per se, but because each `flag.X` call
runs a bit of code at startup.

If you measure cold-start time and `flag` registrations show up:

1. Move flags from package-scope `var` declarations into `func init()`
   bodies. Same effect, slightly more controllable order.
2. Better: move flag registration into a function called from
   `main`. The application controls when it happens, the library
   doesn't pay the cost on every binary that imports it.

```go
// in library
func RegisterFlags(fs *flag.FlagSet) {
    fs.Int("workers", 4, "")
}

// in main
func main() {
    lib.RegisterFlags(flag.CommandLine)
    flag.Parse()
}
```

For a CLI with sub-millisecond cold-start budgets (e.g., a shell
prompt helper that runs on every keystroke), this is a real
improvement. For everything else, init-time `flag` registration is
fine.

## 10. The structure dividend

Most of the "optimization" advice for `flag` is structural:

- Don't use the global `flag.CommandLine` in libraries.
- Construct `*FlagSet` instances per test or per subcommand.
- Refactor `main` into `run(args, out, errOut) int` so tests don't
  fork.
- Cache help output if you generate it programmatically.
- Pre-allocate slice capacities in custom `Value` types when you
  know the rough size.

The runtime impact of any of these is small. The maintainability
impact is large: code that follows them is easier to test, easier to
reason about, and easier to extend. That dividend compounds over a
project's lifetime in a way no microbenchmark can capture.

## 11. When `flag` actually shows up in a profile

Hypothetical scenario: you're writing a test harness that
shells out to `app subcmd --flag1=x --flag2=y` ten thousand times.
You profile it, and `flag.(*FlagSet).Parse` is in the top frames.

The right move is *not* to optimize `flag.Parse`. The right move is:

1. Stop forking. Refactor the harness to call `run(args, out, errOut)`
   directly. Process creation, not flag parsing, is the cost.
2. If you must fork (e.g., you're testing the actual binary's
   behavior including signal handling), accept the parse overhead. It
   was real but not unique — it was a tax on every CLI test, not on
   `flag` specifically.

The package was designed for "parse once at startup," and it's
exquisitely tuned for that case. It is not designed for and will not
reward "parse a million times in a tight loop." Don't try to make it.

## 12. What this file deliberately does not contain

No benchmarks comparing `flag` to `pflag` or `cobra`. Both wrap
`flag` (or replace it with API-compatible code) and add features at
modest cost. If you're choosing between them, the decision is about
features, not microseconds.

No "use `flag.Func` for performance." `Func` saves you writing a
`Value` struct; it doesn't make `Set` faster.

No advice to avoid `flag.PrintDefaults` for performance. The function
is fine. If it shows up in a hot path, you're using `flag` in a way
the package was never meant for.

This file is short on purpose. The right answer to most "how do I
optimize `flag`" questions is: you don't. Get the structure right,
trust the package, and put the tuning effort into the parts of your
program that actually matter.

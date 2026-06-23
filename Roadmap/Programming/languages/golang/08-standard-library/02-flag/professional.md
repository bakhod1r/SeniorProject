# 8.2 `flag` — Professional

> **Audience.** You're building or maintaining a real CLI tool — one
> that ships to engineers, supports nested subcommands, reads
> configuration from multiple sources, runs in container environments
> with environment-variable overrides, and has tests that don't fork
> processes. This file collects the production patterns that keep a
> `flag`-based CLI maintainable up to the point where `cobra` actually
> starts to win.

## 1. A small subcommand framework, in 80 lines

The recurring shape of every multi-command CLI is the same. Capture
it once.

```go
package main

import (
    "context"
    "flag"
    "fmt"
    "io"
    "os"
    "slices"
)

type Command struct {
    Name      string
    Summary   string
    UsageText string
    Setup     func(fs *flag.FlagSet)
    Run       func(ctx context.Context, args []string, out, errOut io.Writer) int
}

type Registry struct {
    cmds map[string]*Command
    out  io.Writer
    err  io.Writer
}

func New(out, errOut io.Writer) *Registry {
    return &Registry{cmds: map[string]*Command{}, out: out, err: errOut}
}

func (r *Registry) Register(c *Command) { r.cmds[c.Name] = c }

func (r *Registry) Run(ctx context.Context, args []string) int {
    if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
        r.usage()
        return 2
    }
    c, ok := r.cmds[args[0]]
    if !ok {
        fmt.Fprintf(r.err, "unknown command %q\n\n", args[0])
        r.usage()
        return 2
    }
    fs := flag.NewFlagSet(c.Name, flag.ContinueOnError)
    fs.SetOutput(r.err)
    fs.Usage = func() {
        fmt.Fprintln(fs.Output(), c.UsageText)
        fmt.Fprintln(fs.Output(), "\nFlags:")
        fs.PrintDefaults()
    }
    if c.Setup != nil { c.Setup(fs) }
    if err := fs.Parse(args[1:]); err != nil {
        if err == flag.ErrHelp { return 0 }
        return 2
    }
    return c.Run(ctx, fs.Args(), r.out, r.err)
}

func (r *Registry) usage() {
    fmt.Fprintln(r.err, "usage: app <command> [flags]")
    fmt.Fprintln(r.err, "\nCommands:")
    var names []string
    for n := range r.cmds { names = append(names, n) }
    slices.Sort(names)
    for _, n := range names {
        fmt.Fprintf(r.err, "  %-12s %s\n", n, r.cmds[n].Summary)
    }
}

func main() {
    reg := New(os.Stdout, os.Stderr)
    reg.Register(&Command{
        Name:      "serve",
        Summary:   "run the HTTP server",
        UsageText: "usage: app serve [flags]",
        Setup: func(fs *flag.FlagSet) {
            fs.String("addr", ":8080", "listen address")
        },
        Run: func(ctx context.Context, args []string, out, _ io.Writer) int {
            fmt.Fprintln(out, "serving")
            return 0
        },
    })
    os.Exit(reg.Run(context.Background(), os.Args[1:]))
}
```

What this buys you:

- A single point that handles `-h`, unknown commands, and exit codes.
- Each command is a struct, not a free function with hidden globals.
- The setup/run split lets the `Setup` register flags into the local
  `*FlagSet`, which `Run` reads from `fs` (passed in, or via closures
  over registered pointers).
- The whole thing is testable: `New(out, errOut).Run(ctx, args)`
  returns an int. No `os.Exit`, no globals.

If you find yourself adding more — categories, deprecation flags,
shell completions, suggestions for typos — that's the boundary at
which `cobra` starts to be cheaper than maintaining your own.

## 2. Deterministic precedence: CLI > env > config > default

The most common production requirement: a flag's effective value
should follow a strict order. The flag if the user passed it; otherwise
the env var if set; otherwise the config-file value; otherwise the
literal default.

```go
type sourcedString struct {
    value  string
    source string // "default", "config", "env", "cli"
}

func (s *sourcedString) String() string { return s.value }

func (s *sourcedString) Set(v string) error {
    s.value = v
    s.source = "cli"
    return nil
}

func resolve(s *sourcedString, envName, cfgValue string) {
    if s.source == "cli" { return }            // CLI already set
    if v, ok := os.LookupEnv(envName); ok {
        s.value = v
        s.source = "env"
        return
    }
    if cfgValue != "" {
        s.value = cfgValue
        s.source = "config"
    }
    // else: keep default
}
```

The flow:

1. Before `flag.Parse`, initialize the `sourcedString` with the
   built-in default and `source = "default"`.
2. Register it with `flag.Var(&v, ...)`. If the user passes the flag,
   `Set` flips `source` to `"cli"`.
3. After `flag.Parse`, walk each `sourcedString` and call `resolve`,
   which preserves the CLI value if set, else falls back through env,
   config, default.

Log the resolved sources at startup:

```
addr = :9090 (cli)
log_level = info (env APP_LOG_LEVEL)
db_dsn = postgres://... (config /etc/app/config.yaml)
workers = 4 (default)
```

This trace is invaluable in production: when someone says "the prod
worker count is wrong," the answer is in the logs.

## 3. The merge-then-reparse pattern

A simpler precedence implementation: parse twice. The first parse
finds the config-file argument. Then load the file, build defaults,
and parse again for everything else.

```go
func runApp(args []string, out, errOut io.Writer) int {
    pre := flag.NewFlagSet("pre", flag.ContinueOnError)
    pre.SetOutput(io.Discard) // no errors yet, we'll re-parse
    cfgPath := pre.String("config", "", "config file")
    pre.Parse(args) // ignore errors; the "real" parse will catch them

    cfg := defaults()
    if *cfgPath != "" {
        if err := loadInto(cfg, *cfgPath); err != nil {
            fmt.Fprintln(errOut, err)
            return 2
        }
    }

    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    fs.SetOutput(errOut)
    fs.StringVar(&cfg.Addr, "addr", envOr("APP_ADDR", cfg.Addr), "listen address")
    fs.StringVar(&cfg.LogLevel, "log-level", envOr("APP_LOG_LEVEL", cfg.LogLevel), "log level")
    fs.IntVar(&cfg.Workers, "workers", envIntOr("APP_WORKERS", cfg.Workers), "worker count")
    if err := fs.Parse(args); err != nil { return 2 }

    return serve(cfg, out, errOut)
}
```

The two-phase parse is the simplest implementation that gets the
precedence right:

1. **Pre-parse** finds `-config`. The pre-parser uses
   `ContinueOnError` and discards output so unknown flags don't error.
2. **Defaults** load the config file into a struct.
3. **Real parse** uses each field's current value (post-config-load,
   post-env-override) as the flag default. The user's CLI input
   overrides those defaults.

The cost: every flag's default is computed at the env/config layer
before `flag.Parse` runs, so CLI input overrides everything below it
naturally. No per-flag tracking required.

## 4. Env-var helpers worth keeping in your toolkit

```go
func envOr(name, def string) string {
    if v, ok := os.LookupEnv(name); ok { return v }
    return def
}

func envIntOr(name string, def int) int {
    if v, ok := os.LookupEnv(name); ok {
        if n, err := strconv.Atoi(v); err == nil { return n }
    }
    return def
}

func envBoolOr(name string, def bool) bool {
    if v, ok := os.LookupEnv(name); ok {
        if b, err := strconv.ParseBool(v); err == nil { return b }
    }
    return def
}

func envDurationOr(name string, def time.Duration) time.Duration {
    if v, ok := os.LookupEnv(name); ok {
        if d, err := time.ParseDuration(v); err == nil { return d }
    }
    return def
}
```

Three rules in their design:

1. **Silent fallback on parse error.** A bad env var doesn't crash;
   it logs nothing and uses the default. If you want strict mode,
   change the helper to return `(value, error)` and propagate.
2. **`os.LookupEnv` not `os.Getenv`.** `Getenv` returns `""` for both
   "unset" and "set to empty"; `LookupEnv` distinguishes them. For
   booleans, an empty value is meaningful (`-flag=`) and you need the
   distinction.
3. **No prefix coupling.** Each helper takes the full env-var name.
   If you want a `MYAPP_` prefix convention, layer it in your registration
   call: `envOr("MYAPP_ADDR", ...)`.

## 5. Unix-conventional exit codes

Standard convention, useful to follow:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic runtime error |
| 2 | Command-line usage error (parse failed, missing arg, unknown flag) |
| 64-78 | The `sysexits.h` codes — niche, but used by tools like `xargs` |
| 126 | Command found but not executable (irrelevant for Go binaries) |
| 127 | Command not found (irrelevant for Go binaries) |
| 130 | Killed by SIGINT (Ctrl-C); equals 128 + signal number |

Map your `flag` errors to these:

```go
func main() {
    code := run(os.Args[1:], os.Stdout, os.Stderr)
    os.Exit(code)
}

func run(args []string, out, errOut io.Writer) int {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    fs.SetOutput(errOut)
    // ... register flags ...
    if err := fs.Parse(args); err != nil {
        if errors.Is(err, flag.ErrHelp) { return 0 }
        return 2 // CLI usage error
    }
    if err := doWork(); err != nil {
        fmt.Fprintln(errOut, err)
        return 1 // runtime error
    }
    return 0
}
```

The default `ExitOnError` mode of `flag.CommandLine` already exits
with 2 on parse failure — match that in your own subcommand handlers
for consistency. Reserve 1 for "the program ran but failed to do its
job."

## 6. Generating shell completions without `cobra`

Bash completions are a list of words emitted to stdout when a hidden
`__complete` flag is present. You can wire this manually:

```go
func completions(args []string, out io.Writer) int {
    if len(args) < 1 {
        // top-level: list subcommands
        for _, name := range subcommandNames() {
            fmt.Fprintln(out, name)
        }
        return 0
    }
    sub := args[0]
    switch sub {
    case "serve":
        for _, f := range []string{"-addr", "-tls", "-config"} {
            fmt.Fprintln(out, f)
        }
    case "migrate":
        for _, f := range []string{"-dir", "-dry-run"} {
            fmt.Fprintln(out, f)
        }
    }
    return 0
}

// In main:
if len(os.Args) >= 2 && os.Args[1] == "__complete" {
    os.Exit(completions(os.Args[2:], os.Stdout))
}
```

The shell side is a small Bash function:

```bash
_app_complete() {
    local cur=${COMP_WORDS[COMP_CWORD]}
    local prev_words=("${COMP_WORDS[@]:1:COMP_CWORD-1}")
    local out
    out=$(app __complete "${prev_words[@]}" 2>/dev/null)
    COMPREPLY=($(compgen -W "$out" -- "$cur"))
}
complete -F _app_complete app
```

For zsh and fish, the shape is similar with different glue. The Go
side is the same pattern: a hidden subcommand that emits one
completion per line based on the partial argv.

You can walk `flag.VisitAll` on each subcommand's `*FlagSet` to
generate completions automatically:

```go
func flagsOf(name string) []string {
    fs := buildFlagSet(name) // your factory
    var out []string
    fs.VisitAll(func(f *flag.Flag) {
        out = append(out, "-"+f.Name)
    })
    return out
}
```

This is the same approach `cobra` uses internally; it just packages the
shell glue and the metadata extraction together.

## 7. Cobra-style help output without Cobra

The `cobra` help format that everyone is used to:

```
NAME:
   app serve - run the HTTP server

USAGE:
   app serve [flags]

FLAGS:
   --addr value     listen address (default ":8080")
   --tls            enable TLS
   --config value   config file path
```

Reproduce it with a custom `Usage`:

```go
func cobraStyleUsage(fs *flag.FlagSet, name, short string) func() {
    return func() {
        out := fs.Output()
        fmt.Fprintf(out, "NAME:\n   app %s - %s\n\n", name, short)
        fmt.Fprintf(out, "USAGE:\n   app %s [flags]\n\n", name)
        fmt.Fprintln(out, "FLAGS:")
        fs.VisitAll(func(f *flag.Flag) {
            fmt.Fprintf(out, "   --%-12s %s", f.Name, f.Usage)
            if f.DefValue != "" && f.DefValue != "false" {
                fmt.Fprintf(out, " (default %q)", f.DefValue)
            }
            fmt.Fprintln(out)
        })
    }
}

fs.Usage = cobraStyleUsage(fs, "serve", "run the HTTP server")
```

Five lines of glue. The benefit of doing it manually: you control the
exact format, you don't pull in a multi-megabyte dependency, and
nothing changes when `cobra` releases a major version.

## 8. Handling SIGINT cleanly

A long-running CLI should drop the work and exit with 130 on Ctrl-C:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
    defer cancel()
    code := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
    os.Exit(code)
}

func run(ctx context.Context, args []string, out, errOut io.Writer) int {
    fs := flag.NewFlagSet("app", flag.ContinueOnError)
    // ... register ...
    if err := fs.Parse(args); err != nil { return 2 }

    if err := doWork(ctx); err != nil {
        if errors.Is(err, context.Canceled) {
            return 130
        }
        fmt.Fprintln(errOut, err)
        return 1
    }
    return 0
}
```

The flag parsing itself doesn't care about signals; the cancellation
is purely about what happens *after*. Pair the parsed flags with a
`context.Context` that propagates the cancellation into your
workload.

## 9. Testable `main`: the canonical shape

Production CLI tests should be table-driven and process-free.

```go
func TestRun(t *testing.T) {
    cases := []struct {
        name     string
        args     []string
        wantCode int
        wantOut  string
        wantErr  string
    }{
        {"happy", []string{"serve", "-addr=:9090"}, 0, "serving on :9090\n", ""},
        {"unknown command", []string{"frobnicate"}, 2, "", "unknown command"},
        {"unknown flag", []string{"serve", "-bogus"}, 2, "", "flag provided but not defined: -bogus"},
        {"help", []string{"serve", "-h"}, 0, "", "usage: app serve"},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            var out, errOut bytes.Buffer
            code := run(context.Background(), c.args, &out, &errOut)
            if code != c.wantCode {
                t.Errorf("code = %d, want %d", code, c.wantCode)
            }
            if c.wantOut != "" && !strings.Contains(out.String(), c.wantOut) {
                t.Errorf("stdout = %q, want substring %q", out.String(), c.wantOut)
            }
            if c.wantErr != "" && !strings.Contains(errOut.String(), c.wantErr) {
                t.Errorf("stderr = %q, want substring %q", errOut.String(), c.wantErr)
            }
        })
    }
}
```

Three properties:

- Each case is independent. The flag set is fresh per call; no
  cross-case state.
- Output capture is per-case. No interference with `t.Log`/`testing`'s
  own output.
- No `os.Exit`. The test process stays alive across cases.

This is the test pattern most production Go CLIs end up at. It works
because `run` is a function, not a `main`.

## 10. Hidden / experimental flags

`flag` has no built-in "hidden" concept. The convention: prefix
experimental flags with `x.` (or `_`), and filter them out of the
default `Usage`:

```go
fs.String("x.experimental-mode", "", "experimental: ...")
fs.String("x.alt-protocol", "", "experimental: ...")

fs.Usage = func() {
    fs.VisitAll(func(f *flag.Flag) {
        if strings.HasPrefix(f.Name, "x.") { return }
        fmt.Fprintf(fs.Output(), "  -%s\t%s\n", f.Name, f.Usage)
    })
}
```

A `--show-experimental` flag can lift the filter for power users:

```go
showExp := fs.Bool("show-experimental", false, "include experimental flags in --help")
fs.Usage = func() {
    fs.VisitAll(func(f *flag.Flag) {
        if !*showExp && strings.HasPrefix(f.Name, "x.") { return }
        fmt.Fprintf(fs.Output(), "  -%s\t%s\n", f.Name, f.Usage)
    })
}
```

The `kubectl` and `gh` projects do the same thing — separate the
experimental surface, opt in to seeing it.

## 11. Deprecating a flag

When you remove a flag, you can leave a stub that warns:

```go
type deprecatedFlag struct {
    name    string
    replace string
    out     io.Writer
}

func (d *deprecatedFlag) String() string { return "" }
func (d *deprecatedFlag) Set(s string) error {
    fmt.Fprintf(d.out, "warning: -%s is deprecated; use -%s instead\n", d.name, d.replace)
    return nil
}

fs.Var(&deprecatedFlag{name: "old-addr", replace: "addr", out: errOut}, "old-addr", "")
```

The flag still parses (so old scripts don't break), but it prints a
warning to stderr. After a release or two, remove the stub.

For flags that should error (hard removal), register a `Value` whose
`Set` returns an error:

```go
type removedFlag struct{ name, replace string }
func (r *removedFlag) String() string { return "" }
func (r *removedFlag) Set(string) error {
    return fmt.Errorf("-%s has been removed; use -%s", r.name, r.replace)
}
```

Now `app -old-addr=...` fails fast with a clear migration message. The
`flag` package's error formatting prepends the standard `invalid value`
prefix, which is sometimes ugly. Consider using `Func` (Go 1.16+) for a
slightly cleaner error path.

## 12. Validating flag combinations after `Parse`

`flag` has no notion of "these flags are mutually exclusive" or "if
flag A is set, flag B is required." Encode such rules after `Parse`:

```go
if err := fs.Parse(args); err != nil { return 2 }

if *useTLS && *certFile == "" {
    fmt.Fprintln(errOut, "-tls requires -cert-file")
    return 2
}
if *certFile != "" && !*useTLS {
    fmt.Fprintln(errOut, "-cert-file is meaningless without -tls")
    return 2
}
if *workers < 1 {
    fmt.Fprintln(errOut, "-workers must be >= 1")
    return 2
}
```

Group these checks into a `validate(*Config) error` function for
testability. Code that scales becomes a `[]validator` where each
validator is a small function.

## 13. The "explain" command

A pattern from larger CLIs: `app config explain` (or `app dump-config`)
prints the merged configuration with sources, so users can debug
"why is the wrong value in effect?"

```go
func explainCmd(args []string, out, errOut io.Writer) int {
    cfg, sources := loadFullConfig() // returns Config + map[fieldName]source
    fmt.Fprintln(out, "Effective configuration:")
    for name, value := range cfg.AsMap() {
        fmt.Fprintf(out, "  %-20s = %v  (%s)\n", name, value, sources[name])
    }
    return 0
}
```

Combined with the precedence pattern from section 2, this is the
single most valuable diagnostic feature you can ship in a CLI. When a
user reports "the wrong DSN is being used," the answer is in the
output.

## 14. When to graduate to `cobra`

Concrete signals:

1. **Three-level subcommands** (`app remote add origin url`). With
   `flag`, each level requires its own dispatch and `*FlagSet`. The
   tree gets unwieldy past two levels.
2. **Per-command short flags** (`-v` and `--verbose`, `-q` and
   `--quiet`) that you want to share between commands without
   manually declaring them on every `*FlagSet`.
3. **Suggestions for typos.** "Did you mean `serve`?" `flag` has no
   such facility; `cobra` ships it.
4. **First-class shell completions.** `cobra` generates Bash, Zsh,
   Fish, and PowerShell completion scripts from the command tree.
   With `flag` you do this by hand.
5. **Documentation generation.** `cobra` generates man pages, Markdown,
   and reStructuredText from the command tree. Useful for projects
   with docs sites.
6. **Pre/post hooks.** "Run this initializer before any subcommand"
   without manually adding a call to every `Run` function.

If your CLI hits two of those, `cobra`'s ~500 KB of code is cheaper
than maintaining the equivalents. If it's a single-binary internal
tool with three commands, stay on `flag` and save the dependency.

The subcommand framework from section 1 is the pragmatic ceiling.
Above that, switch.

## 15. When `flag` is still right

Even at scale, `flag` is the right answer for:

- **The `_test` binary.** Test flags should live on the global
  `flag.CommandLine` (no choice — `testing` puts its flags there
  too). Adding `cobra` for test flags is overkill.
- **Plugins for tools like `kubectl`** or `git`. The plugin gets
  argv after the prefix is stripped; `flag` is enough.
- **One-off operational scripts.** A 200-line tool with three flags
  doesn't need a framework.
- **Any binary where the dependency graph matters.** `cobra` pulls
  `pflag`, `viper` (sometimes), and a few smaller modules; for
  embedded systems, security-audited builds, or distroless images,
  shaving dependencies pays off.
- **Code that targets older Go versions.** `flag` has been API-stable
  for over a decade. `cobra`'s major versions occasionally break
  callers.

The right rule: default to `flag`. Reach for `cobra` when the lack of
its features starts to cost you measurably more than its dependency
cost. The point at which that flips is well-defined and project-
specific.

## 16. Observability hooks

Production CLIs benefit from a single function that logs the resolved
config at startup:

```go
func logConfig(cfg *Config, sources map[string]string, out io.Writer) {
    fmt.Fprintln(out, "config:")
    fields := reflect.ValueOf(cfg).Elem()
    typ := fields.Type()
    for i := 0; i < fields.NumField(); i++ {
        name := typ.Field(i).Tag.Get("name")
        if name == "" { continue }
        fmt.Fprintf(out, "  %-20s = %v  (%s)\n", name, fields.Field(i).Interface(), sources[name])
    }
}
```

Pair it with the source-tracking flags from section 2. The startup
log answers most "why is X happening" questions without a debugger.

For environments that ship structured logs, emit it as JSON instead:

```go
type configEvent struct {
    Field  string `json:"field"`
    Value  any    `json:"value"`
    Source string `json:"source"`
}

for name, val := range cfg.AsMap() {
    enc.Encode(configEvent{Field: name, Value: val, Source: sources[name]})
}
```

Either form, the rule is the same: log what was resolved, where it
came from, before doing anything else.

## 17. Short-circuit reads (`--version`, `--help`)

The `--version` convention: print the version string and exit 0
without doing any other work.

```go
var version = "dev" // overridden via -ldflags

func main() {
    showVersion := flag.Bool("version", false, "print version and exit")
    flag.Parse()
    if *showVersion {
        fmt.Println(version)
        os.Exit(0)
    }
    // normal flow
}
```

Some tools also accept `version` as a subcommand. A polished CLI
handles both:

```go
if len(args) == 1 && (args[0] == "version" || args[0] == "--version") {
    fmt.Println(version)
    return 0
}
```

The same pattern works for `--config-doc`, `--license`, and other
informational flags. Detect early, print, exit; don't fight the rest
of the flow.

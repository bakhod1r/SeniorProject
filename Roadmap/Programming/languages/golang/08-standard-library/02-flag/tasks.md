# 8.2 `flag` — Tasks

Twelve exercises that walk you from "I parsed a string flag" to "I
shipped a small CLI framework." Each task lists what to build,
acceptance criteria, and a hint or two. Code lives wherever you keep
your sandbox; nothing in this file depends on a particular project
layout.

## Task 1 — Calculator CLI

Build a `calc` program that takes two numbers and an operation:

```
$ ./calc -op=add -a=2 -b=3
5
$ ./calc -op=div -a=10 -b=4
2.5
$ ./calc -op=div -a=10 -b=0
error: division by zero
exit status 1
```

Acceptance:

- Flags `-a`, `-b` are `float64`. Flag `-op` is one of `add`, `sub`,
  `mul`, `div`.
- Unknown `-op` exits 2 with a usage error.
- Division by zero exits 1 with "division by zero" on stderr.
- Output goes to stdout with no trailing whitespace beyond `\n`.
- A `-h` flag prints usage and exits 0.

Hint: write a custom `flag.Value` for `-op` that validates against the
allowed set in `Set` and returns an error message naming the choices.

## Task 2 — Custom log-level flag

Implement a `flag.Value` named `logLevel` that accepts `debug`,
`info`, `warn`, `error` and stores an `int` (debug=0, info=1, etc.).
Register it as `-log-level`, default `info`. The program should
print the parsed level and any text supplied as positional arguments.

Acceptance:

- `-log-level=debug` sets the value to 0; `-log-level=info` to 1; etc.
- Any other input exits 2 with the message naming valid choices.
- `flag.PrintDefaults` shows `(default "info")`, not `(default "1")`.
  Achieve this by having `String()` return the human label.
- Tests assert that each valid input maps to the expected int and that
  invalid inputs return a non-nil error from `Set`.

Hint: store both the string label and the int internally; `String()`
returns the label, `Get()` returns the int.

## Task 3 — Subcommand-based file utility

Build `filetool` with three subcommands: `cp src dst`, `mv src dst`,
`rm path...`. Each subcommand has its own `*FlagSet`.

Acceptance:

- `filetool cp -force a b` overwrites the destination if it exists.
  Without `-force`, refuse with exit code 1.
- `filetool mv -dry-run a b` prints what would happen but doesn't
  touch the filesystem.
- `filetool rm path1 path2 path3` accepts any number of positional
  args; exits 1 if any file is missing (after attempting all).
- `filetool` with no args prints a usage block listing the three
  subcommands.
- `filetool help cp` prints the `cp` subcommand's usage.

Hint: write a small registry like the one in
[professional.md](professional.md) section 1; each subcommand is a
struct with `Setup` and `Run`.

## Task 4 — `$XDG_CONFIG_HOME` flag default

Build a `note` tool that takes `-store=PATH` for the location of a
notes file. The default should be:

1. The value of `$NOTE_STORE` if set, else
2. `$XDG_CONFIG_HOME/note/store.txt` if `$XDG_CONFIG_HOME` is set, else
3. `$HOME/.config/note/store.txt`.

Acceptance:

- `-store=/tmp/x.txt` overrides everything.
- The chosen path is logged on startup as `using store: <path>
  (source: cli|env|xdg|home)`.
- Tests verify each precedence level by setting/unsetting env vars.

Hint: compute the default before calling `flag.String`; record the
source in a separate variable for the log line.

## Task 5 — Duration with custom units

Implement a flag type that accepts durations the standard
`time.ParseDuration` doesn't understand, in addition to the standard
ones. Specifically, accept:

- Standard: `1h`, `30m`, `45s`, `100ms`.
- Day: `7d` → 7×24h.
- Week: `2w` → 14×24h.

Acceptance:

- `flag.Var(&v, "expire", "...")` and `-expire=2w` produces 14*24h.
- Mixed forms (`1w3d`) are not required to work, but document the
  decision.
- Invalid input ("3y") returns an error from `Set`.

Hint: detect a `d` or `w` suffix manually, parse the numeric prefix,
multiply, and fall back to `time.ParseDuration` for everything else.

## Task 6 — Key=value pair flag

Build a `flag.Value` that accepts `-set key=value` and stores the
pairs in a `map[string]string`. Multiple `-set` flags accumulate.

Acceptance:

- `-set a=1 -set b=2 -set c=3` produces `{a:1, b:2, c:3}`.
- A pair without `=` returns an error from `Set` ("expected key=value,
  got X").
- A repeat key overwrites the previous value silently. Document the
  decision.
- Bonus: support comma-separated pairs in one flag: `-set a=1,b=2`.

Hint: store the map by pointer; `String()` should print pairs in
sorted order so help output is deterministic.

## Task 7 — Deterministic env precedence

Build a `serve` CLI with flags `-addr`, `-log-level`, `-workers`. The
effective value should follow this precedence:

1. CLI flag if the user passed it.
2. `APP_<NAME>` env var if set.
3. Built-in default.

Acceptance:

- `-addr=:9090` always wins, even if `APP_ADDR` is set.
- With no `-addr` and `APP_ADDR=:7000`, the program uses `:7000`.
- With neither, the program uses `:8080` (the literal default).
- Print the resolved configuration with sources at startup, e.g.
  `addr=:7000 (env APP_ADDR)`.
- Tests cover all three precedence levels per flag.

Hint: track per-flag "user set" via `flag.Visit` after `Parse`. Combine
with the env helpers from
[professional.md](professional.md) section 4.

## Task 8 — Required-flag enforcement helper

Write a reusable function `requireFlags(fs *flag.FlagSet, names ...string) error`
that returns an error if any of the named flags weren't set on the
command line.

Acceptance:

- `requireFlags(fs, "config", "out")` returns nil after `fs.Parse`
  with both flags present.
- With one missing, the error is `required flag(s) missing: -out`.
- With both missing, the error lists both.
- Tests cover all three states using `flag.ContinueOnError` and a
  fresh `*FlagSet` per case.

Hint: build a `map[string]bool` from `fs.Visit`, then loop through
`names` checking absence.

## Task 9 — Bash completion helper

Add a hidden `__complete` subcommand to a CLI that emits one
completion candidate per line, based on the partial argv it receives.

Acceptance:

- `app __complete` lists subcommands.
- `app __complete serve` lists the `-addr`, `-tls`, etc. flags of
  the `serve` subcommand.
- `app __complete serve -a` lists matching flags (`-addr`).
- The hidden subcommand does not appear in the regular help output.
- Provide a Bash glue function (in a comment) that wires it to
  `complete -F`.

Hint: walk `fs.VisitAll` for each subcommand's `*FlagSet` and emit
flag names with leading `-`. Filter prefix matches at the Bash side
with `compgen`.

## Task 10 — Two-phase config-then-CLI parser

Build a parser that:

1. First-pass parses just `-config` from `os.Args[1:]`.
2. Loads a JSON config from that path into a struct.
3. Second-pass parses all flags, with the config values as defaults.

Acceptance:

- `app -config=test.json` loads the JSON, then applies any other
  flags on top.
- A flag passed on the CLI overrides the config value.
- A missing config file (`-config=` not passed) uses built-in
  defaults; everything still works.
- A malformed config file exits 2 with a clear error.
- Tests cover: no config, valid config, valid config plus CLI
  override, malformed config.

Hint: use `flag.NewFlagSet("pre", flag.ContinueOnError)` with output
sent to `io.Discard` for the first pass; ignore errors. Use a fresh
flag set for the second pass.

## Task 11 — Test harness for a `main` function

Refactor an existing `main`-only CLI into the
`run(args []string, out, errOut io.Writer) int` shape from
[middle.md](middle.md) section 13.

Acceptance:

- `main` is six lines or fewer; it constructs the writers, calls
  `run`, and `os.Exit`s with the result.
- All existing functionality works identically — no regressions.
- A test file exercises three behaviors: success, parse error, and
  runtime error. Each test uses fresh `bytes.Buffer`s and asserts on
  the exit code, stdout, and stderr.
- The tests run with `go test ./...` without forking processes.

Hint: replace `flag.Parse()` with `fs.Parse(args)` on a local
`*FlagSet` constructed with `ContinueOnError`. Replace direct calls
to `os.Stdout.Write*` with the passed-in `out` writer.

## Task 12 — Mini "kubectl plugin"-style CLI

Build a CLI named `app` with three subcommands and a `--version` short
circuit. Each subcommand should support `-h`, env-var fallback for
its primary flags, and a `--config` global.

Acceptance:

- `app --version` prints a version string and exits 0.
- `app status` reads `APP_NAMESPACE` from the env; CLI `-n` overrides.
- `app apply -f manifest.yaml` accepts `-f` (file path) and `-dry-run`.
- `app delete -name X` requires `-name`; missing name exits 2.
- The `-h` for any subcommand shows a usage block including the
  subcommand's flags.
- Tests run `app` from a `run(args, out, errOut)` helper, never from
  a forked process. At least one test per subcommand, plus tests for
  `--version` and the missing-required-flag case.

Hint: this is the cumulative test of everything in the leaf. Use the
small registry from
[professional.md](professional.md) section 1, the env helpers from
section 4, the required-flag helper from Task 8, and the
`-h` handling from Task 11. The full implementation is around
200-250 lines including tests.

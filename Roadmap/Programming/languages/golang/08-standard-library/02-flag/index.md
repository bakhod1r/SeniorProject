# 8.2 — `flag`

The standard library's `flag` package is the smallest viable command-line
parser you can put in front of a Go program. It defines flags as
package-level variables, parses `os.Args`, prints a generated usage
message, and stops. There is no abbreviation matching, no required-flag
notion, no native short/long pair, no environment-variable fallback, and
no subcommand framework. Everything beyond the basics you build yourself
on top of `*flag.FlagSet`.

That minimalism is the whole point. For a one-off binary, a test runner,
a lint helper, or any program small enough that adding `cobra` would
double the dependency graph, `flag` is the right answer. For a real CLI
with nested subcommands, completions, and rich validation, you graduate
to `cobra` or `urfave/cli`. This leaf teaches you both — how to use
`flag` well, and the boundary at which it stops being the right tool.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need the core API and the four-line `flag.String`/`Parse` recipe |
| [middle.md](middle.md) | You're writing custom `flag.Value` types and isolating subcommands with `*FlagSet` |
| [senior.md](senior.md) | You need the exact parse rules, error semantics, and `init()`/`testing.M` interactions |
| [professional.md](professional.md) | You're building a small subcommand framework with deterministic env precedence |
| [specification.md](specification.md) | You want every flag-defining function and parse rule on one page |
| [interview.md](interview.md) | You're preparing for or running interviews on stdlib CLI handling |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `flag` bugs in real code |
| [optimize.md](optimize.md) | You want structural improvements; raw `flag` performance rarely matters |

## Prerequisites

- Go 1.22+ (examples use `errors.Is`, `slices`, and modern stdlib idioms).
- Working knowledge of slices, interfaces, and basic error wrapping.
- Comfort with `os.Args`, `os.Exit`, and writing to `os.Stderr`.

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — for reading config files that flags reference.
- [`08-standard-library/05-os`](../05-os/) — for `os.Args`, `os.Getenv`,
  `os.Exit`, and the rest of the process surface.
- [`08-standard-library/04-strconv`](../04-strconv/) — `flag` uses
  `strconv` internally for type coercion; the same parse rules apply.

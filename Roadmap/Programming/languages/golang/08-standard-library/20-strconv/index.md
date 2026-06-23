# 8.20 — `strconv`

The `strconv` package is the standard library's dedicated tool for
converting between strings and primitive Go types: integers, floats,
booleans, and quoted string literals. Every time your program reads a
number from an environment variable, a query parameter, a CSV column,
or a config file, `strconv` is the right first stop — not `fmt.Sscanf`,
not `fmt.Sprintf`, and definitely not `strings.Replace`.

Where `fmt` trades speed for generality (reflection, `io.Writer`,
verb tables), `strconv` is narrow and fast. Its `Parse*` and `Format*`
functions avoid allocations wherever possible. The `Append*` family
goes further: they write directly into a caller-supplied `[]byte`,
enabling zero-allocation number rendering in hot paths.

This leaf covers the full package: the two function families
(`Parse*` / `Format*`), the `Append*` variants, quoting helpers
(`Quote`, `Unquote`, `CanBackquote`), error anatomy (`*NumError`),
and the performance trade-offs between `strconv`, `fmt`, and
`strings.Builder` for number-to-string conversion.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You need `Atoi`, `Itoa`, `ParseInt`, `ParseFloat`, `ParseBool`, and error handling |
| [middle.md](middle.md) | You're using `Append*`, `Quote`/`Unquote`, `ParseUint`, or batch conversion patterns |
| [senior.md](senior.md) | You need float precision internals, `NumError` anatomy, and escape-analysis trade-offs |
| [professional.md](professional.md) | You're parsing high-volume data streams and care about allocations per record |
| [specification.md](specification.md) | You need the full API reference tables |
| [interview.md](interview.md) | You're preparing for or running interviews on Go string conversion |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for `strconv` misuse |
| [optimize.md](optimize.md) | You're cutting allocations from the conversion hot path |

## Prerequisites

- Go 1.22+.
- Variables and basic types (`int`, `int64`, `float64`, `bool`,
  `string`, `[]byte`).
- Familiarity with Go error handling — every `Parse*` returns an error
  you must check.

## Cross-references

- [`08-standard-library/18-fmt`](../18-fmt/index.md) — `fmt.Sprintf`
  and `fmt.Sscanf` are the slower, more general alternative for the
  same conversions. The comparison appears throughout this leaf.
- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — `strconv.AppendInt` writes into `[]byte` buffers; common pattern
  with `bufio.Writer`.
- [`08-standard-library/19-strings-bytes`](../19-strings-bytes/index.md)
  — `strings.TrimSpace` is often applied before `strconv.Parse*`; the
  two packages are natural companions.

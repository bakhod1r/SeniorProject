# 8.8 — `regexp`

Go's `regexp` package is a complete RE2 implementation. That single
choice — RE2, not PCRE — explains almost every quirk of the API: no
backreferences, no lookaround, but linear time on every input. You
trade expressive power for the guarantee that no pattern, ever, can
turn a 10 KiB request into a 60-second CPU pin.

This leaf covers the pattern syntax that's actually supported, the
twenty-or-so methods on `*Regexp` (and how they relate to one
another), submatch handling, replace callbacks, the bytes-vs-strings
split, the leftmost-first vs leftmost-longest semantics, the
concurrency rules, and the cases where `regexp` is the wrong tool —
which is more often than people think.

## Files in this leaf

| File | Read this when… |
|------|-----------------|
| [junior.md](junior.md) | You want the core methods and the patterns you'll use every day |
| [middle.md](middle.md) | You're working with submatches, replace callbacks, and Unicode classes |
| [senior.md](senior.md) | You need the exact RE2 semantics, leftmost-first, and concurrency |
| [professional.md](professional.md) | You're embedding regex matching in a hot path or service surface |
| [specification.md](specification.md) | You need the formal method matrix and syntax reference |
| [interview.md](interview.md) | You're preparing for or running an interview on the package |
| [tasks.md](tasks.md) | You want hands-on exercises with acceptance criteria |
| [find-bug.md](find-bug.md) | You want to train your eye for the regex bugs that ship to production |
| [optimize.md](optimize.md) | You're chasing allocations or throughput in regex-heavy code |

## Cross-references

- [`08-standard-library/01-io-and-file-handling`](../01-io-and-file-handling/index.md)
  — `bufio.Scanner` is usually the right partner for line-at-a-time matching.
- [`08-standard-library/02-strings-and-bytes`](../02-strings-and-bytes/) —
  prefer `strings.Contains`, `HasPrefix`, `Cut` when you don't need a regex.
- [`08-standard-library/14-unicode`](../14-unicode/) — for `\p{L}` and the
  Unicode tables behind `(?i)`.

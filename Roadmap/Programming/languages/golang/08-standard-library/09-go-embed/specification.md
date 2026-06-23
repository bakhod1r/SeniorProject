# 8.9 `embed` and `//go:embed` — Specification

> The condensed contract for `embed`: directive grammar, target types,
> path rules, runtime behavior. Use this as the reference you cite
> when arguing about edge cases.

## 1. Directive grammar

```
EmbedDirective = "//go:embed" Pattern { " " Pattern } "\n"
Pattern        = [ "all:" ] PathOrGlob
PathOrGlob     = ( LiteralPath | DirectoryName | GlobPattern )
```

- A directive is a single-line `//` comment, never `/* */`.
- The directive must be the line immediately above a `var` declaration
  with no blank line in between.
- The variable must be at package scope.
- The variable type is one of: `string`, `[]byte`, `embed.FS`.
- `string` and `[]byte` accept exactly one matched file. `embed.FS`
  accepts zero or more.
- Multiple directives may stack on the same `embed.FS` variable; their
  pattern sets are unioned.
- The package must import `embed` (typically `import _ "embed"` if
  the type used is `string` or `[]byte`).

## 2. Target type rules

| Type | File count | Encoding |
|------|-----------|----------|
| `string` | Exactly 1 | Bytes interpreted as UTF-8-or-arbitrary; not validated |
| `[]byte` | Exactly 1 | Raw bytes, no transformation |
| `embed.FS` | 0 to many | Directory tree-shaped |

For `string` and `[]byte`, the variable's value at program start is
the file's contents. Mutation of the underlying memory is not
guaranteed to be allowed; treat as read-only.

## 3. Pattern resolution rules

1. Patterns resolve relative to the directory of the source file
   containing the directive.
2. Forward slashes only; backslashes are invalid.
3. No `..` components anywhere in the pattern.
4. No absolute paths.
5. Glob syntax follows `path.Match`: `*`, `?`, `[...]`, `[^...]`, `\c`.
   No `**`, no brace expansion, no negation.
6. A pattern that names a directory matches every file in that
   directory tree, recursively.
7. A pattern matching zero files is a build error.

## 4. Hidden file rules

A file's *base name* is hidden if it starts with `.` or `_`. A
directory is hidden under the same rule.

Without `all:`:

- Hidden files are excluded from any match.
- Hidden directories are excluded recursively (their entire subtree
  is skipped).

With `all:` prefix on a pattern:

- Hidden files and directories within that pattern's match are
  included.
- The prefix is per-pattern, not per-directive.

## 5. File-type rules

| File type | Embeddable |
|-----------|------------|
| Regular file | Yes |
| Directory (as a target name) | Yes (recursive) |
| Symbolic link | No (rejected by current toolchain) |
| FIFO / named pipe | No |
| Socket | No |
| Device (block / character) | No |

## 6. `embed.FS` API

```go
package embed

type FS struct{ /* unexported */ }

func (f FS) Open(name string) (fs.File, error)
func (f FS) ReadDir(name string) ([]fs.DirEntry, error)
func (f FS) ReadFile(name string) ([]byte, error)
```

Implements:
- `io/fs.FS` (`Open`)
- `io/fs.ReadFileFS` (`ReadFile`)
- `io/fs.ReadDirFS` (`ReadDir`)

Does **not** implement (use the `io/fs` package functions instead):
- `fs.GlobFS` — use `fs.Glob(fsys, pat)`.
- `fs.StatFS` — use `fs.Stat(fsys, name)`.
- `fs.SubFS` — use `fs.Sub(fsys, dir)`.

## 7. Path semantics inside `embed.FS`

- Names use forward slashes regardless of OS.
- Names are case-sensitive (matches the source file system at compile
  time, but stored case-sensitively in the FS).
- The root is `"."`.
- A directory pattern produces entries with names *including* the
  directory prefix: `//go:embed templates` makes
  `templates/index.html` accessible, not `index.html`.
- `fs.Sub(myFS, "templates")` returns a view that strips the prefix.

## 8. `fs.FileInfo` values for embedded files

| Field | Files | Directories |
|-------|-------|-------------|
| `Name()` | Basename | Basename (or `"."` for the root) |
| `Size()` | File length in bytes | 0 |
| `Mode()` | `0o444` | `0o555 \| fs.ModeDir` |
| `ModTime()` | Zero `time.Time` | Zero `time.Time` |
| `IsDir()` | `false` | `true` |
| `Sys()` | `nil` | `nil` |

## 9. `fs.File` capabilities for embedded files

For a file (not directory) opened via `embed.FS.Open`, the returned
`fs.File` also implements:

- `io.Seeker` — `Seek(offset, whence)`.
- `io.ReaderAt` — `ReadAt(p, off)`.
- `io.WriterTo` — `WriteTo(w)`.

For a directory, the returned `fs.File` implements `fs.ReadDirFile`:

- `ReadDir(n int) ([]fs.DirEntry, error)`.

`Read` on a directory returns an error wrapping
`fs.ErrInvalid`-equivalent ("is a directory").

## 10. Concurrency model

`embed.FS` and the `fs.File` values it returns are safe for concurrent
use by multiple goroutines. The underlying data is read-only.

Each call to `Open` returns a fresh `fs.File` value with its own
position cursor; concurrent reads from the same file via *different*
opens are independent. Concurrent calls on the *same* `fs.File` value
share the cursor and are not safe (same as `*os.File`).

## 11. Deterministic ordering

`embed.FS.ReadDir` returns entries sorted lexically by name. This
ordering is stable across builds, OSes, and Go versions.

`fs.WalkDir` visits entries in the same order, so walks are
deterministic.

## 12. Compile-time vs runtime

| Action | Time |
|--------|------|
| Resolve patterns to file list | Compile time |
| Read file contents | Compile time (baked into binary) |
| Validate patterns and types | Compile time |
| Initialize `embed.FS` value | Init time (before `main`) |
| Initialize `string` / `[]byte` variable | Init time |
| `Open`, `ReadFile`, `ReadDir` calls | Runtime (cheap, no I/O) |

There is no path by which `//go:embed` reads a file at runtime. The
file set is final when `go build` completes.

## 13. Build constraint interaction

Build tags (`//go:build ...`) are evaluated *before* `//go:embed`.
A file excluded by a build tag contributes no embed directives; a
directive inside such a file is dead.

`-ldflags "-X pkg.var=value"` does not interact with `embed` directly,
but is the standard way to stamp the binary with a build ID that
embedded code can read at runtime.

## 14. Reproducibility guarantees

For a given source tree, Go version, and `GOOS`/`GOARCH`:

- The embed file table is byte-identical between builds.
- File order is deterministic (lexical).
- No timestamps are recorded in the embed.
- File modes are fixed constants (`0o444`, `0o555|ModeDir`).

Differences between builds come from the *contents* of embedded
files, not from the embed mechanism itself. Reproducible builds
require deterministic asset generation upstream of `go build`.

## 15. Forbidden patterns checklist

| Pattern | Reason |
|---------|--------|
| `//go:embed /etc/foo` | Absolute path |
| `//go:embed ../foo` | Escapes package directory |
| `//go:embed a/../b` | `..` lexically present |
| `//go:embed dir\file` | Backslash separator |
| `//go:embed nothing.xyz` | Pattern matches zero files |
| `//go:embed dir/` | Trailing slash |
| `//go:embed **/*.html` | `**` not supported |
| `//go:embed {a,b}.html` | Brace expansion not supported |
| `//go:embed foo` (inside func) | Not at package scope |
| `//go:embed foo` (without `import "embed"`) | Embed not imported |
| `//go:embed foo bar` on `string` var | More than one file for scalar type |

## 16. Errors at runtime

`embed.FS.Open`, `ReadDir`, and `ReadFile` can return:

- `*fs.PathError` wrapping `fs.ErrNotExist` — name not in the FS.
- `*fs.PathError` wrapping `fs.ErrInvalid` — name uses backslashes,
  starts with `/`, or contains `..`.
- `*fs.PathError` wrapping a "is a directory" condition — calling
  `ReadFile` on a directory or `Read` on a directory file.

All errors are wrapped; use `errors.Is(err, fs.ErrNotExist)` to
check for missing files.

## 17. Cross-references

- [`io/fs`](../14-io-fs/junior.md) — the interface set `embed.FS` implements.
- [`text/template` and `html/template`](../15-templates/junior.md) —
  `ParseFS(fsys, patterns...)`.
- `net/http` — `http.FS(fsys)` adapter.
- `testing/fstest` — `MapFS` for tests, `TestFS`
  for FS conformance.

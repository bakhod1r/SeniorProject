# 8.9 `embed` and `//go:embed` — Senior

> **Audience.** You've shipped services that depend on `embed` and you
> want the precise rules: what the directive accepts, exactly which
> files end up in the binary, what `embed.FS` guarantees and forbids,
> and how it composes with the wider `io/fs` ecosystem. This file is
> the contract — what holds, what doesn't, and what to assume in code
> that lives a long time.

## 1. The directive grammar

The Go specification documents `//go:embed` as a comment directive
recognized by the `embed` package implementation in the compiler. The
form is:

```
//go:embed pattern1 [pattern2 ...]
var name TYPE
```

Constraints from the compiler:

1. The directive is a `//` line comment, not `/* */`.
2. The directive must appear immediately above a `var` declaration —
   no blank line, no other comment between.
3. The variable must be at package scope (not inside a function).
4. The variable's type must be `string`, `[]byte`, or `embed.FS`.
5. The package containing the directive must import the `embed`
   package, even if only as `_`.
6. `string` and `[]byte` accept exactly one matched file. `embed.FS`
   accepts any number, including zero — though zero matches is a
   build error if the pattern doesn't match anything.
7. Multiple directives may stack on the same `var` (only valid for
   `embed.FS`).

Patterns are space-separated within one directive. Each pattern is
either a literal path, a `path.Match` glob, or a directory name. The
optional `all:` prefix removes the default exclusion of dotfiles and
underscore files.

## 2. The exact path rules

Paths in `//go:embed` are interpreted relative to the directory of
the Go source file containing the directive. The resolved file set is
computed at compile time.

| Allowed | Forbidden |
|---------|-----------|
| Relative paths within the package directory tree | Absolute paths (`/etc/...`, `C:\...`) |
| Forward slashes as the only separator | Backslash separators on any OS |
| Files at any depth under the package | Paths containing `..` |
| Symbolic links to files inside the package | Symlinks pointing outside; symlinks at all in some toolchain versions |
| Regular files | Devices, sockets, FIFOs, named pipes |
| UTF-8 file names | Names that aren't valid UTF-8 |

The check for `..` is purely lexical — even `a/../b` is rejected,
even if it resolves to a path inside the package. The reason:
reproducible builds. The compiler must know the file set without
filesystem-dependent lookups.

## 3. Hidden files and `all:`

Without `all:`, the following are excluded from any directory or glob
match:

- Files whose **base name** starts with `.` (dotfiles).
- Files whose **base name** starts with `_` (underscore files).
- Directories named the same way (their entire subtrees are skipped).

This rule applies recursively when you embed a directory, and
positionally when you use a glob. `templates/.hidden` is excluded
even from `//go:embed templates/*`. The exclusion happens *before*
glob matching, not after.

`all:` lifts the exclusion for one pattern. It is per-pattern, not
per-directive:

```go
//go:embed all:assets templates/*.html
var content embed.FS
```

Here `assets` includes hidden files; `templates/*.html` does not — but
since `*.html` doesn't start with `.`, the practical effect is nil
unless you have files literally named `.html` or starting with `.`.

`all:` does not override the explicit forbidden cases (special files,
out-of-tree symlinks). It only relaxes the dotfile/underscore rule.

## 4. The `embed.FS` zero value and immutability

```go
type FS struct {
    files *[]file
}
```

(The internal layout is unexported; this is paraphrased from the source.)

Three properties:

1. **Zero value is empty and valid.** A `var x embed.FS` with no
   directive returns "file does not exist" for every name. It does
   not panic.
2. **`embed.FS` is read-only.** No `WriteFile`, no `Mkdir`, no `Remove`.
   The interface set is `Open + ReadDir + ReadFile`. By design.
3. **`embed.FS` is goroutine-safe.** The data lives in the binary's
   read-only data segment. Concurrent reads from any number of
   goroutines are safe with no synchronization.

Copying an `embed.FS` is cheap (it's a struct with a pointer field).
Two copies share the same underlying file table. There is no
mutation, so sharing is fine.

## 5. The `fs.File` interface as implemented by `embed`

`embed.FS.Open` returns an `fs.File`:

```go
type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}
```

For files (not directories), the returned object also implements:

- `io.Seeker` — random access into the embedded bytes.
- `io.ReaderAt` — pread-style access.
- `io.WriterTo` — fast path for `io.Copy`.

For directories, the returned object additionally implements
`fs.ReadDirFile`:

```go
type ReadDirFile interface {
    File
    ReadDir(n int) ([]DirEntry, error)
}
```

Calling `Read` on a directory returns an error
(`fs.PathError` wrapping a "is a directory" error). This matches the
behavior of `*os.File`.

## 6. `Stat()` semantics

`fs.FileInfo` from an embedded file:

| Field | Value |
|-------|-------|
| `Name()` | The file's basename (no directory) |
| `Size()` | Length of the file's bytes (always exact) |
| `Mode()` | `0o444` for files, `0o555 \| fs.ModeDir` for directories |
| `ModTime()` | The zero `time.Time` |
| `IsDir()` | `true` for directories |
| `Sys()` | `nil` |

These values are stable across platforms and Go versions. Code that
asserts on them (e.g., `info.Mode().Perm() == 0o444`) is fine.

The zero `ModTime` is the most common surprise. It cascades into:

- `http.ServeContent` skips emitting `Last-Modified`.
- `http.FileServer` cannot use `If-Modified-Since` to short-circuit.
- Tools that sort by `mtime` (cache-bust scripts, build systems) see
  every embedded file as identical.

## 7. The interfaces `embed.FS` does and does not implement

```go
var _ fs.FS         = embed.FS{}  // yes
var _ fs.ReadFileFS = embed.FS{}  // yes
var _ fs.ReadDirFS  = embed.FS{}  // yes
var _ fs.GlobFS     = embed.FS{}  // no — use fs.Glob(fsys, pat)
var _ fs.StatFS     = embed.FS{}  // no — Stat goes through Open + Stat
var _ fs.SubFS      = embed.FS{}  // no — use fs.Sub(fsys, dir)
```

The missing interfaces aren't a problem in practice because the
package-level functions in `io/fs` (`fs.Glob`, `fs.Stat`, `fs.Sub`)
work against any `fs.FS` by falling back to `Open`. The optional
interfaces are pure performance optimizations.

If you wrap an `embed.FS` and want the wrapper to participate in fast
paths, implement the optional interfaces by delegating:

```go
type myFS struct{ embed.FS }

func (m myFS) ReadFile(name string) ([]byte, error) {
    return m.FS.ReadFile(name)
}
```

The same trick is how `fs.Sub` returns an `fs.FS` that still supports
`ReadFile` and `ReadDir` efficiently.

## 8. Pattern matching, formally

Patterns in `//go:embed` use the syntax of `path.Match` from the
`path` package, with one extension: a pattern that is a directory
name (no glob characters) is treated as "all files recursively under
this directory."

`path.Match` rules:

| Pattern | Behavior |
|---------|----------|
| `*` | Any sequence of non-`/` characters |
| `?` | One non-`/` character |
| `[chars]` | Character class |
| `[^chars]` | Negated character class |
| `\c` | Literal `c` (escapes globbing) |

Specifically **not** supported:

- `**` — no recursive glob; use a directory name.
- Brace expansion `{a,b}`.
- POSIX character classes (`[:alpha:]`).

A pattern that contains no glob metacharacters is matched as a literal
path, except when it identifies a directory — then it matches the
recursive contents of that directory.

Edge cases:

- Empty matches are an error: `//go:embed *.notexist` fails to build
  with "no matching files."
- A pattern matching a directory and nothing else still embeds the
  whole tree (per the directory rule above).
- A pattern with literal characters that happen to also be glob
  metacharacters can be escaped: `//go:embed file\*.txt` matches the
  literal `file*.txt`.

## 9. The `all:` prefix, formally

`all:` is a pattern prefix. It applies to one pattern:

```
//go:embed all:dir1 dir2
```

Here `dir1` includes hidden files; `dir2` does not.

The prefix interacts with literal paths and globs differently:

- For a directory recursive match, `all:` includes hidden files at
  every level of the tree.
- For a glob, `all:` permits matching against names that start with
  `.` or `_`. The glob still has to match — `all:*.html` does not
  suddenly match `assets/.htaccess`.
- For a literal file path, `all:` is meaningful only if the path
  itself is hidden (e.g., `all:.gitignore`). The prefix lets the
  literal match succeed.

`all:` does not affect the absolute-path or `..` checks.

## 10. Symbolic link handling

The Go specification on `//go:embed` says symlinks are not followed.
The current toolchain (Go 1.22+) is more conservative: it rejects
symlinks during embed resolution to avoid platform-specific behavior
differences. If your source tree contains a symlink and a pattern
would match it, you'll see `pattern X: cannot embed irregular file`
or similar.

Two practical takeaways:

1. Don't put symlinks in your embedded directory. Copy or hardlink the
   file instead.
2. If a build mysteriously fails on one platform, check whether
   someone added a symlink to the asset tree. CI on Linux happily
   followed it, the developer's macOS resolved it differently, and
   `embed` rejected it on Windows.

## 11. The `[]byte` fast path

When a `//go:embed` variable is `[]byte`, the slice header points
directly at the binary's read-only data segment for the file's bytes
**in some toolchain versions**, and at a fresh heap copy in others.
The Go specification documents that the variable is initialized to
the file's contents but does not promise zero-copy.

What you can rely on:

- The `[]byte` is initialized exactly once, at program startup.
- Reading from it is safe and concurrent.
- Writing to the slice is not guaranteed to error, but is undefined
  behavior — in current toolchains, attempting to write to a slice
  that aliases the read-only segment will cause a runtime panic
  (segmentation fault routed through Go's runtime).

The safe rule: treat embedded `[]byte` and `string` as if they were
backed by read-only memory, even if the current implementation
sometimes copies. Don't mutate them; if you need a mutable copy,
allocate one with `append([]byte(nil), embedded...)` or `bytes.Clone`.

## 12. `string` vs `[]byte` for text data

A `string` and a `[]byte` from the same file have identical content.
The differences:

| Property | `string` | `[]byte` |
|----------|----------|----------|
| Convertible to the other | Yes (one allocation) | Yes (one allocation) |
| Allowed as `case` value in switches | Yes | No |
| `len(x)` and indexing | Yes | Yes |
| Mutable | No (compile error) | No (runtime UB; treat as immutable) |
| Idiomatic for "embed a query / template / message" | Yes | No |
| Idiomatic for "embed an image / certificate / archive" | No | Yes |

Choose `string` when the file is text and you'll feed it to functions
that take strings (template parsers, SQL drivers, regexes). Choose
`[]byte` when the file is binary or when you'll pass it to writers,
hashers, or `io.Copy`-style consumers.

## 13. Multiple directives, multiple variables, multiple files

| Configuration | Allowed |
|---------------|---------|
| Two `//go:embed` directives on the same `embed.FS` var | Yes |
| Two `//go:embed` directives on the same `string` or `[]byte` var | No (single file only) |
| One directive matching two files for `string`/`[]byte` | No |
| One directive matching zero files | No (compile error) |
| Several `embed.FS` vars in the same file embedding overlapping sets | Yes |
| Same pattern across multiple files in the same package | Yes (each var gets its own FS) |
| Embedding the same file twice in the same `embed.FS` | Yes (no error, single entry) |

The rules collapse to: directives bind to one variable; that variable
is one file's worth of data, or one filesystem of any size.

## 14. Build flag interactions

`//go:embed` is evaluated after build constraints (`//go:build`
lines). This means:

- A file in `_dev.go` with `//go:build dev` containing
  `//go:embed dev_only.txt` only takes effect when you build with
  `-tags dev`.
- An entire package compiled out by build constraints contributes no
  embedded files.

Pair this with `-ldflags`:

```bash
go build -tags prod -ldflags "-X main.buildID=$(git rev-parse HEAD)" ./...
```

You can switch which embed file gets used per build, and stamp build
metadata into a string variable that the embed-using code reads at
runtime. This is the standard recipe for dev/prod asset switching.

## 15. Reproducible builds and embed

`go build` is reproducible bit-for-bit when the inputs are identical.
`embed` participates honestly: the file order in `embed.FS` is
deterministic (lexical), the contents are byte-for-byte, and there is
no embedded `mtime`. Two builds from the same commit on the same Go
version produce the same binary section for the same `//go:embed`.

Things that *break* reproducibility:

- A `go generate` step that produces non-deterministic output (e.g.,
  embedding a timestamp in the generated file).
- Embedding files that themselves contain ephemeral metadata
  (`Manifest.txt` with a build date).
- Locale-sensitive sorting in some custom code that reads `ReadDir`
  results — the directory order from `embed.FS.ReadDir` is fixed and
  byte-sorted, so this hits only consumer code.

For supply-chain-conscious builds, prefer pre-built static assets
checked into the repo over `go generate`-produced ones.

## 16. Binary size and what counts

The size cost of embedding is approximately:

```
binary size delta = sum(file sizes) + small overhead per file
```

Per-file overhead is on the order of dozens of bytes (the file table
entry: name, offset, size). For a directory tree of N small files,
the dominant cost is the file table, not the data. For a few large
files, the data dominates.

To measure exactly:

```bash
go build -o app
go tool nm -size app | grep go:embed | sort -n
```

The `go:embed.*` symbols in the binary list each embed point with its
size. The total of those sizes is your embed budget.

For binaries shipped through `go install` or container images, also
note: the binary lives in your container layer regardless of how the
data is laid out. CDN-served assets are usually a more efficient
distribution channel for content over a few MiB.

## 17. The `embed` package surface, complete

```go
package embed

// FS is a read-only collection of files, usually initialized with a
// //go:embed directive.
type FS struct {
    // contains filtered or unexported fields
}

func (f FS) Open(name string) (fs.File, error)
func (f FS) ReadDir(name string) ([]fs.DirEntry, error)
func (f FS) ReadFile(name string) ([]byte, error)
```

That is the entire public API. Everything else you do with embedded
files goes through `io/fs` package functions or through downstream
consumers like `http.FS` and `template.ParseFS`.

The minimalism is deliberate. `embed` defines a producer of `fs.FS`;
all the operations live in `io/fs`. Code that takes an `fs.FS` works
with embedded data, real disks, archives, and tests.

## 18. Edge cases that bite

- **Empty directory.** A directory with no files is not an embed
  target; the pattern fails to match anything.
- **Directory with only hidden files.** Same — without `all:`, it
  matches nothing.
- **Trailing slash on a pattern.** Not allowed; remove it.
- **`go vet` on a misplaced directive.** `vet` does not catch
  misplaced `//go:embed`. The compile error is your first sign.
- **`gofmt` and the directive line.** Formatting moves the directive
  if it's mispositioned — keep it directly above the `var` and
  formatting won't touch it.
- **Embedded files appearing in vendor/cache directories.** They are
  copies, not links; the embed in the original package still works,
  but be careful with relative-path patterns when copying packages.

## 19. What to read next

- [professional.md](professional.md) — production patterns:
  versioning, large-asset strategies, deployment.
- [specification.md](specification.md) — the formal grammar and rule
  list, condensed.
- [find-bug.md](find-bug.md) — drills derived from the rules in this
  file.

# 8.14 `io/fs` — Tasks

Practice problems that build real `fs.FS` muscles. Each task lists
the goal, the constraints, and a hint or two. Solutions are
straightforward applications of material from `junior.md`,
`middle.md`, and `senior.md` — write them, run them, and confirm
with `fstest.TestFS` where applicable.

## Task 1 — Word counter that takes any `fs.FS`

Write a function:

```go
func WordCount(fsys fs.FS, pattern string) (map[string]int, error)
```

`pattern` is a `path.Match` glob (e.g., `"*.txt"`). Walk the FS
matching the pattern, accumulate word counts across all matched
files, return the map.

Constraints:

- Use `fs.Glob` for matching.
- Use `bufio.Scanner` with `ScanWords` for tokenization.
- Don't load whole files into memory; stream them.

Verify with two backends: `os.DirFS(".")` over a sample directory
and `fstest.MapFS{...}` with three short files.

## Task 2 — `cat` over an `fs.FS`

Write a CLI:

```
fcat <fs-source> <name>...
```

Where `<fs-source>` is one of `disk:<dir>`, `embed:`, or
`zip:<file>`. The CLI opens the source as an `fs.FS` and prints
each named file's contents to stdout.

Constraints:

- Single function `func cat(fsys fs.FS, names []string, w io.Writer) error`.
- Use `io.Copy` for streaming.
- Errors include the name (`fmt.Errorf("cat %s: %w", name, err)`).

Hint: `archive/zip.OpenReader` returns a `*zip.ReadCloser` whose
embedded `*zip.Reader` is the `fs.FS` you want.

## Task 3 — Tree printer with depth limit

```go
func PrintTree(fsys fs.FS, root string, maxDepth int, w io.Writer) error
```

Print every entry under `root`, indented by depth, up to
`maxDepth`. Cut off and print `...` for directories that exceed
the limit.

Constraints:

- Use `fs.WalkDir`.
- Return `fs.SkipDir` when depth exceeds `maxDepth`.
- Output stable (lexically sorted, which `WalkDir` already gives).

## Task 4 — Implement `SingleFS`

Write an `fs.FS` whose constructor is:

```go
func NewSingle(name string, data []byte) fs.FS
```

The FS contains one file at the given name. Any other name returns
`fs.ErrNotExist`. The root (`.`) is a directory listing the file.

Constraints:

- Implement `fs.FS`, `fs.ReadFileFS`, `fs.ReadDirFS`.
- Reject invalid paths with `fs.ErrInvalid` wrapped in `*fs.PathError`.
- Pass `fstest.TestFS(fsys, name)` cleanly.

Hint: see `middle.md` section 4 for the file/info type pattern.

## Task 5 — Implement `MultiFS`

Combine multiple `fs.FS` values into one. Each input lives at its
own top-level directory:

```go
fsys := MultiFS{
    "configs":   embedConfigs,
    "templates": embedTemplates,
}
data, _ := fs.ReadFile(fsys, "configs/app.yaml")  // hits embedConfigs
data, _ := fs.ReadFile(fsys, "templates/x.html") // hits embedTemplates
```

Constraints:

- Implement `fs.FS` and `fs.ReadDirFS`.
- The root listing returns the keys (`configs`, `templates`) as
  directory entries.
- A name like `unknown/foo` returns `fs.ErrNotExist`.

## Task 6 — Implement `OverlayFS`

```go
type OverlayFS struct {
    Top    fs.FS
    Bottom fs.FS
}
```

`Open(name)` tries `Top` first; if `fs.ErrNotExist`, falls back to
`Bottom`. `ReadDir(name)` merges entries from both layers, with
`Top` overriding `Bottom` on name collisions.

Constraints:

- Use `errors.Is(err, fs.ErrNotExist)` for the fallback.
- Sort merged `ReadDir` output.

Test with `fstest.MapFS` for both layers, including a file present
in both.

## Task 7 — Implement `FilteredFS`

```go
type FilteredFS struct {
    Base  fs.FS
    Allow func(name string) bool
}
```

Hide every name for which `Allow(name)` returns `false`. They
should look like they don't exist (`fs.ErrNotExist`), not
permission-denied.

Constraints:

- Filter both `Open` and `ReadDir`.
- The root (`.`) is always allowed.
- Test by allowing only `*.go` files and confirming `ReadDir`
  excludes `*.md`.

## Task 8 — Tar archive as an `fs.FS`

Implement:

```go
func NewTarFS(r io.Reader) (fs.FS, error)
```

Read the entire tar archive (`archive/tar`) into memory at
construction; return an `fs.FS` over the entries.

Constraints:

- Skip non-regular entries (symlinks, devices) — for this task,
  treat them as if not present.
- Synthesize parent directories like `MapFS` does: if the tar
  contains `a/b/c.txt`, listing `a/` returns `b`, listing `a/b/`
  returns `c.txt`.
- Pass `fstest.TestFS`.

Hint: store entries in a `map[string]*tarEntry`. Synthesize
directories by deriving parents at construction.

## Task 9 — Conditional asset loader

Write a function that returns the right `fs.FS` for the
environment:

```go
func LoadAssets() fs.FS
```

- If the env var `ASSETS_DIR` is set and points to a real
  directory, return `os.DirFS(value)`.
- Otherwise, return an embedded `fs.FS` (from `//go:embed all:assets`,
  with `fs.Sub` to strip the prefix).

Constraints:

- Include a CLI subcommand or test that prints `fs.WalkDir` output
  for the chosen FS, so you can see what was loaded.
- Document the precedence in a comment near the function.

## Task 10 — Simple HTTP file server

Build a minimal program:

```go
package main

import "net/http"

//go:embed all:public
var public embed.FS

func main() {
    sub, _ := fs.Sub(public, "public")
    http.Handle("/", http.FileServerFS(sub))
    http.ListenAndServe(":8080", nil)
}
```

Extend it:

1. Add an ETag header derived from a build-time `var buildID string`.
2. Add `Cache-Control: public, max-age=31536000, immutable` for
   any URL containing `.v` (a hash version segment).
3. Disable directory listings: respond 404 for any URL ending in
   `/` that isn't `/`.

## Task 11 — Conformance test for an arbitrary `fs.FS`

Write a function:

```go
func RunConformance(t *testing.T, fsys fs.FS, expected ...string)
```

Internally: call `fstest.TestFS` and report failures with
`t.Errorf`. Add additional checks:

- Every name in `expected` returns the same bytes from `Open`+`ReadAll`
  as from `fs.ReadFile`.
- `fs.Stat` and `Open`+`File.Stat` agree on size and mode.
- `fs.ReadDir` results are sorted.

Run it on `embed.FS`, `fstest.MapFS`, and your `SingleFS` from
task 4.

## Task 12 — Recursive file size

```go
func TotalSize(fsys fs.FS, root string) (int64, error)
```

Walk from `root`, sum up the `Size()` of every regular file. Skip
directories (don't double-count).

Constraints:

- Use `fs.WalkDir`.
- Call `d.Info()` only for non-directory entries to keep it lazy.
- Test on `os.DirFS`, `embed.FS`, and `fstest.MapFS`. The result
  should be the sum of `len(MapFile.Data)` for each MapFile.

## Task 13 — `ParseFS` with template inheritance

Set up a project with:

```
templates/
  layout.html
  home.html
  about.html
```

`layout.html` defines the outer structure; `home.html` and
`about.html` define their content via `{{define "content"}}...{{end}}`.

Write a function:

```go
func Render(fsys fs.FS, name string, data any, w io.Writer) error
```

That parses every `*.html` from the FS once at startup and renders
the named template using the layout.

Constraints:

- Use `html/template.ParseFS`.
- Pass `fs.Sub(embedFS, "templates")` so names are `layout.html`,
  `home.html`, `about.html`.
- Test with `fstest.MapFS` containing the three template files.

## Task 14 — In-memory FS with mutation (for tests only)

`fstest.MapFS` is a map; it's not safe to mutate while reading.
Write a thread-safe variant:

```go
type SafeMapFS struct {
    mu sync.RWMutex
    m  map[string][]byte
}

func (s *SafeMapFS) Set(name string, data []byte)
func (s *SafeMapFS) Open(name string) (fs.File, error)
```

Constraints:

- `Set` may be called from multiple goroutines.
- `Open` may be called concurrently with `Set`; readers see a
  consistent snapshot.
- Hint: copy the slice into the map under the write lock; copy out
  under the read lock.

This isn't for production — it's for tests that flip files
mid-test and verify the consumer reacts.

## Task 15 — `find` clone

Build a CLI:

```
ffind <root> -name '<pattern>' [-type f|d]
```

Walks `root` (interpreted as a directory) and prints every entry
whose basename matches the glob and whose type matches the flag.

Constraints:

- Take `fs.FS` internally so unit tests use `MapFS`.
- Use `path.Match` for matching.
- Skip `.git` directories with `fs.SkipDir`.

## Task 16 — Server with hot-reload templates (dev mode)

Implement the dual-mode pattern from `professional.md` section 6:

- Production build: `embed.FS` rooted at templates.
- Dev build (`-tags dev`): `os.DirFS("./templates")`.
- A `Reload()` method on the server that re-parses templates on
  demand.

In dev, the handler calls `Reload()` once per request (cheap on a
local disk) so edits appear without restart. In prod, `Reload()`
is a no-op.

Hint: use a build tag and two files (`server_dev.go`,
`server_prod.go`) implementing the same `reload()` helper
differently.

## Task 17 — `git ls-files`-style enumerator

Walk an `fs.FS`, print every regular file relative to the root,
sorted lexicographically.

```go
func List(fsys fs.FS) ([]string, error)
```

Constraints:

- Skip directories; print only regular files.
- Names are relative (no leading `./`).
- Output is stable. (Hint: collect into a slice and sort, or rely
  on `WalkDir`'s lexical order.)

Run on `embed.FS` and confirm the output matches what
`go list -f '{{.EmbedFiles}}'` says was embedded.

## Task 18 — Search-and-replace across an FS

Read every `*.go` file from an `fs.FS`, search for a regex, replace
all matches, return the modified contents in a `map[string][]byte`.
Don't write anything back — this exercise is read-only.

```go
func SearchReplace(fsys fs.FS, pattern, replacement string) (map[string][]byte, error)
```

Constraints:

- Use `regexp.Compile` once outside the walk.
- Skip files with no matches (don't include them in the output).
- Test with `fstest.MapFS` so you can verify the replacements.

## Task 19 — `fs.FS` from a function

Some libraries expose a "function-as-FS" pattern. Implement:

```go
type FuncFS func(name string) ([]byte, error)
```

Where `Open(name)` calls the function, returns a `bytes.Reader`-backed
`fs.File` if the bytes come back, or `fs.ErrNotExist` if the
function returns `errors.Is(err, fs.ErrNotExist)`.

Constraints:

- The FS is "directory-less" — `ReadDir(".")` returns
  `fs.ErrInvalid` (or returns nothing; document your choice).
- `Stat` opens, calls `Stat`, closes. Implement `StatFS` to
  optimize this path.

This pattern is useful when the source is a remote service, but
keep it minimal for the exercise.

## Task 20 — Mini static site generator

Combine everything: read templates from one `fs.FS`, content from
another, render to a third destination (`os` writes, since `fs.FS`
is read-only).

```go
func Build(templates, content fs.FS, outDir string) error
```

For each `.md` file in `content`, render it through the
appropriate layout template and write the result to
`outDir/<basename>.html`. Use `goldmark` or any markdown library
for the conversion.

Constraints:

- Both `templates` and `content` are `fs.FS`. In tests they're
  `MapFS`; in production they're `embed.FS`.
- The output directory uses `os.WriteFile`. (`fs.FS` doesn't write.)
- Each render is independent; you can run them in parallel with
  `errgroup`.

## What to do with the solutions

Run `fstest.TestFS` against any custom FS. Run `go test -race` on
anything that touches goroutines. Verify with at least two backends
(disk and embed, or embed and MapFS) that a single function works
unchanged.

The point of every task: code that takes `fs.FS` is reusable
across sources. After writing them, the abstraction stops being
abstract and becomes a tool you reach for.

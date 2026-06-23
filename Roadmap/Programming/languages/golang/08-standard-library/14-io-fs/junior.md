# 8.14 `io/fs` — Junior

> **Audience.** You've read files with `os.Open` and walked directories
> with `filepath.WalkDir`. Now you keep seeing `fs.FS`, `fs.File`, and
> `fs.DirEntry` in package signatures (`embed.FS`, `http.FS`,
> `template.ParseFS`, `archive/zip`) and you want a complete picture
> of the abstraction. By the end of this file you'll know the four
> interfaces that define a filesystem, the helper functions that
> consume them, and how to read from any of the half-dozen concrete
> `fs.FS` types in the standard library.

## 1. The insight: `io.Reader`, but for filesystems

Recall what `io.Reader` did. Instead of writing functions against
`*os.File`, the standard library writes them against `io.Reader` —
anything that can produce bytes. A function that takes `io.Reader`
works on files, network connections, gzip streams, and in-memory
buffers without knowing or caring which.

`io/fs` does the same trick at the next level up. Instead of writing
functions against `*os.File`-trees rooted at a real directory, write
them against `fs.FS` — anything that can open named files in a
hierarchy. A function that takes `fs.FS` works on disk
(`os.DirFS`), on an embedded asset bundle (`embed.FS`), on a `.zip`
archive (`zip.OpenReader`), on an in-memory map (`fstest.MapFS`),
or on a custom implementation you wrote in fifty lines.

```go
package main

import (
    "fmt"
    "io/fs"
)

func countFiles(fsys fs.FS) (int, error) {
    n := 0
    err := fs.WalkDir(fsys, ".", func(_ string, d fs.DirEntry, err error) error {
        if err != nil {
            return err
        }
        if !d.IsDir() {
            n++
        }
        return nil
    })
    return n, err
}
```

That single function counts files in your project directory, in an
embedded asset bundle, in a zip archive, and in a test fixture. The
caller chooses the source.

The package was added in Go 1.16. Before it, code that wanted this
abstraction had to invent its own interface, and every library that
shipped one was incompatible with every other. Today, `fs.FS` is
the standard.

## 2. The four core interfaces

The whole package fits in two pages. The four interfaces every
filesystem implementation deals with:

```go
type FS interface {
    Open(name string) (File, error)
}

type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}

type FileInfo interface {
    Name() string       // base name
    Size() int64        // length in bytes
    Mode() FileMode     // file mode bits
    ModTime() time.Time // modification time
    IsDir() bool        // shorthand for Mode().IsDir()
    Sys() any           // platform-specific data
}

type DirEntry interface {
    Name() string
    IsDir() bool
    Type() FileMode
    Info() (FileInfo, error)
}
```

Read top to bottom: an `FS` opens a `File`. A `File` knows its `Stat`
(metadata) and can read bytes. A `FileInfo` is the metadata. A
`DirEntry` is a *cheaper* version of `FileInfo` returned by directory
listings — it carries only the name, kind (file/dir/symlink), and a
deferred `Info()` call when you need full stat data.

`FileMode`, `FileInfo`, and `DirEntry` are aliases of the same types
used by `os` (`os.FileMode = fs.FileMode`, etc.). Code written
against `io/fs` and code written against `os` see the same metadata
shapes — that's deliberate.

## 3. Names: forward-slash, no `..`, no leading slash

The single most important rule. Names in `io/fs` are *virtual* paths,
not OS paths.

- **Forward-slashes always.** `templates/index.html`, on Linux, macOS,
  and Windows. The runtime never translates them. (Compare to
  `path/filepath`, where you'd write `filepath.Join("templates",
  "index.html")` and get backslashes on Windows.)
- **No leading slash.** `/foo` is invalid. The root is `.`, and child
  names are relative.
- **No `..` or `.` segments inside the name.** `a/../b`, `./a` — both
  invalid. Permitted: a bare `.` for the root, and ordinary segment
  names.
- **No empty segments.** `a//b` is invalid.

The function `fs.ValidPath(name)` returns `true` for names that obey
all of the above:

```go
fs.ValidPath(".")              // true
fs.ValidPath("a/b/c")          // true
fs.ValidPath("/a/b")           // false (leading /)
fs.ValidPath("a/../b")         // false (..)
fs.ValidPath("a//b")           // false (empty segment)
fs.ValidPath("")               // false
```

Every method on every `FS` should reject invalid names with a
`*PathError` wrapping `fs.ErrInvalid`. The standard library types do.
If you write your own `FS`, validate at the door and you eliminate a
whole class of bugs.

## 4. Helper functions: the friendly API

The interfaces are minimal because every common operation is built
on `Open` and exposed as a top-level function:

| Function | Does |
|----------|------|
| `fs.ReadFile(fsys, name)` | Open, read all bytes, close |
| `fs.ReadDir(fsys, name)` | List a directory as `[]DirEntry` |
| `fs.Stat(fsys, name)` | Get a `FileInfo` without keeping the file open |
| `fs.Glob(fsys, pattern)` | List paths matching a `path.Match` pattern |
| `fs.Sub(fsys, dir)` | Return an `FS` rooted at a subdirectory |
| `fs.WalkDir(fsys, root, fn)` | Recursive walk |

You almost never call `Open` directly. Reach for the helpers first;
fall back to `Open` when you need streaming or when the helpers don't
fit:

```go
data, err := fs.ReadFile(fsys, "config.yaml")
entries, err := fs.ReadDir(fsys, "templates")
info, err := fs.Stat(fsys, "version.txt")
matches, err := fs.Glob(fsys, "*.go")
```

The helpers are the same shape you already know from `os.ReadFile`,
`os.ReadDir`, `os.Stat`. The difference is that they take an `fsys`
instead of being implicitly anchored at the OS root.

## 5. The half-dozen concrete `fs.FS` types

The standard library ships six places you can get an `fs.FS` from:

| Source | Where it lives | What it represents |
|--------|----------------|--------------------|
| `os.DirFS(root)` | `os` | A real directory on disk |
| `embed.FS` | `embed` | Bytes baked into the binary |
| `fstest.MapFS` | `testing/fstest` | An in-memory map for tests |
| `zip.OpenReader(path)` | `archive/zip` | A `.zip` file (returns `*zip.ReadCloser` which embeds `*zip.Reader`, an `fs.FS`) |
| `fs.Sub(parent, "dir")` | `io/fs` | A subtree view of any `fs.FS` |
| Your own type | anywhere | Tar streams, S3 buckets, layered overlays |

The first four are concrete; the fifth is a constructor; the sixth
is the open-ended frontier. `fs.Sub` is worth highlighting — it's
the cheap rooting operation:

```go
//go:embed assets
var bundle embed.FS

assets, _ := fs.Sub(bundle, "assets")
data, _ := fs.ReadFile(assets, "main.css") // not "assets/main.css"
```

## 6. Reading a single file from any `fs.FS`

Three equivalent forms:

```go
// Helper (recommended)
data, err := fs.ReadFile(fsys, "name")

// Open + io.ReadAll
f, err := fsys.Open("name")
if err != nil { return err }
defer f.Close()
data, err := io.ReadAll(f)

// Method on the concrete type, if it has one
data, err := myEmbed.ReadFile("name") // embed.FS has its own ReadFile
```

Prefer `fs.ReadFile`. It's the one that works on every `fs.FS`,
including ones you didn't write. The package-level helper internally
uses the concrete type's faster `ReadFile` if it has one (see
section 8 of middle.md). You get the speed without depending on the
concrete type.

## 7. Listing a directory

```go
entries, err := fs.ReadDir(fsys, "templates")
if err != nil {
    return err
}
for _, e := range entries {
    fmt.Println(e.Name(), e.IsDir())
}
```

`fs.ReadDir` returns `[]fs.DirEntry`, sorted lexicographically by
name. Sorted *for you* — you don't need to sort it. (Compare
`os.ReadDir`, which has the same guarantee, vs `(*os.File).Readdir`,
which does not.)

`DirEntry` is the lightweight version. `Name()` and `IsDir()` come
for free; `Info()` may require a syscall to fill in size and
modtime, so it's deferred until you ask:

```go
for _, e := range entries {
    if e.IsDir() {
        continue
    }
    info, err := e.Info()
    if err != nil { return err }
    fmt.Println(e.Name(), info.Size())
}
```

For small directories the difference is invisible. For directories
with thousands of entries, lazily stat-ing only the ones you care
about is a real saving.

## 8. Walking a tree: `fs.WalkDir`

The recursive walker. Same shape as `filepath.WalkDir`, but it
takes an `fs.FS` so it works on embeds, zips, and tests:

```go
err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil {
        return err // propagate stat errors or stop the walk
    }
    if d.IsDir() && d.Name() == ".git" {
        return fs.SkipDir
    }
    fmt.Println(path)
    return nil
})
```

Three things to know:

- **Walk root is virtual.** Use `"."` for the FS root. A leading `/`
  is invalid.
- **Lexical order, depth-first.** Directories are visited *before*
  their contents.
- **Return `fs.SkipDir` to prune.** Returning it from a directory
  call skips that directory's children. From a file call, it skips
  the rest of the parent directory.
- **Return `fs.SkipAll` (Go 1.20+) to end the walk** with no error.

`WalkDir` is faster than the older `filepath.Walk` because it gives
you a `DirEntry`, not a `FileInfo`. Lazy stat, again — you only pay
the syscall for files you actually inspect.

## 9. Errors: the canonical sentinels

`io/fs` defines five sentinel errors that every well-behaved FS
returns at the right time:

```go
var (
    ErrInvalid    = errors.New("invalid argument")
    ErrPermission = errors.New("permission denied")
    ErrExist      = errors.New("file already exists")
    ErrNotExist   = errors.New("file does not exist")
    ErrClosed     = errors.New("file already closed")
)
```

These are aliases of (or equal to, depending on Go version) the
errors `os` already used. Modern code checks them with `errors.Is`:

```go
data, err := fs.ReadFile(fsys, "config.yaml")
if errors.Is(err, fs.ErrNotExist) {
    // file isn't there; use a default
} else if err != nil {
    return err
}
```

Older predicates like `os.IsNotExist(err)` still work but don't see
through `errors.Wrap`-style chains. Prefer `errors.Is(err,
fs.ErrNotExist)` in new code.

The wrapper type is `*fs.PathError`, returned by every method that
takes a name:

```go
type PathError struct {
    Op   string // "open", "stat", "read", ...
    Path string // the offending name
    Err  error  // underlying error (often a sentinel)
}
```

When you see `open templates/missing.html: file does not exist`,
that's `PathError.Error()` formatting itself. The `Op`, `Path`, and
`Err` fields are accessible if you care to look at them.

## 10. `os.DirFS`: a real disk directory as an `fs.FS`

The bridge from a real directory to an `fs.FS`:

```go
fsys := os.DirFS("/etc")

data, err := fs.ReadFile(fsys, "hosts")
// equivalent to os.ReadFile("/etc/hosts")
```

`os.DirFS(root)` returns an `fs.FS` rooted at `root`. The names you
pass to `Open`, `ReadFile`, etc., are joined with `root` to form the
real path on disk. So `fs.ReadFile(fsys, "hosts")` opens
`/etc/hosts`.

Two important caveats — see senior.md for the long version:

1. **`os.DirFS` does not prevent path escape.** A name containing
   `..` will be rejected by `ValidPath`, but a *symlink inside the
   directory* whose target is outside is followed silently. For
   user-supplied names from untrusted sources, use Go 1.24's
   `os.Root` instead.
2. **`os.DirFS` returns OS-level errors as-is.** A permission denied
   on the underlying file becomes `fs.ErrPermission` (because they
   alias). You don't need a translation layer.

`os.DirFS` is the easiest way to write tests against real
filesystems and code against the abstract one — wire `os.DirFS` in
production, swap for `fstest.MapFS` in tests.

## 11. `embed.FS`: the binary's own filesystem

Covered in detail in [`../09-go-embed/`](../09-go-embed/junior.md). The
short version:

```go
import "embed"

//go:embed templates
var templates embed.FS

// embed.FS implements fs.FS, fs.ReadFileFS, fs.ReadDirFS.
data, _ := fs.ReadFile(templates, "templates/index.html")
```

Pass it anywhere an `fs.FS` is expected. `template.ParseFS`,
`http.FS`, `fs.WalkDir` — all work the same on `embed.FS` as on
`os.DirFS`.

## 12. `fstest.MapFS`: a fake filesystem for tests

The standard library's in-memory `fs.FS`:

```go
import "testing/fstest"

fsys := fstest.MapFS{
    "config.yaml":     &fstest.MapFile{Data: []byte("debug: true")},
    "templates/x.tpl": &fstest.MapFile{Data: []byte("hello")},
}

data, _ := fs.ReadFile(fsys, "config.yaml")
```

`MapFS` is a `map[string]*MapFile`. Each entry's path is the full
virtual path (no implicit prefix). It implements every optional
interface — `ReadFileFS`, `ReadDirFS`, `StatFS`, `GlobFS`, `SubFS`
— so it's a great target for testing.

If your function takes `fs.FS`, your tests don't need real files,
real fixtures, or `t.TempDir()`. They need a `MapFS` literal. We'll
do this constantly in middle.md.

## 13. Minimal worked example: render a template from any `fs.FS`

```go
package main

import (
    "html/template"
    "io"
    "io/fs"
    "os"
)

func render(fsys fs.FS, name string, data any, w io.Writer) error {
    tpl, err := template.ParseFS(fsys, name)
    if err != nil {
        return err
    }
    return tpl.Execute(w, data)
}

func main() {
    // Production: read from disk.
    if err := render(os.DirFS("./tpl"), "index.html", "world", os.Stdout); err != nil {
        panic(err)
    }
}
```

Test:

```go
func TestRender(t *testing.T) {
    fsys := fstest.MapFS{
        "index.html": &fstest.MapFile{Data: []byte("hello, {{.}}")},
    }
    var buf bytes.Buffer
    if err := render(fsys, "index.html", "world", &buf); err != nil {
        t.Fatal(err)
    }
    if got := buf.String(); got != "hello, world" {
        t.Fatalf("got %q", got)
    }
}
```

No `t.TempDir`, no `os.WriteFile`, no cleanup. The `fs.FS`
interface gave you a free fake.

## 14. `http.FS`: serve any `fs.FS` over HTTP

`http.FileServer` predates `io/fs`; it takes `http.FileSystem`. The
adapter `http.FS` converts:

```go
//go:embed static
var staticFS embed.FS

sub, _ := fs.Sub(staticFS, "static")
http.Handle("/", http.FileServer(http.FS(sub)))
```

Go 1.22 added `http.FileServerFS(fs.FS)` — same thing, one less
adapter call:

```go
http.Handle("/", http.FileServerFS(sub))
```

Either works. New code can use `http.FileServerFS` and skip
`http.FS`.

## 15. `template.ParseFS`: load templates from any `fs.FS`

Both `text/template` and `html/template` ship `ParseFS`:

```go
//go:embed templates/*.html
var tplFS embed.FS

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html"))
```

The pattern argument is a `path.Match` glob inside the FS, not a
disk path. `*` matches one segment; there is no `**`. For deeper
parsing, walk the FS yourself and `Parse` each file.

## 16. Read-only by design

`io/fs` has no `Write`, no `Create`, no `Remove`, no `Mkdir`. The
abstraction is read-only. There is no plan to add a write
counterpart — the use cases (embedded assets, archives, in-memory
test fixtures) don't need one, and a write API would have to
solve a much harder problem (atomicity, durability, locking).

If you want to write, you're in `os` territory. `io/fs` is for
reading.

## 17. `fs.SkipDir` and `fs.SkipAll`

Two pruning sentinels for `WalkDir`:

```go
err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() && d.Name() == "node_modules" {
        return fs.SkipDir // skip the rest of this subtree
    }
    if d.Name() == "STOP" {
        return fs.SkipAll // end the entire walk, no error
    }
    return nil
})
```

`SkipAll` was added in Go 1.20. Before it, you had to return a
custom sentinel error and check for it after the walk. New code
should use `SkipAll`.

## 18. Common mistakes at this level

| Symptom | Likely cause |
|---------|--------------|
| `invalid argument` from `fs.ReadFile` | Used a leading `/` or a `..` in the name |
| `file does not exist` for an embedded file | Path in `embed.FS` includes the directory prefix; either prefix it or `fs.Sub` |
| `pattern X: no matching files found` | `template.ParseFS` glob doesn't match anything in the FS |
| Panic in `ParseFS` | Used `template.Must(...)` on a parse that returned an error; check the error before wrapping |
| Empty walk | Passed `""` instead of `"."` as the root |
| Duplicate path prefix in URLs | Forgot `fs.Sub` *and* `http.StripPrefix` |

The `""` vs `"."` confusion is the most common one. The root of an
`fs.FS` is `"."`, always.

## 19. Putting it together: a directory tree printer

```go
package main

import (
    "flag"
    "fmt"
    "io/fs"
    "os"
    "strings"
)

func main() {
    flag.Parse()
    root := "."
    if flag.NArg() > 0 {
        root = flag.Arg(0)
    }
    if err := tree(os.DirFS(root)); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}

func tree(fsys fs.FS) error {
    return fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
        if err != nil { return err }
        if path == "." { return nil }
        depth := strings.Count(path, "/")
        prefix := strings.Repeat("  ", depth)
        fmt.Println(prefix + d.Name())
        return nil
    })
}
```

Replace `os.DirFS(root)` with an `embed.FS` and the same `tree`
function prints the embedded tree. That's the dividend `io/fs`
pays.

## 20. What to read next

- [middle.md](middle.md) — capability interfaces, building your
  own `fs.FS`, `fstest.TestFS`, layered FS.
- [senior.md](senior.md) — exact contract, `ValidPath` semantics,
  symlink support, `os.DirFS` vs `os.Root`.
- [`../09-go-embed/`](../09-go-embed/junior.md) — the go-to concrete `fs.FS`.
- [`../15-templates/`](../15-templates/junior.md) — `template.ParseFS` in
  detail.
- The official package docs: [`io/fs`](https://pkg.go.dev/io/fs).

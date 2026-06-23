# 8.9 `embed` and `//go:embed` — Junior

> **Audience.** You've heard about `//go:embed`, maybe pasted one once,
> and you want a complete picture: what it does, what you can embed,
> what you can't, and how to use it in real programs. By the end of
> this file you should be able to embed a config file, an HTML
> template, and a directory of static assets, and serve any of them
> over HTTP.

## 1. What `//go:embed` actually does

`//go:embed` is a *compile-time* instruction. When the Go compiler sees
the directive above a package-level variable, it reads the named files
from your source tree and bakes their bytes into the binary. At runtime
your variable is already populated — there is no I/O, no filesystem
lookup, and no error path. The files are part of the executable.

```go
package main

import (
    _ "embed" // required: the directive only works if this package is imported
    "fmt"
)

//go:embed version.txt
var version string

func main() {
    fmt.Println(version)
}
```

If `version.txt` sits next to `main.go` and contains `1.4.2\n`, the
program prints `1.4.2`. The file is no longer required at runtime — you
can `go build`, ship the binary alone, and it still works.

The blank import `_ "embed"` is mandatory. Without it, the compiler
rejects the directive with `//go:embed only allowed in Go files that
import "embed"`. The package itself exposes the `embed.FS` type but is
otherwise tiny; the heavy lifting is done by the compiler and linker.

## 2. The three target types

Every `//go:embed` variable must be one of exactly three types:

| Type | Holds | Use it for |
|------|-------|------------|
| `string` | One file's bytes as text | Single text file (config, version, README) |
| `[]byte` | One file's bytes verbatim | Single binary file (image, certificate, archive) |
| `embed.FS` | A read-only filesystem | One *or more* files, globs, or directory trees |

```go
//go:embed version.txt
var version string

//go:embed logo.png
var logoPNG []byte

//go:embed templates assets static
var content embed.FS
```

`string` and `[]byte` are limited to **one** file. Multiple patterns,
glob patterns, or directory names require `embed.FS`. The compiler
enforces this — `//go:embed templates/*.tmpl` on a `string` variable is
a build error.

## 3. Where the directive must go

Three placement rules trip people up on day one:

1. **Package-level variable only.** The directive cannot decorate a
   variable declared inside a function. The variable must be a top-level
   `var`.
2. **Directly above the variable, no blank line.** A blank line between
   the directive and the `var` invalidates the directive. The Go
   compiler treats `//go:embed` as a *line directive* tied to the
   following declaration.
3. **Use `//`, not `/* */`.** Block comments are ignored.

```go
// CORRECT
//go:embed config.yaml
var config []byte

// WRONG — blank line breaks the binding
//go:embed config.yaml

var config []byte

// WRONG — function-local, will not compile
func load() {
    //go:embed config.yaml
    var config []byte
    _ = config
}
```

## 4. Paths are relative and slash-only

The pattern after `//go:embed` is a path relative to the directory
holding the Go source file. Forward slashes only — even on Windows.

```go
//go:embed assets/css/main.css
var mainCSS string
```

Two restrictions are enforced at build time:

- **No `..` components.** You cannot embed files outside the current
  package's directory tree.
- **No absolute paths.** `/etc/passwd` and `C:\Windows\...` are not
  valid embed targets, by design.

If your assets live in a sibling directory of the package, move the
package or duplicate the assets. There is no escape hatch.

## 5. Single file vs glob vs directory

The pattern after `//go:embed` is one of three forms:

| Form | Example | Embeds |
|------|---------|--------|
| Single file | `templates/index.html` | Just that file |
| Glob | `templates/*.tmpl` | Files in `templates` matching the pattern |
| Directory name | `templates` | The whole tree under `templates` |

A directory name is recursive: `//go:embed templates` embeds every file
inside `templates`, including subdirectories. Globs are not recursive
across directories — `templates/*.tmpl` matches files directly in
`templates`, but not in `templates/admin`.

Multiple patterns can sit on one directive, separated by spaces:

```go
//go:embed templates assets/*.css static/img
var content embed.FS
```

Or stacked across multiple directives on the same variable:

```go
//go:embed templates
//go:embed assets/*.css
//go:embed static/img
var content embed.FS
```

Both compile to the same `embed.FS`. Pick whichever reads better in
your codebase.

## 6. Hidden files and the `all:` prefix

By default `//go:embed` excludes files and directories whose names
begin with `.` or `_`. These are the conventional Go markers for
"ignore me" — `.git`, `.DS_Store`, `_testdata`, and so on. If you
embed a directory tree, those entries are silently skipped.

When you actually need them, prefix the pattern with `all:`:

```go
//go:embed all:assets
var assets embed.FS
```

`all:` includes hidden files and `_`-prefixed entries from the matched
tree. Without it, `assets/.htaccess` and `assets/_drafts/foo.md` are
not embedded. This bit a lot of teams shipping `.well-known` files for
HTTPS challenges before `all:` existed (Go 1.18+).

## 7. The `embed.FS` type

`embed.FS` is the only exported type in the package. It implements the
`io/fs.FS` interface, which means anything in the standard library
that takes an `fs.FS` accepts it directly. The methods you'll use most:

```go
func (f FS) Open(name string) (fs.File, error)
func (f FS) ReadFile(name string) ([]byte, error)
func (f FS) ReadDir(name string) ([]fs.DirEntry, error)
```

Plus `fs.Sub(f, "subdir")` from the `io/fs` package, which returns a
view rooted at a subdirectory.

```go
//go:embed templates
var templates embed.FS

func main() {
    data, err := templates.ReadFile("templates/index.html")
    if err != nil { panic(err) }
    fmt.Println(len(data), "bytes")
}
```

Note the path: `templates/index.html`, not `index.html`. The directory
name is part of the embedded path. If you want a view rooted at
`templates`, use `fs.Sub`:

```go
import "io/fs"

sub, err := fs.Sub(templates, "templates")
if err != nil { panic(err) }
data, err := fs.ReadFile(sub, "index.html") // no "templates/" prefix
```

## 8. Walking the tree

`embed.FS` works with `fs.WalkDir`:

```go
import (
    "fmt"
    "io/fs"
)

err := fs.WalkDir(templates, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    fmt.Println(path, d.IsDir())
    return nil
})
```

`"."` is the root of the embedded tree. The callback fires once per
file and once per directory, in lexical order.

## 9. Serving assets over HTTP

`http.FileServer` accepts an `http.FileSystem`. Adapter
`http.FS` converts any `fs.FS` into one:

```go
package main

import (
    "embed"
    "io/fs"
    "log"
    "net/http"
)

//go:embed static
var static embed.FS

func main() {
    sub, err := fs.Sub(static, "static")
    if err != nil { log.Fatal(err) }

    http.Handle("/", http.FileServer(http.FS(sub)))
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

`fs.Sub` strips the `static/` prefix so requests to `/main.css` map to
the embedded file `static/main.css`. Without the `Sub`, you'd have to
visit `/static/main.css`, which is rarely what you want.

This is a single binary that serves a website. No deploy step copies
files; everything is in the executable.

## 10. Parsing templates from `embed.FS`

`text/template` and `html/template` both expose `ParseFS`:

```go
import "html/template"

//go:embed templates/*.html
var tplFS embed.FS

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    tpl.ExecuteTemplate(w, "index.html", nil)
}
```

The pattern argument to `ParseFS` is a glob *within* the FS. It must
match at least one file or `ParseFS` returns an error.

This pairs particularly well with `embed.FS` — your binary now ships
the templates, parses them once at init time, and uses them forever.
There is no template-not-found error in production unless you typoed
the name.

## 11. What gets embedded, exactly

Just the bytes. Not the metadata.

| Property | Embedded? |
|----------|-----------|
| File contents | Yes |
| File name | Yes |
| Directory structure | Yes |
| File size | Yes (derivable from contents) |
| Modification time | No — `ModTime()` returns the zero `time.Time` |
| Permission bits | No — `Mode()` returns `0o444` for files, `0o555|fs.ModeDir` for dirs |
| Owner / group | No |
| Symbolic links | Not followed; embedding a symlink target is rejected |
| Special files (devices, sockets) | Rejected |

The implication: when you serve embedded assets over HTTP, the
`Last-Modified` header reflects `time.Time{}` (which `net/http` then
omits or normalizes), and ETag generation can't lean on `ModTime`. We'll
revisit this in middle.md.

## 12. A complete worked example

Project layout:

```
myapp/
  main.go
  go.mod
  templates/
    layout.html
    index.html
  static/
    main.css
    logo.png
```

`main.go`:

```go
package main

import (
    "embed"
    "html/template"
    "io/fs"
    "log"
    "net/http"
)

//go:embed templates/*.html
var templateFS embed.FS

//go:embed static
var staticFS embed.FS

var tpl = template.Must(template.ParseFS(templateFS, "templates/*.html"))

func index(w http.ResponseWriter, r *http.Request) {
    if err := tpl.ExecuteTemplate(w, "index.html", nil); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
    }
}

func main() {
    http.HandleFunc("/", index)

    sub, err := fs.Sub(staticFS, "static")
    if err != nil { log.Fatal(err) }
    http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(sub))))

    log.Println("listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

`go build && ./myapp` — that's a deployable web service. The whole
asset pipeline is `go build`. No image, no volume mount, no init
container. This is the dividend `embed` pays.

## 13. When *not* to embed

Embedding bakes bytes into the binary. The trade-offs:

- **Binary size.** A 50 MiB asset directory becomes a 50+ MiB binary.
  CDN-served static assets stay smaller and cache better.
- **Deploy granularity.** Updating a single CSS file requires
  rebuilding and redeploying the whole binary. For frequently-changing
  content, embedding is friction.
- **Dynamic content.** You can't embed user uploads, generated
  reports, or anything not present at build time. The directive is
  evaluated at compile time only.

Embed for content that ships *with* the code: templates, migrations,
default configs, license text, vendored fixtures. Don't embed for
content that ships *separately*: marketing assets, user uploads, CDN
material.

## 14. Common build-time errors

| Message | Meaning |
|---------|---------|
| `//go:embed only allowed in Go files that import "embed"` | Add `import _ "embed"` (or `import "embed"` if you use `embed.FS`) |
| `pattern X: no matching files found` | The path is wrong, the file doesn't exist, or you forgot `all:` for a hidden file |
| `pattern X: cannot match anything: ...` | A `..` or absolute path slipped in |
| `go:embed cannot apply to var inside func` | Move the variable to package scope |
| `embed: no matching files found` | `//go:embed` line not directly above the var (blank line in between?) |

Read the error literally — it almost always tells you which rule was
violated.

## 15. What to read next

- [middle.md](middle.md) — patterns: ParseFS for templates, http.FS
  with stripping, fs.Sub, walking, ETag/cache headers without ModTime.
- [senior.md](senior.md) — the exact directive grammar, hidden-file
  rules, fs.FS guarantees, build flags, and binary-size measurement.
- [tasks.md](tasks.md) — exercises that practice these patterns.
- [`../14-io-fs/`](../14-io-fs/junior.md) — the full `io/fs.FS` API that
  `embed.FS` implements.

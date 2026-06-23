# 8.9 `embed` and `//go:embed` — Find the Bug

> Each section shows a short snippet that compiles or fails for a
> reason that's easy to miss. Read each one, decide what's wrong,
> then check the answer. Together they cover the rough edges that bite
> teams in real codebases.

## 1. The blank line that breaks everything

```go
package main

import (
    _ "embed"
    "fmt"
)

//go:embed version.txt

var version string

func main() { fmt.Println(version) }
```

**Bug.** The blank line between `//go:embed version.txt` and
`var version string` detaches the directive from the variable. The
compile error is `//go:embed cannot apply to var inside func`-adjacent
or `directive must immediately precede declaration`. The fix is to
remove the blank line.

## 2. The function-local embed

```go
package main

import (
    _ "embed"
    "fmt"
)

func main() {
    //go:embed config.json
    var config []byte
    fmt.Println(len(config))
}
```

**Bug.** `//go:embed` only applies to package-level `var` declarations.
The compiler rejects this with a clear message. Move `var config
[]byte` and the directive above `func main`.

## 3. The forgotten import

```go
package main

import "fmt"

//go:embed version.txt
var version string

func main() { fmt.Println(version) }
```

**Bug.** Missing `import _ "embed"`. The compile error is
`//go:embed only allowed in Go files that import "embed"`. Add the
blank import and the file compiles.

## 4. The wrong target type

```go
package main

import (
    _ "embed"
    "fmt"
)

//go:embed templates/*.html
var templates string

func main() { fmt.Println(templates) }
```

**Bug.** A glob that matches more than one file cannot target
`string`. The compile error is `embed: unsupported type for
//go:embed; cannot embed multiple files into a string`. Switch to
`embed.FS`.

## 5. The dot in the path

```go
package main

import (
    "embed"
    "fmt"
)

//go:embed assets/../assets/foo.txt
var content embed.FS

func main() { fmt.Println(content) }
```

**Bug.** `..` in the pattern is rejected even when it would resolve
to a path inside the package. The check is lexical. The fix is to
write `assets/foo.txt` directly.

## 6. The hidden file you can't find

```go
package main

import (
    "embed"
    "fmt"
    "io/fs"
)

//go:embed assets
var assets embed.FS

func main() {
    fs.WalkDir(assets, ".", func(p string, d fs.DirEntry, _ error) error {
        fmt.Println(p)
        return nil
    })
}
```

**Bug.** If `assets/` contains `.htaccess`, it isn't listed. Files
starting with `.` or `_` are excluded by default. Use
`//go:embed all:assets` to include them.

## 7. The mtime-based ETag

```go
func handler(fsys fs.FS) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        info, err := fs.Stat(fsys, "main.css")
        if err != nil { http.Error(w, err.Error(), 500); return }
        etag := fmt.Sprintf(`"%d"`, info.ModTime().Unix())
        w.Header().Set("ETag", etag)
        // ...
    }
}
```

**Bug.** `embed.FS.Stat().ModTime()` returns the zero `time.Time`,
so `.Unix()` is the same value (typically `-62135596800`) for every
request. Every response has the same ETag, which masks bug 8 below.
Use a build ID or a content hash instead.

## 8. The cache that never invalidates

```go
//go:embed static
var static embed.FS

func main() {
    sub, _ := fs.Sub(static, "static")
    handler := http.FileServer(http.FS(sub))
    http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
        handler.ServeHTTP(w, r)
    }))
    http.ListenAndServe(":8080", nil)
}
```

**Bug.** `immutable` plus a year of caching means clients never come
back to check for updates. With the same URL across binary versions,
new builds don't reach old clients. Either include a build ID in the
URL (`/static/v<id>/...`) or use shorter `max-age` and an ETag tied
to the build.

## 9. The missing `fs.Sub`

```go
//go:embed static
var staticFS embed.FS

func main() {
    http.Handle("/", http.FileServer(http.FS(staticFS)))
    http.ListenAndServe(":8080", nil)
}
```

**Bug.** Without `fs.Sub`, the embed paths still include the
directory: `static/main.css`, not `main.css`. A request to
`/main.css` returns 404. The user has to visit `/static/main.css`,
which is rarely what they want. Add `sub, _ := fs.Sub(staticFS,
"static")` and serve `http.FS(sub)`.

## 10. The double prefix

```go
//go:embed static
var staticFS embed.FS

func main() {
    http.Handle("/static/", http.FileServer(http.FS(staticFS)))
    http.ListenAndServe(":8080", nil)
}
```

**Bug.** A request to `/static/main.css` reaches the file server
with that path; the file server looks for `static/main.css` in the
FS, which does exist (the embed kept the prefix), so this *works*.
But adding `fs.Sub` would break it, and adding `http.StripPrefix`
without `fs.Sub` would also break it. The current setup only works
because two prefixes happen to cancel out. Be explicit:
`http.Handle("/static/",
http.StripPrefix("/static/",
http.FileServer(http.FS(sub))))` with `fs.Sub`.

## 11. The path with backslashes

```go
data, err := tplFS.ReadFile("templates\\admin\\edit.html")
if err != nil { /* ... */ }
```

**Bug.** Embed paths use forward slashes everywhere, including on
Windows. The lookup fails with `fs.ErrNotExist`. Use
`templates/admin/edit.html`.

## 12. The disk-style filepath.Join

```go
import "path/filepath"

name := filepath.Join("templates", "index.html")
data, _ := tplFS.ReadFile(name)
```

**Bug.** On Windows, `filepath.Join` returns `templates\index.html`,
which embed rejects. Use `path.Join` (always slashes) or
`filepath.ToSlash` to convert.

## 13. The wrong glob assumption

```go
//go:embed templates/**/*.html
var templates embed.FS
```

**Bug.** `**` is not supported. The directive fails with
`pattern ...: cannot match anything`. To embed nested templates
recursively, name the directory: `//go:embed templates`. Then walk
the FS to find HTML files.

## 14. The empty match

```go
//go:embed assets/*.svg
var icons embed.FS
```

**Bug.** If `assets/` exists but contains no `.svg` files, the build
fails with `pattern assets/*.svg: no matching files found`. The fix
depends on intent: ensure the files exist, or remove the pattern, or
match a different extension.

## 15. The mutated embedded slice

```go
//go:embed config.json
var config []byte

func init() {
    config = bytes.ReplaceAll(config, []byte("{{NAME}}"), []byte("prod"))
}
```

**Bug.** Two issues. First, `bytes.ReplaceAll` returns a new slice;
this just replaces the variable's pointer to point at the new slice,
which is fine. Second (the real one): if the code instead did
`config[0] = 'X'` to "patch" the contents, on some toolchain versions
that would crash because the slice may alias read-only memory. Treat
embedded `[]byte` as immutable.

## 16. The double parse

```go
//go:embed templates/*.html
var tplFS embed.FS

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    t, _ := template.ParseFS(tplFS, "templates/*.html") // re-parse per request
    t.ExecuteTemplate(w, "index.html", nil)
}
```

**Bug.** Templates are parsed on every request, allocating and
re-walking the FS each time. Use the package-level `tpl` instead.
Re-parsing per request is a real performance loss, especially under
load.

## 17. The ParseFS that matches nothing

```go
var tpl = template.Must(template.ParseFS(tplFS, "templates/*.tmpl"))
```

**Bug.** If the embed only contains `.html` files, `ParseFS` returns
`html/template: pattern matches no files: "templates/*.tmpl"`. The
embed succeeds; the parse fails at startup. Fix: match the actual
file extension.

## 18. The forgotten `all:` for `_redirects`

```go
//go:embed dist
var dist embed.FS
```

**Bug.** Static-site builders often emit `_redirects` (Netlify),
`_headers`, or files starting with `_` for special handling. These
are silently excluded without `all:`. Use `//go:embed all:dist`.

## 19. The Stat that wasn't

```go
info, err := tplFS.Stat("index.html")
```

**Bug.** `embed.FS` doesn't have a `Stat` method. The compile error
is `tplFS.Stat undefined`. Use `fs.Stat(tplFS, "index.html")` from
the `io/fs` package, which works on any `fs.FS`.

## 20. The directory that "doesn't exist"

```go
data, err := myFS.ReadFile("templates")
```

**Bug.** `ReadFile` on a directory returns
`*fs.PathError` wrapping `fs.ErrInvalid` ("is a directory"), not the
contents of any file. The error is returned, not a panic, but if you
ignore the error you get `nil` and silently continue. Use `ReadDir`
for directories.

## 21. The pattern with trailing slash

```go
//go:embed templates/
var templates embed.FS
```

**Bug.** Trailing slash is rejected. Drop it: `//go:embed templates`.

## 22. The asymmetric `fs.Sub`

```go
sub, _ := fs.Sub(myFS, "static")
data, err := myFS.ReadFile("main.css") // wrong FS!
```

**Bug.** Reading from `myFS` instead of `sub` looks for
`main.css` at the root of the original FS. The original FS has
`static/main.css`, not `main.css`. Use `sub.ReadFile("main.css")` or
keep using full paths against `myFS`.

## 23. The migration that runs twice

```go
for _, e := range entries {
    sqlBytes, _ := fs.ReadFile(migrationFS, "migrations/"+e.Name())
    db.Exec(string(sqlBytes))
}
```

**Bug.** Re-running the program re-runs every migration. Without a
`schema_versions` table to record applied migrations, you're hoping
each migration is idempotent. Add a tracking table; check before
applying.

## 24. The non-deterministic walk

```go
entries, _ := fs.ReadDir(migrationFS, "migrations")
sort.Slice(entries, func(i, j int) bool {
    return entries[i].Name() > entries[j].Name() // sorted descending!
})
```

**Bug.** Migrations apply in reverse order, which usually means a
later migration tries to operate on a table that earlier migrations
haven't created yet. The fix is `<` not `>` — and then the
explicit sort is unnecessary because `fs.ReadDir` already returns in
ascending lexical order.

## 25. The HTTP body that wasn't drained

```go
func proxy(w http.ResponseWriter, r *http.Request) {
    resp, err := http.Get("http://upstream/" + r.URL.Path)
    if err != nil { http.Error(w, err.Error(), 502); return }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        http.Error(w, "upstream", 502)
        return
    }
    io.Copy(w, resp.Body)
}
```

**Bug.** Not strictly an embed bug — but a common pattern when
embedded assets and proxied calls coexist. On the non-200 path, the
body is closed but not drained. The HTTP client can't reuse the
connection; under load you accumulate sockets. Fix:
`io.Copy(io.Discard, resp.Body)` before `Close`.

## 26. The empty embedded directory

```go
//go:embed assets/empty
var empty embed.FS
```

**Bug.** If `assets/empty` exists but is empty (or only contains
hidden entries), the build fails with `no matching files`. Either add
a placeholder file or remove the directive.

## 27. The `embed.FS` from within a function

```go
func loadFS() embed.FS {
    //go:embed templates
    var fsys embed.FS
    return fsys
}
```

**Bug.** Same as case 2: directives only apply to package-level
vars. The directive is silently ignored or rejected; the returned
`embed.FS` is the zero value (empty). Move the variable to package
scope and return it from the function.

## 28. The pattern across packages

```go
// In package a:
//go:embed ../b/templates
var templates embed.FS
```

**Bug.** Patterns may not escape the package directory tree (no
`..`). To share templates across packages, place them in one
package and re-export the `embed.FS`, or duplicate the files (which
defeats the purpose).

## 29. The handler that always reads from disk

```go
//go:embed templates/index.html
var indexHTML []byte

func handler(w http.ResponseWriter, r *http.Request) {
    data, err := os.ReadFile("templates/index.html")
    if err != nil { http.Error(w, err.Error(), 500); return }
    w.Write(data)
}
```

**Bug.** The embed is unused; the handler reads from disk every
request. If the source tree isn't deployed alongside the binary, the
handler 500s. Switch to `w.Write(indexHTML)`.

## 30. The case sensitivity surprise

```go
data, err := tplFS.ReadFile("Templates/Index.html")
```

**Bug.** Embed paths are case-sensitive even on platforms with
case-insensitive filesystems (macOS default, Windows). If the file is
`templates/index.html`, only that exact name works. Match the case
exactly.

## How to use this file

Don't memorize the list — use it as a checklist when reviewing pull
requests. Most production `embed` bugs are one of these 30; spotting
them quickly saves time. When you find a new one in your own code,
add it.

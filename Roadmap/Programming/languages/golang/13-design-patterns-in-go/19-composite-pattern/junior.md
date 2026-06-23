# Composite — Junior

## 1. What is the Composite pattern?

You have a tree of things. Some nodes are leaves (a single file). Some nodes are containers (a folder of files, or of more folders). You want client code to treat them **uniformly** — call a method on any node, get back a sensible answer, whether it's one item or a whole subtree.

The **Composite** pattern says: give the leaf and the container the *same interface*. A container's implementation delegates to its children. Now the client doesn't have to know whether they're holding "one thing" or "many things".

> Compose objects into tree structures to represent part-whole hierarchies. Composite lets clients treat individual objects and compositions of objects uniformly.
> — GoF, 1994

In Go, "the same interface" usually means: a single interface type satisfied by both leaf structs and container structs.

---

## 2. Prerequisites
- Interfaces and how multiple types satisfy them.
- Slices of interfaces (`[]Node`).
- Recursive types — a struct holding a `[]Self`.
- Basic tree traversal.

---

## 3. Glossary

| Term | Meaning |
|------|---------|
| **Component** | The shared interface |
| **Leaf** | A node with no children |
| **Composite** | A node that holds other Components |
| **Children** | The sub-nodes a Composite contains |
| **Traversal** | Visiting every node in the tree |

---

## 4. The classic example: a filesystem tree

```go
type Node interface {
    Name() string
    Size() int64
}

type File struct {
    name string
    size int64
}

func (f File) Name() string { return f.name }
func (f File) Size() int64  { return f.size }

type Folder struct {
    name     string
    children []Node
}

func (d Folder) Name() string { return d.name }
func (d Folder) Size() int64 {
    var total int64
    for _, c := range d.children {
        total += c.Size()  // delegate
    }
    return total
}
```

Both `File` and `Folder` are `Node`. The client doesn't care which one it's holding:

```go
tree := Folder{
    name: "root",
    children: []Node{
        File{name: "readme.md", size: 1024},
        Folder{
            name: "src",
            children: []Node{
                File{name: "main.go", size: 4096},
                File{name: "util.go", size: 2048},
            },
        },
    },
}

fmt.Println(tree.Size()) // 7168 — recursively summed
```

That's the whole pattern. ~30 lines of Go.

---

## 5. What "uniformly" really buys you

Without Composite, the client has to type-switch every node:

```go
switch n := node.(type) {
case File:
    total += n.size
case Folder:
    for _, c := range n.children {
        // recurse manually...
    }
}
```

Two case branches today; ten years from now you've added Symlink, Mountpoint, Archive, Snapshot, Quota... and every consumer touches the switch.

Composite pushes that switch *into* the type. Each new node type implements `Node` correctly; consumers never change.

---

## 6. Recursive structure

The trick that makes Composite work in Go is the *recursive* container:

```go
type Folder struct {
    children []Node // !! interface, not concrete
}
```

Because `children` is `[]Node` (the interface), a `Folder` can hold any mix of `File`s and other `Folder`s. A `[]Folder` could only hold folders. The interface is what allows mixed trees.

---

## 7. Real-world analogy

A holding company. The parent company owns subsidiaries. Some subsidiaries own further subsidiaries. The CEO asks "what's our total revenue?" Each level adds its direct revenue plus the sum of its subsidiaries' revenues. The CEO doesn't need to know the depth — every level answers the question the same way.

---

## 8. Where you'll see it in Go

- **AST nodes** (`go/ast`) — every node implements `ast.Node`; `*ast.File` is the root.
- **HTML/XML parsing** — `golang.org/x/net/html` Node tree.
- **YAML/JSON document trees** — `gopkg.in/yaml.v3.Node`.
- **UI element trees** — `fyne.CanvasObject`, `gioui.Widget`.
- **Middleware groups** — a `Group` in `chi` or `gin` is a composite of handlers.
- **CLI command trees** — `cobra.Command` is a Composite (parent + children).
- **Configuration overlays** — `viper`'s nested config, `koanf`'s tree-of-config.

---

## 9. Common mistakes

- **Forgetting to call children's method in the container.** `Folder.Size()` that returns its own size only is broken Composite.
- **Storing concrete types instead of interfaces.** `children []*Folder` can't mix in `File`s.
- **Mutating a child during traversal.** Same as ranging over a slice and modifying it — bugs.
- **No way to detect cycles.** If a Folder accidentally has itself as a descendant, `Size()` recurses forever. Real code adds a visited set when cycles are possible.
- **Putting too much in the interface.** If `Node` has 20 methods, every leaf has to implement (or panic on) the ones that don't apply.

---

## 10. Summary

Composite gives leaves and containers the same interface. The container's methods delegate to children, often recursively. Clients call one method and get correct behavior whether they're holding a single leaf or a huge subtree. The pattern shines for trees: filesystems, ASTs, configs, UI hierarchies, CLI command trees.

---

## Further reading
- Refactoring.Guru — Composite
- `go/ast.Node` source
- `golang.org/x/net/html` Node
- `spf13/cobra` Command tree
- GoF (1994) — original Composite

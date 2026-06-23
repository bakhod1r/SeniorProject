# String Internals — Junior

## 1. What this topic is about

You have already met Go's [`string`](../04-strings/) type as a value you can read, slice, and pass around. This topic is about the **shape of that value in memory** — how the runtime represents a string, why some operations are free and others allocate, and where the bytes actually live. Knowing the layout removes most of the surprise from string code.

We are not re-teaching how to write `"hello"` — we are opening the box.

---

## 2. A string is a two-word header

Every `string` value in a running Go program is exactly **16 bytes** on a 64-bit machine (8 bytes on 32-bit). It is a struct with two fields, even though you never declare it that way:

```
+----------------+----------------+
|  data pointer  |     length     |
|   (8 bytes)    |   (8 bytes)    |
+----------------+----------------+
```

The runtime declares this layout in `runtime/string.go` as `stringStruct`, and `reflect.StringHeader` exposes a public mirror (now deprecated in favor of `unsafe.String` / `unsafe.StringData`):

```go
// reflect/value.go (historical)
type StringHeader struct {
    Data uintptr
    Len  int
}
```

So when you write:

```go
s := "hello"
```

the local variable `s` holds a header. The bytes `h`, `e`, `l`, `l`, `o` live somewhere else — in this case in a read-only data section of the binary. `s.Data` points there; `s.Len` is `5`.

You can see the size yourself:

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var s string
    fmt.Println(unsafe.Sizeof(s)) // 16 on a 64-bit machine
}
```

`unsafe.Sizeof` returns the size of the **header**, not the bytes it points at.

---

## 3. Why immutability is a layout decision

The Go spec says: *"Strings are immutable: once created, it is impossible to change the contents of a string."* (https://go.dev/ref/spec#String_types).

That single sentence has practical consequences:

- The compiler can put string **literals** in a read-only memory page. Any write attempt would segfault, and the linker can share identical literals across the whole binary.
- Slicing a string (`s[2:4]`) can be implemented as **two pointer-math operations**: copy the header, advance `Data`, set the new `Len`. No bytes are copied.
- Passing a string to a function copies the 16-byte header by value. The bytes are shared.

If strings were mutable, none of this would be safe: a slice would have to copy bytes to avoid spooky aliasing, and the literal sharing trick would be impossible.

---

## 4. `len(s)` is O(1) — and what that means

```go
s := "héllo"
fmt.Println(len(s)) // 6
```

`len(s)` simply reads the second word of the header. It does not walk the string, it does not count characters, and it does not look at the bytes.

But notice: `len("héllo")` is **6**, not 5. The character `é` is two bytes in UTF-8 (`0xC3 0xA9`). `len` reports **bytes**, not runes. This is consistent with the layout: the runtime never tracks "character count"; the only number it stores is byte length.

If you need rune count, you ask explicitly:

```go
import "unicode/utf8"

utf8.RuneCountInString("héllo") // 5; walks the bytes
```

This one is O(n).

---

## 5. `s[i]` returns a `byte`, not a `rune`

```go
s := "héllo"
fmt.Printf("%T %d\n", s[0], s[0]) // uint8 104  (the 'h')
fmt.Printf("%T %d\n", s[1], s[1]) // uint8 195  (first byte of 'é')
fmt.Printf("%T %d\n", s[2], s[2]) // uint8 169  (second byte of 'é')
```

Indexing returns the byte at offset `i`. The compiler emits a single load from `Data[i]` — about as cheap as an operation gets. There is no decoding step.

This is the most common source of beginner confusion: people expect `s[1]` to give `'é'` (a rune). It gives 195, a meaningless mid-codepoint byte. To get characters, you need to **range** the string:

```go
for i, r := range "héllo" {
    fmt.Printf("%d %c\n", i, r)
}
// 0 h
// 1 é      <- note i jumped from 1 to 3 next
// 3 l
// 4 l
// 5 o
```

The range form decodes UTF-8 on the fly and gives you `(byteOffset, rune)`. We cover this in detail in [middle.md](middle.md).

---

## 6. Where do the bytes live?

For a string literal in source code:

```go
s := "hello"
```

the compiler allocates the bytes `"hello"` once, in the binary's **RODATA** (read-only data) segment. Every occurrence of the same literal shares those bytes. You can prove it:

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    a := "hello"
    b := "hello"
    fmt.Println(unsafe.StringData(a) == unsafe.StringData(b)) // true
}
```

Both `a` and `b` point at the same address in RODATA. This is "string interning" for literals, done at compile time. Strings produced at runtime (e.g. from `string(bytes)`, `fmt.Sprintf`, concatenation) live on the **heap** and each call typically allocates fresh storage.

---

## 7. Slicing shares bytes, doesn't copy

```go
big := "the quick brown fox"
word := big[4:9] // "quick"
```

`word` is a 16-byte header whose `Data` points 4 bytes into `big`'s storage and whose `Len` is 5. **No bytes are copied.** This is why slicing strings is essentially free.

There is a hidden trap: if `big` is a huge string and `word` is tiny, holding onto `word` keeps the whole backing array alive. Garbage collection cannot reclaim `big`'s bytes until `word` is also dropped. For documents-in-memory parsers this can leak hundreds of megabytes through a single short token.

To force a copy and let the big array go:

```go
word := strings.Clone(big[4:9])
```

`strings.Clone` (added in Go 1.18) allocates a fresh backing array sized exactly for `word`, then returns a new header pointing there.

---

## 8. The empty string and nil

There is no "nil string" type in Go. The zero value of `string` is `""` — a header with `Data == nil` and `Len == 0`. Comparing it works:

```go
var s string
fmt.Println(s == "") // true
fmt.Println(len(s))  // 0
```

You may sometimes see code reach into the header with `unsafe` and observe `Data == 0`. That is not the same as "a nil string", because the language does not provide nil-ness for strings. `s` is always a valid, possibly empty, string.

This differs from `[]byte`, where `nil` and `[]byte{}` are distinct values (both behave the same in most contexts but compare differently).

---

## 9. Comparing strings

`==` and `<`, `>`, etc. work on strings. The runtime first checks lengths:

```
if a.Len != b.Len { return false }
return memequal(a.Data, b.Data, a.Len)
```

Equal lengths trigger a byte-by-byte compare via the optimized `runtime.memequal`. For short strings this is one or two SIMD loads. For long strings the cost is proportional to length, but is one of the fastest operations the CPU can do.

Two strings produced from different sources but with identical bytes compare equal even though their `Data` pointers differ. Pointer comparison is not enough — content matters.

---

## 10. `string(bytes)` and `[]byte(s)` — both can allocate

Converting between `string` and `[]byte` is the most common source of accidental allocations in Go programs:

```go
b := []byte{'h', 'i'}
s := string(b)   // allocates: copies bytes into a new immutable backing array
b2 := []byte(s)  // allocates: copies bytes again into a mutable slice
```

Why the copies? Because `string` is immutable and `[]byte` is mutable. If the conversion didn't copy, mutating the slice would mutate the string — breaking the immutability guarantee that the rest of the runtime depends on.

The compiler can elide some of these copies in specific patterns (covered in [middle.md](middle.md) and [senior.md](senior.md)), but unless you know the trick applies, assume conversion costs an allocation.

---

## 11. `string(int)` — the famous pitfall

This compiles and runs, but probably doesn't do what you expect:

```go
n := 65
s := string(n)  // "A", not "65"
```

`string(int)` interprets the integer as a **Unicode code point** and produces the UTF-8 encoding. So `string(65) == "A"` (U+0041) and `string(0x1F600) == "😀"`.

Go 1.15 made this a `go vet` warning because it surprises almost everyone. To convert a number to its decimal string, use:

```go
import "strconv"

strconv.Itoa(65) // "65"
```

---

## 12. A small mental model

Hold these four facts in your head:

| Fact | Why it matters |
|------|----------------|
| A string is a 16-byte header (pointer + length) | Passing strings is cheap; `len` is O(1) |
| The bytes are immutable | Slicing shares; literals live in RODATA |
| `s[i]` is a byte; `range s` decodes runes | Index for performance, range for correctness |
| `string ⟷ []byte` copies (usually) | Convert at the boundary, not in a loop |

With these four, you can already reason about most string code accurately. The next level — UTF-8 in detail, compiler optimizations for conversion, the `runtime.concatstrings` path — is in [middle.md](middle.md).

---

## 13. Looking at the layout with `unsafe`

You normally don't reach into a string's bytes through `unsafe`, but doing it once for educational purposes makes the layout concrete:

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    s := "héllo"

    data := unsafe.StringData(s)            // *byte to first byte
    length := len(s)                         // 6

    fmt.Println("length:", length)
    for i := 0; i < length; i++ {
        b := *(*byte)(unsafe.Add(unsafe.Pointer(data), i))
        fmt.Printf("byte[%d] = 0x%02x\n", i, b)
    }
}
```

Output:

```
length: 6
byte[0] = 0x68
byte[1] = 0xc3
byte[2] = 0xa9
byte[3] = 0x6c
byte[4] = 0x6c
byte[5] = 0x6f
```

You can see the two-byte UTF-8 encoding of `é` (`0xC3 0xA9`) sitting between `h` and the two `l`s. The header gave us the start address and the count; that is all the metadata Go keeps about your string.

---

## 14. Common junior-level mistakes

| Mistake | What actually happens |
|---------|----------------------|
| `s[i]` to get the i-th character | You get the i-th **byte**, possibly mid-codepoint |
| `len(s)` to count characters | You get byte count, not rune count |
| `string(65)` to convert int to "65" | You get `"A"` (Unicode 65) |
| Slicing a huge string and keeping the slice | Whole big backing array stays alive |
| Concatenating in a loop with `+` | Each iteration allocates a fresh string |
| Round-tripping `[]byte ⟷ string` to "convert" | Each direction copies all bytes |

Each of these has a correct alternative covered later in this topic or in [strings/](../04-strings/).

---

## 15. What to read next

- [middle.md](middle.md) — UTF-8 layout, range-loop decoding, compiler-recognized conversion patterns.
- [senior.md](senior.md) — Runtime source for `concatstrings`, `slicebytetostring`, escape analysis on conversions.
- [runes](../05-runes/) — sibling type for individual characters.
- [strings.Builder](../04-strings/) — efficient way to assemble strings without quadratic concat.

---

## 16. Summary

A Go string is a two-word header (pointer + length) wrapping an immutable byte sequence. `len` is O(1) because length is stored, not computed. Indexing returns a byte; ranging decodes UTF-8 into runes. Literals share a single backing array in RODATA; runtime strings live on the heap. Slicing is free but pins the backing array. Conversion to and from `[]byte` allocates by default because immutability cannot be shared with a mutable slice. Once you accept "header + bytes elsewhere" as the mental model, the rest of string behavior follows by deduction.

# Interpreted String Literals in Go — Find the Bug

## Bug 1: Windows Path with Unintended Escape

```go
package main

import (
    "fmt"
    "os"
)

func main() {
    logFile := "C:\new_logs\today.log"
    f, err := os.Create(logFile)
    if err != nil {
        fmt.Printf("Error creating log file: %v\n", err)
        return
    }
    defer f.Close()
    fmt.Println("Created:", logFile)
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Look carefully at the path string. What does `\n` mean in an interpreted string? What about `\t`?
</details>

<details>
<summary>Solution</summary>

**Bug**: The path `"C:\new_logs\today.log"` contains two escape sequences:
- `\n` = newline character (not the letter 'n')
- `\t` = tab character (not the letter 't')

So `logFile` is actually: `C:` + newline + `ew_logs` + tab + `oday.log`

This creates a file with a very strange name (containing newline and tab characters), not the intended path.

**Fix**: Use a raw string or double the backslashes:
```go
logFile := `C:\new_logs\today.log`    // raw string — best
// or:
logFile := "C:\\new_logs\\today.log"  // interpreted with doubled backslashes
```
</details>

---

## Bug 2: Null Byte in Password Hash

```go
package main

import (
    "crypto/md5"
    "fmt"
)

func hashPassword(password string) string {
    // Pad password to 32 chars with null bytes
    for len(password) < 32 {
        password += "\x00"  // null byte padding
    }
    hash := md5.Sum([]byte(password))
    return fmt.Sprintf("%x", hash)
}

func verifyPassword(input, storedHash string) bool {
    return hashPassword(input) == storedHash
}

func main() {
    hash := hashPassword("secret")

    fmt.Println("Verify 'secret':", verifyPassword("secret", hash)) // should be true
    fmt.Println("Verify 'secre':", verifyPassword("secre", hash))   // should be false
    fmt.Println("Verify 'secre\x00':", verifyPassword("secre\x00", hash)) // what happens?
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
After padding, what does `"secre"` + 27 null bytes look like versus `"secre\x00"` + 26 null bytes?
</details>

<details>
<summary>Solution</summary>

**Bug**: The padding algorithm makes "secre" (5 chars) + 27 null bytes equal to "secre\x00" (6 chars) + 26 null bytes — they're different strings. However, a more serious bug is that "secre\x00\x00..." (secre with 27 nulls) is NOT equal to "secret\x00..." (secret with 26 nulls) — correct.

BUT consider: `"secre\x00"` after padding becomes `"secre\x00" + 26 more nulls`, which is NOT the same as `"secret" + 26 nulls`. So the verification works... but null bytes in password hashing is a well-known vulnerability:

1. Older systems (or C-based hashing) might truncate at null byte: `"secret\x00"` becomes `"secret"`
2. This creates password equivalence: `"secret"` == `"secret\x00"` in vulnerable systems

**Real Fix**: Never use null-byte padding in security contexts. Use proper password hashing (bcrypt, argon2):
```go
import "golang.org/x/crypto/bcrypt"

func hashPassword(password string) (string, error) {
    hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
    return string(hash), err
}
```
</details>

---

## Bug 3: Wrong Escape for Null Byte

```go
package main

import "fmt"

func buildProtocolFrame(payload string) string {
    // Frame: STX + payload + NUL + ETX
    // \0 should be null byte, \2 should be STX, \3 should be ETX
    return "\2" + payload + "\0" + "\3"
}

func main() {
    frame := buildProtocolFrame("data")
    fmt.Printf("Frame bytes: % x\n", frame)
    // Expected: 02 64 61 74 61 00 03
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Go doesn't support `\0` as a null byte escape. What does `\0` actually represent in Go?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"\0"` is NOT a valid Go escape sequence! Go uses `\ooo` for octal (exactly 3 digits), so `\0` is a compile error or treated differently. In C, `\0` = null byte; in Go, you must use `"\000"` (3 digits) or `"\x00"` (hex).

Also, `"\2"` is a 1-digit octal escape — while technically valid (Go allows 1-3 digit octal in some contexts), it's non-standard. Use `"\x02"` for clarity.

**Fix**:
```go
func buildProtocolFrame(payload string) string {
    const (
        STX = "\x02"  // Start of Text
        NUL = "\x00"  // Null
        ETX = "\x03"  // End of Text
    )
    return STX + payload + NUL + ETX
}
```
</details>

---

## Bug 4: CRLF vs LF in HTTP Response

```go
package main

import (
    "fmt"
    "net"
)

func handleConnection(conn net.Conn) {
    defer conn.Close()

    body := `{"status": "ok"}`
    response := "HTTP/1.1 200 OK\n" +
        "Content-Type: application/json\n" +
        "Content-Length: " + fmt.Sprint(len(body)) + "\n" +
        "\n" +
        body

    conn.Write([]byte(response))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
HTTP/1.1 specifies which line ending should be used in headers. Check RFC 7230.
</details>

<details>
<summary>Solution</summary>

**Bug**: HTTP/1.1 (RFC 7230) requires CRLF (`\r\n`) as the line ending in headers, not just LF (`\n`). Using only `\n` is technically wrong per the specification. While many HTTP clients are lenient and accept LF-only, strict clients and proxies will reject the response.

**Fix**:
```go
func handleConnection(conn net.Conn) {
    defer conn.Close()

    body := `{"status": "ok"}`
    response := "HTTP/1.1 200 OK\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: " + fmt.Sprint(len(body)) + "\r\n" +
        "\r\n" +
        body

    conn.Write([]byte(response))
}
```

Or better, use the `net/http` package which handles this correctly.
</details>

---

## Bug 5: Incorrect Unicode Escape

```go
package main

import "fmt"

func main() {
    // Trying to print the smiley face emoji 😀
    emoji1 := "\uD83D\uDE00"  // UTF-16 surrogate pair
    emoji2 := "\U0001F600"     // correct Unicode code point

    fmt.Println(emoji1)
    fmt.Println(emoji2)
    fmt.Println(len(emoji1), len(emoji2))
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What are `\uD83D` and `\uDE00`? Are those valid Unicode code points for Go? What encoding system uses surrogate pairs?
</details>

<details>
<summary>Solution</summary>

**Bug**: `\uD83D` and `\uDE00` are UTF-16 surrogate pairs — they're how JavaScript (which uses UTF-16) represents emoji. In Go, lone surrogate code points (U+D800-U+DFFF) are **invalid** and `"\uD83D"` will either produce the replacement character U+FFFD or cause a compile-time error.

Go uses UTF-8, not UTF-16. The emoji 😀 is at code point U+1F600, which cannot be represented as a `\u` escape (only 4 digits). You must use `\U` with 8 digits:

**Fix**:
```go
emoji := "\U0001F600"  // correct: 8-digit \U escape
// Or just write the emoji directly:
emoji = "😀"
```

`len(emoji)` = 4 (4 UTF-8 bytes: F0 9F 98 80)
</details>

---

## Bug 6: String Comparison Fails with Different Normalizations

```go
package main

import "fmt"

func main() {
    // User inputs their name from a form
    userInput := "caf\u00e9"     // "café" — precomposed NFC form

    // Database value was stored from a different OS
    dbValue := "cafe\u0301"      // "café" — decomposed NFD form

    if userInput == dbValue {
        fmt.Println("Names match!")
    } else {
        fmt.Println("Names don't match — but they look the same!")
        // This runs! Both print as "café" but bytes differ
        fmt.Printf("userInput bytes: % x\n", []byte(userInput))
        fmt.Printf("dbValue bytes:   % x\n", []byte(dbValue))
    }
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Go's `==` compares bytes. Do NFC and NFD forms have the same bytes? What is Unicode normalization?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"caf\u00e9"` and `"cafe\u0301"` are both representations of "café" but have different byte sequences:
- NFC (precomposed): `63 61 66 c3 a9` — 5 bytes
- NFD (decomposed): `63 61 66 65 cc 81` — 6 bytes

`==` compares bytes, not visual equivalence. This causes login failures, search misses, and duplicate users in databases.

**Fix**: Normalize to NFC form before comparison:
```go
import "golang.org/x/text/unicode/norm"

func normalizeString(s string) string {
    return norm.NFC.String(s)
}

if normalizeString(userInput) == normalizeString(dbValue) {
    fmt.Println("Names match!")
}
```

In production: normalize at the point of input (when user submits a form) and at the point of storage.
</details>

---

## Bug 7: Missing Backslash in Octal Escape

```go
package main

import "fmt"

func buildMessage(parts []string) string {
    // Join with Record Separator (ASCII 30, octal 36)
    separator := "36"  // Trying to use RS character
    result := ""
    for i, part := range parts {
        if i > 0 {
            result += separator
        }
        result += part
    }
    return result
}

func main() {
    msg := buildMessage([]string{"field1", "field2", "field3"})
    fmt.Printf("Message: %q\n", msg)
    // Wants: "field1\x1efield2\x1efield3"
    // Gets:  "field136field236field3"  ← literal "36" not escape!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
How do you write an octal escape sequence in Go? What is the syntax?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"36"` is just the two characters '3' and '6' — not the octal escape for ASCII 30 (Record Separator). To write an octal escape, you need the backslash prefix: `"\036"`.

**Fix**:
```go
const recordSeparator = "\036" // octal 036 = decimal 30 = ASCII RS
// Or more clearly:
const recordSeparator = "\x1e" // hex 1e = decimal 30 = ASCII RS

func buildMessage(parts []string) string {
    return strings.Join(parts, recordSeparator)
}
```
</details>

---

## Bug 8: ANSI Code in Non-Terminal Output

```go
package main

import (
    "fmt"
    "os"
)

func formatStatus(status string, ok bool) string {
    if ok {
        return "\x1b[32m✓ " + status + "\x1b[0m"  // green checkmark
    }
    return "\x1b[31m✗ " + status + "\x1b[0m"  // red x
}

func main() {
    // Write status to a log file
    logFile, _ := os.Create("status.log")
    defer logFile.Close()

    statuses := []struct {
        name string
        ok   bool
    }{
        {"Database", true},
        {"Cache", false},
        {"API", true},
    }

    for _, s := range statuses {
        fmt.Fprintln(logFile, formatStatus(s.name, s.ok))
    }
    fmt.Println("Statuses written to status.log")
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
ANSI escape sequences are designed for terminal output. What happens when they're written to a log file? What do the escape bytes look like in a file?
</details>

<details>
<summary>Solution</summary>

**Bug**: ANSI escape codes (`\x1b[32m`, `\x1b[0m`, etc.) are written to the log file. In the file, these appear as literal control characters: `^[[32m✓ Database^[[0m`. Log files become hard to read and analyze with tools like `grep`.

**Fix**: Check if the output is a terminal before adding colors:
```go
import "golang.org/x/term"

func formatStatus(status string, ok bool, colorize bool) string {
    if !colorize {
        if ok {
            return "✓ " + status
        }
        return "✗ " + status
    }
    // ...color version...
}

func main() {
    isTerminal := term.IsTerminal(int(os.Stdout.Fd()))

    logFile, _ := os.Create("status.log")
    defer logFile.Close()

    for _, s := range statuses {
        // No colors for file output
        fmt.Fprintln(logFile, formatStatus(s.name, s.ok, false))
        // Colors for terminal
        fmt.Println(formatStatus(s.name, s.ok, isTerminal))
    }
}
```
</details>

---

## Bug 9: Hex Escape with Wrong Number of Digits

```go
package main

import "fmt"

func main() {
    // Trying to embed bytes for a binary protocol header
    // Header: magic(2 bytes) + version(1 byte) + reserved(1 byte)
    magic := "\x4D\x5A"    // "MZ" — DOS executable header
    version := "\x1"       // version 1
    reserved := "\x0"      // reserved 0

    header := magic + version + reserved
    fmt.Printf("Header bytes: % x\n", header)
    fmt.Printf("Header length: %d\n", len(header))
    // Expected: 4 bytes total
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
Go's `\x` escape requires exactly 2 hex digits. What happens with `\x1` and `\x0`?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"\x1"` and `"\x0"` are invalid escape sequences in Go — `\x` requires exactly 2 hex digits. These will cause compile errors: `"invalid escape sequence \x1"`.

**Fix**:
```go
magic := "\x4D\x5A"  // "MZ"
version := "\x01"    // version 1 — must be 2 hex digits
reserved := "\x00"   // reserved 0 — must be 2 hex digits

header := magic + version + reserved
// Header is exactly 4 bytes: 4d 5a 01 00
```
</details>

---

## Bug 10: Unicode Escape Used Where Hex Needed for Binary Data

```go
package main

import (
    "fmt"
    "unicode/utf8"
)

func main() {
    // Trying to create a binary buffer with the byte value 0x80
    // (e.g., for reading binary file format)
    buf := "\u0080"  // thinking: "this gives me byte 0x80"
    fmt.Printf("Bytes: % x\n", buf)
    fmt.Printf("Length: %d\n", len(buf))
    fmt.Printf("Valid UTF-8: %v\n", utf8.ValidString(buf))
    // Expected: 1 byte (0x80)
    // Got: 2 bytes (c2 80)!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
What does `\u0080` produce? Is it the byte 0x80 or something else? What does `\u` produce for code points above 0x7F?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"\u0080"` does NOT produce a single byte 0x80. It produces the Unicode character U+0080, which in UTF-8 is encoded as 2 bytes: 0xC2 0x80. The `\u` escape always produces valid UTF-8.

For binary data where you need the exact byte 0x80 (a continuation byte, invalid UTF-8 alone), you must use `\x`:
```go
// To get the exact byte 0x80 (NOT valid UTF-8):
buf := "\x80"
fmt.Printf("Bytes: % x\n", buf) // "80"
fmt.Printf("Length: %d\n", len(buf)) // 1
fmt.Printf("Valid UTF-8: %v\n", utf8.ValidString(buf)) // false

// To get Unicode character U+0080 (2 bytes, valid UTF-8):
buf2 := "\u0080"
fmt.Printf("Bytes: % x\n", buf2) // "c2 80"
fmt.Printf("Length: %d\n", len(buf2)) // 2
fmt.Printf("Valid UTF-8: %v\n", utf8.ValidString(buf2)) // true
```

Rule: use `\x` for raw byte values in binary data; use `\u`/`\U` for Unicode characters.
</details>

---

## Bug 11: Line Ending Mismatch in Configuration Parser

```go
package main

import (
    "fmt"
    "strings"
)

func parseConfig(data string) map[string]string {
    config := make(map[string]string)
    lines := strings.Split(data, "\n")  // splits by LF only
    for _, line := range lines {
        parts := strings.SplitN(line, "=", 2)
        if len(parts) == 2 {
            config[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
        }
    }
    return config
}

func main() {
    // Config file from Windows (has CRLF line endings)
    windowsConfig := "host=localhost\r\nport=8080\r\nname=myapp\r\n"

    config := parseConfig(windowsConfig)
    fmt.Printf("host=%q\n", config["host"])  // "localhost" ✓
    fmt.Printf("port=%q\n", config["port"])  // "8080\r" ← BUG! Has \r
    fmt.Printf("name=%q\n", config["name"])  // "myapp\r" ← BUG! Has \r
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
When you split by `"\n"` (LF only), what happens to the `"\r"` character at the end of each CRLF-terminated line?
</details>

<details>
<summary>Solution</summary>

**Bug**: `strings.Split(data, "\n")` splits on LF only. After splitting, each line still has a trailing `\r` (from `\r\n`). So `parts[1]` for `"port=8080\r"` is `"8080\r"`. `strings.TrimSpace` trims spaces but also trims `\r` — wait, actually `TrimSpace` DOES trim `\r` since it's whitespace! So in this specific code, `TrimSpace` masks the bug...

Actually: `strings.TrimSpace` removes `\r` because `\r` is a whitespace character. So the values are actually clean. The real test: does `config["port"]` equal `"8080"`? Yes, because TrimSpace handles `\r`.

**BUT** — if the code didn't use TrimSpace (a common mistake), the `\r` would remain. The fix for robustness:

```go
func parseConfig(data string) map[string]string {
    // Normalize line endings first
    data = strings.ReplaceAll(data, "\r\n", "\n")
    data = strings.ReplaceAll(data, "\r", "\n")

    config := make(map[string]string)
    lines := strings.Split(data, "\n")
    for _, line := range lines {
        parts := strings.SplitN(line, "=", 2)
        if len(parts) == 2 {
            config[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
        }
    }
    return config
}
```
</details>

---

## Bug 12: Assuming \uXXXX Range Covers All Unicode

```go
package main

import "fmt"

func main() {
    // Developer thinks all emoji can be represented with \u (4-digit)
    // and writes a function to embed emoji codes
    func getEmoji(name string) string {
        codes := map[string]string{
            "smile":  "\u1F600",  // 😀 — developer thinks this is right
            "heart":  "\u2764",   // ❤ — U+2764, this one works
            "thumbup": "\u1F44D", // 👍 — developer thinks this is right
        }
        if code, ok := codes[name]; ok {
            return code
        }
        return "?"
    }
    // Actually the \u1F600 lines won't even compile!
}
```

**What is the bug?**

<details>
<summary>Hint</summary>
`\u` requires exactly 4 hex digits. What happens if you give it 5 hex digits? What code points require `\U` (8 digits)?
</details>

<details>
<summary>Solution</summary>

**Bug**: `"\u1F600"` is a **compile error** — `\u` accepts exactly 4 hex digits. The compiler reads `\u1F60` as the Unicode escape (4 digits) followed by the literal character `0`. U+1F60 is `Ὠ` (Greek capital letter omega with psili), not a smiley face!

For emoji (code points above U+FFFF), you must use `\U` with 8 hex digits:

**Fix**:
```go
codes := map[string]string{
    "smile":   "\U0001F600",  // 😀 — 8-digit \U
    "heart":   "\u2764",      // ❤ — U+2764, within 4-digit range, OK
    "thumbup": "\U0001F44D",  // 👍 — 8-digit \U
    // Or just write them directly:
    "smile2":  "😀",
    "thumbup2": "👍",
}
```

Rule: `\u` for U+0000 to U+FFFF, `\U` for U+10000 to U+10FFFF.
</details>

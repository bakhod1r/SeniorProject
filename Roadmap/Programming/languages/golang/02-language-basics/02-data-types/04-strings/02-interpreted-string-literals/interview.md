# Interpreted String Literals in Go — Interview Questions

## Junior Level Questions

---

**Q1: What is an interpreted string literal in Go?**

A: An interpreted string literal is a string written between double quotes in Go: `"hello"`. The word "interpreted" means that certain special character sequences (escape sequences) starting with a backslash are processed and converted to their actual value. For example, `"\n"` becomes a real newline character, not the two characters `\` and `n`.

---

**Q2: List the 5 most common escape sequences in Go strings.**

A:
- `\n` — newline (line feed, 0x0A)
- `\t` — horizontal tab (0x09)
- `\\` — literal backslash (0x5C)
- `\"` — literal double quote (0x22)
- `\r` — carriage return (0x0D)

---

**Q3: What is the length of the string `"\n\t\\"`?**

A: `3`. Each escape sequence represents a single byte:
- `\n` = 1 byte (newline)
- `\t` = 1 byte (tab)
- `\\` = 1 byte (backslash)
Total: 3 bytes.

---

**Q4: Why do you need `\"` inside a Go string?**

A: Because a double quote `"` is the delimiter for interpreted string literals. Writing a literal `"` inside would end the string prematurely. For example, `"She said "hi""` would cause a syntax error — the compiler would see three things: `"She said "`, then `hi`, then `""`. To include a double quote inside, you escape it: `"She said \"hi\""`.

---

**Q5: What does `"\x41"` produce?**

A: The single character `"A"`. The `\x41` escape inserts the byte with hexadecimal value 0x41, which equals decimal 65, which is the ASCII code for 'A'. `"\x41" == "A"` is true.

---

**Q6: What is the difference between `"\n"` and `\n` (outside a string)?**

A: `"\n"` is a Go interpreted string literal containing a single newline byte. `\n` outside a string is just a backslash followed by the letter 'n' — two separate characters with no special meaning. In Go code, `\n` only has its escape meaning inside string (or rune) literals.

---

**Q7: Can you put a literal newline (by pressing Enter) inside an interpreted string?**

A: No. A literal newline inside double quotes causes a compile error: "string literal not terminated." Use `\n` to represent a newline in an interpreted string, or use a raw string (backtick) which allows literal newlines.

---

**Q8: What is `"\u4e2d"` in Go?**

A: It's the Unicode escape for the Chinese character '中' (U+4E2D). The `\u` escape takes exactly 4 hexadecimal digits and produces the UTF-8 encoding of that Unicode code point. `"\u4e2d" == "中"` is true.

---

**Q9: How would you write a Windows file path as an interpreted string?**

A: Each backslash must be doubled: `"C:\\Users\\Alice\\Documents"`. The `\\` escape represents a single backslash. For Windows paths, raw strings are often cleaner: `` `C:\Users\Alice\Documents` ``.

---

**Q10: What is the difference between `"\r\n"` and `"\n"`?**

A: Both are newline-related sequences, but they differ:
- `"\n"` is a single newline character (LF, 0x0A) — used on Unix/Linux/macOS
- `"\r\n"` is two characters: carriage return (CR, 0x0D) followed by line feed (LF, 0x0A) — used by Windows and HTTP/1.1 protocol

---

## Middle Level Questions

---

**Q11: What is the difference between `"\x80"` and `"\u0080"` in Go?**

A: Both are ways to specify byte value 128/0x80, but they produce different output:
- `"\x80"` produces a single byte 0x80 — which is NOT valid UTF-8 (it's a UTF-8 continuation byte without a leading byte)
- `"\u0080"` produces the UTF-8 encoding of Unicode code point U+0080, which is the 2-byte sequence 0xC2 0x80 — valid UTF-8

`len("\x80") == 1` but `len("\u0080") == 2`. The `\x` escape is for raw bytes; `\u` is for Unicode characters.

---

**Q12: Why can't you use `\0` for a null byte in Go like you can in C?**

A: Go's octal escape syntax requires exactly 3 digits, so `\0` is an invalid escape (only 1 digit). In C, `\0` is a special shorthand. In Go, use `\000` (3 octal digits) or `\x00` (2 hex digits) for a null byte.

---

**Q13: Are all escape sequences in Go strings processed at runtime or compile time?**

A: All escape sequences are processed at **compile time**. The `\n` in `"hello\n"` is converted to a single newline byte by the compiler before the program runs. At runtime, the string is simply the byte sequence `[104, 101, 108, 108, 111, 10]`. There is zero runtime cost for escape sequences.

---

**Q14: What is the difference between the `\u` and `\U` escape sequences?**

A: Both specify Unicode code points and produce valid UTF-8:
- `\uXXXX` takes exactly 4 hex digits and covers U+0000 to U+FFFF (Basic Multilingual Plane)
- `\UXXXXXXXX` takes exactly 8 hex digits and covers U+0000 to U+10FFFF (all of Unicode)

For emoji and supplementary characters (U+10000+), you must use `\U`:
- `"\U0001F600"` = 😀 (valid, 4-byte UTF-8)
- `"\u1F600"` is a compile error (too many digits for `\u`)

---

**Q15: You receive a UTF-16 encoded string from a Windows API via CGO. How do you convert it to a Go string?**

A: Use `encoding/utf16.Decode`:
```go
import "unicode/utf16"

utf16Data := getFromWindowsAPI() // []uint16
runes := utf16.Decode(utf16Data)
s := string(runes)  // now a valid Go UTF-8 string
```
You cannot simply cast or copy the bytes — UTF-16 uses 2 bytes per character (4 for supplementary planes), while Go strings are UTF-8. The `encoding/utf16` package handles surrogate pairs correctly.

---

**Q16: How would you use `strconv.Unquote` and when is it useful?**

A: `strconv.Unquote(s)` takes a Go-quoted string (like `"\"Hello\\nWorld\""`) and returns the unquoted version (the actual string `"Hello\nWorld"`). It's useful when:
1. You're parsing Go source code or serialized Go values
2. A user enters a string in Go string literal format (e.g., in a configuration file)
3. You need to programmatically convert escape sequences in a string

```go
result, err := strconv.Unquote(`"hello\nworld"`)
// result = "hello\nworld" (with actual newline)
```

---

**Q17: What ANSI escape sequence would you use to print "Error:" in red on a terminal?**

A: `"\x1b[31m"` starts red text, and `"\x1b[0m"` resets formatting:
```go
fmt.Print("\x1b[31mError:\x1b[0m " + message)
```
The escape `\x1b` is the ESC character (byte 0x1B), which signals the terminal that a control sequence follows. `[31m` means "set foreground color to red".

---

## Senior Level Questions

---

**Q18: Explain the security risks of null bytes in Go strings and how to mitigate them.**

A: Null bytes (`\x00`) in strings can cause security vulnerabilities:
1. **Path truncation**: C library functions and some OS calls treat null bytes as string terminators. A path like `"/etc/passwd\x00.png"` might be treated as `"/etc/passwd"` by `syscall.Open` or CGO code.
2. **SQL injection bypass**: Some SQL drivers may truncate or mishandle null bytes.
3. **Log injection**: A null byte might truncate log entries.

Mitigation:
```go
func validateInput(s string) error {
    if strings.ContainsRune(s, '\x00') {
        return errors.New("input contains null byte")
    }
    return nil
}
```
Always validate user input for null bytes before passing to OS calls, database queries, or log systems.

---

**Q19: Describe how Unicode homograph attacks work and how interpreted string escapes relate to them.**

A: A homograph attack exploits the fact that different Unicode characters look visually identical. For example:
- ASCII `a` (U+0061) and Cyrillic `а` (U+0430) look the same in many fonts
- `"\u0061" == "a"` (ASCII) vs `"\u0430"` (Cyrillic)

An attacker registers domain `"pаypal.com"` with Cyrillic `а` in the URL. Users can't tell it apart from the real PayPal.

Mitigation:
1. Normalize to NFC form before comparison
2. For domain names: reject non-ASCII characters or use Punycode (ACE)
3. Use `strings.EqualFold` only after normalization
4. For security-critical comparisons, restrict to ASCII

---

**Q20: How does Go handle the `\r\n` (CRLF) line ending difference in strings, and what are the implications for cross-platform code?**

A: Go makes no implicit conversion of line endings. If your code:
- Reads a Windows file with CRLF → the string contains `\r\n`
- Reads a Unix file with LF → the string contains just `\n`
- Writes `"\n"` on Windows → the file gets LF (not CRLF)

Implications:
1. `strings.Split(data, "\n")` on Windows CRLF data leaves `\r` at end of each line
2. `strings.TrimRight(line, "\r\n")` is safer than `strings.TrimRight(line, "\n")`
3. `http.Header` parsing must accept both `\r\n` and `\n` per RFC 7230
4. Test fixtures stored in Git may have different line endings depending on `.gitattributes`

Best practice: normalize line endings explicitly:
```go
data = strings.ReplaceAll(data, "\r\n", "\n")
```

---

## Scenario-Based Questions

---

**Q21: A production service is logging user-provided strings, and the operations team reports that logs are being corrupted with strange terminal formatting. What's the likely cause and how do you fix it?**

A: The likely cause is ANSI escape code injection. If user input contains `\x1b[...m` sequences (starting with the ESC character), and the logs are viewed in a terminal, those sequences execute as terminal commands (setting colors, clearing screen, moving cursor, etc.).

Fix:
1. Sanitize user input before logging by stripping ANSI codes:
```go
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)
func sanitizeForLog(s string) string {
    return ansiRe.ReplaceAllString(s, "")
}
```
2. Use structured logging (JSON) instead of free-form text — log entries are then not rendered directly by the terminal
3. Use `fmt.Printf("%q", userInput)` in logs to show the exact bytes

---

**Q22: Your team is building an HTTP/1.1 server from scratch (for learning). A teammate writes the response headers with `\n` instead of `\r\n`. Tests pass in the browser, but strict RFC clients fail. Explain the issue.**

A: HTTP/1.1 (RFC 7230) requires CRLF (`\r\n`) as line separators in headers, not just LF (`\n`). Many browsers are lenient and accept `\n`-only responses. However, strict clients (curl with `--verbose`, Postman, some proxy servers) expect proper CRLF.

Fix: use `"\r\n"` consistently in HTTP headers:
```go
const CRLF = "\r\n"
header := "HTTP/1.1 200 OK" + CRLF +
          "Content-Type: application/json" + CRLF +
          "Content-Length: " + strconv.Itoa(len(body)) + CRLF +
          CRLF
```

---

## FAQ

---

**FAQ1: When should I use `\u` vs directly writing the Unicode character?**

Both are equivalent at runtime. Use `\u` when:
1. You want to document which specific Unicode character you're using (especially for visually ambiguous characters)
2. The character is not easily typeable on your keyboard
3. You're writing code that deals with specific Unicode properties and want the code point to be explicit
4. The character is invisible (like zero-width space `\u200b`)

Use the direct character for commonly recognized characters in human-readable strings.

---

**FAQ2: Is `"\a"` (bell/alert) ever useful in modern programs?**

Rarely, but yes:
1. CLI programs that want to beep when an error occurs
2. Terminal-based timers or notifications
3. Some accessibility tools
4. Testing that a terminal supports the bell

Most modern terminals have the bell disabled by default, but `\a` is still valid and occasionally used.

---

**FAQ3: What's the safest way to detect if a string contains any non-printable characters?**

```go
import "unicode"

func containsNonPrintable(s string) bool {
    for _, r := range s {
        if !unicode.IsPrint(r) && r != '\t' && r != '\n' {
            // unicode.IsPrint returns false for control chars, spaces included
            // We allow tabs and newlines as "acceptable" whitespace
            return true
        }
    }
    return false
}
```

`unicode.IsPrint` returns true for printable characters (letters, digits, punctuation, some symbols) and false for control characters, null bytes, and format characters.

---

**FAQ4: Can I use `\"` inside a raw string literal?**

No. A raw string (backtick) can contain `"` directly without escaping. Only in interpreted strings do you need `\"`. In a raw string: `` `She said "hello"` `` is perfectly valid. The `\"` escape only exists for interpreted strings (double-quoted).

---

**FAQ5: Why does Go have both `\ooo` (octal) and `\xHH` (hex) numeric escapes?**

Historical compatibility with C, which popularized octal escapes in the 1970s (Unix file permissions use octal). However, hex is generally more useful and clearer in modern code:
- `\x0a` is clearer than `\012` for a newline
- Hex maps directly to binary (one hex digit = 4 bits)
- Most modern code uses `\xHH` exclusively

Octal escapes are retained for Go's goal of being familiar to C programmers, but there's rarely a reason to prefer them in new Go code.

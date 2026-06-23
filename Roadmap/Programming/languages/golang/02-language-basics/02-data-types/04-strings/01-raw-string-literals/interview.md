# Raw String Literals in Go — Interview Questions

## Junior Level Questions

---

**Q1: What is a raw string literal in Go? How is it written?**

A: A raw string literal is a string surrounded by backtick characters (`` ` ``). Example: `` s := `Hello, World!` ``. Unlike regular strings in double quotes, raw strings do not process escape sequences — backslashes and other special characters are stored exactly as written. Raw strings can also span multiple lines naturally.

---

**Q2: What is the difference between `"\n"` and `` `\n` `` in Go?**

A: `"\n"` is a string containing a single newline character (byte value 0x0A, length 1). `` `\n` `` is a string containing two characters: a backslash followed by the letter 'n' (bytes 0x5C 0x6E, length 2). In raw strings, `\n` is NOT a newline — it's the two literal characters.

---

**Q3: Can a raw string in Go span multiple lines?**

A: Yes. Raw strings can contain literal newlines. When you press Enter inside backtick delimiters, the newline becomes part of the string:
```go
s := `line 1
line 2`
// s contains "line 1\nline 2" (with a real newline)
```

---

**Q4: Can a raw string contain a backtick character?**

A: No. The backtick is the delimiter for raw strings, so there is no way to include one inside a raw string. The workaround is to concatenate: `` s := `before` + "`" + `after` ``.

---

**Q5: Why would you prefer a raw string for a regular expression?**

A: Regex patterns often contain backslashes (like `\d` for digits, `\.` for literal dots). In a regular double-quoted string, each backslash must be doubled: `"\\d+\\.\\d+"`. In a raw string, you write it as you'd see it in regex documentation: `` `\d+\.\d+` ``. Raw strings are easier to read, write, and compare against reference materials.

---

**Q6: What does `` len(`\n`) `` return?**

A: `2`. The raw string `` `\n` `` contains two bytes: 0x5C (backslash) and 0x6E (letter 'n'). It does NOT contain a newline character.

---

**Q7: Is there any performance difference between raw strings and regular strings at runtime?**

A: No. Both compile to identical runtime representations — a `{pointer, length}` struct. The "raw" vs "interpreted" distinction only exists at compile time. At runtime, there is no way to tell if a string came from a raw literal or an interpreted literal.

---

**Q8: What is the zero value of a raw string?**

A: The zero value of any string in Go (including raw strings) is `""` (empty string). The zero value concept applies to the `string` type, not to the literal syntax.

---

**Q9: Give three practical use cases for raw string literals.**

A:
1. **Regular expressions**: `` `^\d{3}-\d{4}$` `` is much cleaner than `"^\\d{3}-\\d{4}$"`
2. **Multi-line SQL queries**: allows writing SQL that looks like SQL without `\n` everywhere
3. **Windows file paths**: `` `C:\Users\Alice\file.txt` `` vs `"C:\\Users\\Alice\\file.txt"`

---

**Q10: What happens to carriage return characters (`\r`) inside a raw string literal?**

A: The Go compiler automatically removes (discards) carriage return bytes from raw string literals. This ensures that raw strings have consistent content regardless of whether the source file has Windows-style CRLF line endings or Unix-style LF-only line endings. This is specified in the Go language spec.

---

## Middle Level Questions

---

**Q11: Explain why indentation can be a problem with raw string literals.**

A: When a raw string is indented in the source code, the indentation spaces become part of the string content:
```go
func getQuery() string {
    return `
        SELECT *
        FROM users
    `
}
```
This string starts with `\n` and each line has 8 leading spaces. If this is used as SQL, most databases will ignore the whitespace — but if it's used as YAML or similar whitespace-sensitive format, it breaks. The fix is to use `strings.TrimSpace` for the leading/trailing whitespace, and a `Dedent` function to remove common indentation.

---

**Q12: How would you write a raw string that includes a backtick character?**

A: Concatenate the backtick using a regular string:
```go
s := `before the ` + "`" + ` backtick`
```
This is the only way. Unlike Rust (which uses `r#"..."#`) or C++ (which uses raw string prefix `R"delimiter(...)delimiter"`), Go offers no escape mechanism for backtick within a raw string.

---

**Q13: Are raw string literals in Go similar to JavaScript's template literals? Explain the differences.**

A: They look similar (both use backticks) but are very different:
- **JavaScript template literals** support `${expression}` interpolation at runtime
- **Go raw strings** have no interpolation — they're plain strings with no special processing
- JavaScript: `` `Hello, ${name}!` `` embeds the variable at runtime
- Go: `` `Hello, ${name}!` `` produces the literal text `Hello, ${name}!`
- For interpolation in Go, you use `fmt.Sprintf` or `text/template`

---

**Q14: Can raw string literals be used as struct tag values?**

A: No. In Go syntax, struct tags are themselves delimited by backticks:
```go
type User struct {
    Name string `json:"name"` // the backticks here delimit the struct tag
}
```
The backtick cannot appear inside a struct tag value because it would end the tag delimiter. This is a syntactic limitation of the language. Struct tag VALUES are always plain string literals (using the double-quote syntax internally).

---

**Q15: How do raw string literals and `//go:embed` complement each other?**

A: Both are used to embed static content in Go programs:
- **Raw strings**: embed small amounts of content directly in source code (SQL queries, regex patterns, small templates). Good for short content that's tightly coupled to the code.
- **`//go:embed`**: embed content from files (HTML templates, config files, schemas). Good for larger content, or content that non-Go developers might edit.

The typical guideline: raw strings for < ~20 lines of content, `go:embed` for larger files or files that need to be separately maintainable.

---

**Q16: What is the difference between Python's `r"..."` and Go's `` `...` ``?**

A: Both are "raw string" forms, but:
- Python's `r"..."` still uses double quotes as delimiters; the only difference from regular strings is that backslashes aren't treated as escape characters
- Go's `` `...` `` uses backticks and additionally allows newlines (multiline raw strings)
- Python `r"..."` cannot span multiple lines without explicit `\n` continuation
- Python's `"""..."""` (triple-quote) allows multiline but DOES process escape sequences
- Go's raw string is more consistent: a single syntax for both multiline and no-escape

---

**Q17: Describe a scenario where using a raw string instead of an interpreted string would prevent a bug.**

A: Scenario: A developer writes a regex to match Windows file paths:
```go
// Interpreted: easy to make mistakes
// Is this matching literal dots or "any character"?
re := regexp.MustCompile("C:\\\\Users\\\\\\w+")  // very confusing!

// Raw: exactly what the regex docs show
re := regexp.MustCompile(`C:\\Users\\\w+`)
// Even this is clearer as: `C:\\Users\\[a-zA-Z]+`
```

Without raw strings, each regex backslash requires `\\` in Go source, and each regex `\\` (literal backslash in the pattern) requires `\\\\` in source. This quadrupling error is a common source of bugs. Raw strings eliminate it entirely.

---

## Senior Level Questions

---

**Q18: How does the Go compiler handle raw string literals at the binary level?**

A: Raw string literals become compile-time constants stored in the `.rodata` (read-only data) section of the binary. The bytes stored are exactly the characters between the backticks, minus any `\r` bytes. The string literal value on the stack (or in registers) is just a 16-byte struct: an 8-byte pointer into `.rodata` and an 8-byte length. Accessing the string at runtime involves no heap allocation and zero GC pressure, since `.rodata` is not managed by the garbage collector.

---

**Q19: A teammate proposes storing all SQL queries as `fmt.Sprintf` calls with raw string templates: `fmt.Sprintf(getUserQuery, userID)`. What are the risks and how would you fix them?**

A: **Risk: SQL injection.** If `getUserQuery` is `` `SELECT * FROM users WHERE name = '%s'` `` and `userID` contains `'; DROP TABLE users; --`, the resulting query is executed as-is, deleting the table.

**Fix**: Raw strings define query structure only; use parameterized queries for values:
```go
const getUserQuery = `SELECT * FROM users WHERE id = $1`
db.Query(getUserQuery, userID)  // driver handles escaping
```
The raw string is for readability of the SQL structure, not for interpolating values.

---

**Q20: Describe how you would architect a codebase to manage 50+ SQL queries, and what role raw strings play.**

A: Use a Query Repository pattern:
1. Create a `db/queries/` package with one Go file per domain entity
2. Each file contains exported constants with raw string SQL queries
3. SQL is formatted for readability and testability (can copy-paste to psql)
4. Repository layer imports the query constants — no SQL strings scattered in business logic
5. All values use parameterized placeholders (`$1`, `$2`, etc.)

Raw strings make the SQL human-readable and tool-friendly. The architecture separates SQL from logic, making queries easy to review, test, and optimize independently. A DBA can read the query file without understanding Go.

---

## Scenario-Based Questions

---

**Q21: You're reviewing a PR where a developer replaced an interpreted string regex with a raw string regex. The tests pass. What specifically would you verify in the review?**

A: I would verify:
1. **Equivalence**: The raw string version has the same pattern. Count the backslashes — each `\\` in the interpreted string should become a single `\` in the raw string.
2. **Test coverage**: Ensure tests cover edge cases, not just happy path (the pattern change could silently be wrong).
3. **No backtick in pattern**: Confirm the regex pattern doesn't contain a backtick (would require workaround).
4. **Package-level variable**: Confirm the regex is compiled once (package-level `var`), not inside a function.
5. **Compile once**: Run `go vet ./...` and `go build` to confirm no panics at init time.

---

**Q22: A colleague embedded a 500-line HTML template as a raw string constant in a Go file. What would you recommend and why?**

A: Recommend using `//go:embed` instead:
```go
//go:embed templates/page.html
var pageTemplate string
```
Reasons:
1. **Separation of concerns**: HTML belongs in `.html` files, not Go source
2. **Editor support**: HTML files get proper syntax highlighting and linting
3. **Designer access**: Frontend developers can edit templates without Go knowledge
4. **Binary size**: Both approaches produce the same binary size, but the file is separately tracked
5. **Testing**: You can diff the template file separately in code reviews
6. **Reload**: Some embed frameworks allow hot-reloading during development

Reserve raw strings for short, code-adjacent content (< ~20 lines).

---

## FAQ

---

**FAQ1: When should I NOT use a raw string?**

Use an interpreted string when:
1. The string contains a backtick character
2. You need actual escape sequences (`\n`, `\t`, `\x00`, `\u0041`)
3. The string is short and simple with no backslashes
4. You need to embed control characters like null bytes (`\x00`) or ANSI codes (`\x1b[...]`)

---

**FAQ2: Why doesn't Go support string interpolation in raw strings like JavaScript does?**

Go's design philosophy favors explicitness over convenience. Interpolation like `${name}` is implicit execution that can be confusing or misused. Go prefers `fmt.Sprintf("Hello, %s!", name)` which is explicit, type-safe, and does not require special syntax. The `text/template` package provides full interpolation with loops and conditionals for complex use cases.

---

**FAQ3: Is there a way to include a newline in a raw string without pressing Enter?**

No. In a raw string, the ONLY way to get a newline is to actually have one in the source code (press Enter). If you want a newline without pressing Enter, use an interpreted string: `"\n"`. You can also concatenate: `` `line1` + "\n" + `line2` ``.

---

**FAQ4: Why does the Go spec say carriage returns are removed from raw strings?**

This is a cross-platform compatibility feature. If a developer on Windows saves the source file with CRLF line endings (`\r\n`), raw strings would contain `\r\n` instead of `\n`. This would make the same code produce different string values on Windows vs. Linux. By stripping `\r`, the spec ensures consistent behavior regardless of platform or editor settings.

---

**FAQ5: Can a raw string contain null bytes (`\x00`)?**

Yes. A raw string can contain any byte except `\r` (which is stripped) and backtick (which ends the string). If your source file literally contains a null byte character between backticks, it will be part of the string. However, embedding null bytes this way is not recommended — use `"\x00"` in an interpreted string for clarity.

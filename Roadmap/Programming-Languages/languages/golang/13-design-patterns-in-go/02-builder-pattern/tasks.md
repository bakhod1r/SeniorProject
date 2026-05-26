# Builder Pattern — Hands-on Tasks

Work through these in order. The first five drill the basic pointer-receiver chain from `junior.md`. The middle tasks force you to choose between the variants in `middle.md` — value-receiver forking, generics, multi-terminal, stage-typing. The last few are open-ended mini-projects that build something you would actually ship.

Run every solution with `go vet ./...` and `go test ./...` before moving on. Each task is self-contained — copy the solution into a fresh directory, `go mod init scratch`, then iterate.

You need Go 1.21 or later. Tasks 14, 15, and 20 use Go 1.18+ generics. Task 11 uses `net/http/httptest`. Task 17 uses `database/sql` semantics but does not require a real database.

---

## Task 1: Pizza builder (warm-up)

A pizzeria takes orders shaped like *size → crust → toppings*. Implement a `PizzaBuilder` whose chain reads like the order:

```go
p, err := NewPizzaBuilder().
    Size("large").
    Crust("thin").
    Topping("mushrooms").
    Topping("olives").
    Build()
```

**Acceptance criteria**

- [ ] `Pizza` struct with `size string`, `crust string`, `toppings []string`.
- [ ] `PizzaBuilder` with deferred-error field.
- [ ] `Size` accepts only `"small"`, `"medium"`, `"large"`; anything else sets `b.err`.
- [ ] `Crust` accepts only `"thin"`, `"thick"`, `"stuffed"`; anything else sets `b.err`.
- [ ] `Topping` is additive — each call appends one topping. Max 10 toppings.
- [ ] `Build()` requires `size` and `crust` to be set; otherwise returns `error`.
- [ ] The returned `*Pizza` does not share the toppings slice with the builder.
- [ ] A `main()` demo prints two pizzas, one valid and one with an invalid size.

<details><summary>Hints</summary>

- Validate per-step (`Size`, `Crust`, `Topping`) for intrinsic errors. Validate cross-field (required fields) in `Build()`. See §10 of `middle.md`.
- For the slice copy, use `append([]string(nil), b.toppings...)` inside `Build()`.
- Don't panic on an 11th topping — set `b.err` and let the chain unwind.

</details>

<details><summary>Solution</summary>

```go
package main

import (
	"errors"
	"fmt"
)

type Pizza struct {
	size     string
	crust    string
	toppings []string
}

type PizzaBuilder struct {
	size     string
	crust    string
	toppings []string
	err      error
}

func NewPizzaBuilder() *PizzaBuilder { return &PizzaBuilder{} }

var validSizes = map[string]bool{"small": true, "medium": true, "large": true}
var validCrusts = map[string]bool{"thin": true, "thick": true, "stuffed": true}

func (b *PizzaBuilder) Size(s string) *PizzaBuilder {
	if b.err != nil {
		return b
	}
	if !validSizes[s] {
		b.err = fmt.Errorf("Size: invalid %q", s)
		return b
	}
	b.size = s
	return b
}

func (b *PizzaBuilder) Crust(c string) *PizzaBuilder {
	if b.err != nil {
		return b
	}
	if !validCrusts[c] {
		b.err = fmt.Errorf("Crust: invalid %q", c)
		return b
	}
	b.crust = c
	return b
}

func (b *PizzaBuilder) Topping(t string) *PizzaBuilder {
	if b.err != nil {
		return b
	}
	if len(b.toppings) >= 10 {
		b.err = errors.New("Topping: max 10 toppings")
		return b
	}
	b.toppings = append(b.toppings, t)
	return b
}

func (b *PizzaBuilder) Build() (*Pizza, error) {
	if b.err != nil {
		return nil, b.err
	}
	if b.size == "" {
		return nil, errors.New("Build: Size required")
	}
	if b.crust == "" {
		return nil, errors.New("Build: Crust required")
	}
	tops := append([]string(nil), b.toppings...)
	return &Pizza{size: b.size, crust: b.crust, toppings: tops}, nil
}

func main() {
	p, err := NewPizzaBuilder().
		Size("large").
		Crust("thin").
		Topping("mushrooms").
		Topping("olives").
		Build()
	fmt.Printf("%+v err=%v\n", p, err)

	bad, err := NewPizzaBuilder().
		Size("enormous").
		Crust("thin").
		Build()
	fmt.Printf("%+v err=%v\n", bad, err)
}
```

</details>

**Discussion.** This is the smallest possible "real" builder. The shape — deferred error, per-step intrinsic validation, build-time cross-field validation, defensive slice copy — recurs in every later task. If anything feels surprising here, re-read `junior.md` §4 and §7 before continuing.

---

## Task 2: SQL `SELECT` builder

Implement a query builder producing parametrised `SELECT` statements. The chain is:

```go
sql, args, err := Select("id", "name", "email").
    From("users").
    Where("active = ?", true).
    Where("created_at > ?", since).
    OrderBy("created_at DESC").
    Limit(100).
    Build()
```

**Acceptance criteria**

- [ ] `Select(cols ...string) *Builder` is the entry point — `NewBuilder` is *not* exposed.
- [ ] `From`, `Where`, `OrderBy`, `Limit` each return `*Builder`.
- [ ] Multiple `Where` calls AND-join their conditions.
- [ ] `OrderBy` overwrites; calling it twice keeps only the last value.
- [ ] `Limit` rejects negative values via deferred error.
- [ ] `Build()` returns `(sqlString string, args []any, err error)`.
- [ ] If `Select` is called with zero columns, defer the error.
- [ ] If `From` was never called, `Build()` returns an error.
- [ ] A unit test asserts the exact SQL string for the chain above.

<details><summary>Hints</summary>

- Use `strings.Builder` for the SQL assembly.
- `args` accumulates as you go — append each `Where`'s args in the order they were passed.
- Test the exact string with `==`, not regexp. Whitespace-sensitive.

</details>

<details><summary>Solution</summary>

```go
package query

import (
	"errors"
	"fmt"
	"strings"
)

type Builder struct {
	columns []string
	table   string
	wheres  []string
	args    []any
	orderBy string
	limit   int
	err     error
}

func Select(cols ...string) *Builder {
	if len(cols) == 0 {
		return &Builder{err: errors.New("Select: no columns")}
	}
	return &Builder{columns: cols}
}

func (b *Builder) From(t string) *Builder {
	if b.err != nil {
		return b
	}
	if t == "" {
		b.err = errors.New("From: empty table")
		return b
	}
	b.table = t
	return b
}

func (b *Builder) Where(cond string, args ...any) *Builder {
	if b.err != nil {
		return b
	}
	b.wheres = append(b.wheres, cond)
	b.args = append(b.args, args...)
	return b
}

func (b *Builder) OrderBy(col string) *Builder {
	if b.err != nil {
		return b
	}
	b.orderBy = col
	return b
}

func (b *Builder) Limit(n int) *Builder {
	if b.err != nil {
		return b
	}
	if n < 0 {
		b.err = fmt.Errorf("Limit: negative (%d)", n)
		return b
	}
	b.limit = n
	return b
}

func (b *Builder) Build() (string, []any, error) {
	if b.err != nil {
		return "", nil, b.err
	}
	if b.table == "" {
		return "", nil, errors.New("Build: From required")
	}
	var sb strings.Builder
	sb.WriteString("SELECT ")
	sb.WriteString(strings.Join(b.columns, ", "))
	sb.WriteString(" FROM ")
	sb.WriteString(b.table)
	if len(b.wheres) > 0 {
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(b.wheres, " AND "))
	}
	if b.orderBy != "" {
		sb.WriteString(" ORDER BY ")
		sb.WriteString(b.orderBy)
	}
	if b.limit > 0 {
		fmt.Fprintf(&sb, " LIMIT %d", b.limit)
	}
	args := append([]any(nil), b.args...)
	return sb.String(), args, nil
}
```

</details>

**Discussion.** Two design choices to think about. First, why `Select(...)` instead of `NewBuilder().Select(...)`? Because the SQL itself starts with `SELECT`; the API mirrors the verb. Second, why does `Where` *append* but `OrderBy` *overwrites*? Because SQL allows many `WHERE` clauses (AND-joined) but only one `ORDER BY` clause. The builder's semantics should match the target domain's semantics — don't invent new rules.

---

## Task 3: SQL `INSERT`, `UPDATE`, `DELETE` builders

Extend Task 2 with three more entry points: `InsertInto(table)`, `Update(table)`, `DeleteFrom(table)`. Each produces a *different* builder type, so its methods differ.

**Acceptance criteria**

- [ ] `InsertBuilder` exposes `Columns(cols ...string)`, `Values(vals ...any)`, `Build()`.
- [ ] `Values` can be called multiple times for multi-row inserts. Column count must match.
- [ ] `UpdateBuilder` exposes `Set(col string, val any)`, `Where(cond, args...)`, `Build()`.
- [ ] `DeleteBuilder` exposes `Where(cond, args...)`, `Build()`.
- [ ] All three `Build()` methods return `(string, []any, error)`.
- [ ] A `DELETE` without any `Where` clause is an error (refuse to nuke the whole table).
- [ ] Tests assert the exact SQL for each shape.

<details><summary>Hints</summary>

- Don't try to unify these into one struct. Three structs, three entry points. The methods overlap (`Where`) but the targets are different.
- For `INSERT` with multiple `Values` calls, store `[][]any` and join with `, ` in `Build`.
- For `UPDATE`, store `[]string` for the `col = ?` fragments and append to `args`.

</details>

<details><summary>Solution</summary>

```go
package query

import (
	"errors"
	"fmt"
	"strings"
)

// INSERT

type InsertBuilder struct {
	table   string
	cols    []string
	rows    [][]any
	err     error
}

func InsertInto(t string) *InsertBuilder {
	if t == "" {
		return &InsertBuilder{err: errors.New("InsertInto: empty table")}
	}
	return &InsertBuilder{table: t}
}

func (b *InsertBuilder) Columns(c ...string) *InsertBuilder {
	if b.err != nil {
		return b
	}
	if len(c) == 0 {
		b.err = errors.New("Columns: empty")
		return b
	}
	b.cols = c
	return b
}

func (b *InsertBuilder) Values(v ...any) *InsertBuilder {
	if b.err != nil {
		return b
	}
	if len(b.cols) == 0 {
		b.err = errors.New("Values: call Columns first")
		return b
	}
	if len(v) != len(b.cols) {
		b.err = fmt.Errorf("Values: want %d, got %d", len(b.cols), len(v))
		return b
	}
	b.rows = append(b.rows, v)
	return b
}

func (b *InsertBuilder) Build() (string, []any, error) {
	if b.err != nil {
		return "", nil, b.err
	}
	if len(b.rows) == 0 {
		return "", nil, errors.New("Build: no Values")
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "INSERT INTO %s (%s) VALUES ", b.table, strings.Join(b.cols, ", "))
	placeholderRow := "(" + strings.Repeat("?, ", len(b.cols)-1) + "?)"
	rowParts := make([]string, len(b.rows))
	args := make([]any, 0, len(b.rows)*len(b.cols))
	for i, row := range b.rows {
		rowParts[i] = placeholderRow
		args = append(args, row...)
	}
	sb.WriteString(strings.Join(rowParts, ", "))
	return sb.String(), args, nil
}

// UPDATE

type UpdateBuilder struct {
	table  string
	sets   []string
	wheres []string
	args   []any
	err    error
}

func Update(t string) *UpdateBuilder {
	if t == "" {
		return &UpdateBuilder{err: errors.New("Update: empty table")}
	}
	return &UpdateBuilder{table: t}
}

func (b *UpdateBuilder) Set(col string, v any) *UpdateBuilder {
	if b.err != nil {
		return b
	}
	b.sets = append(b.sets, col+" = ?")
	b.args = append(b.args, v)
	return b
}

func (b *UpdateBuilder) Where(cond string, args ...any) *UpdateBuilder {
	if b.err != nil {
		return b
	}
	b.wheres = append(b.wheres, cond)
	b.args = append(b.args, args...)
	return b
}

func (b *UpdateBuilder) Build() (string, []any, error) {
	if b.err != nil {
		return "", nil, b.err
	}
	if len(b.sets) == 0 {
		return "", nil, errors.New("Build: no Set")
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "UPDATE %s SET %s", b.table, strings.Join(b.sets, ", "))
	if len(b.wheres) > 0 {
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(b.wheres, " AND "))
	}
	return sb.String(), append([]any(nil), b.args...), nil
}

// DELETE

type DeleteBuilder struct {
	table  string
	wheres []string
	args   []any
	err    error
}

func DeleteFrom(t string) *DeleteBuilder {
	if t == "" {
		return &DeleteBuilder{err: errors.New("DeleteFrom: empty table")}
	}
	return &DeleteBuilder{table: t}
}

func (b *DeleteBuilder) Where(cond string, args ...any) *DeleteBuilder {
	if b.err != nil {
		return b
	}
	b.wheres = append(b.wheres, cond)
	b.args = append(b.args, args...)
	return b
}

func (b *DeleteBuilder) Build() (string, []any, error) {
	if b.err != nil {
		return "", nil, b.err
	}
	if len(b.wheres) == 0 {
		return "", nil, errors.New("Build: DELETE without WHERE refused")
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "DELETE FROM %s WHERE %s", b.table, strings.Join(b.wheres, " AND "))
	return sb.String(), append([]any(nil), b.args...), nil
}
```

</details>

**Discussion.** The refusal to build an unbounded `DELETE` is the interesting part. Builders aren't just structural — they encode policy. You could add a `WhereAll()` escape hatch for the rare case ("yes, I really mean it"), or leave the safety in. `squirrel` and `goqu` make this distinction differently; pick a side and document it.

---

## Task 4: HTTP request builder

Build an `*http.Request` via a builder that mirrors the real `net/http` API but with method-chaining ergonomics.

```go
req, err := NewRequestBuilder("POST", "https://api.example.com/users").
    Header("Authorization", "Bearer "+token).
    Header("Content-Type", "application/json").
    Query("verbose", "1").
    JSONBody(payload).
    Build()
```

**Acceptance criteria**

- [ ] `NewRequestBuilder(method, url string) *RequestBuilder` validates the method and URL.
- [ ] `Header(k, v)` is additive (multiple headers, possibly same key — append, don't overwrite).
- [ ] `Query(k, v)` adds a URL query parameter. Multiple `Query` calls combine.
- [ ] `Body(io.Reader)` sets a raw body. `JSONBody(v any)` JSON-encodes and sets `Content-Type` automatically (unless already set).
- [ ] Calling both `Body` and `JSONBody` is an error.
- [ ] `Build()` returns `(*http.Request, error)`.
- [ ] A test using `httptest.NewServer` round-trips a built request and asserts the server saw the right method, headers, body, and query.

<details><summary>Hints</summary>

- For multi-value headers, use `http.Header.Add` not `Set`.
- Build the URL with `net/url.Parse` then `u.Query()` and `u.RawQuery`.
- `JSONBody` should marshal in `Build()`, not in the option — that's where errors live.

</details>

<details><summary>Solution</summary>

```go
package httpbuild

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type RequestBuilder struct {
	method   string
	rawURL   string
	headers  http.Header
	query    url.Values
	body     io.Reader
	jsonBody any
	err      error
}

var validMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true,
	"DELETE": true, "HEAD": true, "OPTIONS": true,
}

func NewRequestBuilder(method, rawURL string) *RequestBuilder {
	b := &RequestBuilder{
		method:  method,
		rawURL:  rawURL,
		headers: http.Header{},
		query:   url.Values{},
	}
	if !validMethods[method] {
		b.err = fmt.Errorf("NewRequestBuilder: invalid method %q", method)
	}
	if _, err := url.Parse(rawURL); err != nil {
		b.err = fmt.Errorf("NewRequestBuilder: bad URL %q", rawURL)
	}
	return b
}

func (b *RequestBuilder) Header(k, v string) *RequestBuilder {
	if b.err != nil {
		return b
	}
	b.headers.Add(k, v)
	return b
}

func (b *RequestBuilder) Query(k, v string) *RequestBuilder {
	if b.err != nil {
		return b
	}
	b.query.Add(k, v)
	return b
}

func (b *RequestBuilder) Body(r io.Reader) *RequestBuilder {
	if b.err != nil {
		return b
	}
	if b.jsonBody != nil {
		b.err = errors.New("Body: JSONBody already set")
		return b
	}
	b.body = r
	return b
}

func (b *RequestBuilder) JSONBody(v any) *RequestBuilder {
	if b.err != nil {
		return b
	}
	if b.body != nil {
		b.err = errors.New("JSONBody: Body already set")
		return b
	}
	b.jsonBody = v
	return b
}

func (b *RequestBuilder) Build() (*http.Request, error) {
	if b.err != nil {
		return nil, b.err
	}
	u, err := url.Parse(b.rawURL)
	if err != nil {
		return nil, fmt.Errorf("Build: parse URL: %w", err)
	}
	if len(b.query) > 0 {
		existing := u.Query()
		for k, vs := range b.query {
			for _, v := range vs {
				existing.Add(k, v)
			}
		}
		u.RawQuery = existing.Encode()
	}
	var body io.Reader = b.body
	if b.jsonBody != nil {
		raw, err := json.Marshal(b.jsonBody)
		if err != nil {
			return nil, fmt.Errorf("Build: marshal JSON: %w", err)
		}
		body = bytes.NewReader(raw)
		if b.headers.Get("Content-Type") == "" {
			b.headers.Set("Content-Type", "application/json")
		}
	}
	req, err := http.NewRequest(b.method, u.String(), body)
	if err != nil {
		return nil, err
	}
	for k, vs := range b.headers {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	return req, nil
}
```

</details>

**Discussion.** Notice how the *mutually-exclusive* pair `Body` / `JSONBody` is enforced by the deferred-error pattern. A stage-typed builder (junior §5.3) could enforce it at compile time, but for two methods that's overkill. The builder shines exactly when ergonomics > type safety — when the cost of a runtime error is small (a clear message) and the cost of compile-time enforcement is large (extra types).

---

## Task 5: Email builder

A `MailMessage` has many fields, several of which are lists (To, Cc, Bcc, Attachments). Build it via a fluent chain.

```go
msg, err := NewMail().
    From("alice@example.com").
    To("bob@example.com", "carol@example.com").
    Cc("dan@example.com").
    Subject("Q3 review").
    BodyText("Hi all, ...").
    Attachment("report.pdf", pdfBytes).
    Build()
```

**Acceptance criteria**

- [ ] All address fields validate "looks like an email" — at minimum `strings.Contains(s, "@")`.
- [ ] `To`, `Cc`, `Bcc` are additive across calls and within a call (variadic).
- [ ] `BodyText` and `BodyHTML` can both be set (multipart message).
- [ ] `Attachment(filename string, data []byte)` is additive.
- [ ] `Build()` requires `From` and at least one of `To/Cc/Bcc` and `Subject`.
- [ ] The returned `*MailMessage` has its slices and `[]byte` copied — mutating builder state after `Build()` must not affect the message.
- [ ] A unit test mutates the builder after `Build()` and asserts the built message is unchanged.

<details><summary>Hints</summary>

- A cheap email check is enough for this exercise. Don't try to implement RFC 5322.
- For the deep-copy test, change `b.attachments[0].Data[0] = 0xFF` after `Build` and assert the message's attachment is still intact.

</details>

<details><summary>Solution</summary>

```go
package mail

import (
	"errors"
	"fmt"
	"strings"
)

type Attachment struct {
	Filename string
	Data     []byte
}

type MailMessage struct {
	from        string
	to, cc, bcc []string
	subject     string
	bodyText    string
	bodyHTML    string
	attachments []Attachment
}

type Builder struct {
	msg MailMessage
	err error
}

func NewMail() *Builder { return &Builder{} }

func validEmail(s string) bool { return strings.Contains(s, "@") && !strings.Contains(s, " ") }

func (b *Builder) From(addr string) *Builder {
	if b.err != nil {
		return b
	}
	if !validEmail(addr) {
		b.err = fmt.Errorf("From: invalid %q", addr)
		return b
	}
	b.msg.from = addr
	return b
}

func (b *Builder) addList(name string, dst *[]string, addrs []string) *Builder {
	if b.err != nil {
		return b
	}
	for _, a := range addrs {
		if !validEmail(a) {
			b.err = fmt.Errorf("%s: invalid %q", name, a)
			return b
		}
	}
	*dst = append(*dst, addrs...)
	return b
}

func (b *Builder) To(addrs ...string) *Builder  { return b.addList("To", &b.msg.to, addrs) }
func (b *Builder) Cc(addrs ...string) *Builder  { return b.addList("Cc", &b.msg.cc, addrs) }
func (b *Builder) Bcc(addrs ...string) *Builder { return b.addList("Bcc", &b.msg.bcc, addrs) }

func (b *Builder) Subject(s string) *Builder {
	if b.err != nil {
		return b
	}
	b.msg.subject = s
	return b
}

func (b *Builder) BodyText(s string) *Builder {
	if b.err != nil {
		return b
	}
	b.msg.bodyText = s
	return b
}

func (b *Builder) BodyHTML(s string) *Builder {
	if b.err != nil {
		return b
	}
	b.msg.bodyHTML = s
	return b
}

func (b *Builder) Attachment(filename string, data []byte) *Builder {
	if b.err != nil {
		return b
	}
	cp := append([]byte(nil), data...)
	b.msg.attachments = append(b.msg.attachments, Attachment{Filename: filename, Data: cp})
	return b
}

func (b *Builder) Build() (*MailMessage, error) {
	if b.err != nil {
		return nil, b.err
	}
	if b.msg.from == "" {
		return nil, errors.New("Build: From required")
	}
	if len(b.msg.to)+len(b.msg.cc)+len(b.msg.bcc) == 0 {
		return nil, errors.New("Build: at least one recipient required")
	}
	if b.msg.subject == "" {
		return nil, errors.New("Build: Subject required")
	}
	m := MailMessage{
		from:     b.msg.from,
		subject:  b.msg.subject,
		bodyText: b.msg.bodyText,
		bodyHTML: b.msg.bodyHTML,
		to:       append([]string(nil), b.msg.to...),
		cc:       append([]string(nil), b.msg.cc...),
		bcc:      append([]string(nil), b.msg.bcc...),
	}
	m.attachments = make([]Attachment, len(b.msg.attachments))
	for i, a := range b.msg.attachments {
		m.attachments[i] = Attachment{
			Filename: a.Filename,
			Data:     append([]byte(nil), a.Data...),
		}
	}
	return &m, nil
}
```

</details>

**Discussion.** The two interesting bits: `addList` factors the additive-with-validation pattern shared by `To/Cc/Bcc` (apply DRY where it pays — three nearly-identical methods would otherwise drift apart), and `Attachment` copies the byte slice *at the step* rather than at `Build()`. Either is defensible; copying at the step protects against callers mutating the slice they passed in *between* the chain and `Build`.

---

## Task 6: Test user fixture builder

A common test helper: produce a `*User` with sensible defaults but the ability to override anything.

```go
u := NewUserFixture(t).Name("Alice").Role("admin").MustBuild()
admin := NewUserFixture(t).Role("admin").MustBuild()
guest := NewUserFixture(t).Inactive().MustBuild()
```

**Acceptance criteria**

- [ ] `NewUserFixture(t *testing.T)` returns a `*UserFixture`. The `t` is held so `MustBuild` can call `t.Fatal` on error.
- [ ] Default user: random unique `Name`, random unique `Email`, `Role="user"`, `Subscription="active"`.
- [ ] `Name(s)`, `Email(s)`, `Role(s)`, `Subscription(s)` override.
- [ ] `Inactive()` is a convenience that sets `Subscription="inactive"`.
- [ ] `Admin()` is a convenience that sets `Role="admin"`.
- [ ] `MustBuild()` returns `*User` and calls `t.Fatal` if validation fails.
- [ ] `Build()` returns `(*User, error)` for callers that want to assert errors.
- [ ] Uniqueness counter prevents two fixtures in the same test run colliding on `Email`.

<details><summary>Hints</summary>

- Use a package-level `atomic.Int64` for the uniqueness counter.
- `MustBuild` is the test-helper convention. Mark it with `t.Helper()`.
- Keep `t` separate from the builder's data — don't write to `*testing.T` in step methods.

</details>

<details><summary>Solution</summary>

```go
package fixtures

import (
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
)

type User struct {
	Name         string
	Email        string
	Role         string
	Subscription string
}

type UserFixture struct {
	t    *testing.T
	user User
	err  error
}

var fixtureCounter atomic.Int64

func NewUserFixture(t *testing.T) *UserFixture {
	n := fixtureCounter.Add(1)
	return &UserFixture{
		t: t,
		user: User{
			Name:         fmt.Sprintf("Fixture User %d", n),
			Email:        fmt.Sprintf("fixture-%d@example.com", n),
			Role:         "user",
			Subscription: "active",
		},
	}
}

func (f *UserFixture) Name(s string) *UserFixture {
	if f.err != nil {
		return f
	}
	if s == "" {
		f.err = errors.New("Name: empty")
		return f
	}
	f.user.Name = s
	return f
}

func (f *UserFixture) Email(s string) *UserFixture {
	if f.err != nil {
		return f
	}
	f.user.Email = s
	return f
}

func (f *UserFixture) Role(s string) *UserFixture {
	if f.err != nil {
		return f
	}
	f.user.Role = s
	return f
}

func (f *UserFixture) Subscription(s string) *UserFixture {
	if f.err != nil {
		return f
	}
	f.user.Subscription = s
	return f
}

func (f *UserFixture) Inactive() *UserFixture { return f.Subscription("inactive") }
func (f *UserFixture) Admin() *UserFixture    { return f.Role("admin") }

func (f *UserFixture) Build() (*User, error) {
	if f.err != nil {
		return nil, f.err
	}
	u := f.user
	return &u, nil
}

func (f *UserFixture) MustBuild() *User {
	f.t.Helper()
	u, err := f.Build()
	if err != nil {
		f.t.Fatalf("UserFixture: %v", err)
	}
	return u
}
```

</details>

**Discussion.** Fixture builders are the most common builder you'll write in real Go code. The trick is `MustBuild` versus `Build`: the test-helper version (`MustBuild`) calls `t.Fatal` so the caller doesn't have to write `if err != nil { t.Fatal(err) }` in every test. Keep both — `Build` for tests that exercise the validation logic itself, `MustBuild` for the 95% of tests that just want a valid user.

---

## Task 7: Order fixture with nested line-item builders

Extend Task 6 with `OrderFixture`. An order has a customer and one or more line items, each with its own product, quantity, and price.

```go
order := NewOrderFixture(t).
    Customer(u).
    LineItem(NewLineItem().Product("Widget").Qty(2).Price(9.99)).
    LineItem(NewLineItem().Product("Gadget").Qty(1).Price(29.99)).
    MustBuild()
```

**Acceptance criteria**

- [ ] `LineItem` builder is independent (no `*testing.T` reference) and has its own `Build()`.
- [ ] `OrderFixture.LineItem(*LineItemBuilder)` accepts the inner builder and calls its `Build()` internally.
- [ ] An invalid line item propagates to the outer builder's deferred error.
- [ ] Default customer is a fresh `UserFixture`.
- [ ] `MustBuild` requires at least one line item.
- [ ] `Order.Total` is computed in `Build()` from the line items.

<details><summary>Hints</summary>

- The inner builder is "off the test helper". Its errors flow into the outer fixture, which then surfaces them via `MustBuild`.
- Compute `Total` once in `Build`, store it in `Order.Total`. Don't re-compute on every read.

</details>

<details><summary>Solution</summary>

```go
package fixtures

import (
	"errors"
	"fmt"
	"testing"
)

type LineItem struct {
	Product string
	Qty     int
	Price   float64
}

type LineItemBuilder struct {
	li  LineItem
	err error
}

func NewLineItem() *LineItemBuilder { return &LineItemBuilder{} }

func (b *LineItemBuilder) Product(s string) *LineItemBuilder {
	if b.err != nil {
		return b
	}
	if s == "" {
		b.err = errors.New("Product: empty")
		return b
	}
	b.li.Product = s
	return b
}

func (b *LineItemBuilder) Qty(n int) *LineItemBuilder {
	if b.err != nil {
		return b
	}
	if n <= 0 {
		b.err = fmt.Errorf("Qty: must be > 0, got %d", n)
		return b
	}
	b.li.Qty = n
	return b
}

func (b *LineItemBuilder) Price(p float64) *LineItemBuilder {
	if b.err != nil {
		return b
	}
	if p < 0 {
		b.err = fmt.Errorf("Price: negative %v", p)
		return b
	}
	b.li.Price = p
	return b
}

func (b *LineItemBuilder) Build() (LineItem, error) {
	if b.err != nil {
		return LineItem{}, b.err
	}
	if b.li.Product == "" {
		return LineItem{}, errors.New("Build: Product required")
	}
	return b.li, nil
}

type Order struct {
	Customer *User
	Items    []LineItem
	Total    float64
}

type OrderFixture struct {
	t        *testing.T
	customer *User
	items    []LineItem
	err      error
}

func NewOrderFixture(t *testing.T) *OrderFixture {
	cust := NewUserFixture(t).MustBuild()
	return &OrderFixture{t: t, customer: cust}
}

func (f *OrderFixture) Customer(u *User) *OrderFixture {
	if f.err != nil {
		return f
	}
	if u == nil {
		f.err = errors.New("Customer: nil")
		return f
	}
	f.customer = u
	return f
}

func (f *OrderFixture) LineItem(b *LineItemBuilder) *OrderFixture {
	if f.err != nil {
		return f
	}
	li, err := b.Build()
	if err != nil {
		f.err = fmt.Errorf("LineItem: %w", err)
		return f
	}
	f.items = append(f.items, li)
	return f
}

func (f *OrderFixture) Build() (*Order, error) {
	if f.err != nil {
		return nil, f.err
	}
	if len(f.items) == 0 {
		return nil, errors.New("Build: at least one LineItem required")
	}
	var total float64
	for _, li := range f.items {
		total += float64(li.Qty) * li.Price
	}
	items := append([]LineItem(nil), f.items...)
	return &Order{Customer: f.customer, Items: items, Total: total}, nil
}

func (f *OrderFixture) MustBuild() *Order {
	f.t.Helper()
	o, err := f.Build()
	if err != nil {
		f.t.Fatalf("OrderFixture: %v", err)
	}
	return o
}
```

</details>

**Discussion.** Nested builders are the standard pattern for object graphs. The inner builder builds *a* line item; the outer fixture aggregates many of them. Two design choices to ponder: do you want `LineItem(b)` to take a builder (as here) or a value (`LineItem(LineItem{...})`)? Taking the builder lets the caller use the chain; taking the value is simpler. Library taste varies; the builder-of-builders approach reads best for deep graphs.

---

## Task 8: URL builder

Build a `*net/url.URL` via a fluent chain. The native `net/url` API is awkward; this is a real ergonomic win.

```go
u, err := NewURL().
    Scheme("https").
    Host("api.example.com").
    Path("v1", "users", "42").
    Query("expand", "profile").
    Query("expand", "settings").
    Fragment("top").
    Build()
// → https://api.example.com/v1/users/42?expand=profile&expand=settings#top
```

**Acceptance criteria**

- [ ] `Scheme(s)` accepts only `"http"` and `"https"`; anything else is a deferred error.
- [ ] `Host(s)` takes a hostname optionally with a port (`"example.com:8080"`).
- [ ] `Path(segments ...string)` is additive — each call appends segments. Segments are URL-escaped before joining with `/`.
- [ ] `Query(k, v)` is additive (same key can be added multiple times).
- [ ] `Fragment(s)` overwrites.
- [ ] `Build()` returns `(*url.URL, error)`.
- [ ] A test asserts the example string.

<details><summary>Hints</summary>

- Use `url.PathEscape` for each segment.
- Build `url.Values` once, encode at `Build()`.
- `url.URL.String()` does the heavy lifting once the fields are set right.

</details>

<details><summary>Solution</summary>

```go
package urlbuild

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

type Builder struct {
	scheme   string
	host     string
	segments []string
	query    url.Values
	fragment string
	err      error
}

func NewURL() *Builder { return &Builder{query: url.Values{}} }

func (b *Builder) Scheme(s string) *Builder {
	if b.err != nil {
		return b
	}
	if s != "http" && s != "https" {
		b.err = fmt.Errorf("Scheme: invalid %q", s)
		return b
	}
	b.scheme = s
	return b
}

func (b *Builder) Host(h string) *Builder {
	if b.err != nil {
		return b
	}
	if h == "" {
		b.err = errors.New("Host: empty")
		return b
	}
	b.host = h
	return b
}

func (b *Builder) Path(segments ...string) *Builder {
	if b.err != nil {
		return b
	}
	for _, s := range segments {
		if s == "" {
			b.err = errors.New("Path: empty segment")
			return b
		}
		b.segments = append(b.segments, url.PathEscape(s))
	}
	return b
}

func (b *Builder) Query(k, v string) *Builder {
	if b.err != nil {
		return b
	}
	b.query.Add(k, v)
	return b
}

func (b *Builder) Fragment(s string) *Builder {
	if b.err != nil {
		return b
	}
	b.fragment = s
	return b
}

func (b *Builder) Build() (*url.URL, error) {
	if b.err != nil {
		return nil, b.err
	}
	if b.scheme == "" {
		return nil, errors.New("Build: Scheme required")
	}
	if b.host == "" {
		return nil, errors.New("Build: Host required")
	}
	u := &url.URL{
		Scheme:   b.scheme,
		Host:     b.host,
		Path:     "/" + strings.Join(b.segments, "/"),
		RawQuery: b.query.Encode(),
		Fragment: b.fragment,
	}
	return u, nil
}
```

</details>

**Discussion.** Compare this with the native `net/url`. The native API requires you to set fields directly on a `url.URL` value, remember to `PathEscape` yourself, build `url.Values` and call `Encode()`. The builder collapses all that into a chain. A common production extension: a `Param(name, value string)` method that does *both* path-segment substitution (e.g., `/users/{id}` → `/users/42`) and query-string injection depending on what the route expects. That's where builders shine — they encode small policies the underlying API can't express.

---

## Task 9: Database connection string builder

Build connection strings for Postgres and MySQL. The two formats differ enough that you need *two* builders sharing a small core.

```go
dsn := Postgres().Host("db.example.com").Port(5432).User("alice").Password("secret").Database("app").SSLMode("require").Build()
// → "host=db.example.com port=5432 user=alice password=secret dbname=app sslmode=require"

dsn := MySQL().User("alice").Password("secret").Host("db.example.com").Port(3306).Database("app").Build()
// → "alice:secret@tcp(db.example.com:3306)/app"
```

**Acceptance criteria**

- [ ] Two entry points: `Postgres()` and `MySQL()`.
- [ ] Each returns its own builder type with the appropriate methods.
- [ ] Postgres builder produces space-separated `key=value` pairs in deterministic order.
- [ ] MySQL builder produces `user:password@tcp(host:port)/database`.
- [ ] Both expose `Build() (string, error)`.
- [ ] Empty mandatory fields are errors.
- [ ] A `String()` method on each builder returns `Build()`'s first return value, panicking on error — useful for tests but documented as dangerous.

<details><summary>Hints</summary>

- The deterministic order is what makes diffs readable. Iterate over a fixed `[]string` slice of field names, not a `map`.
- Don't try to share a base struct between the two. The fields overlap (host, port, user) but the formatting differs — composition is harder than just having two structs.

</details>

<details><summary>Solution</summary>

```go
package dsn

import (
	"errors"
	"fmt"
	"strings"
)

// Postgres

type PGBuilder struct {
	host, user, password, database, sslmode string
	port                                    int
	err                                     error
}

func Postgres() *PGBuilder { return &PGBuilder{port: 5432, sslmode: "disable"} }

func (b *PGBuilder) Host(s string) *PGBuilder     { b.host = s; return b }
func (b *PGBuilder) Port(n int) *PGBuilder        { b.port = n; return b }
func (b *PGBuilder) User(s string) *PGBuilder     { b.user = s; return b }
func (b *PGBuilder) Password(s string) *PGBuilder { b.password = s; return b }
func (b *PGBuilder) Database(s string) *PGBuilder { b.database = s; return b }
func (b *PGBuilder) SSLMode(s string) *PGBuilder  { b.sslmode = s; return b }

func (b *PGBuilder) Build() (string, error) {
	if b.err != nil {
		return "", b.err
	}
	if b.host == "" || b.user == "" || b.database == "" {
		return "", errors.New("Build: host, user, database required")
	}
	parts := []string{
		fmt.Sprintf("host=%s", b.host),
		fmt.Sprintf("port=%d", b.port),
		fmt.Sprintf("user=%s", b.user),
	}
	if b.password != "" {
		parts = append(parts, fmt.Sprintf("password=%s", b.password))
	}
	parts = append(parts,
		fmt.Sprintf("dbname=%s", b.database),
		fmt.Sprintf("sslmode=%s", b.sslmode),
	)
	return strings.Join(parts, " "), nil
}

func (b *PGBuilder) String() string {
	s, err := b.Build()
	if err != nil {
		panic(err)
	}
	return s
}

// MySQL

type MySQLBuilder struct {
	host, user, password, database string
	port                           int
	err                            error
}

func MySQL() *MySQLBuilder { return &MySQLBuilder{port: 3306} }

func (b *MySQLBuilder) Host(s string) *MySQLBuilder     { b.host = s; return b }
func (b *MySQLBuilder) Port(n int) *MySQLBuilder        { b.port = n; return b }
func (b *MySQLBuilder) User(s string) *MySQLBuilder     { b.user = s; return b }
func (b *MySQLBuilder) Password(s string) *MySQLBuilder { b.password = s; return b }
func (b *MySQLBuilder) Database(s string) *MySQLBuilder { b.database = s; return b }

func (b *MySQLBuilder) Build() (string, error) {
	if b.err != nil {
		return "", b.err
	}
	if b.host == "" || b.user == "" || b.database == "" {
		return "", errors.New("Build: host, user, database required")
	}
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s", b.user, b.password, b.host, b.port, b.database), nil
}
```

</details>

**Discussion.** Two builders, almost identical inputs, very different outputs. The DRY principle would tempt you to share a base struct — *don't*. The formatting logic is the actual variance, and trying to parametrise it across drivers ("MySQL uses `:` between user and password; Postgres uses ` `") buys you nothing readable. Duplicate the fields; each builder owns its rendering.

---

## Task 10: AST node builder for boolean expressions

A small DSL: assemble a boolean expression tree (`AND`, `OR`, `NOT`, equality leaves) via a builder. Useful as a base for query filters, rule engines, etc.

```go
expr := And(
    Eq("role", "admin"),
    Or(
        Eq("active", true),
        Not(Eq("deleted", false)),
    ),
).Build()
// → (role = "admin" AND (active = true OR NOT (deleted = false)))
```

**Acceptance criteria**

- [ ] Types: `Expr` (interface with `String() string`), and concrete `andExpr`, `orExpr`, `notExpr`, `eqExpr`.
- [ ] Constructors `And(...Expr)`, `Or(...Expr)`, `Not(Expr)`, `Eq(field string, value any)`.
- [ ] A `*Builder` accumulates an expression tree and produces the final string via `Build() (string, error)`.
- [ ] `And` and `Or` with zero arguments are an error.
- [ ] `Eq` with empty `field` is an error.
- [ ] A nested expression renders with parentheses.
- [ ] String values are quoted; ints, bools, etc. use Go's `%v`.

<details><summary>Hints</summary>

- Each constructor *returns* a `*Builder` that wraps the resulting expression. That builder can be passed to another constructor as a child.
- Implement `String()` on each expr type. `Build()` just calls `expr.String()`.

</details>

<details><summary>Solution</summary>

```go
package boolexpr

import (
	"errors"
	"fmt"
	"strings"
)

type Expr interface {
	String() string
}

type Builder struct {
	expr Expr
	err  error
}

func (b *Builder) Build() (string, error) {
	if b.err != nil {
		return "", b.err
	}
	if b.expr == nil {
		return "", errors.New("Build: empty expression")
	}
	return b.expr.String(), nil
}

type eqExpr struct {
	field string
	value any
}

func (e eqExpr) String() string {
	if s, ok := e.value.(string); ok {
		return fmt.Sprintf("%s = %q", e.field, s)
	}
	return fmt.Sprintf("%s = %v", e.field, e.value)
}

type andExpr struct{ children []Expr }

func (e andExpr) String() string {
	parts := make([]string, len(e.children))
	for i, c := range e.children {
		parts[i] = c.String()
	}
	return "(" + strings.Join(parts, " AND ") + ")"
}

type orExpr struct{ children []Expr }

func (e orExpr) String() string {
	parts := make([]string, len(e.children))
	for i, c := range e.children {
		parts[i] = c.String()
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

type notExpr struct{ child Expr }

func (e notExpr) String() string { return "NOT " + e.child.String() }

func unwrap(b *Builder) (Expr, error) {
	if b.err != nil {
		return nil, b.err
	}
	return b.expr, nil
}

func Eq(field string, v any) *Builder {
	if field == "" {
		return &Builder{err: errors.New("Eq: empty field")}
	}
	return &Builder{expr: eqExpr{field: field, value: v}}
}

func And(children ...*Builder) *Builder {
	if len(children) == 0 {
		return &Builder{err: errors.New("And: no children")}
	}
	exprs := make([]Expr, 0, len(children))
	for _, c := range children {
		e, err := unwrap(c)
		if err != nil {
			return &Builder{err: err}
		}
		exprs = append(exprs, e)
	}
	return &Builder{expr: andExpr{children: exprs}}
}

func Or(children ...*Builder) *Builder {
	if len(children) == 0 {
		return &Builder{err: errors.New("Or: no children")}
	}
	exprs := make([]Expr, 0, len(children))
	for _, c := range children {
		e, err := unwrap(c)
		if err != nil {
			return &Builder{err: err}
		}
		exprs = append(exprs, e)
	}
	return &Builder{expr: orExpr{children: exprs}}
}

func Not(child *Builder) *Builder {
	e, err := unwrap(child)
	if err != nil {
		return &Builder{err: err}
	}
	return &Builder{expr: notExpr{child: e}}
}
```

</details>

**Discussion.** This task is half-builder, half-DSL. Notice how the "chain" looks like a tree of constructor calls, not a `.` chain. That's deliberate: AST construction is *not* linear, so a linear chain is the wrong shape. The builder lives inside each node as the error-carrier; the user-facing API is the constructor functions. When the domain isn't sequential, abandon the dot-chain — the *spirit* of the pattern (separate type for assembly, terminal `Build()`) survives without it.

---

## Task 11: Mock HTTP server builder

A test helper that spins up an `httptest.Server` whose responses you configured ahead of time.

```go
srv := NewMockServer().
    Route("GET", "/health", JSON(200, map[string]any{"ok": true})).
    Route("POST", "/users", JSON(201, map[string]any{"id": 1})).
    Default(JSON(404, map[string]string{"error": "not found"})).
    Middleware(LogMiddleware(t)).
    Start()
defer srv.Close()
```

**Acceptance criteria**

- [ ] `NewMockServer()` returns a builder.
- [ ] `Route(method, path string, handler http.Handler)` registers a route. Method match is exact.
- [ ] `Default(handler http.Handler)` registers a fallback.
- [ ] `Middleware(mw func(http.Handler) http.Handler)` wraps the entire router. Multiple middlewares wrap in the order added.
- [ ] `Start()` returns a `*httptest.Server` ready to use. `URL()` returns its base URL.
- [ ] Helper `JSON(status int, body any) http.Handler` produces a JSON-responding handler.
- [ ] A test using `http.Get(srv.URL() + "/health")` asserts the configured response.

<details><summary>Hints</summary>

- Use `http.ServeMux` as the underlying router, then wrap with middlewares.
- Apply middlewares in *reverse* order so the first one in the chain runs first.
- `Start()` is your terminal; it's allowed to be more complex than `Build()` because it also starts a server.

</details>

<details><summary>Solution</summary>

```go
package mocksrv

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
)

type Middleware func(http.Handler) http.Handler

type route struct {
	method  string
	path    string
	handler http.Handler
}

type Builder struct {
	routes      []route
	defaultH    http.Handler
	middlewares []Middleware
}

func NewMockServer() *Builder { return &Builder{} }

func (b *Builder) Route(method, path string, h http.Handler) *Builder {
	b.routes = append(b.routes, route{method: method, path: path, handler: h})
	return b
}

func (b *Builder) Default(h http.Handler) *Builder {
	b.defaultH = h
	return b
}

func (b *Builder) Middleware(mw Middleware) *Builder {
	b.middlewares = append(b.middlewares, mw)
	return b
}

func JSON(status int, body any) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	})
}

func (b *Builder) Start() *httptest.Server {
	mux := http.NewServeMux()
	routes := b.routes
	defaultH := b.defaultH
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		for _, rt := range routes {
			if rt.method == r.Method && rt.path == r.URL.Path {
				rt.handler.ServeHTTP(w, r)
				return
			}
		}
		if defaultH != nil {
			defaultH.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})
	var h http.Handler = mux
	for i := len(b.middlewares) - 1; i >= 0; i-- {
		h = b.middlewares[i](h)
	}
	return httptest.NewServer(h)
}
```

</details>

**Discussion.** The builder's terminal does something — it starts a server. That's outside the "construct an object" mental model. The pattern still fits: assemble configuration, then *act on it* in the terminal. Compare with the `database/sql` pattern where `db, err := sql.Open(...)` is conceptually `OpenBuilder.Open()` — there's an action embedded in the terminal. Be deliberate about which terminal names imply what; `Start`, `Open`, `Listen`, `Connect`, `Run` all carry implications a plain `Build` doesn't.

---

## Task 12: Validate-step builder with deferred-error pattern

A library that validates user input across multiple steps. Each step adds a check; `Build()` returns the first error or the validated object.

```go
user, err := Validate(input).
    Required("Name").
    Required("Email").
    Pattern("Email", emailRegex).
    Range("Age", 0, 150).
    Custom(func(u User) error {
        if u.Role == "admin" && u.MFAEnabled == false {
            return errors.New("admin must have MFA")
        }
        return nil
    }).
    Build()
```

**Acceptance criteria**

- [ ] `Validate(input User)` returns a `*Validator`.
- [ ] `Required(fieldName)` uses reflection (or a switch) to assert the named field is non-zero.
- [ ] `Pattern(fieldName, regex)` checks a string field against a compiled regex.
- [ ] `Range(fieldName, min, max int)` checks an int field is in `[min, max]`.
- [ ] `Custom(func(User) error)` runs an arbitrary check.
- [ ] Errors *accumulate* — `Build()` returns a slice of all errors, not just the first.
- [ ] If at least one error, `Build()` returns `(User{}, []error)`. Otherwise `(input, nil)`.
- [ ] A test asserts that two failing checks produce two errors.

<details><summary>Hints</summary>

- Accumulating errors is the variant where deferred-error becomes deferred-*errors* (plural).
- Use `reflect` for the field access, or a hand-written switch on the field name. Switch is easier for this exercise.
- Don't short-circuit — every check should run, even if earlier ones failed.

</details>

<details><summary>Solution</summary>

```go
package validate

import (
	"errors"
	"fmt"
	"regexp"
)

type User struct {
	Name       string
	Email      string
	Age        int
	Role       string
	MFAEnabled bool
}

type Validator struct {
	input User
	errs  []error
}

func Validate(u User) *Validator { return &Validator{input: u} }

func (v *Validator) Required(field string) *Validator {
	switch field {
	case "Name":
		if v.input.Name == "" {
			v.errs = append(v.errs, errors.New("Required: Name"))
		}
	case "Email":
		if v.input.Email == "" {
			v.errs = append(v.errs, errors.New("Required: Email"))
		}
	default:
		v.errs = append(v.errs, fmt.Errorf("Required: unknown field %q", field))
	}
	return v
}

func (v *Validator) Pattern(field string, re *regexp.Regexp) *Validator {
	var s string
	switch field {
	case "Name":
		s = v.input.Name
	case "Email":
		s = v.input.Email
	default:
		v.errs = append(v.errs, fmt.Errorf("Pattern: unknown field %q", field))
		return v
	}
	if !re.MatchString(s) {
		v.errs = append(v.errs, fmt.Errorf("Pattern: %s does not match", field))
	}
	return v
}

func (v *Validator) Range(field string, min, max int) *Validator {
	var n int
	switch field {
	case "Age":
		n = v.input.Age
	default:
		v.errs = append(v.errs, fmt.Errorf("Range: unknown field %q", field))
		return v
	}
	if n < min || n > max {
		v.errs = append(v.errs, fmt.Errorf("Range: %s=%d not in [%d,%d]", field, n, min, max))
	}
	return v
}

func (v *Validator) Custom(f func(User) error) *Validator {
	if err := f(v.input); err != nil {
		v.errs = append(v.errs, fmt.Errorf("Custom: %w", err))
	}
	return v
}

func (v *Validator) Build() (User, []error) {
	if len(v.errs) > 0 {
		return User{}, v.errs
	}
	return v.input, nil
}
```

</details>

**Discussion.** Two extensions of the basic pattern: (1) `Build` returns `[]error` instead of one, because validators are most useful when they report *every* problem at once; (2) each step runs unconditionally — we don't short-circuit on the first error. This trades the single-error simplicity of `junior.md §7` for completeness. It's the right call for validation; the wrong call for, say, a TCP connection builder where the first failure makes everything else moot.

---

## Task 13: Cloneable builder with deep-copy semantics

A query builder where callers fork mid-chain. Implement `Clone()` correctly.

```go
base := Select("id", "name").From("users").Where("active = ?", true)

adultsQuery := base.Clone().Where("age >= ?", 18)
minorsQuery := base.Clone().Where("age < ?", 18)

adultsSQL, _, _ := adultsQuery.Build()
minorsSQL, _, _ := minorsQuery.Build()
// adults: SELECT id, name FROM users WHERE active = ? AND age >= ?
// minors: SELECT id, name FROM users WHERE active = ? AND age < ?
```

**Acceptance criteria**

- [ ] Take your Task 2 SQL builder and add a `Clone()` method.
- [ ] `Clone()` deep-copies every slice and map field.
- [ ] After cloning, mutating the original does not affect the clone, and vice versa.
- [ ] A unit test calls `Clone`, then `Where` on the clone, and asserts the original's `wheres` slice is unchanged.
- [ ] A second test exercises the "spare capacity" trap: `b.wheres = make([]string, 1, 10)`, clone, append on the clone, assert original index 1+ is unaffected.

<details><summary>Hints</summary>

- The shallow `c := *b` followed by `return &c` is the bug. Slice headers share their backing array.
- `append([]string(nil), b.wheres...)` is the idiomatic deep-copy of a slice.
- Maps need `make(map[K]V, len(orig))` plus a loop.

</details>

<details><summary>Solution</summary>

```go
package query

func (b *Builder) Clone() *Builder {
	c := *b
	c.columns = append([]string(nil), b.columns...)
	c.wheres = append([]string(nil), b.wheres...)
	c.args = append([]any(nil), b.args...)
	return &c
}
```

(With the rest of the Task 2 SQL builder unchanged.) A full demonstration:

```go
package main

import (
	"fmt"

	"example.com/query"
)

func main() {
	base := query.Select("id", "name").
		From("users").
		Where("active = ?", true)

	adults := base.Clone().Where("age >= ?", 18)
	minors := base.Clone().Where("age < ?", 18)

	a, _, _ := adults.Build()
	m, _, _ := minors.Build()
	fmt.Println(a)
	fmt.Println(m)
}
```

</details>

**Discussion.** Three failure modes you must understand: (1) shared slice headers leak appends across clones; (2) shared map references leak writes across clones; (3) shared pointer-typed values (a `*http.Client`, a `*log.Logger`) usually *should* be shared — they're services, not data. Deciding which is which is the actual engineering work. As a rule: data is copied, services are aliased.

---

## Task 14: Stage-typed builder (compile-time order enforcement)

For domains where misordered steps are catastrophic — e.g., a cryptographic key derivation — use Go's type system to enforce the order.

```go
key, err := NewKey().
    WithAlgorithm("AES-256").    // returns *NeedSaltBuilder
    WithSalt(saltBytes).          // returns *NeedRoundsBuilder
    WithRounds(100000).           // returns *FinalBuilder
    Build()                       // returns *DerivedKey, error
```

**Acceptance criteria**

- [ ] Four builder types: `*InitialBuilder`, `*NeedSaltBuilder`, `*NeedRoundsBuilder`, `*FinalBuilder`.
- [ ] Each method advances to the next stage by returning a different type.
- [ ] Calling `WithSalt` directly on `*InitialBuilder` is a *compile error*, not a runtime error.
- [ ] `Build()` only exists on `*FinalBuilder`.
- [ ] No runtime `phase int` field — the types do the work.
- [ ] A test in a separate `_test.go` proves the chain works. A comment in the test points at code that *would not compile* if uncommented.

<details><summary>Hints</summary>

- Each stage carries the accumulated state forward. Don't use embedding; pass it through explicit struct copies (small enough that the copy is cheap).
- `Build()` produces the final value — at this point all fields are guaranteed to be set.

</details>

<details><summary>Solution</summary>

```go
package keys

import (
	"errors"
	"fmt"
)

type DerivedKey struct {
	Algorithm string
	Salt      []byte
	Rounds    int
	// (real implementation would hold derived bytes; omitted)
}

type InitialBuilder struct{}

func NewKey() *InitialBuilder { return &InitialBuilder{} }

func (b *InitialBuilder) WithAlgorithm(alg string) *NeedSaltBuilder {
	return &NeedSaltBuilder{alg: alg}
}

type NeedSaltBuilder struct {
	alg string
	err error
}

func (b *NeedSaltBuilder) WithSalt(s []byte) *NeedRoundsBuilder {
	if len(s) < 8 {
		return &NeedRoundsBuilder{err: errors.New("WithSalt: too short, need >= 8 bytes")}
	}
	cp := append([]byte(nil), s...)
	return &NeedRoundsBuilder{alg: b.alg, salt: cp}
}

type NeedRoundsBuilder struct {
	alg  string
	salt []byte
	err  error
}

func (b *NeedRoundsBuilder) WithRounds(n int) *FinalBuilder {
	if b.err != nil {
		return &FinalBuilder{err: b.err}
	}
	if n < 1000 {
		return &FinalBuilder{err: fmt.Errorf("WithRounds: too few %d", n)}
	}
	return &FinalBuilder{alg: b.alg, salt: b.salt, rounds: n}
}

type FinalBuilder struct {
	alg    string
	salt   []byte
	rounds int
	err    error
}

func (b *FinalBuilder) Build() (*DerivedKey, error) {
	if b.err != nil {
		return nil, b.err
	}
	return &DerivedKey{
		Algorithm: b.alg,
		Salt:      append([]byte(nil), b.salt...),
		Rounds:    b.rounds,
	}, nil
}
```

A demo test:

```go
package keys

import "testing"

func TestKey(t *testing.T) {
	k, err := NewKey().
		WithAlgorithm("AES-256").
		WithSalt([]byte("12345678")).
		WithRounds(100000).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	if k.Rounds != 100000 {
		t.Fatalf("rounds: %d", k.Rounds)
	}

	// The following would not compile — uncomment to verify:
	// NewKey().WithSalt([]byte("12345678")) // *InitialBuilder has no WithSalt method
}
```

</details>

**Discussion.** Three types per chain, each holding strictly more state than the last. Verbose? Yes. Worth it? For one-off use cases, no — use the deferred-error pattern. For library APIs where callers will rely on the compiler to catch order mistakes (cryptographic ceremonies, protocol handshakes, anything where misordering can corrupt data silently), absolutely yes. The Rust ecosystem ("typestate") leans on this heavily; Go developers generally prefer runtime checks because the type machinery is unergonomic for evolution (adding a step is a 4-file refactor).

---

## Task 15: Generic builder using type parameters

A reusable builder skeleton that any target type can plug into.

```go
type Server struct {
    Addr    string
    Timeout time.Duration
}

srv, err := NewBuilder[Server]().
    Set(func(s *Server) { s.Addr = ":8080" }).
    Set(func(s *Server) { s.Timeout = 5 * time.Second }).
    Build()
```

**Acceptance criteria**

- [ ] `type Builder[T any] struct { ... }`.
- [ ] `NewBuilder[T any]() *Builder[T]` returns an empty builder.
- [ ] `Set(func(*T)) *Builder[T]` accumulates apply-funcs.
- [ ] `Validate(func(T) error) *Builder[T]` accumulates validators run in `Build`.
- [ ] `Build() (*T, error)` zero-initialises `T`, applies each `Set` in order, then runs each `Validate`.
- [ ] If any validator returns an error, `Build` returns the first one.
- [ ] Demonstrate with two unrelated targets (e.g., `Server` and `Pizza`) in `main`.

<details><summary>Hints</summary>

- The generic builder is, structurally, functional options dressed up. It's most useful as a *framework piece* for code-generated builders.
- Keep `Set` and `Validate` clearly distinct in your mind — `Set` writes, `Validate` reads.

</details>

<details><summary>Solution</summary>

```go
package gbuild

import (
	"fmt"
)

type Builder[T any] struct {
	applies   []func(*T)
	validates []func(T) error
}

func NewBuilder[T any]() *Builder[T] { return &Builder[T]{} }

func (b *Builder[T]) Set(f func(*T)) *Builder[T] {
	if f != nil {
		b.applies = append(b.applies, f)
	}
	return b
}

func (b *Builder[T]) Validate(f func(T) error) *Builder[T] {
	if f != nil {
		b.validates = append(b.validates, f)
	}
	return b
}

func (b *Builder[T]) Build() (*T, error) {
	var t T
	for _, a := range b.applies {
		a(&t)
	}
	for i, v := range b.validates {
		if err := v(t); err != nil {
			return nil, fmt.Errorf("Build: validator %d: %w", i, err)
		}
	}
	return &t, nil
}
```

Usage in `main`:

```go
package main

import (
	"errors"
	"fmt"
	"time"

	"example.com/gbuild"
)

type Server struct {
	Addr    string
	Timeout time.Duration
}

type Pizza struct {
	Size string
}

func main() {
	srv, err := gbuild.NewBuilder[Server]().
		Set(func(s *Server) { s.Addr = ":8080" }).
		Set(func(s *Server) { s.Timeout = 5 * time.Second }).
		Validate(func(s Server) error {
			if s.Addr == "" {
				return errors.New("Addr required")
			}
			return nil
		}).
		Build()
	fmt.Printf("%+v err=%v\n", srv, err)

	pizza, err := gbuild.NewBuilder[Pizza]().
		Set(func(p *Pizza) { p.Size = "large" }).
		Build()
	fmt.Printf("%+v err=%v\n", pizza, err)
}
```

</details>

**Discussion.** Re-read `middle.md` §5 alongside this task. The generic builder is rarely the right end-user API — the `func(*T)` argument is awkward to read. It shines as *infrastructure* in libraries that auto-generate fluent builders from struct definitions (think: a code generator that scans a struct's fields and emits typed `WithFoo`, `WithBar` methods, with the generic builder handling the underlying mechanics). In application code, prefer one builder per target type with named methods.

---

## Task 16: Builder ↔ functional-options hybrid

A package that supports both a structured builder API *and* injectable functional options for advanced configuration.

```go
srv, err := NewServer().
    Addr(":8080").
    ReadTimeout(5*time.Second).
    With(
        WithMaxConns(1000),
        WithRateLimit(100),
        WithTracing(tracer),
    ).
    Build()
```

**Acceptance criteria**

- [ ] `*Builder` exposes named methods `Addr`, `ReadTimeout` for "core" configuration.
- [ ] `type Option func(*Builder)`.
- [ ] `With(opts ...Option) *Builder` applies each option to the builder.
- [ ] `WithMaxConns`, `WithRateLimit`, `WithTracing` are options for "advanced" knobs.
- [ ] Options skip nil values (`if opt == nil { continue }`).
- [ ] Build assembles a `*Server` whose fields are populated from both the core methods and the options.

<details><summary>Hints</summary>

- The trick is `With` returning `*Builder` so it chains.
- Options act on the *builder*, not the final `*Server`. The builder copies into `Server` at `Build()`.

</details>

<details><summary>Solution</summary>

```go
package server

import (
	"errors"
	"time"
)

type Tracer interface{ Trace(string) }

type Server struct {
	Addr        string
	ReadTimeout time.Duration
	MaxConns    int
	RateLimit   int
	Tracer      Tracer
}

type Builder struct {
	addr        string
	readTimeout time.Duration
	maxConns    int
	rateLimit   int
	tracer      Tracer
	err         error
}

func NewServer() *Builder { return &Builder{readTimeout: 30 * time.Second, maxConns: 100} }

func (b *Builder) Addr(s string) *Builder {
	if b.err != nil {
		return b
	}
	if s == "" {
		b.err = errors.New("Addr: empty")
		return b
	}
	b.addr = s
	return b
}

func (b *Builder) ReadTimeout(d time.Duration) *Builder {
	if b.err != nil {
		return b
	}
	b.readTimeout = d
	return b
}

type Option func(*Builder)

func (b *Builder) With(opts ...Option) *Builder {
	if b.err != nil {
		return b
	}
	for _, o := range opts {
		if o == nil {
			continue
		}
		o(b)
	}
	return b
}

func WithMaxConns(n int) Option   { return func(b *Builder) { b.maxConns = n } }
func WithRateLimit(n int) Option  { return func(b *Builder) { b.rateLimit = n } }
func WithTracing(t Tracer) Option { return func(b *Builder) { b.tracer = t } }

func (b *Builder) Build() (*Server, error) {
	if b.err != nil {
		return nil, b.err
	}
	if b.addr == "" {
		return nil, errors.New("Build: Addr required")
	}
	return &Server{
		Addr:        b.addr,
		ReadTimeout: b.readTimeout,
		MaxConns:    b.maxConns,
		RateLimit:   b.rateLimit,
		Tracer:      b.tracer,
	}, nil
}
```

</details>

**Discussion.** The hybrid splits configuration into two categories: *core* (named builder methods) and *advanced* (functional options). The line is policy, not technique — you decide which knobs are "first-class" enough to deserve a method. As the API evolves, you can add new options without breaking callers, and promote one to a method when it becomes core. This is how `database/sql.OpenDB`, `gorilla/mux`, and several other widely-used libraries handle the long tail of optional configuration.

---

## Task 17: Multi-terminal builder — `Build`, `Plan`, `Explain`

Extend the SQL `SELECT` builder from Task 2 with three terminals:

- `Build()` — returns SQL + args.
- `Plan()` — returns a human-readable description of what the query would do.
- `Explain(ctx, db)` — prepends `EXPLAIN` and returns the result of running it (without actually running the main query).

**Acceptance criteria**

- [ ] All three terminals are idempotent — calling `Build()` then `Plan()` then `Build()` returns the same thing as calling `Build()` once.
- [ ] None of the terminals mutate the builder's state.
- [ ] `Plan()` returns a struct with `Table string`, `Columns []string`, `Filters []string`, `Limit int`.
- [ ] `Explain(ctx, db)` returns the EXPLAIN output as `string`.
- [ ] Provide a mock `DB` interface so the test doesn't need a real database.
- [ ] A test calls all three terminals in different orders on the same builder and asserts consistent results.

<details><summary>Hints</summary>

- Factor a private helper `b.assemble() (sql string, args []any, plan Plan)` that computes everything. Each terminal calls it.
- The mock `DB` interface needs only `QueryContext(ctx, sql, args ...any) (Rows, error)`. Stub it with a fake.

</details>

<details><summary>Solution</summary>

```go
package query

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type Plan struct {
	Table   string
	Columns []string
	Filters []string
	Limit   int
}

type DB interface {
	QueryContext(ctx context.Context, sql string, args ...any) (Rows, error)
}

type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close() error
}

// reuse the builder from Task 2; add these methods:

func (b *Builder) assemble() (string, []any, Plan, error) {
	if b.err != nil {
		return "", nil, Plan{}, b.err
	}
	if b.table == "" {
		return "", nil, Plan{}, errors.New("assemble: From required")
	}
	var sb strings.Builder
	sb.WriteString("SELECT ")
	sb.WriteString(strings.Join(b.columns, ", "))
	sb.WriteString(" FROM ")
	sb.WriteString(b.table)
	if len(b.wheres) > 0 {
		sb.WriteString(" WHERE ")
		sb.WriteString(strings.Join(b.wheres, " AND "))
	}
	if b.orderBy != "" {
		sb.WriteString(" ORDER BY ")
		sb.WriteString(b.orderBy)
	}
	if b.limit > 0 {
		fmt.Fprintf(&sb, " LIMIT %d", b.limit)
	}
	plan := Plan{
		Table:   b.table,
		Columns: append([]string(nil), b.columns...),
		Filters: append([]string(nil), b.wheres...),
		Limit:   b.limit,
	}
	return sb.String(), append([]any(nil), b.args...), plan, nil
}

func (b *Builder) Plan() (Plan, error) {
	_, _, plan, err := b.assemble()
	return plan, err
}

func (b *Builder) Explain(ctx context.Context, db DB) (string, error) {
	sql, args, _, err := b.assemble()
	if err != nil {
		return "", err
	}
	rows, err := db.QueryContext(ctx, "EXPLAIN "+sql, args...)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var out strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return "", err
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	return out.String(), nil
}

// Build calls assemble like the other terminals.
func (b *Builder) BuildV2() (string, []any, error) {
	sql, args, _, err := b.assemble()
	return sql, args, err
}
```

</details>

**Discussion.** Idempotency is the rule that ties this together. Multi-terminal builders are tempting to write incrementally — "let me cache the assembled SQL the first time `assemble()` runs, since it's expensive" — and that's how you get bugs where `Plan()` returns one thing before `Build()` and another after. Keep the terminals pure: every call recomputes from the builder's fields. If profiling shows the cost matters, *then* add caching, but make it explicitly invariant to call order.

---

## Task 18: Refactoring a config struct into a builder

You inherit this code. Refactor it to use a builder without breaking existing callers.

```go
// Existing API:
type Config struct {
    Addr         string
    ReadTimeout  time.Duration
    WriteTimeout time.Duration
    MaxConns     int
    TLSCertFile  string
    TLSKeyFile   string
}

func NewServer(cfg Config) (*Server, error) {
    // existing logic...
}
```

**Acceptance criteria**

- [ ] Add a `*ServerBuilder` type and `NewServerBuilder() *ServerBuilder` constructor.
- [ ] Add chained methods for every `Config` field.
- [ ] Add `Build() (*Server, error)` that internally constructs a `Config` and calls `NewServer(cfg)`.
- [ ] Existing callers passing a `Config` directly to `NewServer` keep working unchanged.
- [ ] Add a deprecation note (`// Deprecated:`) on `NewServer(cfg Config)` pointing at the builder.
- [ ] Defaults that lived in `NewServer` move into `NewServerBuilder`.
- [ ] No behaviour change — the builder produces the same `*Server` for the same inputs.

<details><summary>Hints</summary>

- The builder is a *thin adapter* over the existing `NewServer(Config)`. Don't reimplement the logic.
- Defaults are subtle: if `NewServer(cfg)` previously filled in zero values, those defaults must now be in the builder.

</details>

<details><summary>Solution</summary>

```go
package server

import (
	"errors"
	"time"
)

type Config struct {
	Addr         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	MaxConns     int
	TLSCertFile  string
	TLSKeyFile   string
}

// Server itself, omitted; pretend NewServer exists.
type Server struct{ cfg Config }

// Deprecated: prefer NewServerBuilder for safer construction with defaults.
func NewServer(cfg Config) (*Server, error) {
	if cfg.Addr == "" {
		return nil, errors.New("NewServer: Addr required")
	}
	// fill defaults that the old API used to apply
	if cfg.ReadTimeout == 0 {
		cfg.ReadTimeout = 30 * time.Second
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 30 * time.Second
	}
	if cfg.MaxConns == 0 {
		cfg.MaxConns = 100
	}
	return &Server{cfg: cfg}, nil
}

type ServerBuilder struct {
	cfg Config
	err error
}

func NewServerBuilder() *ServerBuilder {
	return &ServerBuilder{cfg: Config{
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		MaxConns:     100,
	}}
}

func (b *ServerBuilder) Addr(s string) *ServerBuilder {
	if b.err != nil {
		return b
	}
	b.cfg.Addr = s
	return b
}

func (b *ServerBuilder) ReadTimeout(d time.Duration) *ServerBuilder {
	if b.err != nil {
		return b
	}
	b.cfg.ReadTimeout = d
	return b
}

func (b *ServerBuilder) WriteTimeout(d time.Duration) *ServerBuilder {
	if b.err != nil {
		return b
	}
	b.cfg.WriteTimeout = d
	return b
}

func (b *ServerBuilder) MaxConns(n int) *ServerBuilder {
	if b.err != nil {
		return b
	}
	b.cfg.MaxConns = n
	return b
}

func (b *ServerBuilder) TLS(certFile, keyFile string) *ServerBuilder {
	if b.err != nil {
		return b
	}
	b.cfg.TLSCertFile = certFile
	b.cfg.TLSKeyFile = keyFile
	return b
}

func (b *ServerBuilder) Build() (*Server, error) {
	if b.err != nil {
		return nil, b.err
	}
	return NewServer(b.cfg)
}
```

</details>

**Discussion.** Migration tasks are where you earn the right to refactor in real codebases. The rules: never break the old API in the same change you add the new one. Mark old APIs with `// Deprecated:` (vet picks it up). Let the new API call the old one internally where possible — duplication of logic is *worse* than duplication of surface. When the old API is gone in a future major version, you'll already have one battle-tested implementation behind both surfaces.

---

## Task 19: Mini-project — a small `httpserver` package

Build a small `httpserver` package whose entire public API is a fluent builder. The result wraps `net/http`'s server but adds: structured logging, graceful shutdown, route registration with middlewares, and TLS configuration.

```go
srv := httpserver.New().
    Addr(":8080").
    ReadTimeout(5 * time.Second).
    WriteTimeout(10 * time.Second).
    Route("GET", "/health", healthHandler).
    Route("POST", "/users", usersHandler).
    Middleware(loggingMiddleware).
    Middleware(authMiddleware).
    GracefulShutdown(15 * time.Second).
    Logger(slog.Default()).
    MustStart(ctx)
```

**Acceptance criteria**

- [ ] `httpserver.New() *Builder`.
- [ ] `Addr`, `ReadTimeout`, `WriteTimeout`, `Logger`, `GracefulShutdown` — each chainable.
- [ ] `Route(method, path string, h http.Handler)` registers a route. Multiple routes accumulate.
- [ ] `Middleware(func(http.Handler) http.Handler)` appends a middleware applied to all routes in registration order.
- [ ] `TLS(certFile, keyFile string)` switches to HTTPS.
- [ ] `Start(ctx) error` runs the server. When `ctx` is cancelled, gracefully shuts down within the configured timeout.
- [ ] `MustStart(ctx)` is a panic-on-error variant for `main` functions.
- [ ] A demo `main` shows a real chain producing a working server.

<details><summary>Hints</summary>

- Use `http.ServeMux` underneath; wrap routes with middlewares.
- Use `errgroup` or `select` over `ctx.Done()` and the server's error channel.
- `srv.Shutdown(shutdownCtx)` handles graceful termination.

</details>

<details><summary>Solution</summary>

```go
package httpserver

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

type Middleware func(http.Handler) http.Handler

type route struct {
	method, path string
	handler      http.Handler
}

type Builder struct {
	addr             string
	readTimeout      time.Duration
	writeTimeout     time.Duration
	shutdownTimeout  time.Duration
	tlsCert, tlsKey  string
	routes           []route
	middlewares      []Middleware
	logger           *slog.Logger
	err              error
}

func New() *Builder {
	return &Builder{
		addr:            ":8080",
		readTimeout:     30 * time.Second,
		writeTimeout:    30 * time.Second,
		shutdownTimeout: 5 * time.Second,
		logger:          slog.Default(),
	}
}

func (b *Builder) Addr(s string) *Builder {
	if b.err != nil {
		return b
	}
	if s == "" {
		b.err = errors.New("Addr: empty")
		return b
	}
	b.addr = s
	return b
}

func (b *Builder) ReadTimeout(d time.Duration) *Builder {
	if b.err != nil {
		return b
	}
	b.readTimeout = d
	return b
}

func (b *Builder) WriteTimeout(d time.Duration) *Builder {
	if b.err != nil {
		return b
	}
	b.writeTimeout = d
	return b
}

func (b *Builder) GracefulShutdown(d time.Duration) *Builder {
	if b.err != nil {
		return b
	}
	b.shutdownTimeout = d
	return b
}

func (b *Builder) Logger(l *slog.Logger) *Builder {
	if b.err != nil {
		return b
	}
	if l == nil {
		b.err = errors.New("Logger: nil")
		return b
	}
	b.logger = l
	return b
}

func (b *Builder) TLS(certFile, keyFile string) *Builder {
	if b.err != nil {
		return b
	}
	b.tlsCert = certFile
	b.tlsKey = keyFile
	return b
}

func (b *Builder) Route(method, path string, h http.Handler) *Builder {
	if b.err != nil {
		return b
	}
	b.routes = append(b.routes, route{method: method, path: path, handler: h})
	return b
}

func (b *Builder) Middleware(mw Middleware) *Builder {
	if b.err != nil {
		return b
	}
	if mw == nil {
		b.err = errors.New("Middleware: nil")
		return b
	}
	b.middlewares = append(b.middlewares, mw)
	return b
}

func (b *Builder) build() (*http.Server, error) {
	if b.err != nil {
		return nil, b.err
	}
	mux := http.NewServeMux()
	for _, rt := range b.routes {
		var h http.Handler = rt.handler
		for i := len(b.middlewares) - 1; i >= 0; i-- {
			h = b.middlewares[i](h)
		}
		method, path := rt.method, rt.path
		mux.Handle(path, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != method {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			h.ServeHTTP(w, r)
		}))
	}
	srv := &http.Server{
		Addr:         b.addr,
		Handler:      mux,
		ReadTimeout:  b.readTimeout,
		WriteTimeout: b.writeTimeout,
	}
	if b.tlsCert != "" && b.tlsKey != "" {
		srv.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return srv, nil
}

func (b *Builder) Start(ctx context.Context) error {
	srv, err := b.build()
	if err != nil {
		return err
	}
	errCh := make(chan error, 1)
	go func() {
		b.logger.Info("server starting", "addr", srv.Addr)
		if b.tlsCert != "" {
			errCh <- srv.ListenAndServeTLS(b.tlsCert, b.tlsKey)
		} else {
			errCh <- srv.ListenAndServe()
		}
	}()
	select {
	case <-ctx.Done():
		b.logger.Info("server shutting down")
		shutCtx, cancel := context.WithTimeout(context.Background(), b.shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutCtx); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (b *Builder) MustStart(ctx context.Context) {
	if err := b.Start(ctx); err != nil {
		panic(err)
	}
}
```

Demo `main`:

```go
package main

import (
	"context"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"example.com/httpserver"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	httpserver.New().
		Addr(":8080").
		ReadTimeout(5*time.Second).
		WriteTimeout(10*time.Second).
		GracefulShutdown(15*time.Second).
		Route("GET", "/health", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("OK"))
		})).
		Middleware(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next.ServeHTTP(w, r)
			})
		}).
		MustStart(ctx)
}
```

</details>

**Discussion.** This is the closest you get in a single file to a "real" library. Notice the trade-offs: `Start(ctx)` blocks; the caller controls the lifetime via the context; the builder accepts middlewares but applies them per-route (a common variation is to apply globally — both work). The pattern earns its complexity because the final API is *one chain* that does what would otherwise take 30 lines of `http.Server` setup. That's the test for whether your builder pulls its weight.

---

## Task 20: Fluent test-assertion builder

A `Expect(x)` library where assertions chain.

```go
Expect(t, user).
    IsNotNil().
    Field("Role").IsEqual("admin").
    Field("Email").Matches(`.*@example\.com`).
    Field("Age").IsBetween(18, 120).
    Done()
```

**Acceptance criteria**

- [ ] `Expect(t *testing.T, v any)` returns a `*Expectation`.
- [ ] `IsNotNil()` fails the test if `v` is nil.
- [ ] `Field(name string) *FieldExpectation` returns a child expectation focused on a struct field. Uses reflection.
- [ ] `FieldExpectation.IsEqual(want any)` fails the test on inequality.
- [ ] `FieldExpectation.Matches(pattern string)` works only for string fields.
- [ ] `FieldExpectation.IsBetween(lo, hi int)` works only for int fields.
- [ ] Each `FieldExpectation` method returns `*Expectation` so the chain returns to the top-level subject.
- [ ] `Done()` is a no-op terminal that signals the end — useful for IDEs and `gofmt`.
- [ ] Errors call `t.Errorf`, not `t.Fatalf` — multiple field failures are reported in one test.

<details><summary>Hints</summary>

- Use `reflect.ValueOf(v).Elem().FieldByName(name)` for struct field access. Handle the pointer-deref carefully.
- `Field` returns a wrapper type; its methods chain back to `*Expectation` so the top-level chain stays uniform.
- Don't try to be type-safe at compile time; this is a test helper — runtime errors are acceptable and informative.

</details>

<details><summary>Solution</summary>

```go
package expect

import (
	"fmt"
	"reflect"
	"regexp"
	"testing"
)

type Expectation struct {
	t *testing.T
	v any
}

func Expect(t *testing.T, v any) *Expectation {
	t.Helper()
	return &Expectation{t: t, v: v}
}

func (e *Expectation) IsNotNil() *Expectation {
	e.t.Helper()
	if e.v == nil {
		e.t.Errorf("Expect: value is nil")
		return e
	}
	rv := reflect.ValueOf(e.v)
	if rv.Kind() == reflect.Pointer && rv.IsNil() {
		e.t.Errorf("Expect: value is nil pointer")
	}
	return e
}

type FieldExpectation struct {
	parent *Expectation
	name   string
	val    reflect.Value
	ok     bool
}

func (e *Expectation) Field(name string) *FieldExpectation {
	e.t.Helper()
	rv := reflect.ValueOf(e.v)
	for rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			e.t.Errorf("Field(%q): nil pointer", name)
			return &FieldExpectation{parent: e, name: name}
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		e.t.Errorf("Field(%q): not a struct", name)
		return &FieldExpectation{parent: e, name: name}
	}
	f := rv.FieldByName(name)
	if !f.IsValid() {
		e.t.Errorf("Field(%q): no such field", name)
		return &FieldExpectation{parent: e, name: name}
	}
	return &FieldExpectation{parent: e, name: name, val: f, ok: true}
}

func (f *FieldExpectation) IsEqual(want any) *Expectation {
	f.parent.t.Helper()
	if !f.ok {
		return f.parent
	}
	got := f.val.Interface()
	if !reflect.DeepEqual(got, want) {
		f.parent.t.Errorf("Field(%q): got %v want %v", f.name, got, want)
	}
	return f.parent
}

func (f *FieldExpectation) Matches(pattern string) *Expectation {
	f.parent.t.Helper()
	if !f.ok {
		return f.parent
	}
	if f.val.Kind() != reflect.String {
		f.parent.t.Errorf("Field(%q).Matches: not a string", f.name)
		return f.parent
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		f.parent.t.Errorf("Field(%q).Matches: bad pattern %v", f.name, err)
		return f.parent
	}
	if !re.MatchString(f.val.String()) {
		f.parent.t.Errorf("Field(%q).Matches: %q does not match %q", f.name, f.val.String(), pattern)
	}
	return f.parent
}

func (f *FieldExpectation) IsBetween(lo, hi int) *Expectation {
	f.parent.t.Helper()
	if !f.ok {
		return f.parent
	}
	switch f.val.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		n := int(f.val.Int())
		if n < lo || n > hi {
			f.parent.t.Errorf("Field(%q).IsBetween: %d not in [%d,%d]", f.name, n, lo, hi)
		}
	default:
		f.parent.t.Errorf("Field(%q).IsBetween: %s, not int", f.name, f.val.Kind())
	}
	return f.parent
}

func (e *Expectation) Done() {
	// no-op terminal — for IDE-clarity and gofmt-friendly chains.
	_ = fmt.Sprint(e)
}
```

</details>

**Discussion.** Two patterns worth absorbing. First, the *focus shift* via `Field(name)`: the chain pivots from "the object" to "this one field" and back again. The return type swap (`*Expectation → *FieldExpectation → *Expectation`) is the trick — it lets `gofmt` line everything up. Second, `Done()` is a no-op. It exists purely so the chain has a clear end, which matters for chains that span 10+ lines (IDE folding, code review skimming). Most production assertion libraries (testify, gomega) don't bother; they treat the last method call as the implicit end. Whether to add `Done()` is purely stylistic.

---

## Where to go from here

You've built twenty builders covering the core variants:

- pointer-receiver mutating (Tasks 1–5)
- nested object-graph builders (Tasks 6–7)
- domain adapters around awkward APIs (Tasks 8–9)
- DSL-style (Task 10)
- side-effecting terminals (Task 11)
- accumulation-of-errors validators (Task 12)
- clone-and-fork (Task 13)
- stage-typed (Task 14)
- generic (Task 15)
- hybrid with functional options (Task 16)
- multi-terminal (Task 17)
- migration into existing APIs (Task 18)
- mini-libraries (Tasks 19–20)

Read [middle.md §17 cheat sheet](middle.md#17-cheat-sheet) again — every row corresponds to one of these tasks. The pattern is small but the choice space is large; the only reliable way to internalise it is to have written, and thrown away, builders for many domains.

Next: **senior.md** covers the architectural questions — versioning a builder API across major releases, builders in code-generated SDKs (`protobuf-go`, gRPC), and the trade-offs that surface only after a builder lives in a public library for two years.

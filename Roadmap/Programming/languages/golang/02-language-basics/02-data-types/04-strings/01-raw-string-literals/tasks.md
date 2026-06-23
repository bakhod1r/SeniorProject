# Raw String Literals in Go — Tasks

## Task 1: Regex Validator Library

Convert a set of validation functions from interpreted strings to raw strings, then extend them.

**Requirements:**
- Rewrite all regex patterns using raw string literals
- Add 3 new validators: IPv4 address, semantic version, UUID
- Compile all patterns at package level (not inside functions)
- Write tests for each validator

**Starter Code:**
```go
package validate

import "regexp"

// TODO: Convert these to raw string literals
var (
    emailRe  = regexp.MustCompile("^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$")
    phoneRe  = regexp.MustCompile("^\\+?[1-9]\\d{7,14}$")
    zipRe    = regexp.MustCompile("^\\d{5}(-\\d{4})?$")
    slugRe   = regexp.MustCompile("^[a-z0-9]+(?:-[a-z0-9]+)*$")
    // TODO: Add ipv4Re, semverRe, uuidRe
)

func IsEmail(s string) bool { return emailRe.MatchString(s) }
func IsPhone(s string) bool { return phoneRe.MatchString(s) }
func IsZip(s string) bool   { return zipRe.MatchString(s) }
func IsSlug(s string) bool  { return slugRe.MatchString(s) }
// TODO: Add IsIPv4, IsSemVer, IsUUID
```

---

## Task 2: SQL Query Repository

Build a query repository for a user management system using raw string constants.

**Requirements:**
- All SQL queries as raw string constants in a `queries` package
- Queries for: get by ID, list all, create, update, soft-delete, search by name
- Include proper PostgreSQL placeholders (`$1`, `$2`, etc.)
- Each query should be readable and properly formatted
- Write a `UserRepository` struct that uses these constants

**Starter Code:**
```go
// queries/user_queries.go
package queries

// TODO: Define all SQL queries as raw string constants
// Hint: Multi-line queries should look like actual SQL
const (
    // GetUserByID retrieves a single user by primary key
    GetUserByID = "" // TODO: write proper SQL

    // ListUsers returns all active users, paginated
    ListUsers = "" // TODO: write proper SQL

    // CreateUser inserts a new user
    CreateUser = "" // TODO: write proper SQL

    // UpdateUser updates mutable fields
    UpdateUser = "" // TODO: write proper SQL

    // SoftDeleteUser sets deleted_at to now
    SoftDeleteUser = "" // TODO: write proper SQL

    // SearchUsersByName finds users by partial name match
    SearchUsersByName = "" // TODO: write proper SQL with ILIKE
)

// repository.go
package repository

type User struct {
    ID        int64
    Name      string
    Email     string
    CreatedAt time.Time
    DeletedAt *time.Time
}

type UserRepository struct {
    // TODO: implement using query constants
}
```

---

## Task 3: Multi-line Template Engine

Build a simple template engine that works with raw string templates.

**Requirements:**
- Template uses `{{key}}` placeholders
- Accept a raw string as the template
- Replace placeholders with values from a `map[string]string`
- Handle missing keys gracefully (keep placeholder unchanged)
- Handle a `Dedent` function to strip common leading whitespace

**Starter Code:**
```go
package template

import "strings"

// Dedent removes common leading whitespace
func Dedent(s string) string {
    // TODO: implement
    return s
}

// Render replaces {{key}} placeholders with values from vars
func Render(tmpl string, vars map[string]string) string {
    // TODO: implement
    return tmpl
}

// Example usage:
/*
const emailTemplate = `
    Dear {{name}},

    Your order {{order_id}} has shipped!
    Tracking: {{tracking}}

    Thanks,
    The Team
`

func main() {
    result := template.Render(template.Dedent(emailTemplate), map[string]string{
        "name":     "Alice",
        "order_id": "ORD-123",
        "tracking": "1Z9999W9999",
    })
    fmt.Println(result)
}
*/
```

---

## Task 4: Config File Embedder

Create a program that embeds default configuration as a raw string and merges it with user configuration.

**Requirements:**
- Default config embedded as a raw string constant
- Parse TOML-like format: `key = value` per line, `#` for comments
- User config overrides defaults
- Return merged configuration as `map[string]string`
- Handle multi-word values (value after `=` can contain spaces)

**Starter Code:**
```go
package config

import "strings"

// defaultConfig is the built-in default configuration
const defaultConfig = `
# Server configuration
host = localhost
port = 8080
timeout = 30

# Database configuration
db_host = localhost
db_port = 5432
db_name = myapp
db_pool_size = 10

# Logging
log_level = info
log_format = json
`

func parseConfig(raw string) map[string]string {
    // TODO: parse key = value format
    // Ignore lines starting with # or empty lines
    // Trim whitespace from keys and values
    result := make(map[string]string)
    _ = strings.TrimSpace // hint
    return result
}

func MergeConfig(userConfig string) map[string]string {
    // TODO: parse defaultConfig, then override with userConfig
    return nil
}
```

---

## Task 5: Log Pattern Matcher

Build a log analyzer that uses raw string patterns to classify log lines.

**Requirements:**
- Define patterns as raw string regex constants
- Match each log line against patterns
- Return the type of log entry and extracted fields
- Handle common formats: nginx access logs, Go error logs, syslog

**Starter Code:**
```go
package logparser

import "regexp"

// TODO: Define these patterns as raw string literals
// Nginx: 127.0.0.1 - - [10/Jan/2024:10:30:45 +0000] "GET /path HTTP/1.1" 200 1234
// Go error: 2024/01/10 10:30:45 some error message
// Syslog: Jan 10 10:30:45 hostname processname[1234]: message

var (
    nginxLogRe  *regexp.Regexp // TODO
    goErrorRe   *regexp.Regexp // TODO
    syslogRe    *regexp.Regexp // TODO
)

type LogEntry struct {
    Type      string // "nginx", "go", "syslog", "unknown"
    Timestamp string
    Level     string
    Message   string
    Extra     map[string]string
}

func ParseLine(line string) LogEntry {
    // TODO: match against each pattern and extract fields
    return LogEntry{Type: "unknown"}
}
```

---

## Task 6: HTML Generator with Raw String Templates

Build an HTML generator that uses raw string templates for structure.

**Requirements:**
- Use raw strings for HTML structure templates
- Functions for: page, table, form, navbar
- `html.EscapeString` all user-provided content to prevent XSS
- Compose templates together

**Starter Code:**
```go
package htmlgen

import (
    "html"
    "strings"
    "fmt"
)

// TODO: Define templates as raw string constants

const pageTemplate = "" // TODO: Full HTML page template with {{title}}, {{body}}
const tableTemplate = "" // TODO: HTML table template
const formTemplate = "" // TODO: HTML form template

type TableData struct {
    Headers []string
    Rows    [][]string
}

func Page(title, body string) string {
    // TODO: combine templates, escape user content
    return ""
}

func Table(data TableData) string {
    // TODO: generate HTML table from data
    // IMPORTANT: escape all cell content!
    var sb strings.Builder
    _ = html.EscapeString // hint: must use this!
    _ = fmt.Sprintf
    return sb.String()
}
```

---

## Task 7: Regex-Based Data Extractor

Build a data extraction pipeline using raw string regex patterns to parse structured text.

**Requirements:**
- Extract data from semi-structured text using named capture groups in raw string patterns
- Handle: email addresses, phone numbers, URLs, dates, amounts (currency)
- Return all found instances of each type as a structured result
- Use `regexp.FindAllStringSubmatch` for extraction

**Starter Code:**
```go
package extract

import "regexp"

// TODO: Define all extraction patterns as raw string constants
// Hint: Use named capture groups: (?P<name>pattern)
var (
    emailExtract *regexp.Regexp
    phoneExtract *regexp.Regexp
    urlExtract   *regexp.Regexp
    dateExtract  *regexp.Regexp
    amountExtract *regexp.Regexp
)

type Extraction struct {
    Emails  []string
    Phones  []string
    URLs    []string
    Dates   []string
    Amounts []string
}

func Extract(text string) Extraction {
    // TODO: apply each regex to text and collect results
    return Extraction{}
}

func main() {
    text := `
    Contact us at support@example.com or call +1-800-555-0123.
    Visit https://www.example.com/docs for more info.
    Order date: 2024-01-15, amount: $125.99
    Also try john.doe@company.co.uk or (555) 987-6543.
    `
    result := Extract(text)
    // Should find: 2 emails, 2 phones, 1 URL, 1 date, 1 amount
    _ = result
}
```

---

## Task 8: Kubernetes Manifest Generator

Create a Go program that generates Kubernetes YAML manifests using raw string templates.

**Requirements:**
- Templates for: Deployment, Service, ConfigMap, Ingress
- All templates as raw string constants
- Fill in values using `fmt.Sprintf` or `text/template`
- Validate output is valid YAML (use a YAML parser)

**Starter Code:**
```go
package k8s

import (
    "fmt"
    "text/template"
    "strings"
)

// TODO: Write these as properly formatted raw string YAML templates
const deploymentTemplate = `` // multiline YAML template

const serviceTemplate = `` // multiline YAML template

type DeploymentSpec struct {
    Name      string
    Namespace string
    Image     string
    Replicas  int
    Port      int
    Labels    map[string]string
}

func GenerateDeployment(spec DeploymentSpec) (string, error) {
    // TODO: render the template with spec values
    tmpl, err := template.New("deployment").Parse(deploymentTemplate)
    if err != nil {
        return "", fmt.Errorf("parsing template: %w", err)
    }
    var b strings.Builder
    if err := tmpl.Execute(&b, spec); err != nil {
        return "", fmt.Errorf("executing template: %w", err)
    }
    return b.String(), nil
}
```

---

## Task 9: Dedent and Text Processing Utilities

Implement a text processing library for raw string template utilities.

**Requirements:**
- `Dedent(s string) string` — remove common leading whitespace
- `TrimBlankLines(s string) string` — remove leading/trailing blank lines
- `Indent(s, prefix string) string` — add prefix to every line
- `WrapWidth(s string, width int) string` — wrap long lines at word boundaries
- All functions handle edge cases gracefully (empty input, all-blank input)

**Starter Code:**
```go
package textutil

import (
    "strings"
    "unicode"
)

func Dedent(s string) string {
    // TODO: remove common leading whitespace from all non-empty lines
    // Step 1: Split into lines
    // Step 2: Find minimum indentation (skip empty/blank lines)
    // Step 3: Remove that many characters from the start of each line
    _ = unicode.IsSpace // hint
    return s
}

func TrimBlankLines(s string) string {
    // TODO: remove leading and trailing blank/empty lines
    return s
}

func Indent(s, prefix string) string {
    // TODO: add prefix to every line
    return s
}

func WrapWidth(s string, width int) string {
    // TODO: wrap text at word boundaries
    // Don't break URLs or words that are longer than width
    _ = strings.Fields // hint
    return s
}

// Example test:
/*
s := `
    Hello,
    World!

    This is some text.
`
fmt.Println(Dedent(s))
// Expected: "\nHello,\nWorld!\n\nThis is some text.\n"
// (common 4-space indent removed)
*/
```

---

## Task 10: Embedded Help System

Build a CLI help system where all help text is stored as raw string constants.

**Requirements:**
- Help text for 5 commands, each as a raw string constant
- Support `--help` flag to show command help
- Support `help <command>` sub-command
- Format help text with consistent layout: usage, description, options, examples

**Starter Code:**
```go
package main

import (
    "fmt"
    "os"
    "strings"
)

// TODO: Define help text for each command as raw string constants
// Format: USAGE line, blank line, DESCRIPTION, blank line, OPTIONS, blank line, EXAMPLES

const helpStart = `` // TODO: main program help

const helpServe = `` // TODO: 'serve' command help

const helpDeploy = `` // TODO: 'deploy' command help

const helpList = `` // TODO: 'list' command help

const helpConfig = `` // TODO: 'config' command help

var commandHelp = map[string]string{
    "serve":  helpServe,
    "deploy": helpDeploy,
    "list":   helpList,
    "config": helpConfig,
}

func showHelp(command string) {
    // TODO: display help for the given command or the main help
    _ = strings.TrimSpace // hint: clean up raw string formatting
}

func main() {
    args := os.Args[1:]
    if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
        showHelp("")
        return
    }
    if args[0] == "help" && len(args) > 1 {
        showHelp(args[1])
        return
    }
    fmt.Printf("Running command: %v\n", args)
}
```

---

## Task 11: OpenAPI Spec Validator

Build a tool that validates OpenAPI spec fragments stored as raw string constants in tests.

**Requirements:**
- Store OpenAPI path definitions as raw string constants
- Parse JSON and validate required fields: `summary`, `operationId`, HTTP method
- Check that all `$ref` references are defined
- Report validation errors with line numbers

**Starter Code:**
```go
package openapi

import (
    "encoding/json"
    "fmt"
    "strings"
)

// Example OpenAPI path spec as a raw string constant
const userPathSpec = `{
    "get": {
        "summary": "Get user by ID",
        "operationId": "getUserById",
        "parameters": [
            {
                "name": "id",
                "in": "path",
                "required": true,
                "schema": {"type": "integer"}
            }
        ],
        "responses": {
            "200": {
                "description": "User found",
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/User"}
                    }
                }
            }
        }
    }
}`

type ValidationError struct {
    Field   string
    Message string
}

func ValidatePathSpec(spec string) []ValidationError {
    // TODO: parse JSON and validate required fields
    var raw map[string]interface{}
    if err := json.Unmarshal([]byte(spec), &raw); err != nil {
        return []ValidationError{{Field: "json", Message: fmt.Sprintf("invalid JSON: %v", err)}}
    }
    // TODO: validate structure
    _ = strings.Contains // hint
    return nil
}
```

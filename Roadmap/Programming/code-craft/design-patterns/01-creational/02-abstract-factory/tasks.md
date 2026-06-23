# Abstract Factory — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/abstract-factory](https://refactoring.guru/design-patterns/abstract-factory)

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: Cross-Platform UI Toolkit](#task-1-cross-platform-ui-toolkit)
2. [Task 2: Theme Engine (Light/Dark)](#task-2-theme-engine-lightdark)
3. [Task 3: Cloud Provider Abstraction](#task-3-cloud-provider-abstraction)
4. [Task 4: Database Dialect Family](#task-4-database-dialect-family)
5. [Task 5: Cipher Suite Factory](#task-5-cipher-suite-factory)
6. [Task 6: Game Asset Theme](#task-6-game-asset-theme)
7. [Task 7: Notification Family (Email + SMS + Push)](#task-7-notification-family-email-sms-push)
8. [Task 8: Test-Friendly In-Memory Variant](#task-8-test-friendly-in-memory-variant)
9. [Task 9: Sub-Factory Composition](#task-9-sub-factory-composition)
10. [Task 10: Hot-Swap Variant at Runtime](#task-10-hot-swap-variant-at-runtime)

---

## Task 1: Cross-Platform UI Toolkit

### Statement

Implement `GuiFactory` with `Button` and `Checkbox` products. Provide `WindowsFactory` and `MacFactory`. Application picks one factory at startup based on env var.

### Java

```java
interface Button   { String render(); }
interface Checkbox { String render(); }

class WinButton    implements Button   { public String render() { return "[Win]";    } }
class WinCheckbox  implements Checkbox { public String render() { return "[Win] [ ]"; } }
class MacButton    implements Button   { public String render() { return "(Mac)";    } }
class MacCheckbox  implements Checkbox { public String render() { return "(Mac) [ ]"; } }

interface GuiFactory {
    Button   createButton();
    Checkbox createCheckbox();
}

class WinFactory implements GuiFactory {
    public Button   createButton()   { return new WinButton(); }
    public Checkbox createCheckbox() { return new WinCheckbox(); }
}

class MacFactory implements GuiFactory {
    public Button   createButton()   { return new MacButton(); }
    public Checkbox createCheckbox() { return new MacCheckbox(); }
}

public class App {
    public static void main(String[] args) {
        GuiFactory f = "win".equals(System.getenv("OS")) ? new WinFactory() : new MacFactory();
        System.out.println(f.createButton().render());
        System.out.println(f.createCheckbox().render());
    }
}
```

### Python

```python
from abc import ABC, abstractmethod

class Button(ABC):
    @abstractmethod
    def render(self) -> str: ...

class Checkbox(ABC):
    @abstractmethod
    def render(self) -> str: ...

class WinButton(Button):
    def render(self): return "[Win]"

class MacButton(Button):
    def render(self): return "(Mac)"

class WinCheckbox(Checkbox):
    def render(self): return "[Win] [ ]"

class MacCheckbox(Checkbox):
    def render(self): return "(Mac) [ ]"

class GuiFactory(ABC):
    @abstractmethod
    def make_button(self) -> Button: ...
    @abstractmethod
    def make_checkbox(self) -> Checkbox: ...

class WinFactory(GuiFactory):
    def make_button(self): return WinButton()
    def make_checkbox(self): return WinCheckbox()

class MacFactory(GuiFactory):
    def make_button(self): return MacButton()
    def make_checkbox(self): return MacCheckbox()
```

### Go

```go
package gui

type Button   interface{ Render() string }
type Checkbox interface{ Render() string }

type winButton struct{};   func (winButton) Render() string   { return "[Win]" }
type winCheckbox struct{}; func (winCheckbox) Render() string { return "[Win] [ ]" }
type macButton struct{};   func (macButton) Render() string   { return "(Mac)" }
type macCheckbox struct{}; func (macCheckbox) Render() string { return "(Mac) [ ]" }

type GuiFactory interface {
    CreateButton()   Button
    CreateCheckbox() Checkbox
}

type WinFactory struct{}
func (WinFactory) CreateButton()   Button   { return winButton{} }
func (WinFactory) CreateCheckbox() Checkbox { return winCheckbox{} }

type MacFactory struct{}
func (MacFactory) CreateButton()   Button   { return macButton{} }
func (MacFactory) CreateCheckbox() Checkbox { return macCheckbox{} }

func New(os string) GuiFactory {
    if os == "win" { return WinFactory{} }
    return MacFactory{}
}
```

---

## Task 2: Theme Engine (Light/Dark)

### Statement

`ThemeFactory` produces `Header`, `Body`, `Footer` widgets matching the theme.

### Java

```java
interface Widget { String render(); }
interface Header extends Widget {}
interface Body   extends Widget {}
interface Footer extends Widget {}

class LightHeader implements Header { public String render() { return "<header light>"; } }
class LightBody   implements Body   { public String render() { return "<body light>";   } }
class LightFooter implements Footer { public String render() { return "<footer light>"; } }

class DarkHeader  implements Header { public String render() { return "<header dark>";  } }
class DarkBody    implements Body   { public String render() { return "<body dark>";    } }
class DarkFooter  implements Footer { public String render() { return "<footer dark>";  } }

interface ThemeFactory {
    Header header();
    Body   body();
    Footer footer();
}

class LightTheme implements ThemeFactory {
    public Header header() { return new LightHeader(); }
    public Body   body()   { return new LightBody();   }
    public Footer footer() { return new LightFooter(); }
}

class DarkTheme implements ThemeFactory {
    public Header header() { return new DarkHeader(); }
    public Body   body()   { return new DarkBody();   }
    public Footer footer() { return new DarkFooter(); }
}
```

### Python (with decorator registry)

```python
from abc import ABC, abstractmethod
from typing import Type

class Header(ABC):
    @abstractmethod
    def render(self) -> str: ...
class Body(ABC):
    @abstractmethod
    def render(self) -> str: ...
class Footer(ABC):
    @abstractmethod
    def render(self) -> str: ...

# concrete products elided for brevity
class LightHeader(Header): def render(self): return "<header light>"

class ThemeFactory(ABC):
    @abstractmethod
    def header(self) -> Header: ...
    @abstractmethod
    def body(self) -> Body: ...
    @abstractmethod
    def footer(self) -> Footer: ...

_REG: dict[str, Type[ThemeFactory]] = {}

def theme(name: str):
    def deco(cls):
        _REG[name] = cls
        return cls
    return deco

@theme("light")
class LightTheme(ThemeFactory):
    def header(self): return LightHeader()
    def body(self):   return LightBody()
    def footer(self): return LightFooter()

@theme("dark")
class DarkTheme(ThemeFactory):
    def header(self): return DarkHeader()
    def body(self):   return DarkBody()
    def footer(self): return DarkFooter()

def get_theme(name: str) -> ThemeFactory:
    return _REG[name]()
```

### Go

```go
type Header interface{ Render() string }
type Body   interface{ Render() string }
type Footer interface{ Render() string }

type ThemeFactory interface {
    Header() Header
    Body()   Body
    Footer() Footer
}

type lightTheme struct{}
func (lightTheme) Header() Header { return lightHeader{} }
func (lightTheme) Body()   Body   { return lightBody{} }
func (lightTheme) Footer() Footer { return lightFooter{} }

type darkTheme struct{}
func (darkTheme) Header() Header { return darkHeader{} }
func (darkTheme) Body()   Body   { return darkBody{} }
func (darkTheme) Footer() Footer { return darkFooter{} }

func New(name string) ThemeFactory {
    if name == "dark" { return darkTheme{} }
    return lightTheme{}
}
```

---

## Task 3: Cloud Provider Abstraction

### Statement

`CloudFactory` produces `Storage` and `Queue` for AWS or GCP.

### Java

```java
interface Storage { void put(String key, byte[] data); }
interface Queue   { void send(byte[] msg); }

class S3Storage  implements Storage { public void put(String k, byte[] d) { /* AWS SDK */ } }
class GcsStorage implements Storage { public void put(String k, byte[] d) { /* GCP SDK */ } }

class SqsQueue   implements Queue { public void send(byte[] m) { /* SQS */ } }
class PubSubQueue implements Queue { public void send(byte[] m) { /* PubSub */ } }

interface CloudFactory {
    Storage storage(String bucket);
    Queue   queue(String topic);
}

class AwsFactory implements CloudFactory {
    public Storage storage(String b) { return new S3Storage(); }
    public Queue   queue(String t)   { return new SqsQueue(); }
}

class GcpFactory implements CloudFactory {
    public Storage storage(String b) { return new GcsStorage(); }
    public Queue   queue(String t)   { return new PubSubQueue(); }
}
```

### Python, Go: analogous structure (omitted for brevity).

---

## Task 4: Database Dialect Family

### Statement

`DialectFactory` produces `Connection`, `Query`, `Transaction` for Postgres/MySQL/SQLite.

### Java

```java
interface Connection { void close(); }
interface Query      { void execute(); }
interface Transaction { void commit(); void rollback(); }

interface DialectFactory {
    Connection  connect(String dsn);
    Query       query(Connection c, String sql);
    Transaction begin(Connection c);
}

class PostgresDialect implements DialectFactory {
    public Connection  connect(String d)  { return new PgConnection(d); }
    public Query       query(Connection c, String s) { return new PgQuery((PgConnection) c, s); }
    public Transaction begin(Connection c) { return new PgTransaction((PgConnection) c); }
}

class SqliteDialect implements DialectFactory {
    public Connection  connect(String d)  { return new SqliteConnection(d); }
    public Query       query(Connection c, String s) { return new SqliteQuery((SqliteConnection) c, s); }
    public Transaction begin(Connection c) { return new SqliteTransaction((SqliteConnection) c); }
}
```

Note the casts inside concrete factories — this is unavoidable when products cross-reference. Tests should verify each factory produces a consistent family.

---

## Task 5: Cipher Suite Factory

### Go

```go
type Hasher interface{ Sum([]byte) []byte }
type Cipher interface{ Encrypt([]byte, []byte) []byte }

type Suite interface {
    Hasher() Hasher
    Cipher() Cipher
}

type sha256Suite struct{}
func (sha256Suite) Hasher() Hasher { return sha256H{} }
func (sha256Suite) Cipher() Cipher { return aesC{} }

type fipsSuite struct{}
func (fipsSuite) Hasher() Hasher { return fipsSHA256H{} }
func (fipsSuite) Cipher() Cipher { return fipsAESC{} }

func New(mode string) Suite {
    if mode == "fips" { return fipsSuite{} }
    return sha256Suite{}
}
```

---

## Task 6: Game Asset Theme

### Python

```python
class Tree(ABC):
    @abstractmethod
    def sprite(self) -> str: ...
class Rock(ABC):
    @abstractmethod
    def sprite(self) -> str: ...
class Enemy(ABC):
    @abstractmethod
    def hp(self) -> int: ...

class PineTree(Tree): def sprite(self): return "🌲"
class Cactus(Tree):   def sprite(self): return "🌵"
class MossyRock(Rock):    def sprite(self): return "🪨"
class SandstoneRock(Rock): def sprite(self): return "⛰️"
class Wolf(Enemy):     def hp(self): return 30
class Scorpion(Enemy): def hp(self): return 15

class LevelTheme(ABC):
    @abstractmethod
    def make_tree(self) -> Tree: ...
    @abstractmethod
    def make_rock(self) -> Rock: ...
    @abstractmethod
    def make_enemy(self) -> Enemy: ...

class ForestTheme(LevelTheme):
    def make_tree(self):  return PineTree()
    def make_rock(self):  return MossyRock()
    def make_enemy(self): return Wolf()

class DesertTheme(LevelTheme):
    def make_tree(self):  return Cactus()
    def make_rock(self):  return SandstoneRock()
    def make_enemy(self): return Scorpion()
```

---

## Task 7: Notification Family (Email + SMS + Push)

### Java

```java
interface Notifier { void send(String to, String msg); }
interface Renderer { String render(String template, Object data); }
interface Tracker  { void track(String event, String to); }

interface NotifChannel {
    Notifier notifier();
    Renderer renderer();
    Tracker  tracker();
}

class EmailChannel implements NotifChannel {
    public Notifier notifier() { return new SmtpNotifier(); }
    public Renderer renderer() { return new HtmlRenderer(); }
    public Tracker  tracker()  { return new SmtpTracker(); }
}

class SmsChannel implements NotifChannel {
    public Notifier notifier() { return new TwilioNotifier(); }
    public Renderer renderer() { return new TextRenderer(); }
    public Tracker  tracker()  { return new SmsTracker(); }
}

class PushChannel implements NotifChannel {
    public Notifier notifier() { return new FcmNotifier(); }
    public Renderer renderer() { return new JsonRenderer(); }
    public Tracker  tracker()  { return new PushTracker(); }
}
```

---

## Task 8: Test-Friendly In-Memory Variant

### Statement

Provide an `InMemoryCloudFactory` for tests so the suite runs without AWS credentials.

### Go

```go
type memStorage struct {
    name string
    data map[string][]byte
    mu   sync.Mutex
}
func (s *memStorage) Put(_ context.Context, k string, v []byte) error {
    s.mu.Lock(); defer s.mu.Unlock()
    s.data[k] = v
    return nil
}
func (s *memStorage) Get(_ context.Context, k string) ([]byte, error) {
    s.mu.Lock(); defer s.mu.Unlock()
    return s.data[k], nil
}

type memQueue struct {
    name string
    ch   chan []byte
}
func (q *memQueue) Send(_ context.Context, m []byte) error    { q.ch <- m; return nil }
func (q *memQueue) Receive(_ context.Context) ([]byte, error) { return <-q.ch, nil }

type local struct{}
func (local) Storage(n string) Storage { return &memStorage{name: n, data: map[string][]byte{}} }
func (local) Queue(n string)   Queue   { return &memQueue{name: n, ch: make(chan []byte, 100)} }

func NewLocal() Provider { return local{} }
```

In tests:

```go
func TestProcessOrder(t *testing.T) {
    p := cloud.NewLocal()
    err := ProcessOrder(p, "ord-1")
    if err != nil { t.Fatal(err) }
}
```

---

## Task 9: Sub-Factory Composition

### Statement

A `CloudFactory` has grown to 8 methods. Split into `StorageFactory` (3 methods) + `QueueFactory` (2) + `ComputeFactory` (3). The original `CloudFactory` returns sub-factories.

### Java

```java
interface StorageFactory {
    BlobStore blob(String name);
    KvStore   kv(String namespace);
    StreamLog log(String topic);
}

interface QueueFactory {
    StandardQueue standard(String name);
    FifoQueue     fifo(String name);
}

interface ComputeFactory {
    VM       vm(String region);
    Function fn(String name);
    Container container(String image);
}

interface CloudFactory {
    StorageFactory storage();
    QueueFactory   queue();
    ComputeFactory compute();
}

class AwsCloudFactory implements CloudFactory {
    public StorageFactory storage() { return new AwsStorageFactory(); }
    public QueueFactory   queue()   { return new AwsQueueFactory(); }
    public ComputeFactory compute() { return new AwsComputeFactory(); }
}
```

This is **Abstract Factory of Abstract Factories** — a hierarchy of families.

---

## Task 10: Hot-Swap Variant at Runtime

### Java

```java
public class ThemeManager {
    private final AtomicReference<GuiFactory> current;

    public ThemeManager(GuiFactory initial) {
        this.current = new AtomicReference<>(initial);
    }

    public synchronized void switchTo(GuiFactory next) { current.set(next); }

    public Button   newButton()   { return current.get().createButton(); }
    public Checkbox newCheckbox() { return current.get().createCheckbox(); }
}

// Usage
var mgr = new ThemeManager(new LightTheme());
var lightButton = mgr.newButton();          // light
mgr.switchTo(new DarkTheme());
var darkButton = mgr.newButton();           // dark
// lightButton is still light! Existing instances aren't swapped.
```

Caveat: existing products aren't refreshed; only future creations use the new factory.

---

## Practice Tips

1. **Test family consistency** for every Concrete Factory.
2. **Avoid product cross-references** when possible — they create concrete-class coupling.
3. **In Go**, write tests verifying each factory returns the expected concrete types.
4. **In Java**, use `default` interface methods when adding optional new types.
5. **Profile** before introducing Sub-Factory Composition — for small factories, it's overkill.

---

[← Interview](interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)

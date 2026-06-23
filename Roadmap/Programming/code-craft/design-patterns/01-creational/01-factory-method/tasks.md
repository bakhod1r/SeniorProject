# Factory Method — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/factory-method](https://refactoring.guru/design-patterns/factory-method)

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Cross-Platform Button](#task-1-cross-platform-button)
2. [Task 2: Document Renderer](#task-2-document-renderer)
3. [Task 3: Logistics System](#task-3-logistics-system)
4. [Task 4: Notification Channel Factory](#task-4-notification-channel-factory)
5. [Task 5: Database Connector](#task-5-database-connector)
6. [Task 6: Plugin Registry](#task-6-plugin-registry)
7. [Task 7: HTTP Request Parser by Content-Type](#task-7-http-request-parser-by-content-type)
8. [Task 8: Game Enemy Spawner](#task-8-game-enemy-spawner)
9. [Task 9: Generic Repository Factory](#task-9-generic-repository-factory)
10. [Task 10: Refactor If/Else to Factory](#task-10-refactor-ifelse-to-factory)

---

## Task 1: Cross-Platform Button

### Statement

Build a UI framework with `Application.createButton()`. Provide `WindowsApp` and `WebApp` subclasses returning `WindowsButton` and `HtmlButton`. The base class has `renderToolbar()` that uses `createButton()` polymorphically.

### Solution — Java

```java
interface Button { void render(); }

class WindowsButton implements Button {
    public void render() { System.out.println("[Win Button]"); }
}

class HtmlButton implements Button {
    public void render() { System.out.println("<button>"); }
}

abstract class Application {
    abstract Button createButton();
    public void renderToolbar() {
        Button b = createButton();
        b.render();
    }
}

class WindowsApp extends Application {
    Button createButton() { return new WindowsButton(); }
}

class WebApp extends Application {
    Button createButton() { return new HtmlButton(); }
}

public class Demo {
    public static void main(String[] args) {
        Application app = "WIN".equals(System.getenv("PLATFORM"))
            ? new WindowsApp() : new WebApp();
        app.renderToolbar();
    }
}
```

### Solution — Python

```python
from abc import ABC, abstractmethod

class Button(ABC):
    @abstractmethod
    def render(self) -> str: ...

class WindowsButton(Button):
    def render(self) -> str: return "[Win Button]"

class HtmlButton(Button):
    def render(self) -> str: return "<button>"

class Application(ABC):
    @abstractmethod
    def create_button(self) -> Button: ...
    def render_toolbar(self) -> str: return self.create_button().render()

class WindowsApp(Application):
    def create_button(self) -> Button: return WindowsButton()

class WebApp(Application):
    def create_button(self) -> Button: return HtmlButton()
```

### Solution — Go

```go
package ui

type Button interface{ Render() string }

type winButton struct{}
func (winButton) Render() string { return "[Win Button]" }

type htmlButton struct{}
func (htmlButton) Render() string { return "<button>" }

type App interface{ Toolbar() string }

type winApp struct{}
func (winApp) Toolbar() string { return winButton{}.Render() }

type webApp struct{}
func (webApp) Toolbar() string { return htmlButton{}.Render() }

func New(platform string) App {
    if platform == "win" { return winApp{} }
    return webApp{}
}
```

---

## Task 2: Document Renderer

### Statement

Implement a `DocumentRenderer` Factory Method with `PDFDocument`, `HTMLDocument`, and `MarkdownDocument` products. Each has a `render()` method that returns a string. The renderer's `printDocument()` method calls `render()`.

### Solution — Java

```java
interface Document { String render(String content); }

class PDFDocument implements Document {
    public String render(String c) { return "%PDF\n" + c; }
}
class HTMLDocument implements Document {
    public String render(String c) { return "<html>" + c + "</html>"; }
}
class MarkdownDocument implements Document {
    public String render(String c) { return "# " + c; }
}

abstract class DocumentRenderer {
    abstract Document createDocument();
    public String printDocument(String content) {
        return createDocument().render(content);
    }
}

class PDFRenderer extends DocumentRenderer {
    Document createDocument() { return new PDFDocument(); }
}
// ...etc
```

### Solution — Python (using a registry)

```python
from typing import Callable

class Document:
    def render(self, content: str) -> str: ...

class PDFDocument(Document):
    def render(self, content): return f"%PDF\n{content}"
class HTMLDocument(Document):
    def render(self, content): return f"<html>{content}</html>"
class MarkdownDocument(Document):
    def render(self, content): return f"# {content}"

REGISTRY: dict[str, Callable[[], Document]] = {
    "pdf":      PDFDocument,
    "html":     HTMLDocument,
    "markdown": MarkdownDocument,
}

def render_document(format: str, content: str) -> str:
    return REGISTRY[format]().render(content)
```

### Solution — Go

```go
package doc

import "fmt"

type Document interface{ Render(string) string }

type pdf struct{}
func (pdf) Render(c string) string { return "%PDF\n" + c }

type html struct{}
func (html) Render(c string) string { return "<html>" + c + "</html>" }

type md struct{}
func (md) Render(c string) string { return "# " + c }

func New(format string) (Document, error) {
    switch format {
    case "pdf":      return pdf{},  nil
    case "html":     return html{}, nil
    case "markdown": return md{},   nil
    }
    return nil, fmt.Errorf("unknown: %s", format)
}
```

---

## Task 3: Logistics System

### Statement

Recreate the canonical refactoring.guru example: `RoadLogistics` returns `Truck`, `SeaLogistics` returns `Ship`, `AirLogistics` returns `Plane`. Each has `deliver()`. Logistics' `planDelivery()` uses the factory method.

### Solution — Java

```java
interface Transport { void deliver(); }

class Truck implements Transport { public void deliver() { System.out.println("by truck"); } }
class Ship  implements Transport { public void deliver() { System.out.println("by ship");  } }
class Plane implements Transport { public void deliver() { System.out.println("by plane"); } }

abstract class Logistics {
    abstract Transport createTransport();
    public void planDelivery() { createTransport().deliver(); }
}

class RoadLogistics extends Logistics { Transport createTransport() { return new Truck(); } }
class SeaLogistics  extends Logistics { Transport createTransport() { return new Ship();  } }
class AirLogistics  extends Logistics { Transport createTransport() { return new Plane(); } }
```

### Solution — Python

```python
class Transport: pass
class Truck(Transport): ...
class Ship(Transport): ...
class Plane(Transport): ...

class Logistics:
    def create_transport(self): raise NotImplementedError
    def plan_delivery(self):
        return self.create_transport()

class RoadLogistics(Logistics):
    def create_transport(self): return Truck()
class SeaLogistics(Logistics):
    def create_transport(self): return Ship()
class AirLogistics(Logistics):
    def create_transport(self): return Plane()
```

### Solution — Go (Simple Factory)

```go
package logistics

type Transport interface{ Deliver() string }

type truck struct{}
func (truck) Deliver() string { return "by truck" }
type ship struct{}
func (ship)  Deliver() string { return "by ship" }
type plane struct{}
func (plane) Deliver() string { return "by plane" }

func PlanDelivery(mode string) string {
    var t Transport
    switch mode {
    case "road": t = truck{}
    case "sea":  t = ship{}
    case "air":  t = plane{}
    }
    return t.Deliver()
}
```

---

## Task 4: Notification Channel Factory

### Statement

A `Notifier` Factory Method system. `EmailNotifier`, `SmsNotifier`, `PushNotifier`, all implementing `send(msg, recipient)`. The factory picks based on user preferences.

### Solution — Java (registry pattern)

```java
import java.util.Map;
import java.util.function.Supplier;

interface Notifier { void send(String to, String msg); }

class EmailNotifier implements Notifier { public void send(String to, String m) { /* SMTP */ } }
class SmsNotifier   implements Notifier { public void send(String to, String m) { /* Twilio */ } }
class PushNotifier  implements Notifier { public void send(String to, String m) { /* FCM */ } }

class NotifierFactory {
    private static final Map<String, Supplier<Notifier>> REGISTRY = Map.of(
        "email", EmailNotifier::new,
        "sms",   SmsNotifier::new,
        "push",  PushNotifier::new
    );
    public static Notifier create(String channel) {
        return REGISTRY.getOrDefault(channel, EmailNotifier::new).get();
    }
}
```

### Solution — Python

```python
from typing import Type

class Notifier:
    def send(self, to: str, msg: str) -> None: ...

class EmailNotifier(Notifier): ...
class SmsNotifier(Notifier): ...
class PushNotifier(Notifier): ...

REGISTRY: dict[str, Type[Notifier]] = {
    "email": EmailNotifier,
    "sms":   SmsNotifier,
    "push":  PushNotifier,
}

def notify(channel: str, to: str, msg: str) -> None:
    REGISTRY[channel]().send(to, msg)
```

### Solution — Go

```go
package notify

type Notifier interface{ Send(to, msg string) error }

type email struct{}; func (email) Send(to, msg string) error { /* ... */ return nil }
type sms struct{};   func (sms)   Send(to, msg string) error { /* ... */ return nil }
type push struct{};  func (push)  Send(to, msg string) error { /* ... */ return nil }

var registry = map[string]func() Notifier{
    "email": func() Notifier { return email{} },
    "sms":   func() Notifier { return sms{} },
    "push":  func() Notifier { return push{} },
}

func New(channel string) Notifier {
    if f, ok := registry[channel]; ok { return f() }
    return email{}   // default
}
```

---

## Task 5: Database Connector

### Statement

Build a `DatabaseConnector` Factory Method with `PostgresConnector`, `MySQLConnector`, `SQLiteConnector`. Each has `connect(dsn)` and returns a `Connection` interface.

### Solution — Java

```java
interface Connection {
    void execute(String sql);
    void close();
}

abstract class DatabaseConnector {
    abstract Connection connect(String dsn);
}

class PostgresConnector extends DatabaseConnector {
    Connection connect(String dsn) { return new PgConnection(dsn); }
}
class MySQLConnector extends DatabaseConnector {
    Connection connect(String dsn) { return new MySqlConnection(dsn); }
}
class SQLiteConnector extends DatabaseConnector {
    Connection connect(String dsn) { return new SqliteConnection(dsn); }
}

class PgConnection implements Connection { /* ... */ }
class MySqlConnection implements Connection { /* ... */ }
class SqliteConnection implements Connection { /* ... */ }
```

### Solution — Python

```python
from typing import Protocol

class Connection(Protocol):
    def execute(self, sql: str) -> None: ...
    def close(self) -> None: ...

class DatabaseConnector:
    def connect(self, dsn: str) -> Connection: raise NotImplementedError

class PostgresConnector(DatabaseConnector):
    def connect(self, dsn): return PgConnection(dsn)

class MySQLConnector(DatabaseConnector):
    def connect(self, dsn): return MySqlConnection(dsn)

class SQLiteConnector(DatabaseConnector):
    def connect(self, dsn): return SqliteConnection(dsn)
```

### Solution — Go

```go
package db

type Conn interface {
    Execute(sql string) error
    Close() error
}

type Connector interface{ Connect(dsn string) (Conn, error) }

type PostgresConnector struct{}
func (PostgresConnector) Connect(dsn string) (Conn, error) { return openPg(dsn) }

type MySQLConnector struct{}
func (MySQLConnector) Connect(dsn string) (Conn, error) { return openMy(dsn) }

type SQLiteConnector struct{}
func (SQLiteConnector) Connect(dsn string) (Conn, error) { return openSqlite(dsn) }
```

---

## Task 6: Plugin Registry

### Statement

Build a thread-safe plugin registry where plugins register their factory function at init. The host app calls `PluginRegistry.create("name", config)` to get a fresh instance.

### Solution — Go

```go
package plugins

import "sync"

type Plugin interface{ Run() error }

type Factory func(cfg map[string]any) Plugin

var (
    factories = map[string]Factory{}
    mu        sync.RWMutex
)

func Register(name string, f Factory) {
    mu.Lock(); defer mu.Unlock()
    factories[name] = f
}

func Create(name string, cfg map[string]any) (Plugin, bool) {
    mu.RLock(); defer mu.RUnlock()
    f, ok := factories[name]
    if !ok { return nil, false }
    return f(cfg), true
}
```

```go
// plugins/csv/csv.go
package csv

import "host/plugins"

type csvPlugin struct{ path string }
func (p *csvPlugin) Run() error { /* read/write CSV */ return nil }

func init() {
    plugins.Register("csv", func(cfg map[string]any) plugins.Plugin {
        path, _ := cfg["path"].(string)
        return &csvPlugin{path: path}
    })
}
```

### Solution — Java (with `Supplier`)

```java
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

public class PluginRegistry {
    private static final Map<String, Function<Map<String, Object>, Plugin>> REG
        = new ConcurrentHashMap<>();

    public static void register(String name, Function<Map<String, Object>, Plugin> factory) {
        REG.put(name, factory);
    }

    public static Plugin create(String name, Map<String, Object> config) {
        Function<Map<String, Object>, Plugin> f = REG.get(name);
        if (f == null) throw new IllegalArgumentException("no plugin: " + name);
        return f.apply(config);
    }
}
```

### Solution — Python

```python
from typing import Callable

class PluginRegistry:
    _factories: dict[str, Callable[[dict], "Plugin"]] = {}

    @classmethod
    def register(cls, name: str, factory: Callable[[dict], "Plugin"]) -> None:
        cls._factories[name] = factory

    @classmethod
    def create(cls, name: str, config: dict) -> "Plugin":
        return cls._factories[name](config)
```

---

## Task 7: HTTP Request Parser by Content-Type

### Statement

Build a parser factory that picks the right `Parser` based on the `Content-Type` header (`application/json`, `application/xml`, `text/csv`).

### Solution — Java

```java
interface Parser { Map<String, Object> parse(String body); }

class JsonParser implements Parser { /* ... */ }
class XmlParser  implements Parser { /* ... */ }
class CsvParser  implements Parser { /* ... */ }

class ParserFactory {
    public static Parser create(String contentType) {
        if (contentType.startsWith("application/json")) return new JsonParser();
        if (contentType.startsWith("application/xml"))  return new XmlParser();
        if (contentType.startsWith("text/csv"))         return new CsvParser();
        throw new IllegalArgumentException("Unsupported: " + contentType);
    }
}
```

### Solution — Python

```python
def parser_for(content_type: str):
    if content_type.startswith("application/json"): return JsonParser()
    if content_type.startswith("application/xml"):  return XmlParser()
    if content_type.startswith("text/csv"):         return CsvParser()
    raise ValueError(f"Unsupported: {content_type}")
```

### Solution — Go

```go
func ParserFor(ct string) (Parser, error) {
    switch {
    case strings.HasPrefix(ct, "application/json"): return jsonParser{}, nil
    case strings.HasPrefix(ct, "application/xml"):  return xmlParser{}, nil
    case strings.HasPrefix(ct, "text/csv"):         return csvParser{}, nil
    }
    return nil, fmt.Errorf("unsupported: %s", ct)
}
```

---

## Task 8: Game Enemy Spawner

### Statement

A game with `Level1`, `Level2`, `Level3`. Each level subclass overrides `spawnEnemy()` to return level-appropriate enemies (`Goblin`, `Orc`, `Dragon`). The base class's `gameTick()` calls `spawnEnemy()` periodically.

### Solution — Java

```java
abstract class Enemy { abstract int hp(); }
class Goblin extends Enemy { public int hp() { return 10; } }
class Orc    extends Enemy { public int hp() { return 50; } }
class Dragon extends Enemy { public int hp() { return 500; } }

abstract class Level {
    abstract Enemy spawnEnemy();
    public void gameTick() {
        Enemy e = spawnEnemy();
        System.out.println("Spawned: HP=" + e.hp());
    }
}

class Level1 extends Level { Enemy spawnEnemy() { return new Goblin(); } }
class Level2 extends Level { Enemy spawnEnemy() { return new Orc();    } }
class Level3 extends Level { Enemy spawnEnemy() { return new Dragon(); } }
```

### Solution — Python (with random distribution)

```python
import random

class Enemy: hp: int = 0
class Goblin(Enemy): hp = 10
class Orc(Enemy):    hp = 50
class Dragon(Enemy): hp = 500

class Level:
    enemy_pool: list[type[Enemy]]
    weights:    list[int]
    def spawn(self) -> Enemy:
        return random.choices(self.enemy_pool, self.weights)[0]()

class Level1(Level):
    enemy_pool = [Goblin, Orc, Dragon]
    weights    = [80, 18, 2]
```

This is a Factory Method with weighted random — a real game pattern.

### Solution — Go

```go
package game

import "math/rand"

type Enemy interface{ HP() int }

type goblin struct{}; func (goblin) HP() int { return 10 }
type orc struct{};    func (orc)    HP() int { return 50 }
type dragon struct{}; func (dragon) HP() int { return 500 }

type Level struct{ Spawn func() Enemy }

func NewLevel1() Level {
    return Level{Spawn: func() Enemy {
        switch r := rand.Intn(100); {
        case r < 80: return goblin{}
        case r < 98: return orc{}
        default:     return dragon{}
        }
    }}
}
```

---

## Task 9: Generic Repository Factory

### Statement

A generic `RepositoryFactory<T>` that creates `Repository<T>` for any entity type. Multiple backends: in-memory, JPA, MongoDB.

### Solution — Java

```java
public interface Repository<T> {
    void save(T entity);
    T findById(Object id);
}

public abstract class RepositoryFactory<T> {
    protected final Class<T> type;
    protected RepositoryFactory(Class<T> type) { this.type = type; }
    public abstract Repository<T> create();
}

public class InMemoryRepositoryFactory<T> extends RepositoryFactory<T> {
    public InMemoryRepositoryFactory(Class<T> t) { super(t); }
    public Repository<T> create() { return new InMemoryRepository<>(type); }
}

public class JpaRepositoryFactory<T> extends RepositoryFactory<T> {
    public JpaRepositoryFactory(Class<T> t) { super(t); }
    public Repository<T> create() { return new JpaRepository<>(type); }
}

// Usage
Repository<User> users = new JpaRepositoryFactory<>(User.class).create();
```

### Solution — Python

```python
from typing import TypeVar, Generic, Type

T = TypeVar("T")

class Repository(Generic[T]):
    def save(self, entity: T) -> None: ...
    def find_by_id(self, id: object) -> T | None: ...

class InMemoryRepository(Repository[T]):
    def __init__(self, type_: Type[T]):
        self.type = type_
        self._store: dict = {}

class RepositoryFactory(Generic[T]):
    def __init__(self, type_: Type[T]): self.type = type_
    def create(self) -> Repository[T]: raise NotImplementedError

class InMemoryRepositoryFactory(RepositoryFactory[T]):
    def create(self) -> Repository[T]: return InMemoryRepository(self.type)
```

### Solution — Go (Generics, 1.18+)

```go
package repo

type Repository[T any] interface {
    Save(t T) error
    FindByID(id any) (T, error)
}

type Factory[T any] interface{ Create() Repository[T] }

type inMemoryFactory[T any] struct{}
func (inMemoryFactory[T]) Create() Repository[T] {
    return newInMemoryRepo[T]()
}

func NewInMemoryFactory[T any]() Factory[T] { return inMemoryFactory[T]{} }
```

---

## Task 10: Refactor If/Else to Factory

### Statement

Given:

```java
class TaxCalculator {
    double calculate(String country, double amount) {
        if (country.equals("US")) {
            return amount * 0.08;
        } else if (country.equals("DE")) {
            double net = amount / 1.19;
            return net * 0.19;
        } else if (country.equals("UK")) {
            return amount * 0.20;
        }
        throw new IllegalArgumentException(country);
    }
}
```

Refactor to Factory Method.

### Solution — Java

```java
interface TaxStrategy { double tax(double amount); }

class USTax implements TaxStrategy { public double tax(double a) { return a * 0.08; } }
class DETax implements TaxStrategy {
    public double tax(double a) {
        double net = a / 1.19;
        return net * 0.19;
    }
}
class UKTax implements TaxStrategy { public double tax(double a) { return a * 0.20; } }

class TaxFactory {
    private static final Map<String, Supplier<TaxStrategy>> REG = Map.of(
        "US", USTax::new,
        "DE", DETax::new,
        "UK", UKTax::new
    );
    public static TaxStrategy create(String country) {
        Supplier<TaxStrategy> f = REG.get(country);
        if (f == null) throw new IllegalArgumentException(country);
        return f.get();
    }
}

class TaxCalculator {
    double calculate(String country, double amount) {
        return TaxFactory.create(country).tax(amount);
    }
}
```

Adding a new country = one new class + one map entry. Old code untouched.

### Solution — Python

```python
class TaxStrategy:
    def tax(self, amount: float) -> float: ...

class USTax(TaxStrategy):
    def tax(self, a): return a * 0.08

class DETax(TaxStrategy):
    def tax(self, a): return (a / 1.19) * 0.19

class UKTax(TaxStrategy):
    def tax(self, a): return a * 0.20

REGISTRY: dict[str, type[TaxStrategy]] = {"US": USTax, "DE": DETax, "UK": UKTax}

def calculate(country: str, amount: float) -> float:
    if country not in REGISTRY:
        raise ValueError(country)
    return REGISTRY[country]().tax(amount)
```

### Solution — Go

```go
package tax

type Strategy interface{ Tax(amount float64) float64 }

type us struct{}; func (us) Tax(a float64) float64 { return a * 0.08 }
type de struct{}; func (de) Tax(a float64) float64 { return (a / 1.19) * 0.19 }
type uk struct{}; func (uk) Tax(a float64) float64 { return a * 0.20 }

var registry = map[string]func() Strategy{
    "US": func() Strategy { return us{} },
    "DE": func() Strategy { return de{} },
    "UK": func() Strategy { return uk{} },
}

func Calculate(country string, amount float64) (float64, error) {
    f, ok := registry[country]
    if !ok { return 0, fmt.Errorf("unknown: %s", country) }
    return f().Tax(amount), nil
}
```

---

## How to Practice

1. **Type out each solution by hand.** Don't paste.
2. **Run tests.** Add a few invariants (`assert factory("X") instanceof X`, etc.).
3. **Compare your structure to the canonical refactoring.guru one.** Note divergences.
4. **Add one variant.** New product = how many files change?
5. **Time yourself.** Each task should take 10-15 minutes once you're fluent.

---

[← Interview](interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)

# PI Processing 0.1.7

## Совместимость

- EveJS Core `261108.1`, fork build `261109.1`.
- В канонический репозиторий возвращены изменения compatibility-кандидата `0.1.6`, ранее существовавшие только вне Git-истории.

## Исправления

- Классификация модулей в глобальном `Module._load` hook кэшируется по resolved filename.
- Повторные `require()` одного и того же target или non-target модуля больше не вызывают повторный синхронный `realpathSync`/`lstat`.
- PI gameplay, формат заданий и SQLite state не изменены.

## Проверка

- Performance-регрессия выполняет 10 000 повторных проходов через вложенную цепочку loaders и подтверждает не более одной canonicalization на уникальный filename для каждого PI loader.
- Core compatibility, delivery, inventory recovery и deterministic packaging покрыты автоматическими тестами.

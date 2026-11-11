# Skyhook PI 0.1.17

## Совместимость

- EveJS Core `261108.1`, fork build `261109.1`.
- В канонический репозиторий возвращены изменения compatibility-кандидата `0.1.16`, ранее существовавшие только вне Git-истории.

## Исправления

- Классификация модулей кэшируется по resolved filename и совместно используется global load hook и JavaScript extension hook.
- Повторные `require()` одного и того же target или non-target модуля больше не вызывают повторный синхронный `realpathSync`/`lstat`.
- Skyhook gameplay, production state и SQLite schema не изменены.

## Проверка

- Performance-регрессия выполняет 10 000 повторных проходов через вложенную цепочку loaders и подтверждает не более одной canonicalization на уникальный filename для каждого PI loader.
- Core transforms, fault containment, delivery и deterministic packaging покрыты автоматическими тестами.

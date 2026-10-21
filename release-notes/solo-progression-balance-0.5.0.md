# SoloProgressionBalance 0.5.0

- Мод перенесён в общий maintained-репозиторий `klimesrenz/evejs-mods` с сохранением исходного id `soloprogressionbalance`.
- Server-side масштабирование mining yield, mining drones, mining holds и logistics cargo адаптировано и проверено на EveJS `261018.1`.
- Строгая проверка Fitting Simulation обновлена на текущие версию сервера и fingerprint `handshake.js`; неизвестные исходники по-прежнему отклоняются.
- Server policy и клиентский adapter используют EveJS `261018.1` и EVE client build `3396210`.
- Fitting Simulation теперь безопасно компонуется с AutoMining `1.2.18` в обоих порядках загрузки.
- Максимальный совмещённый login payload ограничен 512 КиБ; при превышении сохраняется предыдущий штатный пакет.
- Immutable или несовместимый AutoMining delivery обрабатывается fail-closed без изменения handshake.

Автоматические проверки на Windows: основной набор `42/42`, port verifier `5/5`, current-version, Python policy, package/helper и syntax checks. Полноценная игровая приёмка в EVE-клиенте и интеграция с отсутствующим локально `fourModeAsteroidBelts` ещё не выполнены.

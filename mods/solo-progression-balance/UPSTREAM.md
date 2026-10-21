# Происхождение SoloProgressionBalance

Этот пакет основан на [Delta007a/EveJS-SoloProgressionBalance](https://github.com/Delta007a/EveJS-SoloProgressionBalance), версия `0.4.1`, commit `3e82322325cba9e725d437370ae10769fad34741e`.

Версия `0.5.0` изменена 2026-10-21 и адаптирована для EveJS `261018.1`:

- обновлены строгие проверки версии и fingerprint `handshake.js`;
- server policy и клиентский adapter переведены на новый номер EveJS;
- bounded login payload увеличен до 512 КиБ;
- добавлена безопасная композиция доставки с AutoMining;
- добавлены регрессионные и fail-closed проверки текущей версии.

Исходный и изменённый код распространяются по лицензии AGPL-3.0-only. Полный текст находится в `LICENSE`.

# coding: utf-8
# Market Search companion, Python 2.7 / EVE client build 3396210.
# Delivered in a private login namespace; does not modify eveCommands or archives.
try:
    import __builtin__ as _ms_builtins
    import json as _ms_json
    import uthread as _ms_uthread
    import blue as _ms_blue

    _ms_key = '_evejs_market_search_v1'
    _ms_previous = getattr(_ms_builtins, _ms_key, None)
    if _ms_previous is not None:
        _ms_previous.dispose()
    _ms_window_class = None
    sm = None
    session = None

    def _ms_text(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\t', ' ').replace('\n', ' ')

    def _ms_system():
        return int(getattr(session, 'solarsystemid2', None) or getattr(session, 'solarsystemid', None) or 0)

    def _ms_build_window():
        from carbonui import uiconst as C
        from carbonui.control.window import Window
        from carbonui.control.button import Button
        from carbonui.control.combo import Combo
        from carbonui.control.singlelineedits.singleLineEditText import SingleLineEditText
        from carbonui.primitives.container import Container
        from eve.client.script.ui.control.eveLabel import EveLabelMedium
        from eve.client.script.ui.control.eveScroll import Scroll
        from eve.client.script.ui.control.entries.generic import Generic
        from eve.client.script.ui.control.entries.util import GetFromClass

        class MarketSearchWindow(Window):
            default_windowID = 'EveJSMarketSearch'
            default_caption = 'Market Search'
            default_width = 1100
            default_height = 620
            default_minSize = (850, 450)
            default_isStackable = False
            default_scope = C.SCOPE_INGAME

            def ApplyAttributes(self, attributes):
                Window.ApplyAttributes(self, attributes)
                self._character = session.charid
                self._busy = False
                self._serial = 0
                self._offers = []
                self._selected = None
                self._source = 0
                self._item = None
                self.SetCaption(u'Market Search — поиск продаж')
                main = self.content
                top = Container(parent=main, align=C.TOTOP, height=36)
                self.queryEdit = SingleLineEditText(parent=top, align=C.TOLEFT, width=440,
                    hint=u'Type ID или часть английского названия', OnReturn=self.Search)
                Button(parent=top, align=C.TORIGHT, width=130, label=u'Найти / обновить', func=self.Search)
                self.status = EveLabelMedium(parent=main, align=C.TOTOP, height=48, maxLines=3,
                    text=u'Введите ID (например, 21038) или название. Поиск по NPC-станциям всех регионов.')
                self.typeList = Scroll(parent=main, align=C.TOTOP, height=110, multiSelect=False)
                self.typeList.Load(contentList=[], noContentHint=u'При нескольких совпадениях выберите товар двойным щелчком.')
                toolbar = Container(parent=main, align=C.TOTOP, height=34)
                self.sortChoice = Combo(parent=toolbar, align=C.TOPLEFT, width=210,
                    options=[(u'Ближайшие станции', 'distance'), (u'Самая низкая цена', 'price')],
                    select='distance', callback=self.SortChanged)
                footer = Container(parent=main, align=C.TOBOTTOM, height=66)
                Button(parent=footer, align=C.TOPLEFT, width=170, label=u'Задать маршрут', func=self.SetRoute)
                EveLabelMedium(parent=footer, align=C.TOBOTTOM, height=30, maxLines=2,
                    text=u'Прыжки: кратчайший путь по гейтам. Кнопка заменяет маршрут; автопилот не включается.')
                self.offerList = Scroll(parent=main, align=C.TOALL, multiSelect=False)
                self.offerList.Load(contentList=[], noContentHint=u'Сначала выберите товар.')

            def Valid(self):
                return not self.destroyed and _ms_owner.usable() and self._character == session.charid

            def SetStatus(self, value):
                if not self.destroyed:
                    self.status.text = _ms_text(value)

            def Search(self, *args):
                if not self.Valid() or self._busy:
                    return
                query = self.queryEdit.GetValue().strip()
                if not query:
                    self.SetStatus(u'Введите type ID или английское название.')
                    return
                self._busy = True
                self._serial += 1
                self._selected = None
                self._offers = []
                self.offerList.Load(contentList=[], noContentHint=u'Поиск...')
                self.typeList.Load(contentList=[], noContentHint=u'Поиск...')
                self.SetStatus(u'Читаю предложения маркета...')
                _ms_uthread.new(self.SearchWork, query, self._serial, _ms_system())

            def SearchWork(self, query, serial, source):
                try:
                    result = _ms_json.loads(sm.RemoteSvc('marketProxy').MarketSearchFind(query))
                    if not self.Valid() or serial != self._serial:
                        return
                    if source != _ms_system():
                        self.SetStatus(u'Система изменилась. Нажмите «Найти / обновить».')
                        return
                    if not result.get('success'):
                        self.SetStatus(result.get('message', u'Ошибка поиска.'))
                        return
                    if result.get('characterID') != self._character or result.get('sourceSystemID') != source:
                        self.SetStatus(u'Позиция изменилась. Повторите поиск.')
                        return
                    self._source = source
                    self._item = result.get('item')
                    types = result.get('types', [])
                    entries = [GetFromClass(Generic, {'label': _ms_text(u'%s — %s' % (row['typeID'], row['name'])),
                        'typeID': row['typeID'], 'OnDblClick': self.PickType}) for row in types]
                    self.typeList.Load(contentList=entries, noContentHint=u'Товар не найден.')
                    if not self._item:
                        self.SetStatus(u'Выберите товар двойным щелчком.' if types else u'Товар не найден в каталоге маркета.')
                        if result.get('moreTypes'):
                            self.SetStatus(u'Показаны первые 50 типов. Уточните название или выберите товар.')
                        return
                    self._offers = result.get('offers', [])
                    self.RenderOffers()
                    self.SetStatus(u'%s — станций с продажей: %s. Объём указан по лучшей цене на станции.' % (self._item['name'], len(self._offers)))
                except Exception as error:
                    if self.Valid() and serial == self._serial:
                        self.SetStatus(u'Ошибка: %s' % unicode(error))
                finally:
                    if not self.destroyed and serial == self._serial:
                        self._busy = False

            def PickType(self, entry, *args):
                if self._busy:
                    return
                self.queryEdit.SetValue(unicode(entry.sr.node.typeID))
                self.Search()

            def SortChanged(self, *args):
                if hasattr(self, 'offerList'):
                    self.RenderOffers()

            def RenderOffers(self):
                self._selected = None
                mode = self.sortChoice.GetValue()
                def rank(row):
                    distance = row['jumps'] if row.get('jumps') is not None else 1000000
                    return (row['price'], distance, row['stationID']) if mode == 'price' else (distance, row['price'], row['stationID'])
                rows = sorted(self._offers, key=rank)
                entries = []
                for row in rows:
                    hops = unicode(row['jumps']) if row.get('jumps') is not None else u'Нет пути'
                    fields = [hops, u'{:,.2f}'.format(row['price']), u'{:,}'.format(row['quantity']),
                        row['stationName'], row['systemName'], row['regionName']]
                    entries.append(GetFromClass(Generic, {'label': u'<t>'.join(_ms_text(value) for value in fields),
                        'offer': row, 'OnClick': self.PickOffer,
                        'hint': u'%s — station ID %s' % (_ms_text(row['stationName']), row['stationID'])}))
                self.offerList.Load(contentList=entries,
                    headers=[u'Прыжки', u'Цена ISK', u'Количество', u'Станция', u'Система', u'Регион'],
                    noContentHint=u'Активных продаж на NPC-станциях нет.')

            def PickOffer(self, entry, *args):
                self._selected = entry.sr.node.offer

            def SetRoute(self, *args):
                if not self.Valid() or self._busy:
                    return
                row = self._selected
                if row is None:
                    self.SetStatus(u'Сначала выберите станцию в таблице.')
                    return
                if self._source != _ms_system():
                    self.SetStatus(u'Система изменилась. Сначала обновите поиск.')
                    return
                if row.get('jumps') is None:
                    self.SetStatus(u'Путь по обычным гейтам не найден.')
                    return
                try:
                    if sm.GetService('autoPilot').GetState():
                        self.SetStatus(u'Сначала выключите автопилот.')
                        return
                    settings_service = getattr(_ms_builtins, 'settings', None)
                    if settings_service is None:
                        settings_service = _ms_context.get('settings')
                    if settings_service is None:
                        self.SetStatus(u'Настройки навигации недоступны. Перезапустите клиент.')
                        return
                    if settings_service.char.ui.Get('evejsAutoMiningTrip', None):
                        self.SetStatus(u'Сначала отмените текущую перевозку AutoMining.')
                        return
                    sm.GetService('starmap').SetWaypoints([int(row['stationID'])])
                    self.SetStatus(u'Маршрут задан: %s. Автопилот не включён.' % row['stationName'])
                except Exception as error:
                    self.SetStatus(u'Не удалось задать маршрут: %s' % unicode(error))

        return MarketSearchWindow

    class _MarketSearchCompanion(object):
        __notifyevents__ = ['OnSessionChanged', 'OnMarketSearchOpen']

        def __init__(self):
            self.active = True
            self.ready = False
            self.character = None
            self.generation = 0
            self.registered = []

        def current(self):
            return self.active and getattr(_ms_builtins, _ms_key, None) is self

        def usable(self):
            return self.current() and self.ready and session is not None and self.character == getattr(session, 'charid', None)

        def close_window(self):
            if _ms_window_class is not None:
                window = _ms_window_class.GetIfOpen()
                if window is not None:
                    window.Close()

        def dispose(self):
            self.active = False
            self.ready = False
            self.generation += 1
            try:
                self.close_window()
            except Exception:
                pass
            for event in self.registered:
                try:
                    sm.UnregisterForNotifyEvent(self, event)
                except Exception:
                    pass
            self.registered = []

        def start(self):
            global sm, session
            try:
                for attempt in range(240):
                    _ms_blue.pyos.synchro.SleepWallclock(500)
                    if not self.current():
                        return
                    sm = _ms_context.get('sm', getattr(_ms_builtins, 'sm', None))
                    session = _ms_context.get('session', getattr(_ms_builtins, 'session', None))
                    if sm is not None and session is not None:
                        break
                else:
                    raise RuntimeError('Client services did not become ready')
                for event in self.__notifyevents__:
                    sm.RegisterForNotifyEvent(self, event)
                    self.registered.append(event)
                self.changed()
            except Exception:
                self.dispose()
                print('MARKET_SEARCH:BOOT_FAILED')

        def OnSessionChanged(self, *args):
            global session
            if not self.current():
                return
            if len(args) > 1 and hasattr(args[1], 'charid'):
                session = args[1]
            self.changed()

        def changed(self):
            character = getattr(session, 'charid', None)
            if character == self.character and self.ready:
                return
            self.ready = False
            self.close_window()
            self.character = character
            self.generation += 1
            if character:
                _ms_uthread.new(self.connect, self.generation)

        def connect(self, generation):
            for attempt in range(6):
                _ms_blue.pyos.synchro.SleepWallclock(1500)
                if not self.current() or generation != self.generation:
                    return
                try:
                    result = _ms_json.loads(sm.RemoteSvc('marketProxy').MarketSearchReady())
                    if not self.current() or generation != self.generation:
                        return
                    if result.get('success') and result.get('version') == '0.1.3':
                        self.ready = True
                        print('MARKET_SEARCH:READY:0.1.3')
                        return
                except Exception:
                    pass
            print('MARKET_SEARCH:NOT_READY')

        def OnMarketSearchOpen(self, query=''):
            global _ms_window_class
            if not self.usable():
                return
            try:
                if _ms_window_class is None:
                    _ms_window_class = _ms_build_window()
                window = _ms_window_class.Open()
                if query:
                    window.queryEdit.SetValue(unicode(query))
                    window.Search()
            except Exception:
                import log
                log.LogException('Market Search window failed to open')
                from player_messaging.client.ui_message import message_player
                message_player(u'Market Search: окно не открылось. Проверьте клиентский лог.')

    _ms_owner = _MarketSearchCompanion()
    setattr(_ms_builtins, _ms_key, _ms_owner)
    _ms_uthread.new(_ms_owner.start)
except Exception:
    print('MARKET_SEARCH:LOAD_FAILED')

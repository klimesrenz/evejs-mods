# coding: utf-8
# Python 2.7 EVE companion; delivery/lifecycle adapted from Market Search.
try:
    import __builtin__ as _pi_builtins
    import json as _pi_json
    import uthread as _pi_uthread
    import blue as _pi_blue
    import uuid as _pi_uuid
    _pi_key = '_evejs_skyhook_pi_v1'
    _pi_previous = getattr(_pi_builtins, _pi_key, None)
    if _pi_previous is not None:
        _pi_previous.dispose()
    _pi_window_class = None
    sm = None
    session = None

    def _pi_text(value):
        return unicode(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\t', ' ').replace('\n', ' ')

    def _pi_build_window():
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

        class SkyhookPiWindow(Window):
            default_windowID = 'EveJSSkyhookPI'
            default_caption = 'Skyhook PI 0.1.11'
            default_width = 1100
            default_height = 570
            default_minSize = (1000, 500)
            default_isStackable = False
            default_scope = C.SCOPE_INGAME

            def ApplyAttributes(self, attributes):
                Window.ApplyAttributes(self, attributes)
                self._character = session.charid
                self._busy = False
                self._serial = 0
                self._selected = None
                self._selectedHook = None
                self._pending = None
                self._rows = []
                self._rendering = False
                self._rangeMeters = 0
                top = Container(parent=self.content, align=C.TOTOP, height=36)
                Button(parent=top, align=C.TOLEFT, width=115, label=u'Обновить', func=self.Refresh)
                self.startButton = Button(parent=top, align=C.TOLEFT, width=115, label=u'Включить', func=self.Start)
                self.pauseButton = Button(parent=top, align=C.TOLEFT, width=115, label=u'Пауза', func=self.Pause)
                self.status = EveLabelMedium(parent=self.content, align=C.TOTOP, height=45, maxLines=2,
                    text=u'Выберите скайхук слева. Управление доступно удалённо; сбор — рядом со структурой.')
                filters = Container(parent=self.content, align=C.TOTOP, height=36)
                self.systemFilter = Combo(parent=filters, align=C.TOLEFT, width=270,
                    options=[(u'Все системы', 'all'), (u'Текущая система', 'current')], select='all', callback=self.FilterChanged)
                self.stateFilter = Combo(parent=filters, align=C.TOLEFT, width=240,
                    options=[(u'Все состояния', 'all'), (u'Работают', 'running'), (u'На паузе', 'paused'),
                             (u'Не настроены', 'not_configured'), (u'Есть заполненные отделения', 'full')],
                    select='all', callback=self.FilterChanged)
                bottom = Container(parent=self.content, align=C.TOBOTTOM, height=86)
                self.hold = Combo(parent=bottom, align=C.TOPLEFT, width=220,
                    options=[(u'Обычный трюм', 5), (u'Планетарный трюм', 149), (u'Инфраструктурный трюм', 185)], select=5)
                self.quantity = SingleLineEditText(parent=bottom, align=C.TOPLEFT, left=230, width=120, setvalue='40320')
                self.collectButton = Button(parent=bottom, align=C.TOPRIGHT, width=180, label=u'Забрать', func=self.Collect)
                self.collectHint = EveLabelMedium(parent=bottom, align=C.TOBOTTOM, height=48, maxLines=3, text=u'')
                body = Container(parent=self.content, align=C.TOALL)
                left = Container(parent=body, align=C.TOLEFT, width=490)
                self.hookGrid = Scroll(parent=left, align=C.TOALL, multiSelect=False)
                right = Container(parent=body, align=C.TOALL)
                self.details = EveLabelMedium(parent=right, align=C.TOTOP, height=45, maxLines=2, text=u'Выберите скайхук.')
                self.productGrid = Scroll(parent=right, align=C.TOALL, multiSelect=False)
                self.hookGrid.Load(contentList=[], noContentHint=u'Нажмите «Обновить».')
                self.productGrid.Load(contentList=[], noContentHint=u'Выберите скайхук слева.')
                self.UpdateControls()
                _pi_uthread.new(self.WatchRange)

            def Valid(self):
                return not self.destroyed and _pi_owner.usable() and self._character == session.charid

            def Status(self, value):
                if not self.destroyed:
                    self.status.text = _pi_text(value)

            def SystemName(self, row):
                if '_systemName' not in row:
                    name = row.get('solarSystemName')
                    if not name:
                        try:
                            name = getattr(_pi_builtins, 'cfg').evelocations.Get(row['solarSystemID']).locationName
                        except Exception:
                            name = unicode(row['solarSystemID'])
                    row['_systemName'] = unicode(name)
                return row['_systemName']

            def PlanetTypeName(self, row):
                try:
                    import evetypes
                    name = unicode(evetypes.GetName(int(row['planetTypeID'])))
                    if name.startswith(u'Planet (') and name.endswith(u')'):
                        return name[8:-1]
                    return name or u'Неизвестный тип'
                except Exception:
                    return u'Неизвестный тип'

            def StateName(self, row):
                return {'running': u'Работает', 'paused': u'Пауза', 'not_configured': u'Не настроен',
                        'destroyed': u'Уничтожен'}.get(row['status'], row['status'])

            def Filled(self, row):
                cap = row['config']['capacityPerProduct']
                return sum(1 for p in row['products'] if p['quantity'] >= cap)

            def FilterChanged(self, *args):
                if not self._rendering:
                    self.RenderHooks()

            def RenderHooks(self):
                self._rendering = True
                try:
                    systemFilter = self.systemFilter.GetValue()
                    stateFilter = self.stateFilter.GetValue()
                    current = getattr(session, 'solarsystemid2', None)
                    visible = []
                    for row in self._rows:
                        if systemFilter == 'current' and row['solarSystemID'] != current:
                            continue
                        if systemFilter not in ('all', 'current') and row['solarSystemID'] != systemFilter:
                            continue
                        if stateFilter == 'full' and not self.Filled(row):
                            continue
                        if stateFilter not in ('all', 'full') and row['status'] != stateFilter:
                            continue
                        visible.append(row)
                    visible.sort(key=lambda r: (self.SystemName(r).lower(), unicode(r.get('planetName', r['planetID'])), r['itemID']))
                    oldID = self._selectedHook['itemID'] if self._selectedHook else None
                    self._selectedHook = next((r for r in visible if r['itemID'] == oldID), visible[0] if visible else None)
                    entries = []
                    for row in visible:
                        capacity = row['config']['capacityPerProduct'] * len(row['products'])
                        total = sum(p['quantity'] for p in row['products'])
                        percent = 100.0 * total / capacity if capacity else 0
                        label = u'%s<t>%s [%s]<t>%s<t>%.0f%% (%s/%s)' % (_pi_text(self.SystemName(row)),
                            _pi_text(row.get('planetName', row['planetID'])), _pi_text(self.PlanetTypeName(row)), self.StateName(row),
                            percent, self.Filled(row), len(row['products']))
                        entries.append(GetFromClass(Generic, {'label': label, 'piHook': row, 'selected': self._selectedHook is row, 'OnClick': self.SelectHook}))
                    self.hookGrid.Load(contentList=entries, headers=[u'Система', u'Планета / тип', u'Состояние', u'Склад / полных'],
                        noContentHint=u'Нет скайхуков для выбранных фильтров.')
                    self.RenderProducts()
                finally:
                    self._rendering = False

            def SelectHook(self, entry, *args):
                row = entry.sr.node.piHook
                if self._selectedHook and self._selectedHook['itemID'] == row['itemID']:
                    return
                self._selectedHook = row
                self.RenderProducts()

            def RenderProducts(self):
                row = self._selectedHook
                old = self._selected
                self._selected = None
                entries = []
                if row:
                    if old and old[0]['itemID'] == row['itemID']:
                        product = next((p for p in row['products'] if p['typeID'] == old[1]['typeID']), None)
                        if product:
                            self._selected = (row, product)
                    cfg = row['config']
                    rate = float(cfg['amountPerCycle']) * 3600000 / cfg['cycleMs']
                    self.details.text = u'%s — %s [%s]<br>%s; весь набор P1' % (_pi_text(self.SystemName(row)),
                        _pi_text(row.get('planetName', row['planetID'])), _pi_text(self.PlanetTypeName(row)), self.StateName(row))
                    for product in row['products']:
                        selected = bool(self._selected and self._selected[1]['typeID'] == product['typeID'])
                        label = u'%s<t>%s / %s<t>%.1f' % (_pi_text(product['name']), product['quantity'], cfg['capacityPerProduct'], rate)
                        entries.append(GetFromClass(Generic, {'label': label, 'piRow': (row, product), 'selected': selected, 'OnClick': self.Select}))
                else:
                    self.details.text = u'Выберите скайхук.'
                self.productGrid.Load(contentList=entries, headers=[u'P1', u'Запас', u'В час при работе'], noContentHint=u'Выберите скайхук слева.')
                self.UpdateControls()

            def Select(self, entry, *args):
                self._selected = entry.sr.node.piRow
                self.UpdateControls()

            def RangeState(self):
                row = self._selectedHook
                if row is None:
                    return False, u'Выберите скайхук.'
                if getattr(session, 'solarsystemid', None) != row['solarSystemID']:
                    return False, u'Для сбора выйдите в космос в системе %s.' % self.SystemName(row)
                try:
                    park = sm.GetService('michelle').GetBallpark()
                    ball = park.GetBall(row['itemID']) if park else None
                    distance = float(ball.surfaceDist) if ball else None
                    if distance is not None and self._rangeMeters > 0 and distance <= self._rangeMeters:
                        return True, u'Скайхук рядом. Итоговую дистанцию и вместимость проверит сервер.'
                except Exception:
                    pass
                return False, u'Подлетите к скайхуку (дистанция сбора: %s м).' % self._rangeMeters

            def UpdateControls(self):
                if self.destroyed:
                    return
                row = self._selectedHook
                manage = row is not None and row.get('canManage') and not self._busy and self._pending is None
                self.startButton.Enable() if manage and row.get('active', True) and row['status'] != 'running' else self.startButton.Disable()
                self.pauseButton.Enable() if manage and row['status'] == 'running' else self.pauseButton.Disable()
                if self._pending is not None:
                    self.collectButton.SetLabel(u'Повторить запрос')
                    self.collectHint.text = u'Ожидает подтверждения: %s; скайхук %s. Повторяется исходная операция.' % (_pi_text(self._pending['action']), self._pending['itemID'])
                    enabled = not self._busy
                else:
                    self.collectButton.SetLabel(u'Забрать')
                    near, hint = self.RangeState()
                    product = self._selected[1] if self._selected else None
                    if near and product is None:
                        hint = u'Выберите P1 справа, укажите количество и трюм.'
                    elif near and product['quantity'] <= 0:
                        hint = u'Выбранный продукт пока не накоплен. Обновите список после цикла.'
                    self.collectHint.text = _pi_text(hint)
                    enabled = near and product is not None and product['quantity'] > 0 and not self._busy
                self.collectButton.Enable() if enabled else self.collectButton.Disable()

            def WatchRange(self):
                current = getattr(session, 'solarsystemid2', None)
                while self.Valid():
                    _pi_blue.pyos.synchro.SleepWallclock(1000)
                    if not self.Valid():
                        return
                    system = getattr(session, 'solarsystemid2', None)
                    if system != current and self.systemFilter.GetValue() == 'current':
                        self.RenderHooks()
                    current = system
                    self.UpdateControls()

            def Refresh(self, *args):
                if not self.Valid() or self._busy:
                    return
                self._busy = True
                self.UpdateControls()
                self._serial += 1
                _pi_uthread.new(self.RefreshWork, self._serial)

            def RefreshWork(self, serial):
                try:
                    result = _pi_json.loads(sm.RemoteSvc('planetMgr').SkyhookPiList())
                    if not self.Valid() or serial != self._serial:
                        return
                    if not result.get('ok'):
                        self.Status(result.get('code', u'Ошибка обновления'))
                        return
                    if result.get('characterID') != self._character:
                        return
                    self._rows = result.get('rows', [])
                    self._rangeMeters = result.get('collectRangeMeters', 0)
                    selected = self.systemFilter.GetValue()
                    systems = dict((r['solarSystemID'], self.SystemName(r)) for r in self._rows)
                    options = [(u'Все системы', 'all'), (u'Текущая система', 'current')]
                    options += [(name, sid) for sid, name in sorted(systems.items(), key=lambda pair: pair[1].lower())]
                    if selected not in ('all', 'current') and selected not in systems:
                        selected = 'all'
                    self._rendering = True
                    try:
                        self.systemFilter.LoadOptions(options, select=selected)
                    finally:
                        self._rendering = False
                    self.RenderHooks()
                    self.Status(u'Скайхуков: %s. Выберите структуру слева, продукт справа.' % len(self._rows))
                except Exception as error:
                    if self.Valid():
                        self.Status(unicode(error))
                finally:
                    if self.Valid() and serial == self._serial:
                        self._busy = False
                        self.UpdateControls()

            def Start(self, *args):
                self.Action('start')

            def Pause(self, *args):
                self.Action('pause')

            def Collect(self, *args):
                self.Action('collect')

            def Action(self, action):
                if not self.Valid() or self._busy:
                    return
                if self._pending is None:
                    row = self._selectedHook
                    if row is None:
                        self.Status(u'Выберите скайхук слева.')
                        return
                    if action != 'collect' and not row.get('canManage'):
                        self.Status(u'Управлять может установивший персонаж или руководство корпорации.')
                        return
                    request = {'action': action, 'itemID': row['itemID'], 'requestID': _pi_uuid.uuid4().hex}
                    if action == 'collect':
                        if self._selected is None:
                            self.Status(u'Выберите P1 справа.')
                            return
                        near, hint = self.RangeState()
                        if not near:
                            self.Status(hint)
                            return
                        product = self._selected[1]
                        try:
                            quantity = int(self.quantity.GetValue())
                            if quantity <= 0:
                                raise ValueError('quantity')
                        except Exception:
                            self.Status(u'Введите положительное целое количество.')
                            return
                        request.update(typeID=product['typeID'], quantity=quantity, flagID=self.hold.GetValue())
                    self._pending = request
                self._busy = True
                self.UpdateControls()
                self._serial += 1
                _pi_uthread.new(self.ActionWork, self._serial, self._pending.copy())

            def ActionWork(self, serial, request):
                try:
                    result = _pi_json.loads(sm.RemoteSvc('planetMgr').SkyhookPiAction(_pi_json.dumps(request)))
                    if not self.Valid() or serial != self._serial:
                        return
                    code = result.get('code', 'UNKNOWN_RESULT')
                    if result.get('requestID') == request['requestID'] and code != 'RECOVERY_PENDING':
                        self._pending = None
                    elif code in ('ACCESS_DENIED', 'MANAGE_DENIED', 'EMPTY_STOCK', 'CARGO_FULL', 'SKYHOOK_OUT_OF_RANGE', 'SKYHOOK_NOT_ACTIVE', 'PLAYER_CORPORATION_REQUIRED', 'INVALID_HOLD', 'SHIP_NOT_IN_SYSTEM', 'SKYHOOK_UNAVAILABLE', 'NOT_CONFIGURED'):
                        self._pending = None
                    self.Status(u'%s; выдано: %s. Нажмите «Обновить».' % (code, result.get('quantity', 0)))
                except Exception as error:
                    if self.Valid():
                        self.Status(u'Ответ не подтверждён: %s. Повторите — запрос сохранён.' % unicode(error))
                finally:
                    if self.Valid() and serial == self._serial:
                        self._busy = False
                        self.UpdateControls()

        return SkyhookPiWindow
    class _SkyhookPiCompanion(object):
        __notifyevents__ = ['OnSessionChanged', 'OnSkyhookPiOpen']

        def __init__(self):
            self.active = True
            self.ready = False
            self.character = None
            self.generation = 0
            self.registered = []

        def current(self):
            return self.active and getattr(_pi_builtins, _pi_key, None) is self

        def usable(self):
            return self.current() and self.ready and session is not None and self.character == getattr(session, 'charid', None)

        def close_window(self):
            if _pi_window_class is not None:
                window = _pi_window_class.GetIfOpen()
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
                    _pi_blue.pyos.synchro.SleepWallclock(500)
                    if not self.current():
                        return
                    sm = _pi_context.get('sm', getattr(_pi_builtins, 'sm', None))
                    session = _pi_context.get('session', getattr(_pi_builtins, 'session', None))
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
                print('SKYHOOK_PI:BOOT_FAILED')

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
                _pi_uthread.new(self.connect, self.generation)

        def connect(self, generation):
            for attempt in range(6):
                _pi_blue.pyos.synchro.SleepWallclock(1500)
                if not self.current() or generation != self.generation:
                    return
                try:
                    result = _pi_json.loads(sm.RemoteSvc('planetMgr').SkyhookPiReady())
                    if not self.current() or generation != self.generation:
                        return
                    if result.get('ok') and result.get('version') == '0.1.11':
                        self.ready = True
                        print('SKYHOOK_PI:READY:0.1.11')
                        return
                except Exception:
                    pass
            print('SKYHOOK_PI:NOT_READY')

        def OnSkyhookPiOpen(self, query=''):
            global _pi_window_class
            if not self.usable():
                return
            try:
                if _pi_window_class is None:
                    _pi_window_class = _pi_build_window()
                window = _pi_window_class.Open()
                window.Refresh()
            except Exception:
                import log
                log.LogException('Skyhook PI window failed to open')
                from player_messaging.client.ui_message import message_player
                message_player(u'Skyhook PI: окно не открылось. Проверьте клиентский лог.')

    _pi_owner = _SkyhookPiCompanion()
    setattr(_pi_builtins, _pi_key, _pi_owner)
    _pi_uthread.new(_pi_owner.start)
except Exception:
    print('SKYHOOK_PI:LOAD_FAILED')

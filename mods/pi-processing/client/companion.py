# coding: utf-8
# Python 2.7 EVE companion; delivery/lifecycle adapted from Market Search.
try:
    import __builtin__ as _pi_builtins
    import json as _pi_json
    import uthread as _pi_uthread
    import blue as _pi_blue
    import uuid as _pi_uuid
    _pi_key = '_evejs_pi_processing_v1'
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

        class PiProcessingWindow(Window):
            default_windowID = 'EveJSPIProcessing'
            default_caption = u'Переработка PI 0.1.0'
            default_width = 1050
            default_height = 650
            default_minSize = (950, 580)
            default_isStackable = False
            default_scope = C.SCOPE_INGAME

            def ApplyAttributes(self, attributes):
                Window.ApplyAttributes(self, attributes)
                self._character = session.charid
                self._busy = False
                self._serial = 0
                self._recipes = []
                self._jobs = []
                self._recipe = None
                self._job = None
                self._quote = None
                self._next = None
                self._serverNow = 0
                self._clock = _pi_blue.os.GetWallclockTime()
                self._location = self.Location()
                top = Container(parent=self.content, align=C.TOTOP, height=36)
                self.mode = Combo(parent=top, align=C.TOLEFT, width=190, options=[(u'Производство', 'recipes'), (u'Задания', 'jobs')], select='recipes', callback=self.Filter)
                self.tier = Combo(parent=top, align=C.TOLEFT, width=100, options=[(u'Все тиры', 0), ('P2', 2), ('P3', 3), ('P4', 4)], select=0, callback=self.Filter)
                self.search = SingleLineEditText(parent=top, align=C.TOLEFT, width=230, setvalue='')
                Button(parent=top, align=C.TOLEFT, width=110, label=u'Найти', func=self.Filter)
                Button(parent=top, align=C.TOLEFT, width=110, label=u'Обновить', func=self.Refresh)
                Button(parent=top, align=C.TOLEFT, width=110, label=u'Ещё задания', func=self.More)
                self.status = EveLabelMedium(parent=self.content, align=C.TOTOP, height=45, maxLines=2, text=u'Материалы и результат — в личном ангаре места запуска.')
                bottom = Container(parent=self.content, align=C.TOBOTTOM, height=40)
                EveLabelMedium(parent=bottom, align=C.TOLEFT, width=95, text=u'Циклы:')
                self.quantity = SingleLineEditText(parent=bottom, align=C.TOLEFT, width=120, setvalue='1')
                Button(parent=bottom, align=C.TOLEFT, width=110, label=u'Рассчитать', func=self.Quote)
                Button(parent=bottom, align=C.TOLEFT, width=110, label=u'Максимум', func=self.Maximum)
                self.startButton = Button(parent=bottom, align=C.TOLEFT, width=125, label=u'Запустить', func=self.Start)
                self.collectButton = Button(parent=bottom, align=C.TOLEFT, width=125, label=u'Забрать', func=self.Collect)
                Button(parent=bottom, align=C.TOLEFT, width=160, label=u'Повторить запрос', func=self.Retry)
                self.details = EveLabelMedium(parent=self.content, align=C.TOBOTTOM, height=145, maxLines=8, text=u'Выберите продукт.')
                self.grid = Scroll(parent=self.content, align=C.TOALL, multiSelect=False)
                self.grid.Load(contentList=[])
                self.Controls()
                _pi_uthread.new(self.Tick)

            def Location(self):
                return getattr(session, 'structureid', None) or getattr(session, 'stationid', None)

            def Valid(self):
                return not self.destroyed and _pi_owner.usable() and self._character == session.charid

            def Status(self, text):
                if not self.destroyed:
                    self.status.text = _pi_text(text)

            def Name(self, typeID):
                try:
                    import evetypes
                    return unicode(evetypes.GetName(int(typeID)))
                except Exception:
                    return unicode(typeID)

            def Place(self, locationID):
                try:
                    return unicode(getattr(_pi_builtins, 'cfg').evelocations.Get(locationID).locationName)
                except Exception:
                    return unicode(locationID)

            def Now(self):
                return self._serverNow + (_pi_blue.os.GetWallclockTime() - self._clock) / 10000

            def Call(self, method, payload):
                result = _pi_json.loads(getattr(sm.RemoteSvc('planetMgr'), 'PiProcessing' + method)(_pi_json.dumps(payload)))
                if not self.Valid() or self._workLocation != self.Location() or self._workSerial != self._serial:
                    raise RuntimeError(u'Сессия изменилась. Обновите окно.')
                if not result.get('ok'):
                    raise RuntimeError(result.get('message', result.get('code', 'Request failed')))
                self._serverNow = result.get('serverNow', self.Now())
                self._clock = _pi_blue.os.GetWallclockTime()
                return result

            def Run(self, worker, *args):
                if not self.Valid() or self._busy:
                    return
                self._busy = True
                self._serial += 1
                self._workLocation = self.Location()
                self._workSerial = self._serial
                _pi_uthread.new(self.Work, self._serial, self.Location(), worker, args)
                self.Controls()

            def Work(self, serial, location, worker, args):
                try:
                    result = worker(*args)
                    if self.Valid() and serial == self._serial and location == self.Location():
                        self.Render()
                except Exception as error:
                    if self.Valid():
                        self.Status(unicode(error))
                finally:
                    if self.Valid():
                        self._busy = False
                        self.Controls()

            def Refresh(self, *args):
                self.Run(self.Load)

            def Load(self):
                recipes = self.Call('Catalogue', {})['recipes']
                result = self.Call('Jobs', {'limit': 50})
                if not self.Valid():
                    return
                self._recipes = recipes
                self._jobs = result['jobs']
                self._next = result.get('nextCursor')
                if self._job:
                    self._job = next((j for j in self._jobs if j['id'] == self._job['id']), None)
                self.Status(u'Место: %s. Для запуска и получения нужен док.' % self.Place(self.Location()) if self.Location() else u'Вы в космосе. Доступен просмотр заданий.')

            def More(self, *args):
                if self._next:
                    self.Run(self.LoadMore)

            def LoadMore(self):
                result = self.Call('Jobs', {'cursor': self._next, 'limit': 50})
                if self.Valid():
                    self._jobs.extend(result['jobs'])
                    self._next = result.get('nextCursor')

            def Filter(self, *args):
                if hasattr(self, 'grid'):
                    self.Render()

            def Render(self):
                entries = []
                if self.mode.GetValue() == 'recipes':
                    term = unicode(self.search.GetValue()).lower().strip()
                    for r in self._recipes:
                        name = self.Name(r['outputs'][0]['typeID'])
                        if self.tier.GetValue() not in (0, r['tier']) or term and term not in name.lower():
                            continue
                        entries.append(GetFromClass(Generic, {'label': u'%s<t>P%s<t>%s мин' % (_pi_text(name), r['tier'], r['cycleMs'] / 60000), 'piRow': r, 'OnClick': self.SelectRecipe}))
                    headers = [u'Продукт', u'Тир', u'Время партии']
                else:
                    for j in self._jobs:
                        state = { 'starting': u'Восстановление', 'running': u'Готово' if self.Now() >= j['finishAtMs'] else u'Производство', 'delivering': u'Выдача', 'delivered': u'Получено', 'rejected': u'Не запущено' }.get(j['status'], j['status'])
                        entries.append(GetFromClass(Generic, {'label': u'%s<t>%s<t>%s<t>%s' % (_pi_text(self.Name(j['outputs'][0]['typeID'])), j['outputs'][0]['quantity'], _pi_text(self.Place(j['locationID'])), state), 'piRow': j, 'OnClick': self.SelectJob}))
                    headers = [u'Продукт', u'Количество', u'Место', u'Статус']
                self.grid.Load(contentList=entries, headers=headers, noContentHint=u'Нет записей. Нажмите «Обновить».')
                self.Controls()

            def SelectRecipe(self, entry, *args):
                self._recipe = entry.sr.node.piRow
                self._quote = None
                self.Controls()
                self.Quote()

            def SelectJob(self, entry, *args):
                self._job = entry.sr.node.piRow
                self.Controls()

            def Batches(self):
                n = int(self.quantity.GetValue())
                if n <= 0:
                    raise ValueError(u'Введите положительное число циклов.')
                return n

            def Quote(self, *args):
                if self._recipe:
                    self.Run(self.LoadQuote, False)

            def Maximum(self, *args):
                if self._recipe:
                    self.Run(self.LoadQuote, True)

            def LoadQuote(self, maximum):
                r = self._recipe
                result = self.Call('Quote', {'schematicID': r['schematicID'], 'batches': 1 if maximum else self.Batches()})
                if maximum and result['maxBatches']:
                    self.quantity.SetValue(str(result['maxBatches']))
                    result = self.Call('Quote', {'schematicID': r['schematicID'], 'batches': result['maxBatches']})
                if self.Valid() and self._recipe is r:
                    self._quote = result

            def Controls(self):
                if self.destroyed:
                    return
                recipes = self.mode.GetValue() == 'recipes'
                ready = self._job and self._job['status'] == 'running' and self.Now() >= self._job['finishAtMs'] and self.Location() == self._job['locationID'] and self._job.get('locationExists')
                self.startButton.Enable() if recipes and self._recipe and self.Location() and not self._busy else self.startButton.Disable()
                self.collectButton.Enable() if not recipes and ready and not self._busy else self.collectButton.Disable()
                if recipes and self._recipe:
                    r = self._recipe
                    q = self._quote
                    lines = [u'%s — %s мин на всю партию' % (_pi_text(self.Name(r['outputs'][0]['typeID'])), r['cycleMs'] / 60000)]
                    if q:
                        lines.extend(u'%s: нужно %s / есть %s' % (_pi_text(self.Name(e['typeID'])), e['quantity'], e['available']) for e in q['inputs'])
                        lines.append(u'Выход: %s; максимум циклов: %s' % (q['outputs'][0]['quantity'], q['maxBatches']))
                    else:
                        lines.append(u'Нажмите «Рассчитать», находясь в доке.')
                    self.details.text = '<br>'.join(lines)
                elif not recipes and self._job:
                    j = self._job
                    seconds = max(0, int((j['finishAtMs'] - self.Now()) / 1000))
                    self.details.text = u'%s<br>Осталось: %s мин %s сек. Получение в исходном ангаре.<br>%s' % (_pi_text(self.Place(j['locationID'])), seconds // 60, seconds % 60, u'Место недоступно. Автоматического Asset Safety нет.' if not j.get('locationExists') else u'')

            def Pending(self):
                try:
                    return getattr(_pi_builtins, 'settings').char.ui.Get('evejsPiProcessingPending', None)
                except Exception:
                    return getattr(_pi_owner, 'pending', None)

            def SavePending(self, value):
                try:
                    getattr(_pi_builtins, 'settings').char.ui.Set('evejsPiProcessingPending', value)
                except Exception:
                    if value is not None:
                        raise RuntimeError(u'Не удалось сохранить запрос в настройках клиента. Перезапустите клиент.')
                _pi_owner.pending = value

            def Start(self, *args):
                if not self._recipe or self._busy:
                    return
                if self.Pending():
                    self.Status(u'Есть неподтверждённый запрос. Нажмите «Повторить запрос».')
                    return
                try:
                    payload = {'schematicID': self._recipe['schematicID'], 'batches': self.Batches(), 'requestID': str(_pi_uuid.uuid4())}
                    self.SavePending({'method': 'Start', 'payload': payload, 'character': self._character, 'location': self.Location()})
                    self.Retry()
                except Exception as error:
                    self.Status(unicode(error))

            def Collect(self, *args):
                if not self._job or self._busy:
                    return
                if self.Pending():
                    self.Status(u'Есть неподтверждённый запрос. Нажмите «Повторить запрос».')
                    return
                self.SavePending({'method': 'Collect', 'payload': {'jobID': self._job['id'], 'requestID': str(_pi_uuid.uuid4())}, 'character': self._character, 'location': self.Location()})
                self.Retry()

            def Retry(self, *args):
                pending = self.Pending()
                if pending and pending.get('character') == self._character:
                    if pending.get('location') != self.Location():
                        self.Status(u'Вернитесь в место исходного запроса для повтора.')
                        return
                    self.Run(self.Action, pending)

            def Action(self, pending):
                result = _pi_json.loads(getattr(sm.RemoteSvc('planetMgr'), 'PiProcessing' + pending['method'])(_pi_json.dumps(pending['payload'])))
                if not self.Valid():
                    return
                if result.get('ok'):
                    job = result['job']
                    if job['status'] not in ('starting', 'delivering'):
                        self.SavePending(None)
                    self.Status(u'Запрос обработан. Статус: %s' % job['status'])
                    self.Load()
                elif result.get('code') in ('INVALID_REQUEST', 'INVALID_REQUEST_ID', 'INVALID_QUANTITY', 'RECIPE_NOT_FOUND', 'INSUFFICIENT_MATERIALS', 'INSUFFICIENT_MATERIALS_OR_QUANTITY_LIMIT', 'TOO_MANY_STACKS', 'JOB_NOT_FOUND', 'JOB_NOT_READY', 'DOCK_AT_JOB_LOCATION', 'LOCATION_UNAVAILABLE', 'LOCATION_ACCESS_DENIED'):
                    self.SavePending(None)
                    self.Status(result.get('message', result.get('code')))
                else:
                    self.Status((result.get('message') or u'Результат пока не подтверждён.') + u' Используйте «Повторить запрос».')

            def Tick(self):
                while self.Valid():
                    _pi_blue.pyos.synchro.SleepWallclock(1000)
                    if self.Valid():
                        if self.Location() != self._location:
                            self._location = self.Location()
                            self._quote = None
                            self._serial += 1
                            self.Status(u'Место изменилось. Обновите список.')
                        self.Controls()

        return PiProcessingWindow

    class _PiProcessingCompanion(object):
        __notifyevents__ = ['OnSessionChanged', 'OnPiProcessingOpen']

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
                print('PI_PROCESSING:BOOT_FAILED')

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
            self.pending = None
            self.generation += 1
            if character:
                _pi_uthread.new(self.connect, self.generation)

        def connect(self, generation):
            for attempt in range(6):
                _pi_blue.pyos.synchro.SleepWallclock(1500)
                if not self.current() or generation != self.generation:
                    return
                try:
                    result = _pi_json.loads(sm.RemoteSvc('planetMgr').PiProcessingReady())
                    if not self.current() or generation != self.generation:
                        return
                    if result.get('ok') and result.get('version') == '0.1.0':
                        self.ready = True
                        print('PI_PROCESSING:READY:0.1.0')
                        return
                except Exception:
                    pass
            print('PI_PROCESSING:NOT_READY')

        def OnPiProcessingOpen(self, query=''):
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
                log.LogException('PI Processing window failed to open')
                from player_messaging.client.ui_message import message_player
                message_player(u'PI Processing: окно не открылось. Проверьте клиентский лог.')

    _pi_owner = _PiProcessingCompanion()
    setattr(_pi_builtins, _pi_key, _pi_owner)
    _pi_uthread.new(_pi_owner.start)
except Exception:
    print('PI_PROCESSING:LOAD_FAILED')

# Transient login payload. This file is never written to the EVE installation.
try:
    import __builtin__ as _fsc_builtins
    import base64 as _fsc_base64
    import hashlib as _fsc_hashlib
    import json as _fsc_json
    import zlib as _fsc_zlib
    import uthread as _fsc_uthread
    import blue as _fsc_blue

    _fsc_key = '_evejs_ourmods_fitting_runtime'
    # Retire the historical standalone donor on reconnect.
    _fsc_legacy = getattr(_fsc_builtins, '_evejs_fitting_simulation_v1', None)
    if _fsc_legacy is not None:
        _fsc_legacy.dispose()
        delattr(_fsc_builtins, '_evejs_fitting_simulation_v1')
    _fsc_previous = getattr(_fsc_builtins, _fsc_key, None)
    if _fsc_previous is not None:
        _fsc_previous.dispose()

    class _FittingSimulationLogin(object):
        __notifyevents__ = ['OnSessionChanged', 'OnDisconnect']

        def __init__(self):
            self.abi = 1
            self.bundle_revision = 2
            self.active = True
            self.controller = None
            self.registered = []
            self.sm = None
            self.session = None
            self.character = None
            self.generation = 0

        def current(self):
            return self.active and getattr(_fsc_builtins, _fsc_key, None) is self

        def usable(self):
            return self.current() and self.character is not None and self.character == getattr(self.session, 'charid', None)

        def dispose_controller(self):
            controller = self.controller
            self.controller = None
            if controller is not None:
                controller.dispose()

        def dispose_local(self, controller):
            if controller is not None:
                if self.controller is controller:
                    self.controller = None
                controller.dispose()

        def dispose(self):
            self.active = False
            self.generation += 1
            try:
                self.dispose_controller()
            finally:
                for event in self.registered:
                    try:
                        self.sm.UnregisterForNotifyEvent(self, event)
                    except Exception:
                        pass
                self.registered = []

        def OnDisconnect(self, *args):
            self.dispose()

        def OnSessionChanged(self, *args):
            if not self.current():
                return
            character = getattr(self.session, 'charid', None)
            if character != self.character:
                self.generation += 1
                self.dispose_controller()
                self.character = character
                if character:
                    _fsc_uthread.new(self.connect, self.generation)

        def start(self):
            try:
                _fsc_boot = _fsc_context.get('boot', getattr(_fsc_builtins, 'boot', None))
                if int(getattr(_fsc_boot, 'build', 0)) != 3396210:
                    self.dispose()
                    return
                self.policy = _fsc_json.loads(_fsc_base64.b64decode(_fsc_policy64))
                self.checks = _fsc_json.loads(_fsc_base64.b64decode(_fsc_checks64))
                self.namespace = {'__builtins__': _fsc_builtins, '__name__': 'evejs_fitting_simulation'}
                eval(compile(_fsc_zlib.decompress(_fsc_base64.b64decode(_fsc_source64)), '<fitting-simulation-adapter>', 'exec'), self.namespace)
                if self.namespace['validate_policy'](self.policy) is None:
                    self.dispose()
                    return
                for attempt in range(240):
                    _fsc_blue.pyos.synchro.SleepWallclock(500)
                    if not self.current():
                        return
                    self.sm = _fsc_context.get('sm', getattr(_fsc_builtins, 'sm', None))
                    self.session = _fsc_context.get('session', getattr(_fsc_builtins, 'session', None))
                    if self.sm is not None and self.session is not None:
                        break
                else:
                    self.dispose()
                    return
                for event in self.__notifyevents__:
                    self.sm.RegisterForNotifyEvent(self, event)
                    self.registered.append(event)
                self.OnSessionChanged()
            except Exception:
                self.dispose()
                print('FITTING_SIMULATION:UNAVAILABLE')

        def verify(self, functions):
            for key, function in functions.items():
                code = getattr(function, 'func_code', None)
                if code is None or _fsc_hashlib.sha256(code.co_code).hexdigest() != self.checks[key]['bytecodeSha256']:
                    raise RuntimeError('Unsupported fitting seam: ' + key)

        def connect(self, generation):
            for attempt in range(6):
                _fsc_blue.pyos.synchro.SleepWallclock(1000)
                if not self.usable() or generation != self.generation:
                    return
                controller = None
                try:
                    from eve.client.script.ui.shared.fittingScreen.fittingDogmaLocation import FittingDogmaLocation
                    from eve.common.script.dogma.baseDogmaLocation import BaseDogmaLocation
                    from eve.common.lib import appConst
                    from eveexceptions import UserError
                    from localization import GetByLabel
                    self.verify({
                        'fittingDogmaLocation.__init__': FittingDogmaLocation.__init__.im_func,
                        'fittingDogmaLocation.LoadMyShip': FittingDogmaLocation.LoadMyShip.im_func,
                        'fittingDogmaLocation.GetCapacity': FittingDogmaLocation.GetCapacity.im_func,
                        'fittingDogmaLocation.GetAccurateAttributeValue': FittingDogmaLocation.GetAccurateAttributeValue.im_func,
                        'baseDogmaLocation.GetAttributeValue': FittingDogmaLocation.GetAttributeValue.im_func,
                    })
                    valid = self.namespace['validate_policy'](self.policy) or {}
                    providers = dict((key, self.policy['providers'][key]) for key in valid)
                    tracker_method = None
                    picker_class = None
                    cargo_class = None
                    format_hold = None
                    if 'droneclassbalance' in providers:
                        try:
                            from shipfitting.droneUtil import SelectedDroneTracker
                            from eve.client.script.ui.shared.fittingScreen.dronePickerMenu import DronePickerMenu
                            self.verify({
                                'fittingDogmaLocation.GetMaxActiveDrones': FittingDogmaLocation.GetMaxActiveDrones.im_func,
                                'droneUtil.RegisterDroneAsActive': SelectedDroneTracker.RegisterDroneAsActive.im_func,
                                'dronePickerMenu.GetMaxActiveDrones': DronePickerMenu.GetMaxActiveDrones.im_func,
                            })
                            tracker_method = SelectedDroneTracker.RegisterDroneAsActive.im_func
                            picker_class = DronePickerMenu
                        except Exception:
                            providers.pop('droneclassbalance', None)
                            print('FITTING_SIMULATION:DCB_UNAVAILABLE')
                    if 'soloprogressionbalance' in providers:
                        try:
                            from eve.client.script.ui.inflight.shipModuleButton.moduleButtonTooltip import ModuleButtonTooltip
                            from eve.client.script.ui.shared.fittingScreen.droneTooltip import DroneTooltip, DroneFittingTooltip
                            self.verify({
                                'moduleButtonTooltip.ModuleButtonTooltip.GetEffectiveAttributeValue': ModuleButtonTooltip.GetEffectiveAttributeValue.im_func,
                                'moduleButtonTooltip.ModuleButtonTooltip.AddMiningLaserInfo': ModuleButtonTooltip.AddMiningLaserInfo.im_func,
                                'droneTooltip.DroneTooltip.AddMiningDroneInfo': DroneTooltip.AddMiningDroneInfo.im_func,
                                'droneTooltip.DroneFittingTooltip.GetDogmaLocation': DroneFittingTooltip.GetDogmaLocation.im_func,
                                'fittingDogmaLocation.FittingDogmaLocation.GetFittedItemsToShip': FittingDogmaLocation.GetFittedItemsToShip.im_func,
                            })
                        except Exception:
                            providers.pop('soloprogressionbalance', None)
                            print('FITTING_SIMULATION:SOLO_UNAVAILABLE')
                    if 'soloprogressionbalance' in providers:
                        # Presentation is optional even when Solo Dogma is compatible.
                        try:
                            from eve.client.script.ui.shared.fittingScreen.fittingPanels.minihangar import CargoSlots, CargoCargoSlots
                            from dogma.data import get_attribute_display_name
                            from carbon.common.script.util.format import FmtAmt
                            self.verify({
                                'minihangar.CargoSlots.ApplyAttributes': CargoSlots.ApplyAttributes.im_func,
                                'minihangar.CargoCargoSlots.GetSimulatedCapacity': CargoCargoSlots.GetSimulatedCapacity.im_func,
                                'minihangar.CargoSlots._Update': CargoCargoSlots._Update.im_func,
                            })
                            def format_hold(attribute_id, value):
                                label = get_attribute_display_name(attribute_id)
                                return u'%s: %s m\u00b3' % (label, FmtAmt(value, showFraction=1)) if label else None
                            cargo_class = CargoCargoSlots
                        except Exception:
                            print('FITTING_SIMULATION:HOLD_HINT_UNAVAILABLE')
                    if not providers:
                        return
                    effective_policy = dict(self.policy)
                    effective_policy['providers'] = providers
                    def warning(kind, limit):
                        if kind == 'count':
                            text = GetByLabel('UI/Fitting/FittingWindow/ActiveDronesLimitWarning', limit=limit)
                        else:
                            text = GetByLabel('UI/Fitting/FittingWindow/ActiveDroneBandwithWarning')
                        raise UserError('CustomNotify', {'notify': text})
                    # Services may yield while a newer session/connect task wins.
                    existing = self.sm.GetService('clientDogmaIM').fittingDogmaLocation
                    ghost_service = self.sm.GetService('ghostFittingSvc')
                    if not self.usable() or generation != self.generation:
                        return
                    controller = self.namespace['PrivateGhostRuntime'](effective_policy, FittingDogmaLocation,
                        tracker_method, appConst.attributeDroneBandwidthUsed,
                        self.session, self.usable, warning, picker_class, cargo_class, format_hold)
                    self.controller = controller
                    controller.install(existing)
                    if not self.usable() or generation != self.generation:
                        self.dispose_local(controller)
                        return
                    ghost_service.SendOnStatsUpdatedEvent()
                    if not self.usable() or generation != self.generation:
                        self.dispose_local(controller)
                        return
                    print('FITTING_SIMULATION:READY:' + self.policy['revision'])
                    return
                except Exception:
                    # A stale task can only dispose its own controller, never a
                    # newer session's successfully installed owner.
                    self.dispose_local(controller)
            print('FITTING_SIMULATION:UNAVAILABLE')

    _fsc_handler = _FittingSimulationLogin()
    setattr(_fsc_builtins, _fsc_key, _fsc_handler)
    _fsc_uthread.new(_fsc_handler.start)
except Exception:
    # Never prevent the original EveJS login from returning normally.
    print('FITTING_SIMULATION:UNAVAILABLE')

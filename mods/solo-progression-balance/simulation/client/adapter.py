# Python 2.7/3 compatible. No imports of, or changes to, live ClientDogmaLocation.
import math
import types
import weakref

try:
    INTEGER_TYPES = (int, long)
    STRING_TYPES = (basestring,)
except NameError:
    INTEGER_TYPES = (int,)
    STRING_TYPES = (str,)

BANDWIDTH = 1271
BAY = 283
MAX_ACTIVE = 352
SUPPORTED_EVEJS = '261018.1'


def _positive(value):
    return not isinstance(value, bool) and isinstance(value, INTEGER_TYPES + (float,)) and value > 0 and not math.isinf(value) and not math.isnan(value)


def _validate_dcb(provider):
    if not isinstance(provider, dict) or provider.get('schema') != 1:
        return None
    rules, hulls = provider.get('rules'), provider.get('hulls')
    if not isinstance(rules, list) or not isinstance(hulls, dict) or len(rules) > 10000 or len(hulls) > 20000:
        return None
    for rule in rules:
        if not isinstance(rule, list) or len(rule) != 3 or not _positive(rule[0]) or not _positive(rule[1]):
            return None
        limit = rule[2]
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, INTEGER_TYPES) or limit <= 0 or limit > 9007199254740991):
            return None
    resolved = {}
    for key, index in hulls.items():
        if not isinstance(key, STRING_TYPES) or not key.isdigit() or int(key) <= 0 or str(int(key)) != key:
            return None
        if isinstance(index, bool) or not isinstance(index, INTEGER_TYPES) or index < 0 or index >= len(rules):
            return None
        resolved[int(key)] = tuple(rules[index])
    return resolved


def _type_id(value):
    return not isinstance(value, bool) and isinstance(value, INTEGER_TYPES) and 0 < value <= 9007199254740991


def _key_id(value):
    return isinstance(value, STRING_TYPES) and value.isdigit() and _type_id(int(value)) and str(int(value)) == value


def _validate_solo(provider):
    if not isinstance(provider, dict) or provider.get('schema') != 1:
        return None
    programs, ships = provider.get('capacityPrograms'), provider.get('ships')
    if not isinstance(programs, list) or len(programs) > 2000 or not isinstance(ships, dict) or len(ships) > 20000:
        return None
    normalized = []
    for program in programs:
        if not isinstance(program, dict) or len(program) > 128:
            return None
        row = {}
        for key, operations in program.items():
            if not _key_id(key) or int(key) in (BANDWIDTH, BAY, MAX_ACTIVE):
                return None
            if not isinstance(operations, list) or not 0 < len(operations) <= 8 or not all(_positive(x) for x in operations):
                return None
            row[int(key)] = tuple(operations)
        normalized.append(row)
    resolved = {}
    for key, index in ships.items():
        if not _key_id(key) or isinstance(index, bool) or not isinstance(index, INTEGER_TYPES) or not 0 <= index < len(normalized):
            return None
        resolved[int(key)] = normalized[index]
    if provider.get('miningAttribute') != 77:
        return None
    result = {'ships': resolved, 'miningAttribute': 77}
    for family in ('module', 'drone'):
        types_list, scale = provider.get(family + 'Types'), provider.get(family + 'Scale')
        if not isinstance(types_list, list) or len(types_list) > 20000 or not all(_type_id(x) for x in types_list) or not _positive(scale):
            return None
        if len(set(types_list)) != len(types_list):
            return None
        result[family + 'Types'] = set(types_list)
        result[family + 'Scale'] = scale
    if result['moduleTypes'] & result['droneTypes']:
        return None
    return result


def validate_policy(policy):
    if not isinstance(policy, dict) or policy.get('schema') != 1 or policy.get('evejs') != SUPPORTED_EVEJS or policy.get('clientBuild') != 3396210:
        return None
    revision, providers = policy.get('revision'), policy.get('providers')
    if not isinstance(revision, STRING_TYPES) or len(revision) != 64 or any(c not in '0123456789abcdef' for c in revision):
        return None
    if not isinstance(providers, dict) or any(k not in ('droneclassbalance', 'soloprogressionbalance') for k in providers):
        return None
    valid = {}
    for key, validate in (('droneclassbalance', _validate_dcb), ('soloprogressionbalance', _validate_solo)):
        try:
            value = validate(providers.get(key))
            if value is not None:
                valid[key] = value
        except Exception:
            pass
    return valid or None


def scale_round6(value, factor):
    # Match JS Number(value * factor).toFixed(6), including binary midpoint cases.
    if not _positive(value):
        return value
    product = float(value) * factor
    if math.isinf(product) or math.isnan(product) or product < 0:
        raise ValueError('Non-finite Solo projection')
    if product == 0:
        return 0.0
    if product >= 1e21:
        return product
    numerator, denominator = product.as_integer_ratio()
    rounded = (numerator * 1000000 * 2 + denominator) // (2 * denominator)
    whole, fraction = divmod(rounded, 1000000)
    return float('%d.%06d' % (whole, fraction))


def _bind(function, obj):
    try:
        return types.MethodType(function, obj)
    except TypeError:
        return types.MethodType(function, obj, obj.__class__)


class PrivateGhostRuntime(object):
    """One private wrapper owner for our mod family; DCB and Solo share effective reads and teardown."""
    def __init__(self, policy, fitting_class, native_tracker_method, bandwidth_used_attribute,
                 session, usable, warning, picker_class=None, cargo_class=None, format_hold=None):
        self.families = validate_policy(policy) or {}
        self.rules = self.families.get('droneclassbalance', {})
        self.solo = self.families.get('soloprogressionbalance')
        self.active = bool(self.families)
        self.cargo_class = cargo_class
        self.format_hold = format_hold
        self.hint_wrapper = None
        self.hint_had_own = False
        self.original_hint = None
        self.hold_descriptions = {}
        self.fitting_class = fitting_class
        self.native_tracker_method = native_tracker_method
        self.bandwidth_used_attribute = bandwidth_used_attribute
        self.session = session
        self.usable = usable
        self.warning = warning
        self.records = []
        self.dcb_locations = []
        self.original_init = None
        self.init_wrapper = None
        self.picker_class = picker_class
        self.original_picker_max = None
        self.picker_wrapper = None

    def install(self, existing=None):
        if not self.active:
            return False
        owner = self
        # Read the stored function: Python 2 class access creates an unbound
        # method, whose identity differs on every access.
        self.original_init = self.fitting_class.__dict__['__init__']
        def initialize(location, *args, **kwargs):
            result = owner.original_init(location, *args, **kwargs)
            try:
                owner.attach(location)
            except Exception:
                # Instance attachment is transactional; native construction survives.
                pass
            return result
        self.init_wrapper = initialize
        self.fitting_class.__init__ = initialize
        if self.rules and self.picker_class is not None:
            self.original_picker_max = self.picker_class.__dict__['GetMaxActiveDrones']
            def picker_max(menu):
                location = getattr(menu, 'fittingDogmaLocation', None)
                if owner.active and owner.usable() and any(ref() is location for ref, _ in owner.records):
                    return int(location.GetMaxActiveDrones())
                return owner.original_picker_max(menu)
            self.picker_wrapper = picker_max
            self.picker_class.GetMaxActiveDrones = picker_max
        self._install_hold_hint()
        if existing is not None:
            self.attach(existing)
        return True

    def _rule(self, location, raw_get):
        if not self.active or not self.usable() or not isinstance(location, self.fitting_class):
            return None
        if not any(ref() is location for ref in self.dcb_locations):
            return None
        ship_id = location.GetCurrentShipID()
        # Ghost keys are distinct from the real session ship, even for the same type.
        if ship_id is None or ship_id == getattr(self.session, 'shipid', None):
            return None
        ship = location.dogmaItems.get(ship_id)
        if ship is None or getattr(ship, 'categoryID', None) != 6:
            return None
        rule = self.rules.get(int(ship.typeID))
        if rule is None:
            return None
        # Always use unprojected effective values for eligibility. No compounding.
        if raw_get(ship_id, BANDWIDTH) <= 0 and raw_get(ship_id, BAY) <= 0:
            return None
        return rule

    def _project_dcb(self, location, raw_get, item_id, attribute_id, value):
        if attribute_id not in (BANDWIDTH, BAY, MAX_ACTIVE) or item_id != location.GetCurrentShipID():
            return value
        rule = self._rule(location, raw_get)
        if rule is None:
            return value
        if attribute_id == MAX_ACTIVE:
            return rule[2] if rule[2] is not None else value
        return value * rule[0 if attribute_id == BANDWIDTH else 1] if value > 0 else value

    def _ghost_ship(self, location):
        if not self.active or not self.usable() or not isinstance(location, self.fitting_class):
            return None
        ship_id = location.GetCurrentShipID()
        if ship_id is None or ship_id == getattr(self.session, 'shipid', None):
            return None
        ship = location.dogmaItems.get(ship_id)
        return ship if ship is not None and getattr(ship, 'categoryID', None) == 6 else None

    def _project_solo(self, location, raw_get, item_id, attribute_id, value):
        if self.solo is None or not _positive(value):
            return value
        ship = self._ghost_ship(location)
        if ship is None:
            return value
        if item_id == location.GetCurrentShipID():
            for factor in self.solo['ships'].get(int(ship.typeID), {}).get(attribute_id, ()):
                value = scale_round6(value, factor)
            return value
        if attribute_id != self.solo['miningAttribute']:
            return value
        item = location.dogmaItems.get(item_id)
        if item is None:
            return value
        type_id = int(item.typeID)
        if type_id in self.solo['moduleTypes'] and getattr(item, 'categoryID', None) == 7:
            if item_id in location.GetFittedItemsToShip() and item.GetShipID() == location.GetCurrentShipID():
                return scale_round6(value, self.solo['moduleScale'])
        elif type_id in self.solo['droneTypes'] and getattr(item, 'categoryID', None) == 18:
            if item_id in ship.drones:
                return scale_round6(value, self.solo['droneScale'])
        return value

    def _project_attribute(self, location, raw_get, item_id, attribute_id, value):
        # Each family uses the current captured native value. One failure cannot
        # discard a successful disjoint projection owned by the other family.
        result = value
        for project in (self._project_dcb, self._project_solo):
            try:
                projected = project(location, raw_get, item_id, attribute_id, value)
                if projected != value:
                    result = projected
            except Exception:
                pass
        return result

    def _install_hold_hint(self):
        if self.solo is None or self.cargo_class is None or self.format_hold is None:
            return
        owner = self
        self.hint_had_own = '_Update' in self.cargo_class.__dict__
        self.original_hint = getattr(self.cargo_class, '_Update')
        def update(panel):
            result = owner.original_hint(panel)
            try:
                # Native fitting uses a rich tooltip, which takes priority over GetHint.
                # Keep its localized header/description and own only our appended text.
                tooltip = getattr(panel, 'tooltipPanelClassInfo', None)
                if tooltip is None:
                    return result
                owner.hold_descriptions = dict((key, record) for key, record in owner.hold_descriptions.items() if record[0]() is not None)
                record = owner.hold_descriptions.get(id(tooltip))
                if record is None or record[0]() is not tooltip:
                    record = [weakref.ref(tooltip), tooltip.descriptionText, tooltip.descriptionText]
                    owner.hold_descriptions[id(tooltip)] = record
                if tooltip.descriptionText != record[2]:
                    return result  # Another owner changed this description; do not overwrite it.
                rows = []
                controller = panel.controller
                location = controller.dogmaLocation
                ship = owner._ghost_ship(location) if controller.IsSimulated() and controller.GetItemID() == location.GetCurrentShipID() and any(ref() is location for ref, _ in owner.records) else None
                if ship is not None:
                    program = owner.solo['ships'].get(int(ship.typeID), {})
                    for attribute_id in sorted(program):
                        if attribute_id == 38:
                            continue
                        value = location.GetAttributeValue(location.GetCurrentShipID(), attribute_id)
                        if _positive(value):
                            row = owner.format_hold(attribute_id, value)
                            if row:
                                rows.append(row)
                text = ((record[1] + '<br>') if record[1] else '') + '<br>'.join(rows) if rows else record[1]
                tooltip.descriptionText = text
                record[2] = text
            except Exception:
                pass
            return result
        self.hint_wrapper = update
        self.cargo_class._Update = update

    def attach(self, location):
        if not isinstance(location, self.fitting_class) or any(ref() is location for ref, _ in self.records):
            return
        raw_get = location.GetAttributeValue
        tracker = getattr(location, 'selectedDronesTracker', None)
        raw_register = getattr(tracker, 'RegisterDroneAsActive', None)
        function = getattr(raw_register, 'im_func', getattr(raw_register, '__func__', None))
        dcb_compatible = bool(self.rules) and callable(raw_register) and self.native_tracker_method is not None and function is self.native_tracker_method
        if not dcb_compatible and self.solo is None:
            return
        raw_max = location.GetMaxActiveDrones if dcb_compatible else None
        owner = self

        def get_attribute(instance, item_id, attribute_id):
            value = raw_get(item_id, attribute_id)
            try:
                return owner._project_attribute(instance, raw_get, item_id, attribute_id, value)
            except Exception:
                return value

        def get_max(instance):
            try:
                rule = owner._rule(instance, raw_get)
                if rule is not None and rule[2] is not None:
                    return rule[2]
            except Exception:
                pass
            return raw_max()

        def register(instance, dogma_location, drone_id, qty=1, raiseError=True):
            try:
                rule = owner._rule(location, raw_get) if dogma_location is location else None
            except Exception:
                rule = None
            if rule is None or rule[2] is None:
                return raw_register(dogma_location, drone_id, qty=qty, raiseError=raiseError)
            # Replace only the exact-count branch, including the native second
            # minimum-five check. Retain native bandwidth arithmetic and errors.
            if isinstance(qty, bool) or not isinstance(qty, INTEGER_TYPES) or qty <= 0:
                return
            selected = instance.selectedDronesDict
            limit = rule[2]
            if sum(selected.values()) + qty > limit:
                if raiseError:
                    owner.warning('count', limit)
                return
            used = sum(number * dogma_location.GetAttributeValue(item, owner.bandwidth_used_attribute)
                       for item, number in selected.items())
            needed = qty * dogma_location.GetAttributeValue(drone_id, owner.bandwidth_used_attribute)
            if needed + used > dogma_location.GetAttributeValue(dogma_location.GetCurrentShipID(), BANDWIDTH):
                if raiseError:
                    owner.warning('bandwidth', limit)
                return
            selected[drone_id] += qty

        changes = []
        try:
            hooks = [(location, 'GetAttributeValue', get_attribute)]
            if dcb_compatible:
                hooks.extend([(location, 'GetMaxActiveDrones', get_max),
                              (tracker, 'RegisterDroneAsActive', register)])
            for obj, name, function in hooks:
                previous = obj.__dict__.get(name)
                had_own = name in obj.__dict__
                installed = _bind(function, obj)
                setattr(obj, name, installed)
                changes.append((weakref.ref(obj), name, previous, had_own, installed))
        except Exception:
            self._restore(changes)
            raise
        self.records.append((weakref.ref(location), changes))
        if dcb_compatible:
            self.dcb_locations.append(weakref.ref(location))
        # Existing selections came from native constraints. Revalidate only a
        # changed hull, deterministically, without ever touching live drones.
        rule = self._rule(location, raw_get) if dcb_compatible else None
        if rule is not None:
            remaining = location.GetMaxActiveDrones()
            bandwidth = location.GetAttributeValue(location.GetCurrentShipID(), BANDWIDTH)
            for item in sorted(list(tracker.selectedDronesDict), key=str):
                count = tracker.selectedDronesDict[item]
                per_drone = location.GetAttributeValue(item, self.bandwidth_used_attribute)
                keep = min(count, remaining)
                if per_drone > 0:
                    keep = min(keep, max(0, int(bandwidth / per_drone)))
                if keep > 0:
                    tracker.selectedDronesDict[item] = keep
                else:
                    tracker.selectedDronesDict.pop(item, None)
                remaining -= keep
                bandwidth -= keep * per_drone

    def _restore(self, changes):
        for reference, name, previous, had_own, installed in reversed(changes):
            try:
                obj = reference()
                if obj is None or obj.__dict__.get(name) is not installed:
                    continue
                if had_own:
                    setattr(obj, name, previous)
                else:
                    delattr(obj, name)
            except Exception:
                # Retired UI objects must not prevent other hooks being restored.
                pass

    def dispose(self):
        self.active = False
        changed_locations = []
        for reference in self.dcb_locations:
            try:
                location = reference()
                if location is not None:
                    ship = location.dogmaItems.get(location.GetCurrentShipID())
                    if ship is not None and int(ship.typeID) in (self.rules or {}):
                        changed_locations.append(location)
            except Exception:
                pass
        if self.init_wrapper is not None and self.fitting_class.__dict__.get('__init__') is self.init_wrapper:
            self.fitting_class.__init__ = self.original_init
        if self.picker_wrapper is not None and self.picker_class.__dict__.get('GetMaxActiveDrones') is self.picker_wrapper:
            self.picker_class.GetMaxActiveDrones = self.original_picker_max
        if self.hint_wrapper is not None and self.cargo_class.__dict__.get('_Update') is self.hint_wrapper:
            if self.hint_had_own:
                self.cargo_class._Update = self.original_hint
            else:
                delattr(self.cargo_class, '_Update')
        for reference, original, owned in self.hold_descriptions.values():
            try:
                tooltip = reference()
                if tooltip is not None and tooltip.descriptionText == owned:
                    tooltip.descriptionText = original
            except Exception:
                pass
        self.hold_descriptions = {}
        for _, changes in reversed(self.records):
            self._restore(changes)
        self.records = []
        self.dcb_locations = []
        # A preview selected under an expanded limit must not retain an invalid
        # count after teardown. Only ghost selections are adjusted.
        for location in changed_locations:
            try:
                remaining = location.GetMaxActiveDrones()
                bandwidth = location.GetAttributeValue(location.GetCurrentShipID(), BANDWIDTH)
                selected = location.selectedDronesTracker.selectedDronesDict
                for item in sorted(list(selected), key=str):
                    per_drone = location.GetAttributeValue(item, self.bandwidth_used_attribute)
                    keep = min(selected[item], remaining)
                    if per_drone > 0:
                        keep = min(keep, max(0, int(bandwidth / per_drone)))
                    if keep > 0:
                        selected[item] = keep
                    else:
                        selected.pop(item, None)
                    remaining -= keep
                    bandwidth -= keep * per_drone
            except Exception:
                # Never let teardown interfere with character logout.
                pass

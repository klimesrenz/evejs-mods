# coding: utf-8
# Launcher shared Mods menu API v1. The login companion owns the actual HUD.
import evejs_mod_menu as mods
try:
    import __builtin__ as _builtins
except ImportError:
    import builtins as _builtins

def _owner():
    return getattr(_builtins, '_evejs_market_search_v1', None)


def available():
    owner = _owner()
    return owner is not None and owner.usable()


def open_window():
    owner = _owner()
    if owner is not None and owner.usable():
        owner.OnMarketSearchOpen()


registration = mods.register('market-search', {'en': u'Market Search', 'ru': u'Поиск на рынке'},
                             open_window, is_available=available, api_version=1)


def cleanup():
    # This adapter owns only the registration. The existing login companion
    # closes its window and jobs on logout, character change and replacement.
    registration.close()

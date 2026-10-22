from app.games import registry
from app.games.creeper import CreeperGame
from app.games.elytra import ElytraGame
from app.games.mines import MinesGame


def register_all() -> None:
    """Make every shipped game available. Safe to call more than once."""
    for game in (MinesGame(), CreeperGame(), ElytraGame()):
        if registry.get_game(game.id) is None:
            registry.register(game)

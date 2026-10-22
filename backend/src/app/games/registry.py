from app.games.base import Game

_games: dict[str, Game] = {}


def register(game: Game) -> Game:
    if game.id in _games:
        raise ValueError(f"game {game.id!r} already registered")
    _games[game.id] = game
    return game


def unregister(game_id: str) -> None:
    _games.pop(game_id, None)


def get_game(game_id: str) -> Game | None:
    return _games.get(game_id)


def all_games() -> list[Game]:
    return list(_games.values())

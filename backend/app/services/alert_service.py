"""Unowned legacy alerts must never be delivered to a shared subscription pool."""


async def check_alerts() -> None:
    raise RuntimeError("Legacy alerts disabled: migrate verified alert/subscription ownership before enabling delivery")

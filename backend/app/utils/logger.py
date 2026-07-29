"""
Unified logging configuration.

One formatter, one stream handler on the root logger — so every module's
``logging.getLogger(__name__)`` inherits the same clean, timestamped format
instead of SQLAlchemy's raw ``echo`` dumps drowning out application logs.

Call :func:`configure_logging` once at process startup (FastAPI app + arq
worker). It is idempotent.
"""
import logging
import sys

from app.config import settings

_LOG_FORMAT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Third-party loggers that are too chatty at INFO. Pinned to WARNING so the app's
# own INFO lines stay readable. SQLAlchemy statement logging is governed by the
# engine's ``echo`` flag (see SQL_ECHO) rather than these levels.
_NOISY_LOGGERS = {
    "sqlalchemy.engine": logging.WARNING,
    "sqlalchemy.pool": logging.WARNING,
    "sqlalchemy.dialects": logging.WARNING,
    "sqlalchemy.orm": logging.WARNING,
    "aiomysql": logging.WARNING,
    "httpx": logging.WARNING,
    "httpcore": logging.WARNING,
    "urllib3": logging.WARNING,
    "asyncio": logging.WARNING,
    "multipart": logging.WARNING,
}

_configured = False


def configure_logging() -> None:
    """Install a single unified handler on the root logger. Idempotent."""
    global _configured
    if _configured:
        return

    level = getattr(logging, str(settings.LOG_LEVEL).upper(), logging.INFO)
    formatter = logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)

    root = logging.getLogger()
    root.setLevel(level)

    # Replace any pre-existing handlers (e.g. uvicorn's default) with our own,
    # so the format is consistent regardless of who imported logging first.
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(formatter)
    root.addHandler(handler)

    # Route uvicorn/gunicorn logs through the root handler (drop their own).
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "gunicorn.error", "gunicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

    for name, lvl in _NOISY_LOGGERS.items():
        logging.getLogger(name).setLevel(lvl)

    _configured = True


def setup_logger(name: str) -> logging.Logger:
    """Return a module logger. Ensures unified config is installed first.

    Kept for backwards compatibility with existing call sites; prefer
    ``logging.getLogger(__name__)`` after :func:`configure_logging` has run.
    """
    configure_logging()
    return logging.getLogger(name)

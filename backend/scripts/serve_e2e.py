"""Start the API for e2e tests: migrate the (fresh) database, then serve on the given port."""

import os
import sys

import uvicorn
from alembic import command
from alembic.config import Config

if __name__ == "__main__":
    if os.path.exists("e2e.db"):
        os.remove("e2e.db")
    command.upgrade(Config("alembic.ini"), "head")
    uvicorn.run("app.main:app", port=int(sys.argv[1]))

"""responsible gaming: limits and self-exclusion

Revision ID: a1c3e5f7b9d2
Revises: 0976ddec7c1a
Create Date: 2026-10-22 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c3e5f7b9d2"
down_revision: str | Sequence[str] | None = "0976ddec7c1a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("deposit_limit", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("loss_limit", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("excluded_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("excluded_until")
        batch.drop_column("loss_limit")
        batch.drop_column("deposit_limit")

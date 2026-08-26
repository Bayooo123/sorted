-- OPTIONAL. Only needed so that a future `npx prisma migrate deploy` (run
-- from anywhere with real Postgres connectivity) doesn't try to recreate
-- tables that already exist via the SQL editor. Prisma's own migrations
-- CLI does this automatically and safely via:
--
--   npx prisma migrate resolve --applied 20260825000000_init
--
-- Prefer that single command over this file wherever you have DB
-- connectivity to run it — it's the standard, Prisma-maintained way to do
-- this. This file exists only as a fallback for doing it entirely through
-- a SQL editor, matching Prisma's own migrations-table schema and its
-- checksum algorithm (sha256 of the migration.sql file, hex-encoded).

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
VALUES (
  'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
  'e806bbdecf740d7374b636f8120dffe8452538b6d60b133c20c273d0a86d28a3',
  now(),
  '20260825000000_init',
  now(),
  1
)
ON CONFLICT (id) DO NOTHING;

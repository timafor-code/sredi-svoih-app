# API test database isolation

## Purpose

Automated API tests must never write to the working local application database.

The local database roles are now explicit:

- `api_postgres` / `sredi_api` — working local application data. It may contain data that is later reviewed for controlled production promotion. Automated API tests must not use it.
- `api_test_postgres` / `sredi_api_test` — disposable automated-test database. It is available only through the Compose `test` profile and has no published host port or persistent volume.

The pytest suite has a fail-closed guard. Collection stops unless all of these are true:

- `APP_ENV=test`;
- the database host is `api_test_postgres`;
- the database user is `sredi_api_test`;
- the database name is `sredi_api_test`.

The guard never prints the full connection URI or password.

## Canonical full API test run

Run from the repository root in PowerShell:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app

# Recreate only the disposable test PostgreSQL container. The working api_postgres
# service and its api_postgres_data volume are not targeted by these commands.
docker compose -f infra/docker-compose.api.yml --profile test up -d --force-recreate api_test_postgres

docker compose -f infra/docker-compose.api.yml --profile test build api_test_backend

docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend alembic upgrade head

docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend python -m pytest -q tests

docker compose -f infra/docker-compose.api.yml --profile test stop api_test_postgres
```

Do not replace `api_test_backend` with `api_backend` for automated API tests. `api_backend` intentionally uses the working local `sredi_api` database.

Do not use `docker compose down -v` as part of API test cleanup. The test database has no persistent volume; the working local database does.

## Focused API tests

Use the same isolated runner for focused tests:

```powershell
docker compose -f infra/docker-compose.api.yml --profile test up -d --force-recreate api_test_postgres

docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend alembic upgrade head

docker compose -f infra/docker-compose.api.yml --profile test run --rm api_test_backend python -m pytest -q tests/test_example.py
```

The `tests/conftest.py` guard applies to both full and focused pytest runs.

## Existing working-database contamination

This isolation change does not delete or rewrite any existing row in `sredi_api`.

Historical synthetic rows already discovered in the working local database must be handled separately: first by a read-only hygiene audit, then by an owner-reviewed cleanup procedure with a backup. Production promotion must remain paused until that review is complete.

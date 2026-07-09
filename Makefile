# Everything a person needs to type on this project, in one place. The tests
# take a while because they run against a real mongod, so `make check` is what
# runs before a push and `make test-unit` is what runs while working.

SHELL := /bin/bash
NODE_BIN := ./node_modules/.bin
COMPOSE := docker compose

.DEFAULT_GOAL := help

.PHONY: help
help: ## list what this makefile can do
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

.PHONY: install
install: ## install exactly what the lock file says
	npm ci

.PHONY: dev
dev: ## run the desk against a local mongo, restarting on a change
	node --watch src/http/server.js

.PHONY: test
test: ## run every test
	$(NODE_BIN)/jest

.PHONY: test-unit
test-unit: ## run the tests that need no database
	$(NODE_BIN)/jest --selectProjects unit

.PHONY: test-integration
test-integration: ## run the tests that need a database
	$(NODE_BIN)/jest --selectProjects integration

.PHONY: coverage
coverage: ## run every test and write the coverage report
	$(NODE_BIN)/jest --coverage

.PHONY: lint
lint: ## check the source and the tests
	$(NODE_BIN)/eslint src tests scripts

.PHONY: lint-fix
lint-fix: ## fix what can be fixed
	$(NODE_BIN)/eslint --fix src tests scripts

.PHONY: check
check: lint test ## what has to pass before a push

.PHONY: audit
audit: ## look for advisories, ignoring the ones written down as accepted
	node scripts/audit-dependencies.js

.PHONY: up
up: ## start mongo and the desk in docker
	$(COMPOSE) up --build -d

.PHONY: setup
setup: ## migrate and seed the docker database
	$(COMPOSE) --profile setup run --rm migrate
	$(COMPOSE) --profile setup run --rm seed

.PHONY: down
down: ## stop everything and keep the data
	$(COMPOSE) down

.PHONY: clean
clean: ## stop everything and throw the data away
	$(COMPOSE) down --volumes
	rm -rf coverage

.PHONY: logs
logs: ## follow the desk logs, read as prose rather than json
	$(COMPOSE) logs -f desk | $(NODE_BIN)/pino-pretty

.PHONY: worker
worker: ## run the scheduled work against the local database
	node src/workers/index.js

.PHONY: migrate
migrate: ## run the migrations against the local database
	node src/cli/index.js migrate

.PHONY: seed
seed: ## put a small catalogue on the local database
	node src/cli/index.js seed

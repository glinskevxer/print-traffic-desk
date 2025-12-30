# printdesk

Print traffic and rights clearance for repertory cinemas and film archives.

The desk books a physical film print into a cinema on a date. Three things have
to be true at the same time, and they are checked in the order a venue can do
something about them:

1. **A licence covers the screening.** The right title, in the right territory,
   for the right kind of exhibition, on that date, with screenings left on the
   allowance, not blacked out, and not blocked by somebody else's exclusive.
2. **A print exists that the booth can run.** The right gauge, a sound track the
   booth can reproduce, a speed it can hold, enough reels, and a nitrate
   certificate if the stock is nitrate.
3. **The calendar leaves time.** Working backwards from the screening through
   the house's inbound lead days, the carrier lane, both territories' holidays,
   and the bench time if the print is due an inspection.

Every refusal names the rule that refused it. `no licence clears this screening`
is not an answer anybody can act on; `the licence closed on 2025-05-31` is.

## What is in here

| directory | what lives there |
| --- | --- |
| `src/domain` | the rules. No database, no http, no clock it did not receive |
| `src/models` | mongoose schemas and the indexes they need |
| `src/services` | the units of work, each one transaction shaped |
| `src/http` | routes, middleware, and the description of the API |
| `src/ai` | reading licence letters and bench notes with OpenAI |
| `src/cli` | what runs on a schedule, without authenticating against itself |
| `tests/unit` | the rules, with no database at all |
| `tests/integration` | everything else, against a real mongod |

The domain layer is the part worth reading first. `src/domain/rights/clearance.js`
decides whether a screening can happen and under which licence;
`src/domain/traffic/routing.js` works a despatch date backwards from a screening;
`src/domain/condition/grade.js` turns inspection findings into a grade and a
verdict, and lets the physical measurements override the findings.

## Running it

```
cp .env.example .env
npm ci
docker compose up -d mongo
npm run cli migrate
npm run seed
npm start
```

Or the whole thing in containers:

```
make up
make setup
```

The desk needs a replica set even in development, because booking a print
writes to three collections in one transaction and a standalone mongod refuses
to start one. The compose file runs a single node replica set for exactly this.

## Reading and writing

Everything past `/health` and `/auth/sign-in` needs an operator token.

```
curl -s localhost:4010/auth/sign-in \
  -H 'content-type: application/json' \
  -d '{"email":"desk@archive.test","password":"a-development-password"}'

curl -s 'localhost:4010/clearance?titleId=ttl_...&venueId=ven_...&localDate=2025-06-20' \
  -H "authorization: Bearer $TOKEN"
```

The full shape is at `GET /health/openapi.json`, generated from the same
constants the validators use, so it cannot describe a gauge the desk does not
run.

## Roles

| role | what it does |
| --- | --- |
| `viewer` | reads everything |
| `programmer` | writes titles, licences and bookings |
| `traffic` | plans, despatches and lands print legs |
| `archivist` | catalogues prints and files inspections |
| `admin` | everything, plus operators, houses and money |

Roles are not a ladder. Traffic and programmer are peers who do different jobs,
and an earlier version that ranked them let the traffic desk write licences.

## Extraction

Two jobs go to OpenAI, and both land as drafts a person has to accept:

- a licence letter becomes a **draft** rights window, never a live one
- an inspector's bench shorthand becomes structured findings with damage codes

Every answer is validated against the desk's own vocabularies before anything
reads it, identical documents are answered from the previous reading rather
than paid for twice, and the spend is kept in hundredths of a cent because
rounding a call to the nearest cent hid a month of it behind a column of zeros.

Set `EXTRACTION_ENABLED=false` and the desk works exactly as before; the licence
terms just get typed in by hand.

## Money

Every figure is a whole number of minor units. Royalties come back with their
workings, because no distributor has ever accepted just the number.

## Tests

```
make test-unit          # the rules, fast, no database
make test-integration   # everything else, against a real mongod
make check              # what has to pass before a push
```

The integration suite starts one in-memory replica set for the whole run and
gives each jest worker its own database inside it.

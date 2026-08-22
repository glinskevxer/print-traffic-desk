# Changelog

Kept by hand from what `make release-notes` prints, which groups the
commits by the part of the desk they touched.

## 1.0.0

### rights and clearance

- load the licences once for a whole sweep, not once per house (5ff11bc)
- copy a licence forward and make somebody type the blackouts again (20bfd9c)
- one shape for a list call and one for a duplicate key (1ad96ce)
- run prettier over the whole tree and give the suite room to breathe (4c68d40)
- one place turns a public id into a record, so the 404 reads the same (6d6e30e)
- move what makes a deal a deal out of the rights service (834bd3c)
- draft a licence, then check the exclusives when it goes live (08e81ac)
- pick the tightest licence that clears and say why the rest did not (d24e8f9)
- let one house's exclusive stop another house in the same city (5bb91bb)
- make every clearance question a rule that answers in a sentence (cce1f5d)
- treat a licence territory as a set of countries, not a string (94ebbea)

### bookings

- read the booking date off the venue calendar, not off the instant (eec2327)
- refuse a booking at a house with the doors locked (32c6fa7)
- count the booking funnel by the rule that refused it (046219b)
- stop a page dragging the fields nobody on it reads (36e3110)
- swap the print when one fails its inspection and the night still happens (7d22f90)
- write the despatch note in the same transaction as the booking (a4207da)
- look at the shelf again when another desk took the print first (30a0eec)
- book a run of nights on one print, or hold none of them (3d9c94a)
- settle the lint rules and fix what they found (b9ce49e)
- gate every write behind the role that does that job (8c8b8d6)
- put the whole booking life over http, retries included (21a9f8d)
- take the takings over the phone and work the royalty out there and then (1b62754)
- let a hold lapse and give the print and the licence count back (38d803e)
- take a hold only when the licence, a print and the calendar all agree (70bfe96)

### print traffic

- work out the whole span a print is spoken for, not just the screening (99c6589)
- move the print on the shelf only when a leg actually lands (61f241f)
- plan a print leg backwards from the screening it has to make (8a74c93)
- shut the carriers on the days they are actually shut (1898750)
- quote a print leg from the lane table, not from the distance (f1692c2)

### the shelf

- make retirement the way out, so the plain status move stops losing prints (8110511)
- never retire a print without writing down where the film went (317a074)
- keep custody and location apart, because they answer different questions (de85c04)
- stop booking against a condition grade nobody has checked in twenty runs (0ad98aa)
- answer what an archive is asked most: where has this print been (508cc5b)
- ask the database the inspection question instead of filtering a page of it (a8f2949)
- rank which print to send instead of taking whatever is first (434da3b)
- move the booth rules out of the service so the booking path reads them too (9696038)
- record who changed what, in the same transaction as the change (103db0c)
- answer whether a given booth can run a given print in one place (296afcb)
- file an inspection and move the element it graded in one transaction (1649ed8)
- make quarantine reachable from anywhere and only leavable by inspection (9a1850e)
- let the measurements override the findings when grading a print (333fb21)
- write the inspection vocabulary down so findings can be graded (3aa5301)

### money

- correct a statement with a credit note, never by editing what it said (a563762)
- build a period statement from the settled bookings under each licence (f22cc30)
- show the working, because nobody has ever accepted just the number (bae614b)

### reading documents

- stop asking a model that has stopped answering (43b2213)
- cache a reading by the letter, the model asked for and the prompt version (aefffa8)
- keep the spend visible in hundredths of a cent, not rounded to nothing (967c594)
- turn bench shorthand into codes, and drop what it cannot map (0c50d52)
- read a licence letter into a draft window, never a live one (983644c)
- check what the model said against the vocabulary the desk uses (69e1c32)
- put one wrapper in front of openai and classify what it answers (992193b)

### operators and keys

- give a machine a key, and show its secret exactly once (297bf0d)
- record every attempt at the door, including the ones on addresses nobody has (68b2b7a)
- lock an operator out on the record, not in one process's memory (5ffd8b4)
- hash operator passwords with scrypt and compare them in constant time (170484f)

### the http layer

- say which commit is deployed instead of guessing at it (8b94ea9)
- give a polling booking screen more room than a person clicking (0a655c0)
- ready means there is a primary to write a booking to (92781f4)
- let the shape of what was typed decide where to look for it (c246953)
- let a reviewer work the queue in one sitting, failing one at a time (ad7ae8c)
- mount the routers from a table so nobody adds one to the open half (d19ec3a)
- take a whole spreadsheet of houses or none of it (ec742da)
- fold a duplicate catalogue entry without losing what hung off it (1b248f0)
- count the shelf in one pass and say which prints are getting worse (8523e0d)
- flag the licence somebody paid for and nobody programmed (a4eda33)
- build the description from a table the routes are checked against (fd9c2d2)
- answer a request that will not finish instead of holding the socket (f130a46)
- ask every house the same three questions and say which one refused (c461724)
- answer the three questions about a night as one screen (a2a25ff)
- let a distributor read who changed what, and page it like everything else (bec2af0)
- run across the cores the box has and replace a worker that dies (b1c6128)
- export the eleven series worth waking somebody up for (e728824)
- describe the api from the same constants the code enforces (496389a)
- close the listener first and give the bookings in flight time to finish (d9daa24)
- count the rate in mongo, because two processes are two limits (c088c72)
- refuse an unknown origin and a body carrying a query operator (800f597)
- sign an operator in and hand out a session that ends with the shift (306aa8d)
- rank the roles so a route names one gate, not a list (a73ec0f)
- put a human between what the model read and what the desk records (4d3788d)
- hand a distributor the statement in the format their ledger reads (1755791)
- stop every integration file rebuilding the same forty indexes (f9b2f93)
- replay the first answer when a venue desk retries a booking call (b4c26b7)
- book a leg over http and let the desk work the dates out (679bfaa)
- answer whether a house could show a title, before anything is held (8193f96)
- carry the request identity in async storage instead of every signature (83c6447)
- let an inspector file, preview and read back a condition report (40f668c)
- hold licensors, their contacts and the currency they are paid in (35ac360)
- keep houses on file with the booth they actually have (fdb6ee3)
- catalogue titles behind a service that owns the slug and the status (06ac855)
- parse request input with zod and keep the raw body readable (9a7e633)
- stand the http service up with one place that chooses a status code (bdf5aa7)

### the command line

- take a catalogue export without overwriting what is already on file (87d2550)
- throw the chaff away and keep what a distributor can ask about (263c5c3)
- sign a despatch note so the office can tell a real one (ab7dcf1)
- print the reports on a terminal, sized to what is in them (4655906)
- send the queue from a worker, one message at a time (3a22eee)
- put a floor under coverage and stop the factories colliding (ba9e2bf)
- run each migration once and record it before the next one starts (4ba2b46)
- give the desk a command line so a cron never has to authenticate (6a01666)
- parse the command line by hand rather than pull four packages in (7cdf9cb)

### the worker

- run the scheduled work in a worker rather than a cron nobody updates (d88b66e)

### plumbing

- fail on the shape of a secret, not on a list somebody remembered (f9b0ba0)
- read the csv an archive already keeps, quotes and newlines and all (ba87097)
- pin the signing algorithm so a token cannot ask to be trusted unsigned (42e6f0a)
- record each reading as a job, with a hash of the letter and not the letter (9dfde3e)
- back off with jitter so the retries do not arrive as one wave (0108703)
- write our own csv so a comma in a title cannot break a remittance (b73533b)
- freeze a statement's lines the moment it is issued (33db713)
- make a booking one screening, with the clearance it was granted on (bd30b17)
- treat out and back as two legs, because they are two legs (71f93dd)
- write a licence down as a window with dates, a cap and its terms (2e12539)
- page the catalogue by keyset so nothing slips past a moving cursor (dc80bdc)
- put every physical print on the shelf with its restrictions (91b35f9)
- book against what a booth can actually run (1c82b5f)
- store titles against the party that can licence them (f052d19)
- open one mongo connection and run multi collection writes in a transaction (21f3fb9)
- work in venue local dates and walk carrier working days (f28f60c)
- keep every settlement figure in whole minor units (f55d0c6)
- add readable identifiers and a logger that blanks credentials (739780b)
- start the print desk with env parsing and the error hierarchy (0241ae6)

### tests

- check the tree is fit to deploy before anybody deploys it (553c7ff)
- accept the two advisories the early 2025 pins carry, by id and with a date (c3fbe42)
- pin the shape of the work, not the time it took (35fdcf8)
- walk the whole desk once, over http, the way a programmer does (08a0d34)
- check the laws that have to hold for every input, not the examples (1766487)

### build and deployment

- run lint, both test projects, the image and an audit on every push (7017c1a)
- run mongo as a one node replica set, because bookings are transactions (939775d)
- build a non root image that carries no test tooling (4aab24e)

131 commits.

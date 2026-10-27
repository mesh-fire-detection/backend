# Membership and subscriptions

Status: agreed October 27, 2026; not built. Covers backend #9 (who may join),
#29 (subscriptions) and the website half of both (web#3, web#8). Joining with a
node depends on the registration core of #12, so that core is in this release
too. Ships together with the sign-in pages already built on the website.

The issues hold the reasoning; this is the build plan that reconciles them.
Where an issue and this plan disagree, the issue is out of date: fix it.

## The model

One row in `users` per person, from their first interaction, with an explicit
status:

| Status       | Can sign in | Gets updates        | How someone gets here                |
| ------------ | ----------- | ------------------- | ------------------------------------ |
| `subscriber` | No          | Once confirmed      | Subscribed in the footer             |
| `member`     | Yes         | Unless unsubscribed | Joined: invited, or connected a node |

`banned` stays as it is and overrides both. There is no pending state and no
approval queue: a person is eligible to join or they are not.

**Only `member` may receive a sign-in code.** Today's check in
`src/shared/auth/signIn.ts` is "an existing, enabled account", which a
subscriber row would pass. It becomes "status is `member` and not banned". This
is the one change that must not slip: without it, subscribing would be a way to
get an account. The same rule has to hold for every route under `/v1/auth/*`,
which exposes more of Better Auth than we use (`docs/plans/v0.1.1.md`, item 2).

Existing rows migrate to `member`.

## Who may join

Either of (#9):

1. **The address has been invited.** The existing `invites` table becomes the
   allowlist: an invite is an address that may join, and the role it joins as.
   The token link goes, because the code now proves the address. Admins create
   invites with `POST /v1/users` as today, or `npm run user:invite` on the
   server.
2. **The person connected a node on `/connect`** and joins from there. Joining
   registers the node as a device (#12) and puts them on it.

**What route 2 does and does not prove.** The website cannot verify that a node
is real: anything the page reports about it can be typed by hand. This was
accepted on purpose, because it lets a builder join at their bench before any
gateway has heard the node. What keeps it honest:

- The email address is always proven with a code before anything is created.
- Joins are rate limited per caller and per address.
- A device someone registered but the network has never heard has no
  `lastHeardAt`, which is visible to admins and in the device list.

**Two people, one node.** Connecting a node that is already registered adds you
to it as an equal co-owner, and the same is true when joining with it (#11,
#12). Possession of the hardware is the claim. So a node number is never
"taken"; that is how two people who built a node together both get on it.

## Devices, as far as this release needs them

From #11 and #12, unchanged:

- `device_members(deviceId, userId, …)` rather than an owner column.
- Any member may register a device. Only what a builder knows while holding the
  node is required; location, antenna height and deployment date are filled in
  later, so those columns become nullable.
- The node's hardware identifier (`MyNodeInfo.device_id`) is stored next to its
  node number, nullable.
- Every registered device is visible to every signed-in person. **Nobody is
  named as an owner** on any shared view (#15 Q10); a person sees only that a
  device is theirs. No visibility flag yet.

The `/devices` page itself (web#5) follows this release.

## Data

- `users.status` — `'subscriber' | 'member'`, not null.
- `invites` — keyed by address; the token columns go.
- `subscriptions` — one per user: `status` (`unconfirmed`, `confirmed`,
  `unsubscribed`), hashed confirm and unsubscribe tokens, `confirmedAt`,
  `unsubscribedAt`, `source` (`footer` or `join`). Consent is recorded here:
  when, from where, and the wording shown.
- `device_members` and the `devices` changes above, from #12.

`notification_channels` stays reserved for alert delivery, which has different
urgency and rules. Updates get their own table so consent and unsubscribe state
cannot be confused with an alert setting (#29 asks for this to be decided
explicitly).

## Endpoints

All public ones are rate limited and answer identically whether or not an
address is known, so none of them can be used to find out who is here.

| Method | Path                              | Does                                                                                 |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------ |
| POST   | `/v1/subscribe`                   | Creates a subscriber if new; sends a confirmation link                               |
| POST   | `/v1/subscribe/confirm`           | Confirms, from the token in that link                                                |
| POST   | `/v1/unsubscribe`                 | Unsubscribes, from the token in any update; also RFC 8058 one-click                  |
| POST   | `/v1/join`                        | Checks eligibility, sends a join code if eligible                                    |
| POST   | `/v1/auth/email-otp/verify-email` | Better Auth's: checks the code; our hook makes the person a member and signs them in |
| POST   | `/v1/devices`                     | Opened to members by #12; registering an existing node adds you to it                |
| GET    | `/v1/me/devices`                  | The devices you are on                                                               |

**Join codes are Better Auth's**, using the email-OTP plugin's verification
type rather than a second token scheme: one code, ten minutes, three attempts,
the same as sign-in. Verifying is Better Auth's own `verify-email` endpoint,
which is public under `/v1/auth/*`, so the membership change hangs off its
verification hooks rather than off a route of ours: there is no way to verify
an address that skips it. It runs in one transaction. Built for invitations on
October 27, 2026; joining with a node will register the device from the same
hook.

**Joining when already a member** sends a sign-in code instead, so the person
is not stuck, and the response is the same as for anyone else.

**Passwords** stay for the bootstrap admin only, created on the server with
`createAdmin`, as #15 Q17 recommends. The website never offers them (#10).

## Subscribing

From #29:

- Confirm before sending anything else. An unconfirmed address receives its
  confirmation and nothing more; asking again within a day sends nothing new.
- Subscribing twice is harmless and reveals nothing.
- Unsubscribed means unsubscribed, including after joining later. Opting back
  in is a fresh confirmation.
- Every update carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers
  pointing at `/v1/unsubscribe`, which Gmail and Yahoo require of bulk senders.
- Joining subscribes you, confirmed, because the join code already proved the
  address. Unless you had unsubscribed: that stands.
- Subscribing does not make anyone eligible to join; only an invite or a node
  does (#29's second open question).

The confirm and unsubscribe links open pages on the website with a button that
does the POST. Mail scanners fetch links before people do; a link that acted on
GET would be confirmed or unsubscribed by a robot.

**Not in this release:** writing and sending updates. This release collects
confirmed subscribers and honours unsubscribes. #29's open question about what
goes in an update, and who writes it, still needs answering before the first
one is sent.

## Website

| Where                | What                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Header               | **Sign in**, or your name (built)                                                            |
| Footer, every page   | Email field and **Subscribe**, with one honest line on what is sent and how to stop          |
| `/join`              | Two ways in: **I've built a node** → `/connect`; **I was invited** → email, name, code       |
| `/connect`           | With a node connected: signed out, **Join with this node**; signed in, **Add to my devices** |
| `/sign-in`           | Built. Adds **No account? Join**, a resend cooldown, and non-revealing copy (web#3)          |
| `/account`           | Built (web#8 asked for `/profile`). Adds your devices and your updates setting               |
| `/subscribe/confirm` | **Confirm subscription** button, from the email link                                         |
| `/unsubscribe`       | **Unsubscribe** button, from the email link                                                  |
| `/privacy`           | Rewritten for the session cookie, codes, subscriptions and device membership                 |

Join says plainly that it also subscribes you (web#3). The invited route on
`/join` answers the same way whether or not the address is on the list: **If
your address is on our list, we've sent a code.** It also points to `/connect`,
so someone who is not on the list knows what to do next.

## Emails

- **Confirm your subscription** — a link to `/subscribe/confirm`.
- **Your code to join** — six digits, like sign-in.
- Sign-in code — unchanged.

All of them come out of one daily allowance: 100 on Resend's free tier. The
footer form is the new way to spend it, so it is limited per caller and per
address, and `/health` already reports email trouble.

## Order of work

1. Backend: status, invites as the allowlist, the sign-in gate, migration.
   Ship-blocking.
2. Backend: subscriptions and their emails.
3. Backend: the #12 core — `device_members`, nullable deployment fields,
   `device_id`, member registration.
4. Backend: join, both routes.
5. Website: sign-in fixes, footer, confirm and unsubscribe pages, `/join`.
6. Website: `/connect` join and add, `/account` additions.
7. Privacy page; `docs/SPEC.md` and `docs/ARCHITECTURE.md`; the connect spec.
8. Try it end to end locally, then on production with a real address.

## Open questions

- **How a self-registered device gets its ID** (`sen-07`; #11, #15 Q06). It is
  the primary key and public, so it is chosen before route 2 can ship.
  Recommendation: the server assigns it, as #15 suggests.
- **Whether a node really carries our private channel key** (web#6), since
  route 2 trusts that the connected node is one of ours.
- **What an update contains, and who writes it** (#29).

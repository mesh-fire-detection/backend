# Nodes: membership, approximate positions and the hardware ID

Status: agreed October 29, 2026. Covers backend #12 and the backend half of
web#5. Builds on `docs/plans/membership.md`, which recorded nodes against
members (`member_nodes`) and left registering them to #12.

Where an issue and this plan disagree, the issue is out of date: fix it.

## Decisions

**Members register nodes.** Connecting a node and adding it to your account
registers it. There is no approval step and no separate registration form.
`member_nodes` goes: each of its rows becomes a registered node with the
member on it, in `node_members`. A node can have several people on it, all
equal (#11).

**The server assigns the ID**, `n-0001` and up, and never changes or reuses
it. It does not encode the type, which can change. The registered name is
separate and editable. Existing IDs such as `sen-01` stay as they are, and
admins can still choose an ID when they register a node themselves.

**Only identity is required.** Type, position, elevation, antenna height,
firmware and deployment date are filled in later by the people on the node.
A node missing any of what the map needs is left off the map.

**The hardware ID is stored.** Meshtastic's `MyNodeInfo.device_id`, which
`/connect` receives from a node connected to the browser, is kept as
`hardwareId`. It survives a reflash and the firmware upgrade that changes the
node number (#12), so it is how a node keeps its ID and history when its
number changes. Only someone already on the node can move it to a new number
that way; anyone else with the same hardware ID is added to the node, as with
a node number. Still to verify on a bench: that a RAK4631 on our 2.7.x fork
reports a `device_id` at all, and that a reflash leaves it unchanged.

**Positions are approximate unless the people on a node choose otherwise.**
A node in someone's home must not be findable, and an outdoor node must not
be easy to steal. Similar networks do the same: Raspberry Shake moves each
station within about a mile, Helium shows hexagons of about 0.7 km², RIPE
Atlas rounds to about 1 km, and iNaturalist keeps true coordinates in private
fields.

- The exact position is stored, and shown only to the people on the node and
  to admins.
- Everyone else, on `/nodes` and on the public map, sees the centre of a
  fixed grid cell about 1 km across, and elevation to the nearest 50 m. The
  cell is the same every time, so repeated requests cannot be averaged back
  to the true point.
- Link distances on the map are measured between the positions it shows.
- What a node reports about itself (`reported*`, from its own GPS) is shown
  only with the exact position.
- `exactPosition` shows a node exactly, for a project node on public land or
  where the owner has agreed. It is off by default.
- Not covered here, and to do: our firmware's channel `position_precision`, so
  the node itself does not broadcast an exact position, and the Git mirror
  (#14), which must export the approximate position.

**Known weakness.** Joining a node by its number is accepted on purpose: holding
the node is the claim (#11), and a node number is public. Anyone who joins that
way then sees the hardware ID and could quote it to move the node to another
number, breaking ingest for it until an admin moves it back. Decide before the
first re-link in the field whether moving a node needs more than the hardware
ID, such as the node being heard on the new number.

**Disabled nodes** are hidden from people who are not on them; admins see
them (#15 Q11).

## Data

- `nodes`: `type`, `longitude`, `latitude`, `elevationM`, `antennaHeightM`,
  `firmware` and `deployedOn` become nullable. New: `hardware` (the board, as
  reported), `hardwareId` (unique, nullable), `exactPosition` (default false).
- `node_members(nodeId, userId, addedAt)`, one row per person on a node.
- `member_nodes` is migrated into the two above and dropped.

## Endpoints

| Method | Path            | Who                       | Does                                                                      |
| ------ | --------------- | ------------------------- | ------------------------------------------------------------------------- |
| GET    | `/v1/nodes`     | signed in                 | Every visible node, each saying whether it is yours                       |
| GET    | `/v1/nodes/:id` | signed in                 | One node; its private details only for the people on it and admins        |
| PATCH  | `/v1/nodes/:id` | people on the node, admin | Edit it. Changing the mesh ID or enabling is for admins                   |
| POST   | `/v1/nodes`     | admin                     | Register a node with a chosen ID, as today                                |
| GET    | `/v1/me/nodes`  | signed in                 | The nodes you are on                                                      |
| POST   | `/v1/me/nodes`  | signed in                 | Add nodes your browser connected: registers new ones, joins existing ones |

Every node response has one shape, built in one place: shared fields for any
signed-in person, and `details` (exact position, notes, hardware ID, what the
node reported) that is null unless the caller is on the node or an admin. No
response names the people on a node, or counts them (#15 Q10). Editing
someone else's node answers as if it did not exist, like alert rules.

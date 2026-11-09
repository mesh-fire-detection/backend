import { sql } from 'drizzle-orm'
import {
    index,
    integer,
    primaryKey,
    real,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Every table in one file so drizzle-kit sees the whole database. Timestamps
 * are UTC epoch milliseconds. Column names are snake_case in SQL (see the
 * `casing` option where the connection is opened).
 *
 * Nothing here cascades deletes: data is never removed as a side effect.
 */

const timestamp = () => integer({ mode: 'timestamp_ms' })
const createdAt = () =>
    timestamp()
        .notNull()
        .default(sql`(unixepoch('subsec') * 1000)`)
const updatedAt = () =>
    timestamp()
        .notNull()
        .default(sql`(unixepoch('subsec') * 1000)`)

// ── Accounts (shape owned by Better Auth with the admin plugin) ─────────────

export const users = sqliteTable('users', {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: integer({ mode: 'boolean' }).notNull().default(false),
    image: text(),
    role: text(),
    banned: integer({ mode: 'boolean' }).default(false),
    banReason: text(),
    banExpires: timestamp(),
    /**
     * Ours, not Better Auth's. One row per person from their first contact: a
     * `subscriber` can never sign in, a `member` can. See `auth/membership.ts`.
     */
    status: text({ enum: ['subscriber', 'member'] })
        .notNull()
        .default('member'),
    /**
     * When this person asked to join with nodes their browser had connected.
     * Like an invite, it makes the address eligible for a join code; the nodes
     * themselves stay in the browser until the code is verified (backend#9).
     */
    nodeJoinRequestedAt: timestamp(),
    /**
     * When the person deleted their account. The row stays, because readings,
     * events and alerts point at it, but everything that identifies them is
     * gone and they can never sign in again (web#8).
     */
    deletedAt: timestamp(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

export const sessions = sqliteTable(
    'sessions',
    {
        id: text().primaryKey(),
        expiresAt: timestamp().notNull(),
        token: text().notNull().unique(),
        ipAddress: text(),
        userAgent: text(),
        userId: text()
            .notNull()
            .references(() => users.id),
        impersonatedBy: text(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index('sessions_user_id_idx').on(t.userId)]
)

export const accounts = sqliteTable(
    'accounts',
    {
        id: text().primaryKey(),
        accountId: text().notNull(),
        providerId: text().notNull(),
        userId: text()
            .notNull()
            .references(() => users.id),
        accessToken: text(),
        refreshToken: text(),
        idToken: text(),
        accessTokenExpiresAt: timestamp(),
        refreshTokenExpiresAt: timestamp(),
        scope: text(),
        password: text(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index('accounts_user_id_idx').on(t.userId)]
)

export const verifications = sqliteTable('verifications', {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

/**
 * The allowlist: an address that may join, and the role it joins as. No token,
 * because the emailed code proves the address; no expiry, because an admin who
 * changes their mind deletes the invite.
 */
export const invites = sqliteTable('invites', {
    id: text().primaryKey(),
    email: text().notNull().unique(),
    role: text({ enum: ['admin', 'user'] }).notNull(),
    invitedById: text()
        .notNull()
        .references(() => users.id),
    acceptedAt: timestamp(),
    acceptedUserId: text().references(() => users.id),
    createdAt: createdAt(),
})

/**
 * Project updates, one row per person (#29). Nothing is sent to an address
 * until it is `confirmed`, and `unsubscribed` stands until the person opts back
 * in. Consent is recorded here: when, from where, and the words they saw.
 */
export const subscriptions = sqliteTable('subscriptions', {
    userId: text()
        .primaryKey()
        .references(() => users.id),
    status: text({ enum: ['unconfirmed', 'confirmed', 'unsubscribed'] }).notNull(),
    source: text({ enum: ['footer', 'join', 'account', 'default'] }).notNull(),
    consentText: text().notNull(),
    /** SHA-256 of the confirmation link's token; cleared once used. */
    confirmTokenHash: text().unique(),
    confirmSentAt: timestamp(),
    confirmedAt: timestamp(),
    unsubscribedAt: timestamp(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

// ── Mesh ────────────────────────────────────────────────────────────────────

/**
 * Registered nodes. Only identity is required: the rest is filled in later by
 * the people on the node, and a node missing what the map needs stays off it.
 * The position is exact here; everyone but the node's people and admins sees
 * it approximately (src/mesh/nodes/position.ts) unless `exactPosition` is set.
 */
export const nodes = sqliteTable('nodes', {
    id: text().primaryKey(),
    nodeNum: integer().notNull().unique(),
    /** Meshtastic's `MyNodeInfo.device_id`: survives a reflash, unlike the node number. */
    hardwareId: text().unique(),
    name: text().notNull(),
    type: text({ enum: ['base', 'cellular', 'sensor', 'vision'] }),
    longitude: real(),
    latitude: real(),
    exactPosition: integer({ mode: 'boolean' }).notNull().default(false),
    elevationM: real(),
    antennaHeightM: real(),
    /** The board, as the node reported it. */
    hardware: text(),
    firmware: text(),
    deployedOn: text(),
    note: text(),
    enabled: integer({ mode: 'boolean' }).notNull().default(true),
    lastHeardAt: timestamp(),
    /** What the node said when a browser last connected to it. */
    shortName: text(),
    settings: text({ mode: 'json' }).$type<Record<string, string>>(),
    settingsReportedAt: timestamp(),
    reportedName: text(),
    reportedLongitude: real(),
    reportedLatitude: real(),
    reportedAltitudeM: real(),
    reportedAt: timestamp(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

/** The people on a node, all equal (#11). Only they and admins are told who they are. */
export const nodeMembers = sqliteTable(
    'node_members',
    {
        nodeId: text()
            .notNull()
            .references(() => nodes.id),
        userId: text()
            .notNull()
            .references(() => users.id),
        addedAt: createdAt(),
    },
    (t) => [
        primaryKey({ columns: [t.nodeId, t.userId] }),
        index('node_members_user_idx').on(t.userId),
    ]
)

export const gateways = sqliteTable('gateways', {
    nodeId: text()
        .primaryKey()
        .references(() => nodes.id),
    mqttUsername: text().unique(),
    notecardUid: text().unique(),
    notehubTokenHash: text().unique(),
    enabled: integer({ mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

/**
 * Every accepted packet, kept forever. Not unique on (fromNodeNum, packetId):
 * Meshtastic packet IDs are random 32-bit numbers and repeat over years, so
 * duplicates are only rejected within a short window (see ingest).
 */
export const packetsSeen = sqliteTable(
    'packets_seen',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        fromNodeNum: integer().notNull(),
        packetId: integer().notNull(),
        gatewayId: text()
            .notNull()
            .references(() => nodes.id),
        receivedAt: timestamp().notNull(),
        sourceHash: text(),
    },
    (t) => [
        index('packets_seen_key_idx').on(t.fromNodeNum, t.packetId, t.receivedAt),
        index('packets_seen_source_hash_idx').on(t.sourceHash),
        // When each gateway last delivered, for the event log's silent-gateway check.
        index('packets_seen_gateway_idx').on(t.gatewayId, t.receivedAt),
    ]
)

export const notehubEvents = sqliteTable(
    'notehub_events',
    {
        eventId: text().primaryKey(),
        gatewayId: text()
            .notNull()
            .references(() => nodes.id),
        contentHash: text().notNull(),
        capturedAt: timestamp().notNull(),
        receivedAt: timestamp().notNull(),
    },
    (t) => [
        index('notehub_events_received_at_idx').on(t.receivedAt),
        index('notehub_events_gateway_idx').on(t.gatewayId, t.receivedAt),
    ]
)

export const notehubSamples = sqliteTable('notehub_samples', {
    sourceHash: text().primaryKey(),
    receivedAt: timestamp().notNull(),
})

export const deviceMetrics = sqliteTable(
    'device_metrics',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        nodeId: text()
            .notNull()
            .references(() => nodes.id),
        recordedAt: timestamp().notNull(),
        liveEligible: integer({ mode: 'boolean' }).notNull().default(true),
        batteryPct: real(),
        voltage: real(),
        uptimeS: integer(),
    },
    (t) => [index('device_metrics_node_time_idx').on(t.nodeId, t.recordedAt)]
)

/**
 * One row per value. Metric names come from the sensor, e.g. `environmentMetrics.temperature`.
 * `measuredAt` is the sensor's own clock, when it sent one: what matches one
 * measurement across sources, since `recordedAt` is receipt time for MQTT.
 * `source` is null for rows from before it was recorded.
 */
export const readings = sqliteTable(
    'readings',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        nodeId: text()
            .notNull()
            .references(() => nodes.id),
        recordedAt: timestamp().notNull(),
        liveEligible: integer({ mode: 'boolean' }).notNull().default(true),
        metric: text().notNull(),
        value: real().notNull(),
        measuredAt: timestamp(),
        source: text({ enum: ['mqtt', 'notehub', 'browser'] }),
        /** Who sent a browser's copy: anyone on a node can, so it stays attributable. */
        uploadedById: text().references(() => users.id),
    },
    (t) => [
        index('readings_node_time_idx').on(t.nodeId, t.recordedAt),
        index('readings_node_metric_time_idx').on(t.nodeId, t.metric, t.recordedAt),
        index('readings_node_metric_measured_idx').on(t.nodeId, t.metric, t.measuredAt),
        // Only uploads: gateways may repeat a measurement, and must never be refused for it.
        uniqueIndex('readings_browser_sample_idx')
            .on(t.nodeId, t.metric, t.recordedAt)
            .where(sql`source = 'browser'`),
    ]
)

/** What a browser saw happen to a node while connected to it. */
export const nodeEvents = sqliteTable(
    'node_events',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        nodeId: text()
            .notNull()
            .references(() => nodes.id),
        kind: text({ enum: ['connected', 'disconnected', 'restarted', 'malformed'] }).notNull(),
        at: timestamp().notNull(),
        uploadedById: text()
            .notNull()
            .references(() => users.id),
    },
    (t) => [uniqueIndex('node_events_node_kind_at_idx').on(t.nodeId, t.kind, t.at)]
)

export const linkObservations = sqliteTable(
    'link_observations',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        fromNodeId: text()
            .notNull()
            .references(() => nodes.id),
        toNodeId: text()
            .notNull()
            .references(() => nodes.id),
        observedAt: timestamp().notNull(),
        snr: real().notNull(),
        rssi: real(),
    },
    (t) => [index('link_observations_time_idx').on(t.observedAt)]
)

// ── Alerts ──────────────────────────────────────────────────────────────────

export const alertRules = sqliteTable(
    'alert_rules',
    {
        id: text().primaryKey(),
        ownerId: text()
            .notNull()
            .references(() => users.id),
        nodeId: text().references(() => nodes.id),
        metric: text().notNull(),
        comparison: text({ enum: ['above', 'below'] }).notNull(),
        threshold: real().notNull(),
        durationS: integer().notNull(),
        cooldownS: integer().notNull(),
        enabled: integer({ mode: 'boolean' }).notNull(),
        /** Rules are soft-deleted so the alerts they raised keep their owner. */
        deletedAt: timestamp(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (t) => [index('alert_rules_metric_idx').on(t.metric)]
)

export const alerts = sqliteTable(
    'alerts',
    {
        id: text().primaryKey(),
        kind: text({ enum: ['rule', 'offline', 'low_battery'] }).notNull(),
        ruleId: text().references(() => alertRules.id),
        nodeId: text()
            .notNull()
            .references(() => nodes.id),
        status: text({ enum: ['open', 'acknowledged', 'resolved'] }).notNull(),
        triggerValue: real(),
        openedAt: timestamp().notNull(),
        resolvedAt: timestamp(),
    },
    (t) => [
        index('alerts_status_idx').on(t.status),
        index('alerts_rule_node_idx').on(t.ruleId, t.nodeId, t.openedAt),
        index('alerts_kind_node_idx').on(t.kind, t.nodeId, t.status),
    ]
)

export const alertEvents = sqliteTable(
    'alert_events',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        alertId: text()
            .notNull()
            .references(() => alerts.id),
        status: text({ enum: ['open', 'acknowledged', 'resolved'] }).notNull(),
        actorId: text().references(() => users.id),
        at: timestamp().notNull(),
        note: text(),
    },
    (t) => [index('alert_events_alert_idx').on(t.alertId)]
)

/** Reserved for notifications. Empty until they are built. */
export const notificationChannels = sqliteTable(
    'notification_channels',
    {
        id: text().primaryKey(),
        userId: text()
            .notNull()
            .references(() => users.id),
        kind: text().notNull(),
        target: text().notNull(),
        enabled: integer({ mode: 'boolean' }).notNull().default(true),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex('notification_channels_user_kind_target_idx').on(t.userId, t.kind, t.target),
    ]
)

// ── Monitoring ──────────────────────────────────────────────────────────────

/**
 * The event log (#36): a few structured facts about the system's health, for
 * admins and the alerting agent. Codes and IDs only, never free text. The
 * detail stays in the process log. Unlike everything else here, rows are
 * deleted after 90 days (docs/SPEC.md, Event log).
 */
export const events = sqliteTable(
    'events',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        at: timestamp().notNull(),
        severity: text({ enum: ['info', 'warn', 'error'] }).notNull(),
        type: text().notNull(),
        subjectKind: text({ enum: ['gateway', 'node', 'user'] }),
        subjectId: text(),
        /** How many occurrences this row stands for; counted events cover a window. */
        count: integer().notNull().default(1),
        details: text({ mode: 'json' }).$type<Record<string, string | number | boolean | null>>(),
    },
    (t) => [index('events_at_idx').on(t.at)]
)

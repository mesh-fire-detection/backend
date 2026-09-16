import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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

/** Single-use invite links. Only a SHA-256 hash of the token is stored. */
export const invites = sqliteTable('invites', {
    id: text().primaryKey(),
    tokenHash: text().notNull().unique(),
    email: text().notNull(),
    role: text({ enum: ['admin', 'user'] }).notNull(),
    invitedById: text()
        .notNull()
        .references(() => users.id),
    expiresAt: timestamp().notNull(),
    acceptedAt: timestamp(),
    acceptedUserId: text().references(() => users.id),
    createdAt: createdAt(),
})

// ── Mesh ────────────────────────────────────────────────────────────────────

export const devices = sqliteTable('devices', {
    id: text().primaryKey(),
    nodeNum: integer().notNull().unique(),
    name: text().notNull(),
    type: text({ enum: ['base', 'cellular', 'sensor', 'vision'] }).notNull(),
    longitude: real().notNull(),
    latitude: real().notNull(),
    elevationM: real().notNull(),
    antennaHeightM: real().notNull(),
    firmware: text().notNull(),
    deployedOn: text().notNull(),
    note: text(),
    enabled: integer({ mode: 'boolean' }).notNull().default(true),
    lastHeardAt: timestamp(),
    reportedName: text(),
    reportedLongitude: real(),
    reportedLatitude: real(),
    reportedAltitudeM: real(),
    reportedAt: timestamp(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
})

export const gateways = sqliteTable('gateways', {
    deviceId: text()
        .primaryKey()
        .references(() => devices.id),
    mqttUsername: text().notNull().unique(),
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
            .references(() => devices.id),
        receivedAt: timestamp().notNull(),
    },
    (t) => [index('packets_seen_key_idx').on(t.fromNodeNum, t.packetId, t.receivedAt)]
)

export const deviceMetrics = sqliteTable(
    'device_metrics',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        deviceId: text()
            .notNull()
            .references(() => devices.id),
        recordedAt: timestamp().notNull(),
        batteryPct: real(),
        voltage: real(),
        uptimeS: integer(),
    },
    (t) => [index('device_metrics_device_time_idx').on(t.deviceId, t.recordedAt)]
)

/** One row per value. Metric names come from the sensor, e.g. `environmentMetrics.temperature`. */
export const readings = sqliteTable(
    'readings',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        deviceId: text()
            .notNull()
            .references(() => devices.id),
        recordedAt: timestamp().notNull(),
        metric: text().notNull(),
        value: real().notNull(),
    },
    (t) => [
        index('readings_device_time_idx').on(t.deviceId, t.recordedAt),
        index('readings_device_metric_time_idx').on(t.deviceId, t.metric, t.recordedAt),
    ]
)

export const linkObservations = sqliteTable(
    'link_observations',
    {
        id: integer().primaryKey({ autoIncrement: true }),
        fromDeviceId: text()
            .notNull()
            .references(() => devices.id),
        toDeviceId: text()
            .notNull()
            .references(() => devices.id),
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
        deviceId: text().references(() => devices.id),
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
        deviceId: text()
            .notNull()
            .references(() => devices.id),
        status: text({ enum: ['open', 'acknowledged', 'resolved'] }).notNull(),
        triggerValue: real(),
        openedAt: timestamp().notNull(),
        resolvedAt: timestamp(),
    },
    (t) => [
        index('alerts_status_idx').on(t.status),
        index('alerts_rule_device_idx').on(t.ruleId, t.deviceId, t.openedAt),
        index('alerts_kind_device_idx').on(t.kind, t.deviceId, t.status),
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

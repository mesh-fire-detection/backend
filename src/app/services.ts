import { createEvaluationRepo } from '#src/alerts/evaluation/repo'
import { createEvaluationService } from '#src/alerts/evaluation/service'
import { createAlertRepo } from '#src/alerts/lifecycle/repo'
import { createAlertService } from '#src/alerts/lifecycle/service'
import { createRuleRepo } from '#src/alerts/rules/repo'
import { createRuleService } from '#src/alerts/rules/service'
import { type MqttState } from '#src/health/schema'
import { createHealthService } from '#src/health/service'
import { createGatewayRepo } from '#src/mesh/gateways/repo'
import { createGatewayService } from '#src/mesh/gateways/service'
import { createIngestRepo } from '#src/mesh/ingest/repo'
import { createIngestService } from '#src/mesh/ingest/service'
import { createNetworkRepo } from '#src/mesh/network/repo'
import { createNetworkService } from '#src/mesh/network/service'
import { createNodeRepo } from '#src/mesh/nodes/repo'
import { createNodeService } from '#src/mesh/nodes/service'
import { createNotehubRepo } from '#src/mesh/notehub/repo'
import { createNotehubService } from '#src/mesh/notehub/service'
import { createReadingsRepo } from '#src/mesh/readings/repo'
import { createReadingsService } from '#src/mesh/readings/service'
import { type Auth } from '#src/shared/auth/auth'
import { createMembership } from '#src/shared/auth/membership'
import { type Db, pingDatabase, transaction } from '#src/shared/db/connection'
import { type EmailService } from '#src/shared/email/service'
import { type Logger } from '#src/shared/logger'
import { type Clock } from '#src/shared/time'
import { createUserRepo } from '#src/users/repo'
import { createUserService } from '#src/users/service'

export type AppConfig = {
    readonly statusDegradedMin: number
    readonly statusOfflineMin: number
    readonly lowBatteryPct: number
    readonly notehubChannelKey?: Buffer | undefined
    readonly linkWindowMin: number
    /** The website's origin, for links in emails such as a subscription confirmation. */
    readonly siteUrl: string
}

export type ServiceDeps = {
    readonly db: Db
    readonly auth: Auth
    readonly clock: Clock
    readonly logger: Logger
    readonly config: AppConfig
    readonly mqttState: () => MqttState
    readonly email: EmailService
}

/** The only place repos and services are wired together. */
export function createServices(deps: ServiceDeps) {
    const { db, auth, clock, logger, config } = deps
    const transact = <T>(fn: () => T): T => transaction(db, fn)
    const statusThresholds = {
        degradedMin: config.statusDegradedMin,
        offlineMin: config.statusOfflineMin,
        lowBatteryPct: config.lowBatteryPct,
    }

    const nodeRepo = createNodeRepo(db)
    const gatewayRepo = createGatewayRepo(db)
    const networkRepo = createNetworkRepo(db)
    const ruleRepo = createRuleRepo(db)
    const alertRepo = createAlertRepo(db)

    const nodes = createNodeService({
        repo: nodeRepo,
        clock,
        transact,
        batteries: () => networkRepo.latestBatteryByNode(),
        thresholds: statusThresholds,
    })
    const alerts = createAlertService({ repo: alertRepo, clock, transact })
    const evaluation = createEvaluationService({
        repo: createEvaluationRepo(db),
        ruleRepo,
        alertRepo,
        alerts,
        nodeRepo,
        networkRepo,
        transact,
        thresholds: { offlineMin: config.statusOfflineMin, lowBatteryPct: config.lowBatteryPct },
    })

    const ingest = createIngestService({
        nodeRepo,
        gatewayRepo,
        repo: createIngestRepo(db),
        transact,
        onReadings: (readings) => {
            evaluation.onReadings(readings)
        },
        logger,
    })
    const notehub = createNotehubService({
        repo: createNotehubRepo(db),
        gatewayRepo,
        nodeRepo,
        ingest,
        transact,
        clock,
        logger,
        channelKey: config.notehubChannelKey,
    })

    return {
        email: deps.email,
        health: createHealthService({
            databaseOk: () => pingDatabase(db),
            notehubHealth: () => notehub.health(),
            mqttState: deps.mqttState,
            emailState: () => deps.email.state(),
        }),
        users: createUserService({
            repo: createUserRepo(db),
            auth,
            membership: createMembership({ db, clock }),
            email: deps.email,
            siteUrl: config.siteUrl,
            clock,
        }),
        nodes,
        gateways: createGatewayService({ repo: gatewayRepo, nodeRepo, clock }),
        ingest,
        notehub,
        network: createNetworkService({
            repo: networkRepo,
            nodeRepo,
            clock,
            thresholds: statusThresholds,
            linkWindowMin: config.linkWindowMin,
        }),
        readings: createReadingsService({ repo: createReadingsRepo(db), nodes, clock }),
        rules: createRuleService({ repo: ruleRepo, nodeRepo, clock }),
        alerts,
        evaluation,
    }
}

export type Services = ReturnType<typeof createServices>

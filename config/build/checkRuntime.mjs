import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const rootDir = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'mesh-runtime-'))
const databasePath = path.join(directory, 'mesh.db')
let child
let completion
let logs = ''

try {
    // Ask the OS for a free loopback port instead of taking the developer's port 3000.
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    assert.ok(address && typeof address !== 'string')
    const port = address.port
    await new Promise((resolve, reject) => {
        reservation.close((error) => (error ? reject(error) : resolve()))
    })
    const baseUrl = `http://127.0.0.1:${port}`

    // Start the actual production entry point. Do not load .env or enable MQTT.
    child = spawn(process.execPath, ['dist/index.js'], {
        cwd: rootDir,
        env: {
            NODE_ENV: 'production',
            HOST: '127.0.0.1',
            PORT: String(port),
            LOG_LEVEL: 'info',
            DATABASE_PATH: databasePath,
            AUTH_SECRET: 'runtime-check-secret-at-least-32-characters',
            AUTH_URL: baseUrl,
            CORS_ORIGIN: 'http://localhost:5173',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => {
        logs += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
        logs += chunk.toString()
    })
    completion = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal }))
    })
    // A spawn failure must remain handled while the HTTP readiness probe is running.
    void completion.catch(() => {})

    const deadline = Date.now() + 15_000
    let ready = false
    let lastError
    while (Date.now() < deadline) {
        assert.ok(
            child.exitCode === null && child.signalCode === null,
            'The compiled app exited before becoming ready'
        )
        try {
            const response = await fetch(`${baseUrl}/health`, {
                signal: AbortSignal.timeout(1000),
            })
            assert.equal(response.status, 200)
            assert.deepEqual(await response.json(), {
                status: 'ok',
                database: 'ok',
                mqtt: 'disabled',
            })
            ready = true
            break
        } catch (error) {
            lastError = error
        }
        await delay(100)
    }
    if (!ready) throw new Error('The compiled app did not become healthy', { cause: lastError })

    await access(databasePath)
    const network = await fetch(`${baseUrl}/api/network.json`, {
        signal: AbortSignal.timeout(1000),
    })
    assert.equal(network.status, 200)
    assert.deepEqual(await network.json(), { nodes: [], links: [] })

    child.kill('SIGTERM')
    const result = await Promise.race([
        completion,
        delay(5000, undefined, { ref: false }).then(() => {
            throw new Error('The compiled app did not stop within 5 seconds')
        }),
    ])
    assert.deepEqual(result, { code: 0, signal: null }, 'The compiled app did not stop cleanly')
    process.stdout.write('Compiled app starts, migrates SQLite, serves HTTP, and stops cleanly.\n')
} catch (error) {
    process.stderr.write(logs)
    throw error
} finally {
    try {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await completion
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

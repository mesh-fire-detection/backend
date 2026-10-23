import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

const rootDir = path.resolve(import.meta.dirname, '../../..')
const backendSchema = JSON.stringify(path.join(rootDir, 'src/mesh/network/schema.js'))

const checkFixture = (source: string) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mesh-contract-'))
    try {
        const sourceDir = path.join(directory, 'src/core/content/network')
        mkdirSync(sourceDir, { recursive: true })
        writeFileSync(path.join(sourceDir, 'network.ts'), source)
        return spawnSync(
            process.execPath,
            [path.join(rootDir, 'config/build/checkNetworkContract.mjs'), directory],
            // Generous for the same reason as the Vitest timeout below: this
            // spawns a real TypeScript compile that competes with the rest of
            // the suite. Being killed here reads as a contract failure, which
            // is the most misleading way this could fail.
            { cwd: rootDir, encoding: 'utf8', timeout: 60_000 }
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

/**
 * Each case spawns a TypeScript compile, which takes about a second idle and
 * longer when the rest of the suite is running beside it. Vitest's five-second
 * default made that a coin toss under load, failing a push and passing on the
 * identical retry.
 */
const SPAWNS_A_COMPILE = { timeout: 90_000 }

describe('network contract check', () => {
    it('accepts matching types, including re-exports', SPAWNS_A_COMPILE, () => {
        const result = checkFixture(`export type { MeshNode, MeshLink } from ${backendSchema}`)
        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr).toBe(0)
    })

    it.each([
        {
            label: 'non-nullable RSSI',
            node: 'BackendNode',
            link: "Omit<BackendLink, 'rssi'> & { rssi: number }",
            message: 'MeshLink field types differ',
        },
        {
            label: 'missing SNR',
            node: 'BackendNode',
            link: "Omit<BackendLink, 'snr'>",
            message: 'MeshLink fields differ',
        },
        {
            label: 'an extra optional field',
            node: 'BackendNode & { extra?: string }',
            link: 'BackendLink',
            message: 'MeshNode fields differ',
        },
        {
            label: 'a required note',
            node: "Omit<BackendNode, 'note'> & { note: string }",
            link: 'BackendLink',
            message: 'MeshNode field types differ',
        },
        {
            label: 'a narrower status enum',
            node: "Omit<BackendNode, 'status'> & { status: 'online' }",
            link: 'BackendLink',
            message: 'MeshNode field types differ',
        },
    ])('rejects $label', SPAWNS_A_COMPILE, ({ node, link, message }) => {
        const result = checkFixture(`
            import type { MeshNode as BackendNode, MeshLink as BackendLink } from ${backendSchema}
            export type MeshNode = ${node}
            export type MeshLink = ${link}
        `)
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(message)
    })
})

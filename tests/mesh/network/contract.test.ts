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
            { cwd: rootDir, encoding: 'utf8', timeout: 10_000 }
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

describe('network contract check', () => {
    it('accepts matching types, including re-exports', () => {
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
    ])('rejects $label', ({ node, link, message }) => {
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

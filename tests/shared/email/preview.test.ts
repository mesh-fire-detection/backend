import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPreviewStore } from '#src/shared/email/preview'
import { signInCode } from '#src/shared/email/templates'

const AT = new Date('2026-06-01T12:00:00.000Z')
const directories: string[] = []

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mfd-mail-'))
    directories.push(directory)
    return directory
}

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true })
    }
})

describe('the preview store, which stands in for a provider locally', () => {
    it('writes the message to a file a developer can open', async () => {
        const directory = temporaryDirectory()
        const store = createPreviewStore(directory, () => AT)

        await store.sender.send(signInCode('ranger@example.org', '314159', 10))

        const [file] = fs.readdirSync(directory)
        expect(file).toContain('sign-in-code')
        const contents = fs.readFileSync(path.join(directory, String(file)), 'utf8')
        expect(contents).toContain('To: ranger@example.org')
        expect(contents).toContain('314159')
    })

    it('lists messages newest first for /dev/mail', async () => {
        const store = createPreviewStore(temporaryDirectory(), () => AT)

        await store.sender.send(signInCode('first@example.org', '111111', 10))
        await store.sender.send(signInCode('second@example.org', '222222', 10))

        expect(store.list().map((message) => message.to)).toEqual([
            'second@example.org',
            'first@example.org',
        ])
    })

    it('keeps working when the directory cannot be written', async () => {
        const directory = path.join(temporaryDirectory(), 'file-not-a-directory')
        fs.writeFileSync(directory, 'in the way', 'utf8')
        const store = createPreviewStore(path.join(directory, 'mail'), () => AT)

        const result = await store.sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result.ok).toBe(true)
        expect(store.list()).toHaveLength(1)
    })

    it('reports success, so local sign-in behaves as it would in production', async () => {
        const store = createPreviewStore(temporaryDirectory(), () => AT)

        const result = await store.sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result.ok).toBe(true)
    })
})

import { type EmailMessage } from '#src/shared/email/message'

/**
 * The messages the backend sends, as plain text. One function per message, so
 * the wording lives in one place and a test can read it.
 *
 * Keep them short and literal. A sign-in code is read on a phone, often
 * outdoors, by someone who asked for it ten seconds ago.
 */

/**
 * A code and no link, deliberately. A link saves one tap when the mail and the
 * browser are on the same device, and costs the code appearing in a URL, a
 * landing page to stop mail scanners spending it, and nothing at all when
 * someone reads mail on a phone and browses on a laptop. Phones offer codes
 * from the notification now, which was most of the argument for links.
 */
export function signInCode(to: string, code: string, validForMinutes: number): EmailMessage {
    return {
        template: 'sign-in-code',
        to,
        subject: `${code} is your Mesh Fire Detection sign-in code`,
        text: [
            `Your sign-in code is ${code}.`,
            '',
            `It works once, and expires in ${validForMinutes} minutes.`,
            '',
            'If you did not ask to sign in, you can ignore this message. Someone',
            'typed your address; without the code they cannot get in.',
        ].join('\n'),
    }
}

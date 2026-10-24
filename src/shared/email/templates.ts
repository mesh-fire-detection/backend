import { type EmailMessage } from '#src/shared/email/message'

/**
 * The messages the backend sends, as plain text. One function per message, so
 * the wording lives in one place and a test can read it.
 *
 * Keep them short and literal. A sign-in code is read on a phone, often
 * outdoors, by someone who asked for it ten seconds ago.
 */

/**
 * The link carries the same code the message spells out, so there is one
 * token, one expiry and one attempt counter however the person uses it. The
 * page it opens completes the sign-in with a button, which is what stops a
 * mail scanner's prefetch from spending the code on its way through.
 */
export function signInCode(
    to: string,
    code: string,
    link: string,
    validForMinutes: number
): EmailMessage {
    return {
        template: 'sign-in-code',
        to,
        subject: `${code} is your Mesh Fire Detection sign-in code`,
        text: [
            'Open this link to sign in:',
            link,
            '',
            `Or type this code: ${code}`,
            '',
            `Either works once, and expires in ${validForMinutes} minutes.`,
            '',
            'If you did not ask to sign in, you can ignore this message. Someone',
            'typed your address; without the code they cannot get in.',
        ].join('\n'),
    }
}

/** Where the link in that message points. The page reads the code and posts it. */
export function signInLink(siteOrigin: string, to: string, code: string): string {
    const url = new URL('/sign-in', siteOrigin)
    url.searchParams.set('email', to)
    url.searchParams.set('code', code)
    return url.href
}

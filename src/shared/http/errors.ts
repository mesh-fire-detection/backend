/** The only error shape the API returns. Never carries stack traces or SQL. */
export type ErrorBody = {
    readonly error: {
        readonly code: string
        readonly message: string
    }
}

export function errorBody(code: string, message: string): ErrorBody {
    return { error: { code, message } }
}

const CODES_BY_STATUS: Readonly<Partial<Record<number, string>>> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    413: 'payload_too_large',
    429: 'rate_limited',
}

export function codeForStatus(status: number): string {
    return CODES_BY_STATUS[status] ?? 'http_error'
}

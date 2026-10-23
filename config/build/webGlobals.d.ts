/**
 * Ambient globals the website relies on, for the contract check only.
 *
 * `checkNetworkContract.mjs` compiles a few of the website's sources with the
 * backend's tsconfig to compare the `MeshNode` and `MeshLink` types across the
 * two repositories. The website is a Vite app, so those sources can reach
 * `import.meta.env`, which Vite types through `vite/client`. The backend has no
 * reason to depend on Vite, so the check declares the few members it needs.
 *
 * Declared one by one rather than as an index signature, because the backend
 * sets `noPropertyAccessFromIndexSignature`. Add a member here if the website
 * starts using one; the error will say which.
 *
 * Excluded from the backend's own tsconfig: this exists so the website's files
 * compile here, not so the backend may use `import.meta.env`.
 */
interface ImportMeta {
    readonly env: {
        readonly BASE_URL: string
        readonly MODE: string
        readonly DEV: boolean
        readonly PROD: boolean
        readonly SSR: boolean
    }
}

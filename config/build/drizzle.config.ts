import { defineConfig } from 'drizzle-kit'

// Generates SQL into `migrations/` from the schema. Never edit a committed migration.
export default defineConfig({
    dialect: 'sqlite',
    schema: './src/shared/db/schema.ts',
    out: './migrations',
    casing: 'snake_case',
})

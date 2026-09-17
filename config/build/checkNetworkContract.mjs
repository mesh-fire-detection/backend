import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const rootDir = path.resolve(import.meta.dirname, '../..')
const webDir = path.resolve(rootDir, process.argv[2] ?? '../web')
const files = [
    path.join(rootDir, 'src/mesh/network/schema.ts'),
    path.join(webDir, 'src/core/content/network/network.ts'),
]

const config = ts.readConfigFile(path.join(rootDir, 'tsconfig.json'), ts.sys.readFile)
assert.equal(config.error, undefined, 'Could not read the backend tsconfig.json')
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir, {
    paths: { '@core/*': [path.join(webDir, 'src/core/*.ts')] },
})
const program = ts.createProgram(files, parsed.options)
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => rootDir,
        getCanonicalFileName: (fileName) => fileName,
        getNewLine: () => '\n',
    })
)

const checker = program.getTypeChecker()
const exportsByFile = files.map((file) => {
    const source = program.getSourceFile(file)
    assert.ok(source, `Missing contract source: ${file}`)
    const module = checker.getSymbolAtLocation(source)
    assert.ok(module, `Missing module: ${file}`)
    return new Map(checker.getExportsOfModule(module).map((symbol) => [symbol.name, symbol]))
})

for (const name of ['MeshNode', 'MeshLink']) {
    const types = exportsByFile.map((exports) => {
        const symbol = exports.get(name)
        assert.ok(symbol, `Missing exported type: ${name}`)
        return checker.getDeclaredTypeOfSymbol(
            symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
        )
    })
    const [backend, web] = types
    assert.deepEqual(
        backend
            .getProperties()
            .map((property) => property.name)
            .toSorted(),
        web
            .getProperties()
            .map((property) => property.name)
            .toSorted(),
        `${name} fields differ between backend and web`
    )
    assert.ok(
        checker.isTypeAssignableTo(backend, web) && checker.isTypeAssignableTo(web, backend),
        `${name} field types differ between backend and web`
    )
}

process.stdout.write('Network contract matches the web types.\n')

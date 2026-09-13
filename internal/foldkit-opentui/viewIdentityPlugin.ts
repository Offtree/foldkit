import { transformViewIdentity } from '@foldkit/vite-plugin'

const root = import.meta.dir
const applicationModule = /(?:^|[\\/])(?:example|form)[\\/].*\.ts$/
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

Bun.plugin({
  name: 'foldkit-opentui-view-identity',
  setup: build => {
    build.onLoad({ filter: applicationModule }, async ({ path }) => {
      const source = await Bun.file(path).text()
      const javascript = transpiler.transformSync(source)
      const transformed = transformViewIdentity(javascript, path, root)

      return { contents: transformed?.code ?? javascript, loader: 'js' }
    })
  },
})

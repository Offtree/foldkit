import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('Bun-generated identities replace terminal view branches', async () => {
  const root = resolve(import.meta.dir, '..')
  const childProcess = Bun.spawn(
    [
      process.execPath,
      '--preload',
      './viewIdentityPlugin.ts',
      '-e',
      `import { Array, Option } from 'effect'
import { InputRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { init as listInit, view as listView } from './example/main.ts'
import { init as formInit, view as formView } from './form/main.ts'
import { createReconciler } from './src/reconciler.ts'

const setup = await createTestRenderer({ width: 60, height: 16, useThread: false })
const tree = createReconciler(setup.renderer, () => {})
const applicationRoot = () => {
  const container = Option.getOrThrow(Array.head(setup.renderer.root.getChildren()))
  return Option.getOrThrow(Array.head(container.getChildren()))
}
const descendants = parent =>
  parent.getChildren().flatMap(child => [child, ...descendants(child)])
try {
  tree.commit(listView(listInit().model))
  const listRoot = applicationRoot()
  const listInput = descendants(listRoot).find(child => child instanceof InputRenderable)
  if (!(listInput instanceof InputRenderable)) throw new Error('Missing list input')

  tree.commit(formView(formInit().model))
  console.log(JSON.stringify({
    replaced: applicationRoot() !== listRoot,
    rootDestroyed: listRoot.isDestroyed,
    inputDestroyed: listInput.isDestroyed,
    inputListeners: listInput.listenerCount('input'),
  }))
} finally {
  tree.dispose()
  setup.renderer.destroy()
}`,
    ],
    { cwd: root, stderr: 'pipe', stdout: 'pipe' },
  )
  const [exitCode, stderr, stdout] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stderr).text(),
    new Response(childProcess.stdout).text(),
  ])

  expect(stderr).toBe('')
  expect(exitCode).toBe(0)
  expect(JSON.parse(stdout)).toEqual({
    replaced: true,
    rootDestroyed: true,
    inputDestroyed: true,
    inputListeners: 0,
  })
})

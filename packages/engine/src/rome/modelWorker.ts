import { buildModel, type BuiltModel } from './buildModel.ts'

/**
 * Fetches and builds the model of Rome off the main thread (ModelLayer `load`): it is
 * millions of vertices, half a second of work that would otherwise hold up the map's
 * first frame. Posts back the mesh, or null if the pipeline's output is missing.
 */
self.onmessage = async () => {
  const [meta, bin] = await Promise.all([
    fetch('/rome/model.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch('/rome/model.bin')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
  ])
  const post = self as unknown as Worker
  if (!meta || !bin) return post.postMessage(null)
  const built: BuiltModel = buildModel(meta, bin)
  post.postMessage(built, [
    ...Object.values(built.attributes).map(([a]) => a.buffer),
    built.tops.buffer,
  ])
}

// Validate the reviewable configuration before any remote mutation.
export function validateReleaseConfig(config, worker) {
  const id = /^[a-f0-9]{32}$/;
  if (
    !['staging', 'production'].includes(config.environment) ||
    !id.test(config.accountId) ||
    !id.test(config.otherAccountId) ||
    config.accountId === config.otherAccountId
  )
    throw Error('Separate environment accounts required');
  if (
    worker.account_id !== config.accountId ||
    worker.name !== config.workerName ||
    worker.vars?.ALLOWED_ORIGIN !== config.origin
  )
    throw Error('Environment identity mismatch');
  if (
    worker.observability?.enabled !== false ||
    worker.observability?.logs?.invocation_logs !== false ||
    worker.observability?.traces?.enabled !== false ||
    worker.tail_consumers?.length
  )
    throw Error('Unsafe observability');
  if (
    worker.assets?.run_worker_first !== true ||
    worker.assets?.binding !== 'ASSETS' ||
    worker.assets?.not_found_handling !== 'none'
  )
    throw Error('API and private assets must pass Worker admission');
  const bindings = worker.durable_objects?.bindings;
  if (
    bindings?.length !== 1 ||
    bindings[0].name !== 'CAPTURE' ||
    bindings[0].class_name !== 'CaptureStore' ||
    bindings[0].script_name
  )
    throw Error('Stable capture binding required');
  if (
    worker.r2_buckets?.length !== 1 ||
    worker.r2_buckets[0].binding !== 'RECORDINGS' ||
    !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(worker.r2_buckets[0].bucket_name || '')
  )
    throw Error('Private recording bucket required');
  if (
    worker.migrations?.some(
      (m) =>
        Object.keys(m).some((k) => !['tag', 'new_sqlite_classes'].includes(k)) ||
        m.new_sqlite_classes?.some((c) => c !== 'CaptureStore'),
    )
  )
    throw Error('Destructive or unrelated migration refused');
  if (JSON.stringify(worker.triggers?.crons) !== JSON.stringify(['*/5 * * * *']))
    throw Error('Independent cleanup schedule required');
  if (worker.preview_urls !== false) throw Error('Preview URLs must be disabled');
  if (
    config.environment === 'production' &&
    (config.origin !== 'https://simulacrum.build' ||
      worker.workers_dev !== false ||
      JSON.stringify(worker.routes) !==
        JSON.stringify([{ pattern: 'simulacrum.build', custom_domain: true }]))
  )
    throw Error('Production custom domain required');
  if (
    config.environment === 'staging' &&
    (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(config.origin) ||
      worker.workers_dev !== true ||
      worker.routes?.length)
  )
    throw Error('Isolated staging origin required');
  return worker;
}

export function validateEffectiveBindings(config, settings) {
  const bucket = settings.bindings?.filter((b) => b.name === 'RECORDINGS');
  const capture = settings.bindings?.filter((b) => b.name === 'CAPTURE');
  if (
    !config.captureNamespaceId ||
    bucket?.length !== 1 ||
    bucket[0].type !== 'r2_bucket' ||
    bucket[0].bucket_name !== config.bucketName ||
    capture?.length !== 1 ||
    capture[0].type !== 'durable_object_namespace' ||
    capture[0].namespace_id !== config.captureNamespaceId ||
    capture[0].class_name !== 'CaptureStore'
  )
    throw Error('Effective recording binding drift');
}

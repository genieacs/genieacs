import * as promClient from 'prom-client'

type CollectCallback = (() => void)
type CallbackEntry = {
  labels: { [k: string]: string | number },
  cb: (() => number)
}

const registeredCallbacks: { [metricName: string]: CallbackEntry[] } = {}


function collectorCallback(metricName: string): CollectCallback {
  return function () {
    if (registeredCallbacks[metricName] && this instanceof promClient.Gauge) {
      for (const entry of registeredCallbacks[metricName])
        this.labels(entry.labels).set(entry.cb())
    }
  }
}
const callbackEntryCreator = function (metricName: string) {
  return function (entry: CallbackEntry): void {
    if (!registeredCallbacks[metricName])
      registeredCallbacks[metricName] = []
    registeredCallbacks[metricName].push(entry);
  }
}

export const metricsExporter = {
  socketConnections: new promClient.Gauge({
    name: 'genieacs_socket_connections',
    help: 'Current socket connections active',
    labelNames: ['server', 'type']
  }),

  sessionInit: new promClient.Gauge({
    name: 'genieacs_session_init',
    help: 'Initiated connection sessions.',
    labelNames: ['server']
  }),

  totalConnectionTime: new promClient.Summary({
    name: 'genieacs_total_connection_time',
    help: 'Socket connection times',
    labelNames: ['server'],
    maxAgeSeconds: 300,
    ageBuckets: 5,
    percentiles: [0.05, 0.5, 0.95]
  }),

  faultRpc: new promClient.Gauge({
    name: 'genieacs_fault_rpc',
    help: 'RPC faults',
  }),

  registeredDevice: new promClient.Gauge({
    name: 'genieacs_registered_devices',
    help: 'Registered devices',
  }),

  totalRequests: new promClient.Gauge({
    name: 'genieacs_total_requests',
    help: 'Total incoming http requests on genieacs',
    labelNames: ['server']
  }),

  droppedRequests: new promClient.Gauge({
    name: 'genieacs_dropped_requests',
    help: 'droppedRequests',
    labelNames: ['server']
  }),

  provisionsFailed: new promClient.Gauge({
    name: 'genieacs_provisions_failed',
    help: 'Failed provisions with error message as label',
    labelNames: ['reason'],
  }),

  provisionDuration: new promClient.Histogram({
    name: 'genieacs_provision_duration',
    help: 'Provision durations in seconds',
    labelNames: ['name', 'ext_counter'],
    buckets: [0.001, 0.01, 0.1, 1, 5],
  }),

  extensionDuration: new promClient.Histogram({
    name: 'genieacs_extension_duration',
    help: 'Extension durations in seconds',
    labelNames: ['script_name'],
    buckets: [0.001, 0.01, 0.1, 1, 5],
  }),

  blockedNewCpe: new promClient.Gauge({
    name: 'genieacs_blocked_new_cpe',
    help: 'New CPEs that were blocked before registering',
  }),

  cpeRequestType: new promClient.Gauge({
    name: 'genieacs_cpe_request_type',
    help: 'Name of the request type from CPE, as defined in TR-069 protocol',
    labelNames: ['type'],
  }),

  acsRequestType: new promClient.Gauge({
    name: 'genieacs_acs_request_type',
    help: 'Name of the request type to CPE, as defined in TR-069 protocol',
    labelNames: ['type'],
  }),

  // Below gauge metrics are collected by callbacks.
  // We don't export the metrics, only the callback.
  concurrentRequestsCB: callbackEntryCreator('concurrentRequests')
}

new promClient.Gauge({
  name: 'genieacs_concurrent_requests',
  help: 'concurrentRequests',
  labelNames: ['server'],
  collect: collectorCallback('concurrentRequests'),
});

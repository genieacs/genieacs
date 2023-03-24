import * as promClient from 'prom-client'

type CollectCallback = (()=>void)
type CallbackEntry = {
  labels: {[k:string]:string|number},
  cb: (()=>number)
}

promClient.collectDefaultMetrics({
	prefix: 'genieacs_',
	gcDurationBuckets: [0.001,0.01,0.1,1,5],
})

const registeredCallbacks : {[metricName:string]:CallbackEntry[]} = {}


function collectorCallback( metricName:string) : CollectCallback {
  return function() {
    if (registeredCallbacks[metricName] && this instanceof promClient.Gauge) {
      for (const entry of registeredCallbacks[metricName] )
        this.labels(entry.labels).set(entry.cb())
    }
  }
}
const callbackEntryCreator = function(metricName:string) {
  return function( entry:CallbackEntry ) : void {
    if (!registeredCallbacks[metricName])
      registeredCallbacks[metricName] = []
    registeredCallbacks[metricName].push(entry);
  } 
} 

export const metricsExporter = {
  socketConnections : new promClient.Gauge({
    name:'socket_connections',
    help:'Current socket connections active',
    labelNames: ['server','type']
  }),

  sessionInit : new promClient.Gauge({
    name:'session_init',
    help:'Initiated connection sessions.',
    labelNames: ['server']
  }),

  totalConnectionTime : new promClient.Summary({
    name:'total_connection_time',
    help:'Socket connection times',
    labelNames: ['server'],
    maxAgeSeconds: 300,
    ageBuckets: 5,
    percentiles: [0.05,0.5,0.95]
  }),

  faultRpc : new promClient.Gauge({
    name:'fault_rpc',
    help:'RPC faults',
  }),

  registeredDevice : new promClient.Gauge({
    name:'registered_devices',
    help:'Registered devices',
  }),

  totalRequests : new promClient.Gauge({
    name:'total_requests',
    help:'Total incoming http requests on genieacs',
    labelNames: ['server']
  }),

  droppedRequests : new promClient.Gauge({
    name:'dropped_requests',
    help:'droppedRequests',
    labelNames: ['server']
  }),

  provisionDuration : new promClient.Histogram({
    name:'provision_duration',
    help:'Provision durations in milliseconds. This can be',
    labelNames: ['name','ext_counter'],
  }),

  extensionDuration : new promClient.Histogram({
    name:'extension_duration',
    help:'Extension durations in milliseconds',
    labelNames: ['script_name']
  }),

  // Below gauge metrics are collected by callbacks.
  // We don't export the metrics, only the callback.
  concurrentRequestsCB : callbackEntryCreator('concurrentRequests')
}

new promClient.Gauge({
  name:'concurrent_requests',
  help:'concurrentRequests',
  labelNames: ['server'],
  collect: collectorCallback('concurrentRequests'),
});

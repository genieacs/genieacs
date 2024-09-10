import * as config from "../lib/config.ts";
import * as logger from "../lib/logger.ts";
import * as cluster from "../lib/cluster.ts";
import * as server from "../lib/server.ts";
import { listener } from "../lib/ui.ts";
import * as extensions from "../lib/extensions.ts";
import * as db from "../lib/db/db.ts";
import { version as VERSION } from "../package.json";

logger.init("ui", VERSION);

const SERVICE_ADDRESS = config.get("UI_INTERFACE") as string;
const SERVICE_PORT = config.get("UI_PORT") as number;

function exitWorkerGracefully(): void {
  setTimeout(exitWorkerUngracefully, 5000).unref();
  Promise.all([
    db.disconnect(),
    extensions.killAll(),
    cluster.worker.disconnect(),
  ])
    .then(logger.close)
    .catch(exitWorkerUngracefully);
}

function exitWorkerUngracefully(): void {
  void extensions.killAll().finally(() => {
    process.exit(1);
  });
}

if (!cluster.worker) {
  const WORKER_COUNT = config.get("UI_WORKER_PROCESSES") as number;

  logger.info({
    message: `genieacs-ui starting`,
    pid: process.pid,
    version: VERSION,
  });

  cluster.start(WORKER_COUNT, SERVICE_PORT, SERVICE_ADDRESS);

  process.on("SIGINT", () => {
    logger.info({
      message: "Received signal SIGINT, exiting",
      pid: process.pid,
    });

    cluster.stop();
  });

  process.on("SIGTERM", () => {
    logger.info({
      message: "Received signal SIGTERM, exiting",
      pid: process.pid,
    });

    cluster.stop();
  });
} else {
  const key = config.get("UI_SSL_KEY") as string;
  const cert = config.get("UI_SSL_CERT") as string;
  const options = {
    port: SERVICE_PORT,
    host: SERVICE_ADDRESS,
    ssl: key && cert ? { key, cert } : null,
    timeout: 120000,
  };

  // Need this for Node < 15
  process.on("unhandledRejection", (err) => {
    throw err;
  });

  process.on("uncaughtException", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ERR_IPC_DISCONNECTED") return;
    logger.error({
      message: "Uncaught exception",
      exception: err,
      pid: process.pid,
    });
    server.stop().then(exitWorkerGracefully).catch(exitWorkerUngracefully);
  });

  const initPromise = db
    .connect()
    .then(() => {
      server.start(options, async (req, res) => listener(req, res));
    })
    .catch((err) => {
      setTimeout(() => {
        throw err;
      });
    });

  process.on("SIGINT", () => {
    void initPromise.finally(() => {
      server.stop().then(exitWorkerGracefully).catch(exitWorkerUngracefully);
    });
  });

  process.on("SIGTERM", () => {
    void initPromise.finally(() => {
      server.stop().then(exitWorkerGracefully).catch(exitWorkerUngracefully);
    });
  });
}

import { spawn, ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import readline from "node:readline";
import * as config from "./config.ts";
import { Fault } from "./types.ts";
import { ROOT_DIR } from "./config.ts";
import * as logger from "./logger.ts";

const TIMEOUT = +config.get("EXT_TIMEOUT");

const processes: { [script: string]: ChildProcess } = {};
const jobs = new Map();

export function run(args: string[]): Promise<{ fault: Fault; value: any }> {
  return new Promise((resolve) => {
    const scriptName = args[0];

    const id = crypto.randomBytes(8).toString("hex");
    jobs.set(id, resolve);

    if (!processes[scriptName]) {
      const p = spawn(ROOT_DIR + "/bin/genieacs-ext", [scriptName], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      processes[scriptName] = p;

      p.on("error", (err) => {
        if (processes[scriptName] === p) {
          if (jobs.delete(id)) {
            resolve({
              fault: { code: err.name, message: err.message },
              value: null,
            });
          }

          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          kill(processes[scriptName]);
          delete processes[scriptName];
        }
      });

      p.on("disconnect", () => {
        if (processes[scriptName] === p) delete processes[scriptName];
      });

      p.on("message", (message) => {
        const func = jobs.get(message[0]);
        if (func) {
          jobs.delete(message[0]);
          // Wait for any disconnect even to fire
          setTimeout(() => {
            func({ fault: message[1], value: message[2] });
          });
        }
      });

      const rlstdout = readline.createInterface(p.stdout);
      rlstdout.on("line", (line) => {
        logger.info({ message: `Ext ${scriptName}(${p.pid}): ${line}` });
      });

      const rlstderr = readline.createInterface(p.stderr);
      rlstderr.on("line", (line) => {
        logger.warn({ message: `Ext ${scriptName}(${p.pid}): ${line}` });
      });
    }

    setTimeout(() => {
      if (jobs.delete(id)) {
        resolve({
          fault: { code: "timeout", message: "Extension timed out" },
          value: null,
        });
      }
    }, TIMEOUT);

    if (!processes[scriptName].connected) return false;

    return processes[scriptName].send([id, args.slice(1)]);
  });
}

function kill(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const timeToKill = Date.now() + 5000;

    process.kill();

    const t = setInterval(() => {
      if (!process.connected) {
        clearInterval(t);
        resolve();
      } else if (Date.now() > timeToKill) {
        process.kill("SIGKILL");
        clearInterval(t);
        resolve();
      }
    }, 100);
  });
}

export async function killAll(): Promise<void> {
  await Promise.all(
    Object.entries(processes).map(([k, p]) => {
      delete processes[k];
      return kill(p);
    }),
  );
}

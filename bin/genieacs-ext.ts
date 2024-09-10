import { Fault } from "../lib/types.ts";

const jobs = new Set();
const fileName = process.argv[2];
let script;

function errorToFault(err: Error): Fault {
  if (!err) return null;

  if (!err.name) return { code: "ext", message: `${err}` };

  const fault: Fault = {
    code: `ext.${err.name}`,
    message: err.message,
    detail: {
      name: err.name,
      message: err.message,
    },
  };

  if (err.stack) {
    fault.detail["stack"] = err.stack;
    // Trim the stack trace
    const stackTrimIndex = fault.detail["stack"].match(
      /\s+at\s[^\s]+\s\(.*genieacs-ext:.+\)/,
    );
    if (stackTrimIndex) {
      fault.detail["stack"] = fault.detail["stack"].slice(
        0,
        stackTrimIndex.index,
      );
    }
  }

  return fault;
}

// Need this for Node < 15
process.on("unhandledRejection", (err) => {
  throw err;
});

process.on("uncaughtException", (err) => {
  const fault = errorToFault(err);
  jobs.forEach((jobId) => {
    process.send([jobId, fault, null]);
  });
  jobs.clear();
  process.disconnect();
});

process.on("message", (message) => {
  jobs.add(message[0]);

  if (!script) {
    const cwd = process.env["GENIEACS_EXT_DIR"];
    process.chdir(cwd);
    script = require(`${cwd}/${fileName}`);
  }

  const funcName = message[1][0];

  if (!script[funcName]) {
    const fault = {
      code: "ext",
      message: `No such function '${funcName}' in extension '${fileName}'`,
    };
    process.send([message[0], fault, null]);
    return;
  }

  script[funcName](message[1].slice(1), (err, res) => {
    if (!jobs.delete(message[0])) return;

    process.send([message[0], errorToFault(err), res]);
  });
});

// Ignore SIGINT
process.on("SIGINT", () => {
  // Ignore
});

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(exec);

async function runEslint(): Promise<string> {
  const CMD =
    "eslint 'bin/*.ts' 'lib/**/*.ts' 'ui/**/*.ts' 'test/**/*.ts' 'build/**/*.ts'";
  const env = {
    ...(process.stdout.isTTY && { FORCE_COLOR: "1" }),
    ...process.env,
  };
  try {
    const { stdout, stderr } = await execPromise(CMD, { env });
    if (stderr) throw new Error(stderr);
    return stdout;
  } catch (err) {
    if (err.killed || err.signal || err.stderr || err.code !== 1) throw err;
    return err.stdout;
  }
}

async function runTsc(): Promise<string> {
  const CMD = "tsc --noEmit";
  const env = {
    ...(process.stdout.isTTY && { FORCE_COLOR: "1" }),
    ...process.env,
  };
  const { stdout, stderr } = await execPromise(CMD, { env });
  if (stderr) throw new Error(stderr);
  return stdout;
}

async function runPrettier(): Promise<string> {
  const CMD = "prettier --prose-wrap always --write .";
  const env = {
    ...(process.stdout.isTTY && { FORCE_COLOR: "1" }),
    ...process.env,
  };
  const { stdout, stderr } = await execPromise(CMD, { env });
  if (stderr) throw new Error(stderr);
  return stdout;
}

async function runAll(): Promise<void> {
  const prom1 = runPrettier();
  const prom2 = runEslint();
  const prom3 = runTsc();

  console.log(await prom1);
  console.log(await prom2);
  console.log(await prom3);
}

runAll().catch(console.error);

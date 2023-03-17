import { readFileSync, existsSync } from "fs";
import { ROOT_DIR } from "./config";

const ignoreFilename = `${ROOT_DIR}/config/ignore.json`;

const ignoreDefaultFilename = `${ROOT_DIR}/config/ignore.default.json`;

const ignoreArray: Array<string> = [];

if (existsSync(ignoreFilename)) {
  const ignoreFile = JSON.parse(readFileSync(ignoreFilename).toString());

  for (const [_, v] of Object.entries(ignoreFile))
    ignoreArray.push(v as string);
}

if (existsSync(ignoreDefaultFilename)) {
  const ignoreDefaultFile = JSON.parse(
    readFileSync(ignoreDefaultFilename).toString()
  );

  for (const [_, v] of Object.entries(ignoreDefaultFile))
    ignoreArray.push(v as string);
}

export function Ignore(parameterName: string): boolean {
  return ignoreArray.indexOf(parameterName) > -1;
}
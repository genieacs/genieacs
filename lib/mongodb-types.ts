import { ObjectId } from "mongodb";
import { Expression, FaultStruct } from "./types";

export interface Fault {
  _id: string;
  device: string;
  channel: string;
  timestamp: Date;
  provisions: string;
  retries: number;
  code: string;
  message: string;
  detail?:
    | FaultStruct
    | {
        name: string;
        message: string;
        stack?: string;
      };
  expiry?: Date;
}

interface TaskBase {
  _id: ObjectId;
  timestamp?: Date;
  expiry?: Date;
  name: string;
}

interface TaskGetParameterValues extends TaskBase {
  name: "getParameterValues";
  parameterNames: string[];
}

interface TaskSetParameterValues extends TaskBase {
  name: "setParameterValues";
  parameterValues: [string, string | number | boolean, string?][];
}

interface TaskRefreshObject extends TaskBase {
  name: "refreshObject";
  objectName: string;
}

interface TaskReboot extends TaskBase {
  name: "reboot";
}

interface TaskFactoryReset extends TaskBase {
  name: "factoryReset";
}

interface TaskDownload extends TaskBase {
  name: "download";
  fileType: string;
  fileName: string;
  targetFileName?: string;
}

interface TaskAddObject extends TaskBase {
  name: "addObject";
  objectName: string;
  parameterValues: [string, string | number | boolean, string?][];
}

interface TaskDeleteObject extends TaskBase {
  name: "deleteObject";
  objectName: string;
}

interface TaskProvisions extends TaskBase {
  name: "provisions";
  provisions?: [string, ...Expression[]][];
}

export type Task =
  | TaskGetParameterValues
  | TaskSetParameterValues
  | TaskRefreshObject
  | TaskReboot
  | TaskFactoryReset
  | TaskDownload
  | TaskAddObject
  | TaskDeleteObject
  | TaskProvisions;

export interface Operation {
  _id: string;
  name: string;
  timestamp: Date;
  channels: string;
  retries: string;
  provisions: string;
  args: string;
}

export interface Config {
  _id: string;
  value: string;
}

export interface Cache {
  _id: string;
  value: string;
  timestamp: Date;
  expire: Date;
}

import { ObjectId } from "mongodb";
import { Expression, FaultStruct } from "../types.ts";

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
  device: string;
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

export interface Device {
  _id: string;
  _lastInform: Date;
  _registered: Date;
  _tags?: string[];
  _timestamp?: Date;
}

type Configuration =
  | { type: "age"; name: string; age: number }
  | { type: "value"; name: string; value: boolean | number | string }
  | { type: "add_tag"; tag: string }
  | { type: "delete_tag"; tag: string }
  | { type: "add_object"; name: string; object: string }
  | { type: "delete_object"; name: string; object: string }
  | { type: "provision"; name: string; args?: Expression[] };

export interface Preset {
  _id: string;
  weight: number;
  channel: string;
  events: Record<string, boolean>;
  configurations: Configuration[];
}

export interface Object {
  _id: string;
}

export interface Provision {
  _id: string;
  script: string;
}

export interface VirtualParameter {
  _id: string;
  script: string;
}

export interface File {
  _id: string;
  length: number;
  filename: string;
  uploadDate: Date;
  metadata?: {
    fileType?: string;
    oui?: string;
    productClass?: string;
    version?: string;
  };
}

export interface Permission {
  _id: string;
  role: string;
  resource: string;
  access: 1 | 2 | 3;
  filter?: string;
  validate?: string;
}

export interface User {
  _id: string;
  password: string;
  roles: string;
  salt: string;
}

export interface Lock {
  _id: string;
  value: string;
  timestamp: Date;
  expire: Date;
}

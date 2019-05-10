import Path from "./common/path";
import PathSet from "./common/path-set";
import VersionedMap from "./versioned-map";
import InstanceSet from "./instance-set";
import { IncomingMessage, ServerResponse } from "http";

export type Expression = string | number | boolean | null | any[];

export interface Fault {
  code: string;
  message: string;
  detail?:
    | FaultStruct
    | {
        name: string;
        message: string;
        stack?: string;
      };
  timestamp?: number;
}

export interface SessionFault extends Fault {
  timestamp: number;
  provisions: string[][];
  retryNow?: boolean;
  precondition?: boolean;
  retries?: number;
  expiry?: number;
}

export interface Attributes {
  object?: [number, 1 | 0];
  writable?: [number, 1 | 0];
  value?: [number, [string | number | boolean, string]];
}

export interface AttributeTimestamps {
  object?: number;
  writable?: number;
  value?: number;
}

export interface AttributeValues {
  object?: boolean;
  writable?: boolean;
  value?: [string | number | boolean, string?];
}

export interface DeviceData {
  paths: PathSet;
  timestamps: VersionedMap<Path, number>;
  attributes: VersionedMap<Path, Attributes>;
  trackers: Map<Path, { [name: string]: number }>;
  changes: Set<string>;
}

export type VirtualParameterDeclaration = [
  Path,
  { path?: number; object?: number; writable?: number; value?: number }?,
  {
    path?: [number, number];
    object?: boolean;
    writable?: boolean;
    value?: [string | number | boolean, string?];
  }?
];

export interface SyncState {
  refreshAttributes: {
    exist: Set<Path>;
    object: Set<Path>;
    writable: Set<Path>;
    value: Set<Path>;
  };
  spv: Map<Path, [string | number | boolean, string]>;
  gpn: Set<Path>;
  gpnPatterns: Map<Path, number>;
  tags: Map<Path, boolean>;
  virtualParameterDeclarations: VirtualParameterDeclaration[][];
  instancesToDelete: Map<Path, Set<Path>>;
  instancesToCreate: Map<Path, InstanceSet>;
  downloadsToDelete: Set<Path>;
  downloadsToCreate: InstanceSet;
  downloadsValues: Map<Path, string | number>;
  downloadsDownload: Map<Path, number>;
  reboot: number;
  factoryReset: number;
}

export interface SessionContext {
  sessionId?: string;
  timestamp: number;
  deviceId: string;
  deviceData: DeviceData;
  cwmpVersion: string;
  timeout: number;
  provisions: any[];
  channels: { [channel: string]: number };
  virtualParameters: [
    string,
    AttributeTimestamps,
    AttributeValues,
    AttributeTimestamps,
    AttributeValues
  ][][];
  revisions: number[];
  rpcCount: number;
  iteration: number;
  cycle: number;
  extensionsCache: any;
  declarations: Declaration[][];
  faults?: { [channel: string]: SessionFault };
  retries?: { [channel: string]: number };
  cacheSnapshot?: string;
  configContext?: { [name: string]: any };
  httpResponse?: ServerResponse;
  httpRequest?: IncomingMessage;
  faultsTouched?: { [channel: string]: boolean };
  presetCycles?: number;
  new?: boolean;
  debug?: boolean;
  state: number;
  tasks?: Task[];
  operations?: { [commandKey: string]: Operation };
  cacheUntil?: number;
  syncState?: SyncState;
  lastActivity?: number;
  rpcRequest?: AcsRequest;
  operationsTouched?: { [commandKey: string]: 1 | 0 };
  provisionsRet?: any[];
  doneTasks?: string[];
}

export interface Task {
  _id: string;
  name: string;
  parameterNames?: string[];
  parameterValues?: [string, string | number | boolean, string?][];
  objectName?: string;
  fileType?: string;
  fileName?: string;
  targetFileName?: string;
  expiry?: number;
}

export interface Operation {
  name: string;
  timestamp: number;
  provisions: string[][];
  channels: { [channel: string]: number };
  retries: { [channel: string]: number };
  args: {
    instance: string;
    fileType: string;
    fileName: string;
    targetFileName: string;
  };
}

export interface AcsRequest {
  name: string;
  next?: string;
}

export interface GetAcsRequest extends AcsRequest {
  name: "GetParameterNames" | "GetParameterValues";
  objectName?: string;
  parameterNames?: string[];
  parameterPath?: string;
  nextLevel?: boolean;
  instanceValues?: { [name: string]: string };
}

export interface SetAcsRequest extends AcsRequest {
  name:
    | "SetParameterValues"
    | "AddObject"
    | "DeleteObject"
    | "FactoryReset"
    | "Reboot"
    | "Download";
  parameterList?: [string, string | number | boolean, string][];
  instanceValues?: { [param: string]: string | number | boolean };
  objectName?: string;
  DATETIME_MILLISECONDS?: boolean;
  BOOLEAN_LITERAL?: boolean;
  commandKey?: string;
  instance?: string;
  fileType?: string;
  fileSize?: number;
  url?: string;
  fileName?: string;
  targetFileName?: string;
}

export interface CpeResponse {
  name: string;
}

export interface SpvFault {
  parameterName: string;
  faultCode: string;
  faultString: string;
}

export interface FaultStruct {
  faultCode: string;
  faultString: string;
  setParameterValuesFault?: SpvFault[];
}

export interface CpeFault {
  faultCode: string;
  faultString: string;
  detail?: FaultStruct;
}

export interface CpeGetResponse extends CpeResponse {
  name: "GetParameterNamesResponse" | "GetParameterValuesResponse";
  parameterList?:
    | [string, boolean][]
    | [string, string | number | boolean, string][];
}

export interface CpeSetResponse extends CpeResponse {
  name:
    | "SetParameterValuesResponse"
    | "AddObjectResponse"
    | "DeleteObjectResponse"
    | "RebootResponse"
    | "FactoryResetResponse"
    | "DownloadResponse";
  status?: number;
  instanceNumber?: string;
  startTime?: number;
  completeTime?: number;
}

export interface CpeRequest {
  name: string;
  fileType?: string;
}

export interface InformRequest extends CpeRequest {
  name: "Inform";
  deviceId: {
    Manufacturer: string;
    OUI: string;
    ProductClass?: string;
    SerialNumber: string;
  };
  event: string[];
  retryCount: number;
  parameterList: [string, string | number | boolean, string][];
}

export interface TransferCompleteRequest extends CpeRequest {
  name: "TransferComplete";
  commandKey?: string;
  faultStruct?: FaultStruct;
  startTime?: number;
  completeTime?: number;
}

export interface AcsResponse {
  name: string;
  commandKey?: string;
  faultStruct?: FaultStruct;
}

export interface QueryOptions {
  projection?: any;
  skip?: number;
  limit?: number;
  sort?: {
    [param: string]: number;
  };
}

export interface Declaration {
  path: Path;
  pathGet: number;
  pathSet?: [number, number];
  attrGet?: { object?: number; writable?: number; value?: number };
  attrSet?: {
    object?: boolean;
    writable?: boolean;
    value?: [string | number | boolean, string?];
  };
  defer: boolean;
}

export type Clear = [
  Path,
  number,
  { object?: number; writable?: number; value?: number }?,
  number?
];

export interface Preset {
  name: string;
  channel: string;
  schedule?: { md5: string; duration: number; schedule: any };
  events?: { [event: string]: boolean };
  precondition?: {};
  provisions: string[][];
}

export type PermissionSet = {
  [resource: string]: {
    access: number;
    validate?: Expression;
    filter: Expression;
  };
}[];

export interface SoapMessage {
  id: string;
  cwmpVersion: string;
  sessionTimeout: number;
  cpeRequest?: CpeRequest;
  cpeFault?: CpeFault;
  cpeResponse?: CpeResponse;
}

export interface ScriptResult {
  fault: Fault;
  clear: Clear[];
  declare: Declaration[];
  done: boolean;
  returnValue: any;
}

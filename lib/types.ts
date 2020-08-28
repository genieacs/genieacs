/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import Path from "./common/path";
import PathSet from "./common/path-set";
import VersionedMap from "./versioned-map";
import InstanceSet from "./instance-set";
import { IncomingMessage, ServerResponse } from "http";
import { Script } from "vm";

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
  notification?: [number, number];
  accessList?: [number, string[]];
}

export interface AttributeTimestamps {
  object?: number;
  writable?: number;
  value?: number;
  notification?: number;
  accessList?: number;
}

export interface AttributeValues {
  object?: boolean;
  writable?: boolean;
  value?: [string | number | boolean, string?];
  notification?: number;
  accessList?: string[];
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
  {
    path?: number;
    object?: number;
    writable?: number;
    value?: number;
    notification?: number;
    accessList?: number;
  }?,
  {
    path?: [number, number];
    object?: boolean;
    writable?: boolean;
    value?: [string | number | boolean, string?];
    notification?: number;
    accessList?: string[];
  }?
];

export interface SyncState {
  refreshAttributes: {
    exist: Set<Path>;
    object: Set<Path>;
    writable: Set<Path>;
    value: Set<Path>;
    notification: Set<Path>;
    accessList: Set<Path>;
  };
  spv: Map<Path, [string | number | boolean, string]>;
  spa: Map<Path, { notification: number; accessList: string[] }>;
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
  httpResponse?: ServerResponse;
  httpRequest?: IncomingMessage;
  faultsTouched?: { [channel: string]: boolean };
  presetCycles?: number;
  new?: boolean;
  debug?: boolean;
  state: number;
  authState: number;
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
  _id?: string;
  name: string;
  parameterNames?: string[];
  parameterValues?: [string, string | number | boolean, string?][];
  objectName?: string;
  fileType?: string;
  fileName?: string;
  targetFileName?: string;
  expiry?: number;
  provisions?: (string | number | boolean)[][];
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

export type AcsRequest =
  | GetParameterNames
  | GetParameterValues
  | GetParameterAttributes
  | SetParameterValues
  | SetParameterAttributes
  | AddObject
  | DeleteObject
  | FactoryReset
  | Reboot
  | Download;

export interface GetParameterNames {
  name: "GetParameterNames";
  parameterPath: string;
  nextLevel: boolean;
}

export interface GetParameterValues {
  name: "GetParameterValues";
  parameterNames: string[];
}

export interface GetParameterAttributes {
  name: "GetParameterAttributes";
  parameterNames: string[];
}

export interface SetParameterValues {
  name: "SetParameterValues";
  parameterList: [string, boolean | number | string, string][];
  parameterKey?: string;
  DATETIME_MILLISECONDS?: boolean;
  BOOLEAN_LITERAL?: boolean;
}

export interface SetParameterAttributes {
  name: "SetParameterAttributes";
  parameterList: [string, number, string[]][];
}

export interface AddObject {
  name: "AddObject";
  objectName: string;
  parameterKey?: string;
  instanceValues: Record<string, string>;
}

export interface DeleteObject {
  name: "DeleteObject";
  objectName: string;
  parameterKey?: string;
}

export interface FactoryReset {
  name: "FactoryReset";
  commandKey?: string;
}

export interface Reboot {
  name: "Reboot";
  commandKey?: string;
}

export interface Download {
  name: "Download";
  commandKey: string;
  instance: string;
  fileType: string;
  fileName?: string;
  url?: string;
  username?: string;
  password?: string;
  fileSize?: number;
  targetFileName?: string;
  delaySecods?: number;
  successUrl?: string;
  failureUrl?: string;
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

export type CpeResponse =
  | GetParameterNamesResponse
  | GetParameterValuesResponse
  | GetParameterAttributesResponse
  | SetParameterValuesResponse
  | SetParameterAttributesResponse
  | AddObjectResponse
  | DeleteObjectResponse
  | RebootResponse
  | FactoryResetResponse
  | DownloadResponse;

export interface GetParameterNamesResponse {
  name: "GetParameterNamesResponse";
  parameterList: [Path, boolean, boolean][];
}

export interface GetParameterValuesResponse {
  name: "GetParameterValuesResponse";
  parameterList: [Path, string | number | boolean, string][];
}

export interface GetParameterAttributesResponse {
  name: "GetParameterAttributesResponse";
  parameterList: [Path, number, string[]][];
}

export interface SetParameterValuesResponse {
  name: "SetParameterValuesResponse";
  status: number;
}

export interface SetParameterAttributesResponse {
  name: "SetParameterAttributesResponse";
}

export interface AddObjectResponse {
  name: "AddObjectResponse";
  instanceNumber: string;
  status: number;
}

export interface DeleteObjectResponse {
  name: "DeleteObjectResponse";
  status: number;
}

export interface RebootResponse {
  name: "RebootResponse";
}

export interface FactoryResetResponse {
  name: "FactoryResetResponse";
}

export interface DownloadResponse {
  name: "DownloadResponse";
  status: number;
  startTime?: number;
  completeTime?: number;
}

export type CpeRequest =
  | InformRequest
  | TransferCompleteRequest
  | GetRPCMethodsRequest
  | RequestDownloadRequest;

export interface InformRequest {
  name: "Inform";
  deviceId: {
    Manufacturer: string;
    OUI: string;
    ProductClass?: string;
    SerialNumber: string;
  };
  event: string[];
  retryCount: number;
  parameterList: [Path, string | number | boolean, string][];
}

export interface TransferCompleteRequest {
  name: "TransferComplete";
  commandKey?: string;
  faultStruct?: FaultStruct;
  startTime?: number;
  completeTime?: number;
}

export interface GetRPCMethodsRequest {
  name: "GetRPCMethods";
}

export interface RequestDownloadRequest {
  name: "RequestDownload";
  fileType: string;
}

export type AcsResponse =
  | InformResponse
  | GetRPCMethodsResponse
  | TransferCompleteResponse
  | RequestDownloadResponse;

export interface InformResponse {
  name: "InformResponse";
}

export interface GetRPCMethodsResponse {
  name: "GetRPCMethodsResponse";
  methodList: string[];
}

export interface TransferCompleteResponse {
  name: "TransferCompleteResponse";
}

export interface RequestDownloadResponse {
  name: "RequestDownloadResponse";
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
  pathSet?: number | [number, number];
  attrGet?: {
    object?: number;
    writable?: number;
    value?: number;
    notification?: number;
    accessList?: number;
  };
  attrSet?: {
    object?: boolean;
    writable?: boolean;
    value?: [string | number | boolean, string?];
    notification?: number;
    accessList?: string[];
  };
  defer: boolean;
}

export type Clear = [
  Path,
  number,
  {
    object?: number;
    writable?: number;
    value?: number;
    notification?: number;
    accessList?: number;
  }?,
  number?
];

export interface Preset {
  name: string;
  channel: string;
  schedule?: { md5: string; duration: number; schedule: any };
  events?: { [event: string]: boolean };
  precondition?: Expression;
  provisions: [string, ...Expression[]][];
}

export interface Provisions {
  [name: string]: { md5: string; script: Script };
}

export interface VirtualParameters {
  [name: string]: { md5: string; script: Script };
}

export interface Files {
  [name: string]: { length: number; md5: string; contentType: string };
}

export interface Users {
  [name: string]: { password: string; salt: string; roles: string[] };
}

export interface Permissions {
  [role: string]: {
    [access: number]: {
      [resource: string]: {
        access: number;
        filter: Expression;
        validate?: Expression;
      };
    };
  };
}

export type PermissionSet = {
  [resource: string]: {
    access: number;
    validate?: Expression;
    filter: Expression;
  };
}[];

export interface Config {
  [name: string]: Expression;
}

export interface UiConfig {
  filters: Record<string, unknown>;
  device: Record<string, unknown>;
  index: Record<string, unknown>;
  overview: {
    charts?: Record<string, unknown>;
    groups?: Record<string, unknown>;
  };
  pageSize?: Expression;
}

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

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

import { Collection, GridFSBucket, ObjectId } from "mongodb";
import { Script } from "vm";
import { collections, onConnect, optimizeProjection } from "../db";
import * as mongodbFunctions from "../mongodb-functions";
import { evaluate } from "../common/expression/util";
import { QueryOptions, Expression } from "../types";
import { Readable } from "stream";

let filesBucket: GridFSBucket;

onConnect(async (db) => {
  filesBucket = new GridFSBucket(db);
});

export async function* query(
  resource: string,
  filter: Expression,
  options?: QueryOptions
): AsyncGenerator<any, void, undefined> {
  options = options || {};
  filter = evaluate(filter, null, Date.now());
  const q = mongodbFunctions.toMongoQuery(filter, resource);
  if (!q) return;

  const collection = collections[resource] as Collection<any>;
  const cursor = collection.find(q);
  if (options.projection) {
    let projection = options.projection;
    if (resource === "devices")
      projection = mongodbFunctions.processDeviceProjection(options.projection);

    if (resource === "presets") projection.configurations = 1;
    projection = optimizeProjection(projection);
    cursor.project(projection);
  }

  if (resource === "users") cursor.project({ password: 0, salt: 0 });

  if (options.skip) cursor.skip(options.skip);
  if (options.limit) cursor.limit(options.limit);

  if (options.sort) {
    let s = Object.entries(options.sort)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .reduce(
        (obj, [k, v]) =>
          Object.assign(obj, { [k]: Math.min(Math.max(v, -1), 1) }),
        {}
      );

    if (resource === "devices") s = mongodbFunctions.processDeviceSort(s);
    cursor.sort(s);
  }

  for await (let doc of cursor) {
    if (resource === "devices") doc = mongodbFunctions.flattenDevice(doc);
    else if (resource === "faults") doc = mongodbFunctions.flattenFault(doc);
    else if (resource === "tasks") doc = mongodbFunctions.flattenTask(doc);
    else if (resource === "presets") doc = mongodbFunctions.flattenPreset(doc);
    else if (resource === "files") doc = mongodbFunctions.flattenFile(doc);

    yield doc;
  }
}

export function count(resource: string, filter: Expression): Promise<number> {
  const collection = collections[resource] as Collection<unknown>;
  filter = evaluate(filter, null, Date.now());
  const q = mongodbFunctions.toMongoQuery(filter, resource);
  if (!q) return Promise.resolve(0);
  return collection.countDocuments(q);
}

export async function updateDeviceTags(
  deviceId: string,
  tags: Record<string, boolean>
): Promise<void> {
  const add = [];
  const pull = [];

  for (let [tag, onOff] of Object.entries(tags)) {
    tag = tag.trim();
    if (onOff) add.push(tag);
    else pull.push(tag);
  }
  const object = {};

  if (add?.length) object["$addToSet"] = { _tags: { $each: add } };
  if (pull?.length) object["$pullAll"] = { _tags: pull };

  await collections.devices.updateOne({ _id: deviceId }, object);
}

async function putResource(resource, id, object): Promise<void> {
  const collection = collections[resource] as Collection<unknown>;
  await collection.replaceOne({ _id: id }, object, { upsert: true });
}

async function deleteResource(
  resource: string,
  id: string | ObjectId
): Promise<void> {
  const collection = collections[resource] as Collection<unknown>;
  await collection.deleteOne({ _id: id });
}

export function putPreset(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  object = mongodbFunctions.preProcessPreset(object);
  return putResource("presets", id, object);
}

export function deletePreset(id: string): Promise<void> {
  return deleteResource("presets", id);
}

export function putProvision(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`)
      );
    }
    return Promise.reject(err);
  }
  return putResource("provisions", id, object);
}

export function deleteProvision(id: string): Promise<void> {
  return deleteResource("provisions", id);
}

export function putVirtualParameter(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`)
      );
    }
    return Promise.reject(err);
  }
  return putResource("virtualParameters", id, object);
}

export function deleteVirtualParameter(id: string): Promise<void> {
  return deleteResource("virtualParameters", id);
}

export function putConfig(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  return putResource("config", id, object);
}

export function deleteConfig(id: string): Promise<void> {
  return deleteResource("config", id);
}

export function putPermission(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  return putResource("permissions", id, object);
}

export function deletePermission(id: string): Promise<void> {
  return deleteResource("permissions", id);
}

export async function putUser(
  id: string,
  object: Record<string, unknown>
): Promise<void> {
  // update instead of replace to keep the password if not set by user
  await collections.users.updateOne(
    { _id: id },
    { $set: object },
    { upsert: true }
  );
}

export function deleteUser(id: string): Promise<void> {
  return deleteResource("users", id);
}

export function downloadFile(filename: string): Readable {
  return filesBucket.openDownloadStreamByName(filename);
}

export function putFile(
  filename: string,
  metadata: Record<string, string>,
  contentStream: Readable
): Promise<void> {
  return new Promise((resolve, reject) => {
    const uploadStream = filesBucket.openUploadStreamWithId(
      filename as unknown as ObjectId,
      filename,
      {
        metadata: metadata,
      }
    );

    let readableEnded = false;
    contentStream.on("end", () => {
      readableEnded = true;
    });
    contentStream.on("close", () => {
      // In Node versions prior to 15, the stream will not emit an error if the
      // connection is closed before the stream is finished.
      // For Node 12.9+ we can just use stream.readableEnded
      if (!readableEnded)
        uploadStream.destroy(new Error("Stream closed prematurely"));
    });

    contentStream.on("error", (err) => {
      uploadStream.destroy(err);
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", resolve);
    contentStream.pipe(uploadStream);
  });
}

export async function deleteFile(filename: string): Promise<void> {
  await filesBucket.delete(filename as any);
}

export function deleteFault(id: string): Promise<void> {
  return deleteResource("faults", id);
}

export function deleteTask(id: ObjectId): Promise<void> {
  return deleteResource("tasks", id);
}

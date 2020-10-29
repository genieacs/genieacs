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

import * as url from "url";
import * as querystring from "querystring";
import { IncomingMessage, ServerResponse } from "http";
import { Collection, GridFSBucket, ObjectId } from "mongodb";
import { onConnect, getOperations } from "./db";
import * as logger from "./logger";
import { getRequestOrigin } from "./forwarded";

let filesCollection: Collection;
let filesBucket: GridFSBucket;
let uploadsBucket: GridFSBucket;

onConnect(async (db) => {
  filesCollection = db.collection("fs.files");
  filesBucket = new GridFSBucket(db);
  uploadsBucket = new GridFSBucket(db, { bucketName: "uploads" });
});

async function canUpload(
  deviceId: string,
  fileName: string,
  timeout = Date.now() + 5000
): Promise<boolean> {
  const operations = Object.values(await getOperations(deviceId));
  for (const operation of operations) {
    if (operation.name === "Upload" && operation.args.fileName === fileName)
      return true;
  }

  if (Date.now() >= timeout) return false;
  // Need to wait and retry in case upload was initiated before session was closed
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return canUpload(deviceId, fileName, timeout);
}

export async function listener(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const urlParts = url.parse(request.url, true);
  if (request.method === "GET") {
    const filename = querystring.unescape(urlParts.pathname.substring(1));

    const log = {
      message: "Fetch file",
      filename: filename,
      remoteAddress: getRequestOrigin(request).remoteAddress,
    };

    const file = await filesCollection.findOne({ _id: filename });
    if (!file) {
      response.writeHead(404);
      response.end();
      log.message += " not found";
      logger.accessError(log);
      return;
    }

    response.writeHead(200, {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Length": file.length,
    });

    const downloadStream = filesBucket.openDownloadStreamByName(filename);
    downloadStream.pipe(response);

    logger.accessInfo(log);
  } else if (request.method === "PUT") {
    const [, deviceId, ...filePath] = urlParts.pathname
      .split("/")
      .map(querystring.unescape);

    const fileName = `${deviceId}/${filePath.join("/")}`;

    if (!(await canUpload(deviceId, fileName))) {
      response.writeHead(403);
      response.end("403 Forbidden");
      return;
    }

    try {
      await uploadsBucket.delete((fileName as unknown) as ObjectId);
    } catch (err) {
      // File not found, do nothing
    }
    const uploadStream = uploadsBucket.openUploadStreamWithId(
      fileName,
      fileName
    );

    uploadStream.on("finish", () => {
      response.writeHead(200);
      response.end();
    });

    uploadStream.on("error", (err) => {
      response.writeHead(500);
      response.end(err.message);
    });

    request.pipe(uploadStream);
  } else {
    response.writeHead(405, { Allow: "GET" });
    response.end("405 Method Not Allowed");
  }
}

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
import { Collection, GridFSBucket } from "mongodb";
import { onConnect } from "./db";
import * as logger from "./logger";
import { getRequestOrigin } from "./forwarded";
import memoize from "./common/memoize";

let filesCollection: Collection;
let filesBucket: GridFSBucket;

onConnect(async (db) => {
  filesCollection = db.collection("fs.files");
  filesBucket = new GridFSBucket(db);
});

const getFile = memoize(
  (md5: string, size: number, filename: string): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.allocUnsafe(size);
      let i = 0;
      const downloadStream = filesBucket.openDownloadStreamByName(filename);
      downloadStream.on("error", reject);
      downloadStream.on("data", (data: Buffer) => {
        data.copy(buffer, i);
        i += data.length;
      });
      downloadStream.on("end", () => {
        if (i !== size) reject(new Error("File size mismatch"));
        else resolve(buffer);
      });
    });
  }
);

export async function listener(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end("405 Method Not Allowed");
    return;
  }

  const urlParts = url.parse(request.url, true);
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

  const buffer = await getFile(file.md5, file.length, filename);

  response.writeHead(200, {
    "Content-Type": file.contentType || "application/octet-stream",
    "Content-Length": file.length,
  });

  response.end(buffer);
  logger.accessInfo(log);
}

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
import { GridFSBucket } from "mongodb";
import * as db from "./db";
import * as logger from "./logger";
import { getRequestOrigin } from "./forwarded";

export function listener(
  request: IncomingMessage,
  response: ServerResponse
): void {
  const urlParts = url.parse(request.url, true);
  if (request.method === "GET") {
    const filename = querystring.unescape(urlParts.pathname.substring(1));

    const log = {
      message: "Fetch file",
      filename: filename,
      remoteAddress: getRequestOrigin(request).remoteAddress
    };

    db.filesCollection.findOne({ _id: filename }, (err, file) => {
      if (err) throw err;

      if (!file) {
        response.writeHead(404);
        response.end();
        log.message += " not found";
        logger.accessError(log);
        return;
      }

      response.writeHead(200, {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": file.length
      });

      const bucket = new GridFSBucket(db.client.db());
      const downloadStream = bucket.openDownloadStreamByName(filename);
      downloadStream.pipe(response);

      logger.accessInfo(log);
    });
  } else {
    response.writeHead(405, { Allow: "GET" });
    response.end("405 Method Not Allowed");
  }
}

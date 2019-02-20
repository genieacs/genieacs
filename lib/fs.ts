/**
 * Copyright 2013-2018  Zaid Abdulla
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
import { GridFSBucket } from "mongodb";
import * as db from "./db";

export function listener(request, response): void {
  const urlParts = url.parse(request.url, true);
  if (request.method === "GET") {
    const filename = querystring.unescape(urlParts.pathname.substring(1));
    db.filesCollection.findOne({ _id: filename }, (err, file) => {
      if (err) {
        response.writeHead(500, { Connection: "close" });
        response.end(`${err.name}: ${err.message}`);
        throw err;
      }

      if (!file) {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": file.length
      });

      const bucket = new GridFSBucket(db.client.db());
      const downloadStream = bucket.openDownloadStreamByName(filename);
      downloadStream.pipe(response);
    });
  } else {
    response.writeHead(405, { Allow: "GET" });
    response.end("405 Method Not Allowed");
  }
}

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

import * as notifications from "./notifications";

export let codeMirror;
export let yaml;

let note;

function onError(): void {
  if (!note) {
    note = notifications.push(
      "error",
      "Error loading JS resource, please reload the page",
      {
        Reload: () => {
          window.location.reload();
        }
      }
    );
  }
}

export function loadCodeMirror(): Promise<void> {
  if (codeMirror) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const promises = [
      import(/* webpackChunkName: "codemirror" */ "codemirror"),
      import(
        /* webpackChunkName: "codemirror" */ "codemirror/mode/javascript/javascript"
      ),
      import(/* webpackChunkName: "codemirror" */ "codemirror/mode/yaml/yaml")
    ];
    Promise.all(promises)
      .then(modules => {
        codeMirror = modules[0];
        resolve();
      })
      .catch(err => {
        onError();
        reject(err);
      });
  });
}

export function loadYaml(): Promise<void> {
  if (yaml) return Promise.resolve();

  return new Promise((resolve, reject) => {
    import(/* webpackChunkName: "yaml" */ "yaml")
      .then(module => {
        yaml = module;
        resolve();
      })
      .catch(err => {
        onError();
        reject(err);
      });
  });
}

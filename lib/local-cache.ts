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

import { setTimeoutPromise } from "./util";
import { get, set } from "./cache";
import { acquireLock, releaseLock } from "./lock";

const REFRESH = 5000;
const EVICT_TIMEOUT = 120000;

export class LocalCache<T> {
  private nextRefresh = 1;
  private currentRevision: string = null;
  private snapshots: Map<string, T> = new Map();

  constructor(
    private cacheKey: string,
    private callback: () => Promise<[string, T]>
  ) {}

  async getRevision(): Promise<string> {
    if (Date.now() > this.nextRefresh) await this.refresh();
    return this.currentRevision;
  }

  hasRevision(revision: string): boolean {
    return this.snapshots.has(revision);
  }

  get(revision: string): T {
    const snapshot = this.snapshots.get(revision);
    if (!snapshot) throw new Error("Cache snapshot does not exist");
    return snapshot;
  }

  async refresh(): Promise<void> {
    if (!this.nextRefresh) {
      await setTimeoutPromise(20);
      await this.refresh();
      return;
    }

    const now = Date.now();
    if (now < this.nextRefresh) return;
    this.nextRefresh = 0;

    const dbHash = await get(this.cacheKey);

    if (this.currentRevision && dbHash === this.currentRevision) {
      this.nextRefresh = now + (REFRESH - (now % REFRESH));
      return;
    }

    const lockToken = await acquireLock(this.cacheKey, 5000);

    const [hash, snapshot] = await this.callback();

    if (this.currentRevision) {
      const r = this.currentRevision;
      const s = this.snapshots.get(r);
      setTimeout(() => {
        if (this.snapshots.get(r) === s) this.snapshots.delete(r);
      }, EVICT_TIMEOUT).unref();
    }

    this.currentRevision = hash;
    this.snapshots.set(hash, snapshot);

    if (lockToken) {
      if (hash !== dbHash) await set(this.cacheKey, hash, 300);
      await releaseLock(this.cacheKey, lockToken);
    }

    this.nextRefresh = now + (REFRESH - (now % REFRESH));
  }
}

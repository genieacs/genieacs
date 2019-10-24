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

import { PermissionSet, Expression } from "../types";
import { evaluate, or } from "./expression";

export default class Authorizer {
  private permissionSets: PermissionSet[];
  private validatorCache: WeakMap<
    object,
    (mutationType, mutation, any) => boolean
  >;
  private hasAccessCache: Map<string, boolean>;
  private getFilterCache: Map<string, Expression>;

  public constructor(permissionSets) {
    this.permissionSets = permissionSets;
    this.validatorCache = new WeakMap();
    this.hasAccessCache = new Map();
    this.getFilterCache = new Map();
  }

  public hasAccess(resourceType: string, access: number): boolean {
    const cacheKey = `${resourceType}-${access}`;
    if (this.hasAccessCache.has(cacheKey))
      return this.hasAccessCache.get(cacheKey);

    let has = false;
    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= access) {
            has = true;
            break;
          }
        }
      }
    }

    this.hasAccessCache.set(cacheKey, has);
    return has;
  }

  public getFilter(resourceType: string, access: number): Expression {
    const cacheKey = `${resourceType}-${access}`;
    if (this.getFilterCache.has(cacheKey))
      return this.getFilterCache.get(cacheKey);

    let filter: Expression = null;
    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= access)
            filter = or(filter, perm[resourceType].filter);
        }
      }
    }

    this.getFilterCache.set(cacheKey, filter);
    return filter;
  }

  public getValidator(
    resourceType,
    resource
  ): (mutationType: string, mutation?: any, args?: any) => boolean {
    if (this.validatorCache.has(resource))
      return this.validatorCache.get(resource);

    const validators: Expression[] = [];

    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (
          perm[resourceType] &&
          perm[resourceType].access >= 3 &&
          perm[resourceType].validate
        )
          validators.push(perm[resourceType].validate);
      }
    }

    const validator = (
      mutationType: string,
      mutation: any,
      any: any
    ): boolean => {
      if (!validators.length) return false;

      const object = {
        mutationType,
        mutation,
        resourceType,
        object: resource,
        options: any
      };

      const valueFunction = (paramName): any => {
        const entry = paramName.split(".", 1)[0];
        paramName = paramName.slice(entry.length + 1);
        let value = null;
        if (["mutation", "options"].includes(entry)) {
          value = object[entry];
          for (const seg of paramName.split(".")) {
            // typeof null is "object"
            if (value != null && typeof value !== "object") value = null;
            else value = value[seg];
            if (value == null) break;
          }
        } else if (object[entry]) {
          value = object[entry][paramName];
        }

        return value;
      };

      const res = evaluate(
        validators.length > 1 ? ["OR", validators] : validators[0],
        valueFunction,
        Date.now()
      );
      return !Array.isArray(res) && !!res;
    };

    this.validatorCache.set(resource, validator);
    return validator;
  }

  public getPermissionSets(): PermissionSet[] {
    return this.permissionSets;
  }
}

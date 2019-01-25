"use strict";

import pass from "./validators/pass";
import test from "./validators/test";

const validators = { pass, test };

export default class Authorizer {
  constructor(permissionSets) {
    this.permissionSets = permissionSets;
    this.validatorCache = new WeakMap();
    this.hasAccessCache = {};
  }

  hasAccess(resourceType, access) {
    const cacheKey = `${resourceType}-${access}`;
    if (cacheKey in this.hasAccessCache) return this.hasAccessCache[cacheKey];

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

    this.hasAccessCache[cacheKey] = has;
    return has;
  }

  getValidator(resourceType, resource) {
    if (this.validatorCache.has(resource))
      return this.validatorCache.get(resource);

    let funcs = {};

    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= 3) {
            if (perm[resourceType].validate) {
              for (const [k, v] of Object.entries(perm[resourceType].validate))
                funcs[k] = v;
            }
          } else {
            funcs = {};
          }
        }
      }
    }

    const validator = (mutationType, mutation, any) => {
      let valid = false;
      for (const [k, v] of Object.entries(funcs)) {
        if (v) {
          const res = validators[k](
            resourceType,
            resource,
            mutationType,
            mutation,
            any
          );

          if (res > 0) valid = true;
          else if (res < 0) return false;
        }
      }

      return valid;
    };

    this.validatorCache.set(resource, validator);
    return validator;
  }
}

import pass from "./validators/pass";
import test from "./validators/test";
import { PermissionSet } from "../types";

export const validators = { pass, test };

export default class Authorizer {
  private permissionSets: PermissionSet[];
  private validatorCache: WeakMap<
    object,
    (mutationType, mutation, any) => boolean
  >;
  private hasAccessCache: Map<string, boolean>;

  public constructor(permissionSets) {
    this.permissionSets = permissionSets;
    this.validatorCache = new WeakMap();
    this.hasAccessCache = new Map();
  }

  public hasAccess(resourceType, access): boolean {
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

  public getValidator(
    resourceType,
    resource
  ): (mutationType: string, mutation: any, args: any) => boolean {
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

    const validator = (
      mutationType: string,
      mutation: any,
      any: any
    ): boolean => {
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

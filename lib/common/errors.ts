export class ResourceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLockedError";
  }
}

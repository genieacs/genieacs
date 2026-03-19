export function getClockSkew(): number {
  return window.clockSkew;
}

export class SkewedDate extends Date {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(Date.now() + getClockSkew());
    } else {
      super(...(args as [any]));
    }
  }

  static override now(): number {
    return Date.now() + getClockSkew();
  }
}

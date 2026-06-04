declare module "@breejs/later" {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  import later = require("later");
  export = later;
}

declare module "*.jsx" {
  const content: string;
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}

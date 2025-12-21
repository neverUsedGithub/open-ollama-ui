declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  declare const plugin: {
    gfm: TurndownService.Plugin;
  };

  export default plugin;
}

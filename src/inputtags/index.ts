import type { InputTag } from "@/types";
import { isExtensionInstalled } from "@/util/extension";
import ImagePlusIcon from "lucide-solid/icons/image-plus";
import GlobeIcon from "lucide-solid/icons/globe";
import LightbulbIcon from "lucide-solid/icons/lightbulb";
import * as imageGen from "@/imagegen";

export const inputTags: InputTag[] = [
  {
    id: "create-image",

    name: "Create Image",
    short: "Image",
    icon: ImagePlusIcon,
    placeholder: "Describe an image",

    prompt:
      "You should create an image using the `image_gen` tool by the user's description. If you aren't certain the user's prompt is describing an image, ask the user for further details.",

    isSupported() {
      return imageGen.isAvailable();
    },
  },

  {
    id: "search-web",

    name: "Web Search",
    short: "Search",
    icon: GlobeIcon,

    prompt: "You should prefer executing a web search based on the user's query.",

    async isSupported() {
      return isExtensionInstalled();
    },
  },

  {
    id: "think",

    name: "Thinking",
    short: "Think",
    icon: LightbulbIcon,

    async isSupported(ctx) {
      return ctx.capabilities.thinking;
    },
  },
];

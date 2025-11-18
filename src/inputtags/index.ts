import type { InputTag } from "@/types";
import { isExtensionInstalled } from "@/util/extension";
import ImagePlusIcon from "lucide-solid/icons/image-plus";
import GlobeIcon from "lucide-solid/icons/globe";
import LightbulbIcon from "lucide-solid/icons/lightbulb";
import PuzzleIcon from "lucide-solid/icons/puzzle";
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
      return ctx.metadata.capabilities.thinking;
    },
  },

  {
    id: "reason",

    name: "Reasoning",
    short: "Reason",
    icon: PuzzleIcon,

    prompt:
      "Think through this problem step-by-step in a clear, explicit way: break the task into parts, identify relevant information, state any assumptions, consider different possibilities, analyze them logically, and show your reasoning as you work toward the answer. Write down your thinking process step-by-step, and get a better grasp of the task at hand before answering. . After outlining your reasoning, provide the final conclusion. You are not required to call tools, so do not unnecessarily waste tool calls, unless the user's task explicitly matches a tool's usecase. It's imperative you write down the thinking process before answering, do not jump straight into the answer.",

    async isSupported(ctx) {
      return !ctx.metadata.capabilities.thinking;
    },
  },
];

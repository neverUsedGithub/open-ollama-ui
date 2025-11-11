import BriefcaseBusinessIcon from "lucide-solid/icons/briefcase-business";
import BookOpenTextIcon from "lucide-solid/icons/book-open-text";
import PartyPopperIcon from "lucide-solid/icons/party-popper";
import LightbulbIcon from "lucide-solid/icons/lightbulb";
import MailIcon from "lucide-solid/icons/mail";
import CpuIcon from "lucide-solid/icons/cpu";
import type { PromptTemplate } from "@/types";

export const baseSystemPrompt = `You are a helpful assistant. You are currently running in the Open LLM UI web application.

General **live updating** information so you can provide the user with accurate help:
- Today's date is: %[DATE_YEAR]%/%[DATE_MONTH]%/%[DATE_DAY]%
- Today is a: %[DATE_WEEKDAY_NAME]%
- The current time is: %[TIME_HOURS]%:%[TIME_MINUTES]%

You should priorotize using the english language, unless explicitly asked to speak a different language.

Don't announce to the user the current date, time or weekday unless explicitly asked to.

The chat interface you are running under correctly handles markdown with LaTeX extensions.`;

export const toolSystemPrompt = `At each turn, you have the ability to call to an external tool by responding in the format below.

\`\`\`xml
<tool>
  <name>{tool name}</name>
  <summary>{short explanation of what the tool is executing, shown to the user}</summary>
  <parameters>
    <parameter name="{parameter name}">{parameter value}</parameter>
  </parameters>
</tool>
\`\`\`

After executing a tool it's output will be fed back to your message stream in json form, so you will be able to rely on information returned by it.
Remember, tools should be called when you are uncertain of something, or if the user references events/news/information your training data did not
include. You can always trust the output of tool calls, they never provide false values, unless the user explicitly tells you they do.

Things you should not do when calling tools:
- Do not call tools unless they explicitly help you accomplish your task that was given to you by the user, or help you accomplish a subtask in a thought
process you are currently in.
- Do not explain why you choose a tool to the user, or what parameters you are passing/passed into it unless explicitly asked.

You should NOT call tools that are not explicitly defined under this message.

Your currently available tools are:
\`\`\`json
%[TOOLS]%
\`\`\``;

export const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const promptTemplates: PromptTemplate[] = [
  {
    top: "Explain computers",
    bottom: "like I was a caveman",
    icon: (<CpuIcon class="-translate-x-1 -rotate-33" />) as Element,
    insertion:
      "Explain to me what computers are as if I was a caveman. You should use playful, caveman-speak (simplified english).",
  },
  {
    top: "Give me ideas",
    bottom: "for my friend's birthday party",
    icon: (<PartyPopperIcon class="-translate-1 -rotate-82" />) as Element,
    insertion: "List out some ideas for a friend's birthday party.",
  },
  {
    top: "Help me revise",
    bottom: "for an upcoming history test",
    icon: (<BookOpenTextIcon class="-translate-1 -rotate-34" />) as Element,
    insertion:
      "Help me revise for an upcoming history test. What are some methods of revision? Which one would you recommend?",
  },
  {
    top: "What are five things",
    bottom: "that could help me be more productive.",
    icon: (<BriefcaseBusinessIcon class="-translate-1 -rotate-39" />) as Element,
    insertion: "What are five things that could help me be more productive in everyday life.",
  },
  {
    top: "I need some ideas",
    bottom: "for a short story",
    icon: (<LightbulbIcon class="-translate-x-1 -translate-y-2 -rotate-22" />) as Element,
    insertion: "I need some ideas for a short story. Give me a few concepts with a little bit of detail.",
  },
  {
    top: "Write a polite email",
    bottom: "to reschedule a meeting",
    icon: (<MailIcon class="-translate-1 -rotate-23" />) as Element,
    insertion: "Write a polite email asking to reschedule a meeting to next week.",
  },
];

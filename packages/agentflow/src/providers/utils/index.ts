import {
  parseAsBalancedJson,
  parseAsExtractedJson,
  parseAsJson,
  parseAsMarkdownJson,
  parseAsTaggedJson,
  stripThinkTags,
} from "./parsers.js";

export const parser = {
  parseAsJson,
  parseAsMarkdownJson,
  parseAsExtractedJson,
  parseAsBalancedJson,
  parseAsTaggedJson,
  stripThinkTags,
};

export * from "./tool-call.js";

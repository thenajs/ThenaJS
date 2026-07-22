import {
    parseAsBalancedJson,
    parseAsExtractedJson,
    parseAsJson,
    parseAsMarkdownJson,
    stripThinkTags
} from "./parsers.js";

export const parser = {
    parseAsJson,
    parseAsMarkdownJson,
    parseAsExtractedJson,
    parseAsBalancedJson,
    stripThinkTags
};
import z from "zod";

export type ToolType = { 
    name: string; 
    description: string; 
    schema: z.ZodType; 
    execute: (args: any) => Promise<string>;
};
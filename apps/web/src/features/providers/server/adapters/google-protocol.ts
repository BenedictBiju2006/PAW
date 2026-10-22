import { asSchema, jsonSchema, type ToolSet, type ModelMessage } from "ai";
import { ProviderProtocolError, type ProviderEvent } from "../../model/provider";
import type { SdkProtocol } from "./sdk";
type Call = Extract<ProviderEvent, { type: "call" }>;

/** A wire declaration is a generation hint, not PAW's authorization/validation schema. */
function declaration(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderProtocolError("tool_schema");
  const source = value as Record<string, unknown>;
  // Bootstrap tools have finite, explicit properties. Do not silently flatten
  // future recursive schemas: they need an explicit wire representation.
  if (
    source.$ref ||
    source.definitions ||
    source.$defs ||
    source.anyOf ||
    source.oneOf
  )
    throw new ProviderProtocolError("tool_schema");
  const result: Record<string, unknown> = {};
  for (const key of ["type", "description", "enum", "required"])
    if (source[key] !== undefined) result[key] = source[key];
  if (source.properties && typeof source.properties === "object")
    result.properties = Object.fromEntries(
      Object.entries(source.properties).map(([key, schema]) => [
        key,
        declaration(schema),
      ]),
    );
  if (source.items) result.items = declaration(source.items);
  return result;
}

async function googleTools(tools: ToolSet): Promise<ToolSet> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(tools).map(async ([name, definition]) => {
        const schema =
          name === "invoke_tool"
            ? {
                type: "object",
                properties: {
                  toolId: {
                    type: "string",
                    description:
                      "The tool ID inspected with describe_tool in this turn.",
                  },
                  arguments: {
                    type: "string",
                    description:
                      "A JSON-encoded object matching the discovered tool's input schema. Encode all nested arrays and objects inside this string; use {} for no arguments.",
                  },
                },
                required: ["toolId", "arguments"],
              }
            : declaration(await asSchema(definition.inputSchema).jsonSchema);
        // Deliberately do not run Zod transforms/defaults on signed wire inputs.
        // The orchestrator and ToolExecutor retain the original strict schemas.
        return [name, { ...definition, inputSchema: jsonSchema(schema) }];
      }),
    ),
  );
}

function googleMessages(
  model: string,
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || typeof message.content === "string")
      return message;
    const calls = message.content.filter((part) => part.type === "tool-call");
    if (
      /^gemini-[34]/.test(model) &&
      calls.length &&
      !calls[0].providerOptions?.google?.thoughtSignature
    )
      throw new ProviderProtocolError("thought_signature");
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-call") return part;
        const raw = part.providerOptions?.pawGoogle?.rawCall;
        if (typeof raw !== "string") return part;
        const { pawGoogle: _privateReplay, ...providerOptions } =
          part.providerOptions!;
        // Restore the exact JSON-string arguments returned by Google; re-encoding
        // the decoded object could change whitespace/order covered by its signature.
        return { ...part, input: JSON.parse(raw), providerOptions };
      }),
    };
  });
}
function googleCall(call: Call): Call {
  const rawCall = JSON.stringify(call.args);
  let args = call.args;
  if (
    call.name === "invoke_tool" &&
    args &&
    typeof args === "object" &&
    !Array.isArray(args)
  ) {
    const input = args as Record<string, unknown>;
    if (typeof input.arguments === "string") {
      try {
        args = { ...input, arguments: JSON.parse(input.arguments) };
      } catch {
        /* Keep invalid JSON as a string: dispatch returns a bounded validation error. */
      }
    }
  }
  return {
    ...call,
    args,
    providerOptions: { ...call.providerOptions, pawGoogle: { rawCall } },
  };
}
export const googleProtocol: SdkProtocol = {
  async prepare(input) {
    return {
      ...input,
      tools: await googleTools(input.tools),
      messages: googleMessages(input.model, input.messages),
    };
  },
  call: googleCall,
};

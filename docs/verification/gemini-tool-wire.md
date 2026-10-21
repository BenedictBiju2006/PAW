# Gemini tool-calling wire investigation

Inspected main at `f0ce90f` with AI SDK 7.0.145 and Google provider 4.0.102. Tests capture the actual installed SDK's outgoing generateContent requests using mocked HTTP/SSE responses. No live Gemini inference was performed; without the original production response, these reproductions do not identify which rejection a particular deployment encountered.

## Initial request: recursive bootstrap declaration

Before any tool result, `invoke_tool.arguments` generated from `z.record(z.string(), z.json())` contained `propertyNames`, `additionalProperties`, and a reference to `definitions.__schema0`. That definition recursively referenced itself for arrays and objects. A strict Google mock reproduces HTTP 400 on this first request. This is an unbounded JSON declaration, rather than a finite tool parameter schema; support for other JSON Schema keywords varies by Google model/API.

Google now receives a finite declaration with `toolId` and a JSON-encoded `arguments` string. The adapter decodes that string before dispatch. The original bootstrap Zod schemas and ToolExecutor still validate and authorize every execution, including nested inputs and unknown properties. Other providers retain their existing declarations. Invalid JSON returns the ordinary bounded validation result. The system prompt and discovery-first orchestration are unchanged.

## After tool results: streamed thought signature lost

A second independent reproduction sends Google's real thought signature on a later function-call input delta. The installed SDK exposes it on that delta, but its final tool-call event repeats metadata captured at input start. Reading only final-event metadata loses the real signature. The next request then contains the SDK's `skip_thought_signature_validator` substitute; a strict mock rejects this second request with HTTP 400.

The adapter accumulates input metadata per call ID and forwards the real signature. It also retains the original wire arguments for replay: SDK validation previously injected defaults such as `search_tools.limit`, and decoding/re-encoding the JSON argument string could alter its contents. Replay now preserves the original arguments, call order, IDs, and signatures. Parallel calls are tested with only the first call signed and with every call signed. Missing required signatures stop replay locally with a specific error; PAW does not inject dummy signatures.

Official protocol references:

- https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- https://ai.google.dev/gemini-api/docs/generate-content/function-calling

## Diagnostics and verification

Google errors identify the model request number and whether it is the initial request or follows tool results. HTTP 400/422 diagnostics classify schema rejection, thought signatures, result pairing/order, and generation configuration using safe field names rather than copying upstream bodies, prompts, or credentials. Existing key, access, quota, and availability classifications remain intact.

Passed:

- `npm run typecheck`
- `npm test`: 42 tests, including actual SDK wire regressions, strict validation, nested mutation execution through ToolExecutor, parallel calls, late signatures, redaction, and existing OpenAI/Groq cases.
- `npm run build`
- `git diff --check`

No provider switch, billable inference, dependency change, system prompt change, or Supabase migration change was made.

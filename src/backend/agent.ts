import { FunctionCallingConfigMode, type Content, type Part } from "@google/genai";
import { generateWithRetry } from "./llm.js";
import { toolDeclarations, executeTool } from "./tools.js";

export type AgentEvent =
  | { type: "thought"; step: number; text: string }
  | { type: "tool_call"; id: number; step: number; name: string; args: Record<string, any> }
  | { type: "tool_result"; id: number; name: string; summary: string }
  | { type: "final"; report: string; steps: number }
  | { type: "error"; error: string };

const MAX_STEPS = Math.max(2, Number(process.env.AGENT_MAX_STEPS) || 8);

const SYSTEM_PROMPT = `You are an autonomous web research agent.
Goal: produce a accurate, well-sourced Markdown research report on the user's topic.

You have tools: web_search, fetch_page, finish_report. You decide:
- what to search, and how many times (vary your angles; do not repeat a query)
- which pages are worth reading in full
- when you have enough evidence to stop
If a tool fails or returns weak results, change strategy (different query, different page).
Cross-check important claims across more than one source and note disagreements.
Never invent facts or URLs. Only cite URLs that appeared in tool results.
You have a hard budget of ${MAX_STEPS} steps in total, so be efficient and finish before it runs out.

When ready, call finish_report with a Markdown report using exactly this structure:
# Comprehensive Research Report: <topic>
## Executive Summary
(2-3 clear paragraphs)
## Key Developments & Findings
## Challenges & Open Limitations
## Verified References
(markdown links to the sources you actually used)`;

function textOf(content: Content): string {
  return (content.parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("")
    .trim();
}

export async function runAgent(
  topic: string,
  emit: (e: AgentEvent) => void,
  isCancelled: () => boolean
): Promise<void> {
  const contents: Content[] = [
    { role: "user", parts: [{ text: `Research topic: ${topic}` }] },
  ];
  let toolCallId = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (isCancelled()) return;

    // On the last step, force the model to wrap up with what it has
    const lastStep = step === MAX_STEPS;

    const response = await generateWithRetry({
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
        toolConfig: lastStep
          ? {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                allowedFunctionNames: ["finish_report"],
              },
            }
          : undefined,
      },
    });

    const modelContent = response.candidates?.[0]?.content;
    if (!modelContent) throw new Error("The model returned an empty response.");

    // Keep the model's turn exactly as returned (needed for multi-step tool use)
    contents.push(modelContent);

    const thought = textOf(modelContent);
    const calls = (modelContent.parts ?? []).filter((p) => p.functionCall).map((p) => p.functionCall!);

    // No tool call: the model answered directly, treat it as the final report
    if (calls.length === 0) {
      emit({ type: "final", report: thought || "The agent produced no report.", steps: step });
      return;
    }

    if (thought) emit({ type: "thought", step, text: thought });

    // The model chose to finish
    const finish = calls.find((c) => c.name === "finish_report");
    if (finish) {
      const report = String((finish.args as any)?.report ?? "").trim();
      emit({ type: "final", report: report || "The agent produced an empty report.", steps: step });
      return;
    }

    // Run every tool the model asked for and feed the results back
    const responseParts: Part[] = [];
    for (const call of calls) {
      if (isCancelled()) return;
      const id = ++toolCallId;
      const name = call.name ?? "unknown";
      const args = (call.args ?? {}) as Record<string, any>;

      emit({ type: "tool_call", id, step, name, args });
      const out = await executeTool(name, args);
      emit({ type: "tool_result", id, name, summary: out.summary });

      responseParts.push({
        functionResponse: {
          id: call.id,
          name,
          response: { result: out.forModel },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  throw new Error("The agent ran out of steps without producing a report.");
}

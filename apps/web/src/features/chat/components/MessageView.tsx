"use client";
import type { UIMessage } from "ai";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Activity } from "../../agent/public";
import type { Message } from "../model/schema";
export type ChatMessage = UIMessage<
  unknown,
  {
    activity: Activity;
    turn: {
      id: string;
      status: string;
      notice?: string | null;
      usage?: { input: number; output: number };
    };
    mutation: { workspaceId: string };
  }
>;
export function persistedMessages(
  messages: Message[],
  states: Record<string, string> = {},
): ChatMessage[] {
  const output: ChatMessage[] = [],
    groups = new Map<string, ChatMessage>();
  for (const message of messages) {
    const groupId =
      message.role === "user" ? message.id : (message.turn_id ?? message.id);
    let group = groups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        role: message.role === "user" ? "user" : "assistant",
        parts: [],
      };
      groups.set(groupId, group);
      output.push(group);
    }
    for (const block of message.content) {
      if (block.type === "text")
        group.parts.push({ type: "text", text: block.text });
      else if (block.type === "tool_call")
        group.parts.push({
          type: "data-activity",
          id: block.invocationId,
          data: {
            ...block,
            status: block.status === "pending" ? "running" : block.status,
            arguments: block.arguments,
          },
        });
      else {
        const previous = group.parts.find(
          (p) => p.type === "data-activity" && p.id === block.invocationId,
        );
        const status = block.isError
          ? (block.result as { error?: { code: string } })?.error?.code ===
            "confirmation_required"
            ? "awaiting_confirmation"
            : "failed"
          : "completed";
        if (previous?.type === "data-activity")
          previous.data = { ...previous.data, status, result: block.result };
        else
          group.parts.push({
            type: "data-activity",
            id: block.invocationId,
            data: {
              invocationId: block.invocationId,
              toolId: block.toolId,
              arguments: {},
              status,
              result: block.result,
            },
          });
      }
    }
  }
  for (const message of output)
    if (states[message.id] && states[message.id] !== "running")
      for (const part of message.parts)
        if (part.type === "data-activity" && part.data.status === "running")
          part.data = {
            ...part.data,
            status: "failed",
            result: {
              error: {
                code: "outcome_unknown",
                message:
                  "This turn ended before the tool outcome was recorded. Inspect current workspace state before retrying.",
              },
            },
          };
  return output;
}
const labels: Record<string, string> = {
  search_tools: "Searching available tools",
  describe_tool: "Inspecting tool schema",
  list_resources: "Exploring workspace resources",
  inspect_resource: "Inspecting resource",
  create_collection: "Creating collection",
  get_catalog: "Inspecting A2UI catalog",
  inspect_component: "Inspecting component",
  inspect_interface: "Inspecting current interface",
  apply_interface_messages: "Updating interface",
  save_interface: "Saving interface",
  query_records: "Querying records",
  create_record: "Creating record",
  update_record: "Updating record",
  aggregate_records: "Aggregating records",
};
export function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <details className="tool-activity">
      <summary>
        {labels[activity.toolId] ?? activity.toolId.replaceAll("_", " ")}{" "}
        <span className="muted">· {activity.status.replaceAll("_", " ")}</span>
      </summary>
      <dl>
        <dt>Tool</dt>
        <dd>{activity.toolId}</dd>
        <dt>Arguments</dt>
        <dd>
          <pre>{JSON.stringify(activity.arguments, null, 2)}</pre>
        </dd>
        {activity.result !== undefined && (
          <>
            <dt>Result</dt>
            <dd>
              <pre>{JSON.stringify(activity.result, null, 2)}</pre>
            </dd>
          </>
        )}
      </dl>
      {activity.status === "awaiting_confirmation" && (
        <p>
          Agent deletion is blocked. Use the manual delete control to confirm
          this operation.
        </p>
      )}
    </details>
  );
}
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <button
        type="button"
        onClick={async () => {
          try {
            const text =
              typeof children === "object" && children && "props" in children
                ? String(
                    (children as { props: { children: unknown } }).props
                      .children,
                  )
                : String(children);
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
export function MessageView({ message }: { message: ChatMessage }) {
  return (
    <article
      className={`chat-message ${message.role}`}
      aria-label={
        message.role === "user" ? "Your message" : "Assistant message"
      }
    >
      {message.parts.map((part, index) => {
        if (part.type === "text")
          return (
            <div key={index} className="message-text">
              {message.role === "user" ? (
                <p>{part.text}</p>
              ) : (
                <ReactMarkdown
                  skipHtml
                  components={{
                    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {part.text}
                </ReactMarkdown>
              )}
            </div>
          );
        if (part.type === "data-activity")
          return <ActivityRow key={index} activity={part.data} />;
        if (part.type === "data-turn")
          return (
            <p className="turn-status muted" key={index}>
              {part.data.status}
              {part.data.notice ? ` · ${part.data.notice}` : ""}
              {part.data.usage
                ? ` · ${part.data.usage.input} input / ${part.data.usage.output} output tokens · cost unknown`
                : ""}
            </p>
          );
        return null;
      })}
    </article>
  );
}

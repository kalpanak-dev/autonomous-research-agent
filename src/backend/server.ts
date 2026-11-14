import "dotenv/config";
import express from "express";
import cors from "cors";
import { runAgent, type AgentEvent } from "./agent.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    geminiKey: Boolean(process.env.GEMINI_API_KEY),
    tavilyKey: Boolean(process.env.TAVILY_API_KEY),
    model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
    maxSteps: Number(process.env.AGENT_MAX_STEPS) || 8,
  });
});

app.post("/api/research", async (req, res) => {
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  if (!topic) {
    res.status(400).json({ error: "Topic is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (payload: AgentEvent | { type: "done" }) =>
    res.write(`data: ${JSON.stringify(payload)}\n\n`);

  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
  });

  try {
    await runAgent(
      topic,
      (event) => {
        if (!clientGone) send(event);
      },
      () => clientGone
    );
  } catch (error: any) {
    console.error("Agent execution error:", error);
    if (!clientGone) send({ type: "error", error: error?.message ?? "Unknown error" });
  } finally {
    if (!clientGone) send({ type: "done" });
    res.end();
  }
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`⚡ Autonomous agent server online at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn("⚠️  GEMINI_API_KEY is not set");
  if (!process.env.TAVILY_API_KEY) console.warn("⚠️  TAVILY_API_KEY is not set");
});

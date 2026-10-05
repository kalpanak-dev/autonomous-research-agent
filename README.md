# Autonomous Research Agent (v2, tool-calling agent)

A single Gemini agent that runs its own ReAct-style loop: it chooses between `web_search`, `fetch_page` and `finish_report`, decides how many times to use each, and decides when to stop. A step budget (`AGENT_MAX_STEPS`) is the only hard limit.

## Setup
1. `npm install`
2. `copy .env.example .env` (Windows) or `cp .env.example .env`, then add your keys
3. `npm run dev`
4. Open http://localhost:3000 (health check: http://localhost:5000/api/health)



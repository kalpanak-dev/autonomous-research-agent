import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Search,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Cpu,
  AlertCircle,
  Globe,
  BookOpen,
  MessageSquare,
  XCircle,
} from 'lucide-react';

type TimelineItem =
  | { kind: 'thought'; key: string; text: string }
  | {
      kind: 'tool';
      key: string;
      id: number;
      name: string;
      args: Record<string, any>;
      status: 'running' | 'done' | 'failed';
      summary?: string;
    };

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  fetch_page: 'Reading a page',
};

function describeArgs(name: string, args: Record<string, any>) {
  if (name === 'web_search') return args.query;
  if (name === 'fetch_page') {
    try {
      return new URL(args.url).hostname + new URL(args.url).pathname.slice(0, 30);
    } catch {
      return args.url;
    }
  }
  return '';
}

export default function App() {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [finalReport, setFinalReport] = useState('');
  const [stepsUsed, setStepsUsed] = useState<number | null>(null);
  const [error, setError] = useState('');

  const handleEvent = (e: any) => {
    switch (e.type) {
      case 'thought':
        setTimeline((prev) => [...prev, { kind: 'thought', key: `t-${prev.length}`, text: e.text }]);
        break;
      case 'tool_call':
        setTimeline((prev) => [
          ...prev,
          { kind: 'tool', key: `c-${e.id}`, id: e.id, name: e.name, args: e.args, status: 'running' },
        ]);
        break;
      case 'tool_result':
        setTimeline((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.id === e.id
              ? {
                  ...item,
                  status: String(e.summary).startsWith('Failed') ? 'failed' : 'done',
                  summary: e.summary,
                }
              : item
          )
        );
        break;
      case 'final':
        setFinalReport(e.report);
        setStepsUsed(e.steps);
        break;
      case 'error':
        setError(e.error || 'Something went wrong while running the agent.');
        break;
    }
  };

  const handleResearch = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setTimeline([]);
    setFinalReport('');
    setStepsUsed(null);
    setError('');

    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data: ')) continue;
          try {
            handleEvent(JSON.parse(chunk.slice(6)));
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Could not reach the backend. Is it running on port 5000?');
    } finally {
      setLoading(false);
    }
  };

  const toolCount = timeline.filter((t) => t.kind === 'tool').length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-sm mb-4">
          <Cpu className="w-4 h-4" /> Autonomous AI Agent
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Autonomous Research Agent</h1>
        <p className="text-gray-400 max-w-xl mx-auto">
          Give it a topic. The agent decides what to search, which pages to read, and when it knows enough to write the report.
        </p>
      </div>

      <form onSubmit={handleResearch} className="mb-6 max-w-2xl mx-auto">
        <div className="relative flex items-center">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., Latest developments in solid-state batteries..."
            className="w-full pl-12 pr-32 py-4 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            disabled={loading}
          />
          <Search className="absolute left-4 w-5 h-5 text-gray-500" />
          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="absolute right-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Research'}
          </button>
        </div>
      </form>

      {error && (
        <div className="max-w-2xl mx-auto mb-8 flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 h-fit">
          <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-400" /> Agent Activity
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            {loading
              ? 'The agent is deciding its next move...'
              : stepsUsed
              ? `Finished in ${stepsUsed} reasoning steps, ${toolCount} tool calls`
              : 'Every decision the agent makes appears here.'}
          </p>

          {timeline.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No task running. Submit a topic to start.</p>
          ) : (
            <div className="space-y-3">
              {timeline.map((item) =>
                item.kind === 'thought' ? (
                  <div key={item.key} className="flex items-start gap-3 px-3 py-2 text-xs text-gray-400 italic">
                    <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
                    <div className="min-w-0 break-words">{item.text}</div>
                  </div>
                ) : (
                  <div key={item.key} className="flex items-start gap-3 p-3 bg-gray-900/60 rounded-lg border border-gray-800">
                    {item.status === 'running' ? (
                      <Loader2 className="w-5 h-5 text-blue-400 animate-spin mt-0.5 shrink-0" />
                    ) : item.status === 'failed' ? (
                      <XCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-200 flex items-center gap-1.5">
                        {item.name === 'fetch_page' ? (
                          <BookOpen className="w-3.5 h-3.5 text-gray-400" />
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        {TOOL_LABELS[item.name] ?? item.name}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 break-words">
                        {describeArgs(item.name, item.args)}
                      </div>
                      {item.summary && <div className="text-xs text-gray-500 mt-1">{item.summary}</div>}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-gray-800/30 border border-gray-700/50 rounded-xl p-6 min-h-[400px]">
          <div className="flex items-center gap-2 mb-6 border-b border-gray-700/50 pb-4">
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Generated Research Brief</h2>
          </div>

          {finalReport ? (
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown>{finalReport}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <p>Your synthesized research output will appear here once ready.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

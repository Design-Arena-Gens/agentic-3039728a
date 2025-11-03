"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowPathIcon, MicrophoneIcon, StopIcon } from "@heroicons/react/24/outline";
import { clsx } from "clsx";

type AgentStep = {
  title: string;
  description: string;
  tool?: string | null;
};

type AgentResult = {
  summary: string;
  category: string;
  confidence: number;
  steps: AgentStep[];
  recommendedTools: string[];
  followUps: string[];
  speech: string;
};

type ConversationTurn = {
  id: string;
  command: string;
  timestamp: string;
  result: AgentResult;
};

type SpeechRecognitionResultEvent = {
  results: SpeechRecognitionResultList;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js";

export default function Page() {
  const [pyodideReady, setPyodideReady] = useState(false);
  const [pyodideLoadingText, setPyodideLoadingText] = useState("Booting embedded Python runtime…");
  const pyodideRef = useRef<any>(null);
  const [commandInput, setCommandInput] = useState("");
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        setPyodideLoadingText("Loading Pyodide runtime…");
        if (!(window as any).loadPyodide) {
          await injectScript(PYODIDE_URL);
        }
        if (cancelled) return;

        setPyodideLoadingText("Initializing Python environment…");
        const pyodideInstance = await (window as any).loadPyodide();

        if (cancelled) return;

        const frameworkSource = await fetch("/agent_framework.py").then((res) => {
          if (!res.ok) throw new Error("Failed to load agent framework");
          return res.text();
        });

        pyodideInstance.FS.writeFile("agent_framework.py", frameworkSource);
        await pyodideInstance.runPythonAsync("import agent_framework");

        pyodideRef.current = pyodideInstance;
        setPyodideReady(true);
        setPyodideLoadingText("Python agent ready");
      } catch (loadError: any) {
        console.error(loadError);
        setError("Failed to load the Python reasoning engine. Refresh to retry.");
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pyodideReady || !pendingCommand || isProcessing) {
      return;
    }

    const controller = new AbortController();
    void runAgent(pendingCommand, controller.signal);

    async function runAgent(command: string, signal: AbortSignal) {
      try {
        setIsProcessing(true);
        const pyodide = pyodideRef.current;
        const escapedCommand = JSON.stringify(command);
        const resultJson = await pyodide.runPythonAsync(
          [
            "import json",
            "from agent_framework import orchestrate_command",
            `json.dumps(orchestrate_command(${escapedCommand}))`
          ].join("\n")
        );

        if (signal.aborted) {
          return;
        }

        const parsed: AgentResult = JSON.parse(resultJson);

        setHistory((prev) => [
          {
            id: crypto.randomUUID(),
            command,
            timestamp: new Date().toISOString(),
            result: parsed
          },
          ...prev
        ]);

        speakText(parsed.speech);
        setCommandInput("");
        setPendingCommand(null);
      } catch (agentError: any) {
        console.error(agentError);
        setError("Jarvis hit a snag while reasoning about that request. Try rephrasing.");
        setPendingCommand(null);
      } finally {
        setIsProcessing(false);
      }
    }

    return () => controller.abort();
  }, [pendingCommand, pyodideReady, isProcessing]);

  function ensureRecognizer() {
    if (typeof window === "undefined") return null;

    if (recognitionRef.current) return recognitionRef.current;

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setError("This browser does not support Web Speech Recognition. Try Chrome Desktop.");
      return null;
    }

    const instance = new SpeechRecognitionCtor();
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = "en-US";

    instance.onresult = (event: SpeechRecognitionResultEvent) => {
      const lastResult = event.results[event.results.length - 1];
      const transcript = lastResult[0].transcript.trim();
      if (transcript.length) {
        setPendingCommand(transcript);
      }
      setIsListening(false);
    };

    instance.onerror = (event: any) => {
      console.error(event);
      setIsListening(false);
      const message =
        typeof event.error === "string"
          ? `Speech recognition error: ${event.error}`
          : "Speech recognition was interrupted.";
      setError(message);
    };

    instance.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = instance;
    return instance;
  }

  function toggleListening() {
    const recognizer = ensureRecognizer();
    if (!recognizer) return;

    setError(null);

    if (isListening) {
      recognizer.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      recognizer.start();
    }
  }

  function submitCommand() {
    if (!commandInput.trim()) return;
    setPendingCommand(commandInput.trim());
  }

  function speakText(text: string) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1;
    utterance.rate = 1;
    utterance.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  const lastTurn = history.length > 0 ? history[0] : null;

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-xl shadow-indigo-500/10"
          initial={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Command Center</h2>
              <p className="mt-1 text-sm text-slate-300">
                Say “Hey Jarvis…” or type an instruction to kick off an autonomous plan.
              </p>
            </div>
            <StatusBadge ready={pyodideReady} />
          </div>

          <div className="mt-8 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
              <div className="text-xs uppercase tracking-[0.25em] text-indigo-300/80">
                Voice Interface
              </div>
              <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-slate-200">
                  {isListening
                    ? "Listening… Speak your instruction clearly."
                    : "Tap the orb to start voice capture."}
                </div>
                <button
                  type="button"
                  onClick={toggleListening}
                  className={clsx(
                    "group relative flex h-16 w-16 items-center justify-center rounded-full transition",
                    isListening
                      ? "bg-rose-500/80 shadow-[0_0_40px_rgba(244,63,94,0.45)]"
                      : "bg-indigo-500/70 shadow-[0_0_28px_rgba(79,70,229,0.35)] hover:bg-indigo-500/90"
                  )}
                  disabled={!pyodideReady || isProcessing}
                >
                  <span className="absolute inset-0 rounded-full border border-white/20" />
                  {isListening ? (
                    <StopIcon className="h-7 w-7 text-white transition group-hover:scale-105" />
                  ) : (
                    <MicrophoneIcon className="h-7 w-7 text-white transition group-hover:scale-105" />
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
              <label className="text-xs uppercase tracking-[0.25em] text-indigo-300/80">
                Manual Override
              </label>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <input
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/80 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="e.g. Jarvis, book a table for two at a sushi place tomorrow at 7pm"
                  value={commandInput}
                  onChange={(event) => setCommandInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCommand();
                    }
                  }}
                  disabled={!pyodideReady || isProcessing}
                />
                <button
                  type="button"
                  onClick={submitCommand}
                  className="inline-flex items-center justify-center rounded-2xl border border-indigo-500/40 bg-indigo-500/80 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:border-indigo-400 hover:bg-indigo-500"
                  disabled={!pyodideReady || isProcessing}
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Synthesizing…
                    </span>
                  ) : (
                    "Deploy Jarvis"
                  )}
                </button>
              </div>
              {error && (
                <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                  {error}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        <div className="flex flex-col gap-6">
          <Panel title="Latest Plan">
            {!pyodideReady && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-slate-300">
                {pyodideLoadingText}
              </div>
            )}
            {pyodideReady && !lastTurn && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-slate-300">
                Awaiting your first mission. Ask Jarvis to orchestrate something ambitious!
              </div>
            )}
            {lastTurn && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 text-sm text-indigo-100">
                  <div className="text-xs uppercase tracking-[0.25em] text-indigo-200/70">
                    Mission Summary
                  </div>
                  <p className="mt-2 text-base text-white">{lastTurn.result.summary}</p>
                  <div className="mt-3 flex items-center gap-3 text-xs text-indigo-200/70">
                    <span className="rounded-full border border-indigo-400/40 px-3 py-1">
                      {lastTurn.result.category}
                    </span>
                    <span className="rounded-full border border-indigo-400/40 px-3 py-1">
                      Confidence {(lastTurn.result.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-300/70">
                    Step-by-step Execution
                  </div>
                  <ul className="mt-4 space-y-3">
                    {lastTurn.result.steps.map((step, index) => (
                      <li
                        key={index}
                        className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200/80">
                          Step {index + 1}
                        </div>
                        <div className="mt-1 text-base text-white">{step.title}</div>
                        <p className="mt-2 text-sm text-slate-300">{step.description}</p>
                        {step.tool && (
                          <div className="mt-3 inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
                            Suggested Tool: {step.tool}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-300/70">
                    Suggested Automations
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {lastTurn.result.recommendedTools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-200"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                  {!!lastTurn.result.followUps.length && (
                    <div className="mt-5">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                        Follow-up suggestions
                      </div>
                      <ul className="mt-3 space-y-2 text-sm text-slate-200">
                        {lastTurn.result.followUps.map((item, index) => (
                          <li key={index} className="rounded-lg border border-white/10 bg-white/5 p-3">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Launch Checklist">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-slate-200">
              <ol className="space-y-3">
                <li>
                  1. Invoke Jarvis with a clear instruction. Voice capture segments the command and
                  triggers the Python planner.
                </li>
                <li>
                  2. The embedded Python agent analyses intent ∙ surfaces structured steps ∙ tags the
                  required tools.
                </li>
                <li>3. Review the plan, fire the automation in your preferred integrations.</li>
                <li>4. Iterate with follow-up questions to refine, escalate, or abort plans.</li>
              </ol>
            </div>
          </Panel>
        </div>
      </section>

      <section>
        <Panel title="Mission History">
          <AnimatePresence initial={false}>
            {history.length === 0 && (
              <motion.div
                className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-slate-300"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                No missions yet. Ask Jarvis to orchestrate tasks like phone calls, navigation, or
                scheduling.
              </motion.div>
            )}
            {history.length > 0 && (
              <motion.ul
                className="space-y-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                {history.map((turn) => (
                  <li
                    key={turn.id}
                    className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.25em] text-indigo-200/70">
                        {new Date(turn.timestamp).toLocaleTimeString()}
                      </div>
                      <span className="rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-indigo-200">
                        {turn.result.category}
                      </span>
                    </div>
                    <div className="mt-3 text-base text-white">“{turn.command}”</div>
                    <p className="mt-3 text-sm text-slate-300">{turn.result.summary}</p>
                    <details className="group mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
                      <summary className="cursor-pointer select-none text-slate-200 transition group-open:text-indigo-200">
                        Inspect detailed plan
                      </summary>
                      <ul className="mt-3 space-y-2 text-slate-200">
                        {turn.result.steps.map((step, stepIndex) => (
                          <li
                            key={stepIndex}
                            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                          >
                            <div className="text-xs uppercase tracking-[0.2em] text-indigo-200/80">
                              Step {stepIndex + 1}: {step.title}
                            </div>
                            <p className="mt-1 text-slate-200">{step.description}</p>
                            {step.tool && (
                              <div className="mt-2 text-xs text-indigo-200/80">
                                Tool Recommendation: {step.tool}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </Panel>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section
      className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20"
      initial={{ opacity: 0, translateY: 16 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

function StatusBadge({ ready }: { ready: boolean }) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em]",
        ready
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
          : "border-amber-400/40 bg-amber-500/10 text-amber-100"
      )}
    >
      <span
        className={clsx(
          "h-2 w-2 rounded-full",
          ready ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.75)]" : "bg-amber-300"
        )}
      />
      {ready ? "Python Core Online" : "Booting Python Core"}
    </div>
  );
}

async function injectScript(src: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.getAttribute("data-loaded") === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Failed to load script ${src}`)));
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.setAttribute("data-loaded", "true");
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`Failed to load script ${src}`)));
    document.body.appendChild(script);
  });
}

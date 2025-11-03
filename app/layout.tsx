"use client";

import "./globals.css";
import { Inter } from "next/font/google";
import { clsx } from "clsx";
import { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <body className={clsx(inter.className, "bg-slate-950 text-slate-100")}>
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
          <header className="border-b border-white/10">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
              <div className="flex flex-col">
                <span className="font-semibold uppercase tracking-widest text-indigo-400">
                  Project Jarvis
                </span>
                <h1 className="text-2xl font-bold text-white">Agentic Voice Assistant</h1>
              </div>
              <div className="rounded-full border border-indigo-500/60 bg-indigo-500/10 px-4 py-1 text-sm font-medium text-indigo-200 shadow-lg shadow-indigo-500/10">
                Voice-Driven Python Reasoning
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-5xl px-6 py-12">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, translateY: 16 }}
                animate={{ opacity: 1, translateY: 0 }}
                exit={{ opacity: 0, translateY: -16 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
          <footer className="border-t border-white/10 bg-slate-950/60">
            <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-slate-400">
              Built with Next.js, Pyodide, and real-time speech orchestration.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

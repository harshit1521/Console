import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { useMonaco, type OnMount } from "@monaco-editor/react";
import { ChevronDown, Play, Trash2, Terminal, Code2, } from 'lucide-react';
import TerminalView, { type TerminalHandle } from './components/TerminalView';
// import { randomUUID } from "node:crypto";
// import axios from 'axios';

const LANGUAGES = [
    { id: 'javascript', name: 'JavaScript', label: 'JAVASCRIPT', extension: 'js' },
    { id: 'cpp', name: 'C++', label: 'C++', extension: 'cpp' },
    { id: 'java', name: 'Java', label: 'JAVA', extension: 'java' },
    { id: 'python', name: 'Python', label: 'PYTHON', extension: 'py' },
    { id: 'typescript', name: 'TypeScript', label: 'TYPESCRIPT', extension: 'ts' },
];

export default function ConsoleIDE() {
    const monaco = useMonaco();
    // const writtenLengthRef = useRef(0);
    const [output, setOutput] = useState('');
    const wsRef = useRef<WebSocket | null>(null);
    const terminalRef = useRef<TerminalHandle>(null);
    const [isRunning, setIsRunning] = useState(false);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [isOutputOpen, setIsOutputOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
    const [selectedLang, setSelectedLang] = useState(LANGUAGES[0]);

    const handleEditorMount: OnMount = (editor) => {
        editorRef.current = editor;
    };

    // Define custom theme
    useEffect(() => {
        if (monaco) {
            monaco.editor.defineTheme('console-dark', {
                base: 'vs-dark',
                inherit: false,
                rules: [
                    { token: 'comment', foreground: '5A6370', fontStyle: 'italic' },
                    { token: 'string', foreground: '7EC699' },
                    { token: 'number', foreground: 'B8A9FF' },
                    { token: 'keyword', foreground: 'FF9D76' },
                    { token: 'variable', foreground: 'F5F7FA' },
                    { token: 'function', foreground: '56B6F2' },
                    { token: 'delimiter', foreground: 'D1D5DB' },
                    { token: '', foreground: 'F5F7FA' },
                ],
                colors: {
                    'editor.background': '#11151B',
                    'editor.foreground': '#F5F7FA',
                    'editor.lineNumbersBackground': '#11151B',
                    'editor.lineNumbersForeground': '#5A6370',
                    'editor.lineHighlightBackground': '#151A2155',
                    'editor.selectionBackground': '#2A313C80',
                    'editor.selectionForeground': '#F5F7FA',
                    'editor.inactiveSelectionBackground': '#2A313C40',
                    'editor.cursorForeground': '#F5F7FA',
                    'editor.cursorLineBackground': '#151A2155',
                    'editorBracketMatch.background': '#2A313C',
                    'editorBracketMatch.border': '#9BA3AF',
                    'editorWhitespace.foreground': '#2A313C',
                    'editorIndentGuide.background': '#2A313C',
                    'editorIndentGuide.activeBackground': '#5A6370',
                    'editorError.foreground': '#FF6B6B',
                    'editorWarning.foreground': '#FFD93D',
                }
            });
            monaco.editor.setTheme('console-dark');
        }
    }, [monaco]);

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Close WebSocket on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const handleRun = async () => {
        const currentCode = editorRef.current?.getValue() ?? "";
        console.log(currentCode);
        setIsRunning(true);
        setIsOutputOpen(true);
        setOutput('');
        terminalRef.current?.clear();

        try {

            const ws = new WebSocket(`ws://localhost:8080`);
            wsRef.current = ws;


            ws.onopen = () => {
                ws.send(
                    JSON.stringify(
                        {
                            type: "start",
                            code: currentCode,
                            language: selectedLang.label
                        }
                    )
                );
            }

            ws.onmessage = (event) => {
                const chunk = event.data as string;
                setOutput(prev => prev + chunk); // keep for mobile modal / logging
                terminalRef.current?.write(chunk.replace(/\n/g, "\r\n"));
            }

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                const msg = `\n[ERROR]: WebSocket connection failed\r\n`;
                setOutput(prev => prev + `\n[ERROR]: WebSocket connection failed`);
                terminalRef.current?.write(msg);
                setIsRunning(false);
                wsRef.current = null;
            }

            ws.onclose = () => {
                console.log('WebSocket connection closed');
                setIsRunning(false);
                wsRef.current = null;
            }

        } catch (error) {
            console.log(error);
            setOutput(`[ERROR]: ${error instanceof Error ? error.message : 'Failed to submit code'}`);
            setIsRunning(false);
        }
    };

    const handleClear = () => {
        wsRef.current?.send(JSON.stringify({ type: "kill" }))
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        editorRef.current?.setValue("");
        setOutput('');
        terminalRef.current?.clear();
    };

    const handleTerminalInput = useCallback((line: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "stdin", data: line }));
        }
    }, []);

    return (
        <div className="w-full h-screen bg-[#11151B] border border-[#2A313C] shadow-2xl overflow-hidden flex flex-col transition-all duration-200">

            {/* HEADER */}
            <header className="px-6 py-5 border-b border-[#2A313C] bg-[#11151B] flex flex-col justify-center">
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F5F7FA] leading-none" style={{ fontFamily: '"JetBrains Mono", monospace', letterSpacing: '-0.02em' }}>
                    Console
                </h1>
                <p className="text-xs sm:text-sm text-[#9BA3AF] mt-1.5 font-normal tracking-wide">
                    online multilingual compiler
                </p>
            </header>

            {/* TOOLBAR */}
            <div className="px-6 py-3 border-b border-[#2A313C] bg-[#151A21] flex items-center justify-between gap-4">

                {/* Left Side: Language Dropdown */}
                <div className="relative shrink-0" ref={dropdownRef}>
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center justify-between min-w-35 px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-[#F5F7FA] bg-[#11151B] border border-[#2A313C] rounded-md hover:border-[#9BA3AF] focus:outline-none focus:border-[#F5F7FA] transition-all duration-150 group"
                        aria-expanded={isDropdownOpen}
                    >
                        <span>{selectedLang.name}</span>
                        <ChevronDown className={`w-3.5 h-3.5 ml-2 text-[#9BA3AF] group-hover:text-[#F5F7FA] transition-transform duration-150 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Custom Dropdown Menu */}
                    {isDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-[#151A21] border border-[#2A313C] rounded-md shadow-xl py-1 z-50 text-xs">
                            {LANGUAGES.map((lang) => (
                                <button
                                    key={lang.id}
                                    onClick={() => {
                                        setSelectedLang(lang);
                                        setIsDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 transition-colors duration-150 flex items-center justify-between ${selectedLang.id === lang.id
                                        ? 'bg-[#2A313C] text-[#F5F7FA] font-medium'
                                        : 'text-[#9BA3AF] hover:bg-[#11151B] hover:text-[#F5F7FA]'
                                        }`}
                                >
                                    <span>{lang.name}</span>
                                    <span className="text-[10px] font-mono text-[#9BA3AF] uppercase">{lang.extension}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Center: Primary RUN Button */}
                <div className="flex-1 flex justify-center">
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="flex items-center justify-center gap-2 px-6 py-1.5 text-xs font-bold tracking-wider text-[#F5F7FA] bg-transparent border border-[#2A313C] rounded-md hover:border-[#F5F7FA] hover:bg-[#2A313C]/30 active:bg-[#2A313C]/60 focus:outline-none focus:ring-1 focus:ring-[#F5F7FA] transition-all duration-150 disabled:opacity-50"
                    >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{isRunning ? 'RUNNING...' : 'RUN'}</span>
                    </button>
                </div>

                {/* Right Side: Secondary CLEAR Button */}
                <div className="shrink-0">
                    <button
                        onClick={handleClear}
                        className="flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold tracking-wider text-[#9BA3AF] bg-transparent border border-[#2A313C] rounded-md hover:text-[#F5F7FA] hover:border-[#9BA3AF] hover:bg-[#2A313C]/20 active:bg-[#2A313C]/40 focus:outline-none transition-all duration-150"
                    >
                        <Trash2 className="w-3 h-3" />
                        <span>CLEAR</span>
                    </button>
                </div>

            </div>

            {/* MAIN WORKSPACE (Equal Split) */}
            <div className="grid grid-cols-1 md:grid-cols-2 flex-1 bg-[#0B0E12] relative">

                {/* LEFT PANEL: CODE EDITOR */}
                <div className="flex flex-col border-b md:border-b-0 md:border-r border-[#2A313C] bg-[#11151B] md:flex">
                    {/* Label */}
                    <div className="px-4 py-2 border-b border-[#2A313C] bg-[#151A21] flex items-center justify-between text-[11px] font-mono font-semibold tracking-wider text-[#9BA3AF]">
                        <span className="uppercase pl-3">{selectedLang.label}</span>
                        <Code2 className="w-3.5 h-3.5 text-[#9BA3AF]/60" />
                    </div>

                    {/* Editor Input Area */}
                    <div className="relative flex-1 overflow-hidden">
                        <Editor
                            height="100%"
                            language={selectedLang.id}
                            // value={code}
                            onMount={handleEditorMount}
                            // onChange={(value) => setCode(value || '')}
                            theme="console-dark"
                            options={{
                                minimap: { enabled: false },
                                lineNumbers: 'on',
                                scrollBeyondLastLine: false,
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 13,
                                lineHeight: 24,
                                fontLigatures: true,
                                tabSize: 2,
                                insertSpaces: true,
                                wordWrap: 'on',
                                automaticLayout: true,
                                cursorStyle: 'line',
                                cursorBlinking: 'blink',
                                smoothScrolling: true,
                                padding: { top: 12, bottom: 12 },
                                renderWhitespace: 'none',
                                bracketPairColorization: {
                                    enabled: true,
                                    independentColorPoolPerBracketType: true,
                                },
                            }}
                            loading={<div className="w-full h-full bg-[#11151B] flex items-center justify-center text-[#9BA3AF]">Loading editor...</div>}
                        />
                    </div>
                </div>

                {/* RIGHT PANEL: OUTPUT TERMINAL - Hidden on mobile, shown on desktop */}
                <div className="hidden md:flex flex-col bg-[#151A21]">
                    {/* Label */}
                    <div className="px-4 py-2 border-b border-[#2A313C] bg-[#151A21] flex items-center justify-between text-[11px] font-mono font-semibold tracking-wider text-[#9BA3AF]">
                        <span>OUTPUT</span>
                        <Terminal className="w-3.5 h-3.5 mr-3 text-[#9BA3AF]/60" />
                    </div>

                    {/* Terminal Screen */}
                    <TerminalView ref={terminalRef} onData={handleTerminalInput}>
                        {/* {output ? (
                            <pre className="whitespace-pre-wrap text-[#F5F7FA] font-mono">{output}</pre>
                        ) : (
                            <div className="text-[#9BA3AF]/40 select-none">
                                Console output stream...
                                className="flex-1 p-4 font-mono text-xs sm:text-sm leading-6 overflow-y-auto"
                            </div>
                        )} */}
                    </TerminalView>
                </div>

            </div>

            {/* MOBILE OUTPUT MODAL - Only shown on mobile when RUN is clicked */}
            {isOutputOpen && (
                <div className="fixed inset-0 md:hidden bg-black/50 z-50 flex flex-col">
                    <div className="flex-1 flex flex-col bg-[#0B0E12] m-4 rounded-lg border border-[#2A313C] overflow-hidden">
                        {/* Modal Header with Close Button */}
                        <div className="px-4 py-3 border-b border-[#2A313C] bg-[#151A21] flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[11px] font-mono font-semibold tracking-wider text-[#9BA3AF]">
                                <Terminal className="w-3.5 h-3.5 text-[#9BA3AF]/60" />
                                <span>OUTPUT</span>
                            </div>
                            <button
                                onClick={() => setIsOutputOpen(false)}
                                className="p-1 hover:bg-[#2A313C] rounded transition-colors"
                                aria-label="Close output"
                            >
                                <svg className="w-5 h-5 text-[#9BA3AF] hover:text-[#F5F7FA]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Terminal Screen */}
                        <div className="flex-1 p-4 font-mono text-xs leading-6 overflow-y-auto">
                            {output ? (
                                <pre className="whitespace-pre-wrap text-[#F5F7FA] font-mono">{output}</pre>
                            ) : (
                                <div className="text-[#9BA3AF]/40 select-none">
                                    Console output stream...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* FOOTER STATUS BAR */}
            <footer className="px-4 py-1.5 border-t border-[#2A313C] bg-[#151A21] flex items-center justify-between text-[10px] font-mono text-[#9BA3AF]">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500/80 animate-pulse"></span>
                    <span>READY</span>
                </div>
                <div className="flex items-center gap-4">
                    <span>UTF-8</span>
                    <span>2 SPACES</span>
                </div>
            </footer>

        </div>
    );
}
import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { useMonaco, type OnMount } from "@monaco-editor/react";
import { ChevronDown, Play, Trash2, Terminal, Code2, Sun, Moon, TerminalSquare } from 'lucide-react';
import TerminalView, { type TerminalHandle } from './components/TerminalView';

const LANGUAGES = [
    { id: 'javascript', name: 'JavaScript', label: 'JAVASCRIPT', extension: 'js' },
    { id: 'cpp', name: 'C++', label: 'C++', extension: 'cpp' },
    { id: 'java', name: 'Java', label: 'JAVA', extension: 'java' },
    { id: 'python', name: 'Python', label: 'PYTHON', extension: 'py' },
    { id: 'typescript', name: 'TypeScript', label: 'TYPESCRIPT', extension: 'ts' },
];

const JAVA_BOILERPLATE = `public class Main {
  public static void main(String[] args) {
    // start code from here 

  }
}
`;

interface ConsoleIDEProps {
    isDark?: boolean;
    onToggleTheme?: () => void;
}

export default function ConsoleIDE({ isDark = false, onToggleTheme }: ConsoleIDEProps) {

    const monaco = useMonaco();
    // const writtenLengthRef = useRef(0);
    const wsRef = useRef<WebSocket | null>(null);
    const terminalRef = useRef<TerminalHandle>(null);
    const mobileTerminalRef = useRef<TerminalHandle>(null);
    const [isRunning, setIsRunning] = useState(false);
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const [isOutputOpen, setIsOutputOpen] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
    const [isEditorReady, setIsEditorReady] = useState(false);
    const [selectedLang, setSelectedLang] = useState(LANGUAGES[0]);

    const handleEditorMount: OnMount = (editor) => {
        editorRef.current = editor;
        setIsEditorReady(true);
    };

    const handleLanguageSelect = (lang: typeof LANGUAGES[number]) => {
        setSelectedLang(lang);
        setIsDropdownOpen(false);

        const currentValue = editorRef.current?.getValue() || "";

        if (lang.id === 'java') {
            if (!currentValue.trim()) {
                editorRef.current?.setValue(JAVA_BOILERPLATE);
            }
        } else {
            // If we are switching away from Java and the editor only contains the untouched boilerplate, clear it.
            if (currentValue === JAVA_BOILERPLATE) {
                editorRef.current?.setValue("");
            }
        }
    };

    // Define custom theme
    useEffect(() => {
        if (monaco) {
            monaco.editor.defineTheme('console-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '8C8C8C', fontStyle: 'italic' },
                    { token: 'string', foreground: '7EC699' },
                    { token: 'number', foreground: 'B8A9FF' },
                    { token: 'keyword', foreground: 'FF9D76' },
                    { token: 'variable', foreground: 'F5F5F5' },
                    { token: 'function', foreground: '56B6F2' },
                    { token: 'delimiter', foreground: 'C9C9C9' },
                ],
                colors: {
                    'editor.background': '#181818',
                    'editor.foreground': '#F5F5F5',
                    'editor.lineNumbersBackground': '#181818',
                    'editor.lineNumbersForeground': '#8C8C8C',
                    'editor.lineHighlightBackground': '#202020',
                    'editor.selectionBackground': '#262626',
                    'editor.selectionForeground': '#F5F5F5',
                    'editor.inactiveSelectionBackground': '#242424',
                    'editor.cursorForeground': '#F5F5F5',
                    'editor.cursorLineBackground': '#202020',
                    'editorBracketMatch.background': '#242424',
                    'editorBracketMatch.border': '#2D2D2D',
                    'editorWhitespace.foreground': '#2D2D2D',
                    'editorIndentGuide.background': '#2D2D2D',
                    'editorIndentGuide.activeBackground': '#8C8C8C',
                    'editorError.foreground': '#FF6B6B',
                    'editorWarning.foreground': '#FFD93D',
                }
            });

            monaco.editor.defineTheme('console-light', {
                base: 'vs',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '737373', fontStyle: 'italic' },
                    { token: 'string', foreground: '148039' },
                    { token: 'number', foreground: '4B2CDE' },
                    { token: 'keyword', foreground: 'D03A00' },
                    { token: 'variable', foreground: '111111' },
                    { token: 'function', foreground: '0063A5' },
                    { token: 'delimiter', foreground: '525252' },
                ],
                colors: {
                    'editor.background': '#FFFFFF',
                    'editor.foreground': '#111111',
                    'editor.lineNumbersBackground': '#FFFFFF',
                    'editor.lineNumbersForeground': '#737373',
                    'editor.lineHighlightBackground': '#F5F5F5',
                    'editor.selectionBackground': '#EAEAEA',
                    'editor.selectionForeground': '#111111',
                    'editor.inactiveSelectionBackground': '#F3F4F6',
                    'editor.cursorForeground': '#111111',
                    'editor.cursorLineBackground': '#F5F5F5',
                    'editorBracketMatch.background': '#F3F4F6',
                    'editorBracketMatch.border': '#E5E5E5',
                    'editorWhitespace.foreground': '#E5E5E5',
                    'editorIndentGuide.background': '#E5E5E5',
                    'editorIndentGuide.activeBackground': '#737373',
                    'editorError.foreground': '#DC2626',
                    'editorWarning.foreground': '#D97706',
                }
            });
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
        if (isRunning || !editorRef.current) return;

        const currentCode = editorRef.current.getValue() ?? "";
        console.log(currentCode);
        setIsRunning(true);
        setIsOutputOpen(true);
        terminalRef.current?.clear();
        mobileTerminalRef.current?.clear();

        let clientTimeout: NodeJS.Timeout;

        try {
            const ws = new WebSocket(`ws://${window.location.hostname}:8080`);
            wsRef.current = ws;

            // 25 seconds safety timeout (5 seconds longer than worker limit)
            clientTimeout = setTimeout(() => {
                if (wsRef.current) {
                    const msg = `\r\n[ERROR]: Connection timed out (Server unresponsive).\r\n`;
                    terminalRef.current?.write(msg);
                    mobileTerminalRef.current?.write(msg);
                    wsRef.current.close();
                }
            }, 25000);

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
                console.log(chunk);

                const output = chunk.replace(/\n/g, "\r\n");
                terminalRef.current?.write(output);
                mobileTerminalRef.current?.write(output);
            }

            ws.onerror = (error) => {
                clearTimeout(clientTimeout);
                console.error('WebSocket error:', error);
                const msg = `\r\n[ERROR]: WebSocket connection failed\r\n`;
                terminalRef.current?.write(msg);
                mobileTerminalRef.current?.write(msg);
                setIsRunning(false);
                wsRef.current = null;
            }

            ws.onclose = () => {
                clearTimeout(clientTimeout);
                console.log('WebSocket connection closed');
                const msg = `\r\n[INFO]: Execution connection closed.\r\n`;
                terminalRef.current?.write(msg);
                mobileTerminalRef.current?.write(msg);
                setIsRunning(false);
                wsRef.current = null;
            }

        } catch (error) {
            if (clientTimeout!) clearTimeout(clientTimeout);
            console.log(error);
            const msg = `\r\n[ERROR]: ${error instanceof Error ? error.message : 'Failed to submit code'}\r\n`;
            terminalRef.current?.write(msg);
            mobileTerminalRef.current?.write(msg);
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
        terminalRef.current?.clear();
        mobileTerminalRef.current?.clear();
    };

    const handleTerminalInput = useCallback((line: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "stdin", data: line }));
        }
    }, []);

    return (
        <div className="relative w-full h-screen bg-bg border border-border shadow-2xl overflow-hidden flex flex-col transition-all duration-200">

            {/* ------------------------ HEADER ------------------------ */}

            <header className="shrink-0 px-4 sm:px-6 py-4 sm:py-5 border-b border-border bg-bg flex items-center justify-between">
                <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-3">
                        <TerminalSquare className="w-8 h-8 sm:w-9 sm:h-9 text-text" />
                        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-text leading-none font-mono">
                            Console
                        </h1>
                    </div>
                    <p className="text-[10px] sm:text-xs text-text-muted mt-2 font-medium tracking-[0.25em] uppercase">
                        online compiler
                    </p>
                </div>
                {onToggleTheme && (
                    <button
                        onClick={onToggleTheme}
                        className="p-2 rounded-md bg-surface-alt border border-border hover:bg-hover text-text flex items-center justify-center relative w-9 h-9 overflow-hidden"
                        aria-label="Toggle theme"
                    >
                        <Sun className={`w-4 h-4 absolute transition-all duration-500 transform ${isDark ? '-rotate-90 opacity-0 scale-50' : 'rotate-0 opacity-100 scale-100'}`} />
                        <Moon className={`w-4 h-4 absolute transition-all duration-500 transform ${isDark ? 'rotate-0 opacity-100 scale-100' : 'rotate-90 opacity-0 scale-50'}`} />
                    </button>
                )}
            </header>

            {/* ------------------------ TOOLBAR ------------------------ */}
            <div className="shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-border bg-surface flex items-center justify-between gap-4">

                {/* ------------------------ Dropdown ------------------------ */}
                <div className="relative shrink-0" ref={dropdownRef}>
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center justify-between min-w-35 px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-text bg-bg border border-border rounded-md hover:border-text focus:outline-none focus:border-text transition-all duration-150 group"
                        aria-expanded={isDropdownOpen}
                    >
                        <span>{selectedLang.name}</span>
                        <ChevronDown className={`w-3.5 h-3.5 ml-2 text-text-muted group-hover:text-text transition-transform duration-150 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Custom Dropdown Menu */}
                    {isDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-bg border border-border rounded-md shadow-xl py-1 z-50 text-xs">
                            {LANGUAGES.map((lang) => (
                                <button
                                    key={lang.id}
                                    onClick={() => handleLanguageSelect(lang)}
                                    className={`w-full text-left px-3 py-2 transition-colors duration-150 flex items-center justify-between ${selectedLang.id === lang.id
                                        ? 'bg-surface-alt text-text font-medium'
                                        : 'text-text-muted hover:bg-hover hover:text-text'
                                        }`}
                                >
                                    <span>{lang.name}</span>
                                    <span className="text-[10px] font-mono text-text-muted uppercase">{lang.extension}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ------------------------ RUN Button ------------------------ */}
                <div className="flex-1 flex justify-center">
                    <button
                        onClick={handleRun}
                        disabled={isRunning || !isEditorReady}
                        className="flex items-center justify-center gap-2 px-6 py-1.5 text-xs font-bold tracking-wider text-white bg-emerald-600 border border-emerald-500 rounded-md hover:bg-emerald-500 active:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-bg transition-all duration-300 disabled:opacity-50"
                    >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{isRunning ? 'RUNNING...' : 'RUN'}</span>
                    </button>
                </div>

                {/* ------------------------ CLEAR Button ------------------------ */}
                <div className="shrink-0">
                    <button
                        onClick={handleClear}
                        className="flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold tracking-wider text-text-muted bg-transparent border border-border rounded-md hover:text-text hover:border-text-muted hover:bg-hover active:bg-pressed focus:outline-none transition-all duration-150"
                    >
                        <Trash2 className="w-3 h-3" />
                        <span>CLEAR</span>
                    </button>
                </div>

            </div>

            {/* ------------------------ MAIN WORKSPACE ------------------------ */}
            <div className="grid grid-cols-1 md:grid-cols-2 flex-1 min-h-0 bg-bg relative overflow-hidden">

                {/*  ------------------------ LEFT PANEL ------------------------ */}
                <div className="flex flex-col min-h-0 overflow-hidden border-b md:border-b-0 md:border-r border-border bg-surface md:flex">
                    {/* Label */}
                    <div className="px-4 sm:px-6 py-2 border-b border-border bg-surface-alt flex items-center justify-between text-[11px] font-mono font-semibold tracking-wider text-text-muted">
                        <span className="uppercase">{selectedLang.label}</span>
                        <Code2 className="w-3.5 h-3.5 text-text-muted opacity-60" />
                    </div>

                    {/* Editor Input Area */}
                    <div className="relative flex-1 overflow-hidden">
                        <Editor
                            height="100%"
                            language={selectedLang.id}
                            onMount={handleEditorMount}
                            theme={isDark ? "console-dark" : "console-light"}
                            options={{
                                minimap: { enabled: false },
                                lineNumbers: 'on',
                                lineNumbersMinChars: 3,
                                lineDecorationsWidth: 10,
                                folding: false,
                                glyphMargin: false,
                                scrollBeyondLastLine: false,
                                fontFamily: '"JetBrains Mono", monospace',
                                fontSize: 14,
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
                            loading={<div className="w-full h-full bg-surface flex items-center justify-center text-text-muted">Loading editor...</div>}
                        />
                    </div>
                </div>

                {/* ------------------------ RIGHT PANEL: OUTPUT TERMINAL ------------------------*/}
                <div className="hidden md:flex flex-col min-h-0 overflow-hidden bg-surface-alt">
                    {/* Label */}
                    <div className="px-4 sm:px-6 py-2 border-b border-border bg-surface-alt flex items-center justify-between text-[11px] font-mono font-semibold tracking-wider text-text-muted">
                        <span>OUTPUT</span>
                        <Terminal className="w-3.5 h-3.5 text-text-muted opacity-60" />
                    </div>

                    {/* Terminal Screen */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <TerminalView ref={terminalRef} onData={handleTerminalInput} isDark={isDark}>
                        </TerminalView>
                    </div>
                </div>

            </div>

            {/* ------------------------ MOBILE OUTPUT MODAL ------------------------ */}
            {isOutputOpen && (
                <div className="absolute inset-0 md:hidden bg-black/50 z-50 flex flex-col">
                    <div className="flex-1 flex flex-col bg-surface-alt m-4 rounded-lg border border-border overflow-hidden">

                        <div className="px-4 py-3 border-b border-border bg-surface-alt flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[11px] font-mono font-semibold tracking-wider text-text-muted">
                                <Terminal className="w-3.5 h-3.5 text-text-muted opacity-60" />
                                <span>OUTPUT</span>
                            </div>
                            <button
                                onClick={() => {
                                    setIsOutputOpen(false)
                                }}
                                className="p-1 hover:bg-hover rounded transition-colors"
                                aria-label="Close output"
                            >
                                <svg className="w-5 h-5 text-text-muted hover:text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <TerminalView ref={mobileTerminalRef} onData={handleTerminalInput} isDark={isDark}></TerminalView>
                    </div>
                </div>
            )}

            {/* ------------------------ FOOTER ------------------------ */}
            <footer className="relative shrink-0 px-4 py-1.5 border-t border-border bg-surface-alt flex items-center justify-between text-[10px] font-mono text-text-muted">
                <div className="flex items-center gap-2 z-10">
                    <span className="w-2 h-2 rounded-full bg-emerald-500/80 animate-pulse"></span>
                    <span>READY</span>
                </div>

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none tracking-widest uppercase">
                    <span>Build by <span className="font-bold text-text">Harshit</span></span>
                </div>

                <div className="flex items-center gap-4 z-10">
                    <span>UTF-8</span>
                    <span>2 SPACES</span>
                </div>
            </footer>

        </div>
    );
}

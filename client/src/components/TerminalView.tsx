// Terminal.tsx
import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
    onData?: (line: string) => void; // called when user hits Enter
}

export interface TerminalHandle {
    write: (data: string) => void;
    clear: () => void;
}

const TerminalView = React.forwardRef<TerminalHandle, TerminalProps>(
    ({ onData }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const xtermRef = useRef<XTerm | null>(null);
        const fitAddonRef = useRef<FitAddon | null>(null);
        const lineBufferRef = useRef<string>("");
        const onDataRef = useRef(onData);

        useEffect(() => {
            onDataRef.current = onData;
        }, [onData]);

        useEffect(() => {
            if (!containerRef.current) return;

            const term = new XTerm({
                cursorBlink: true,
                fontSize: 16,
                theme: {
                    background: "#151A21",
                    foreground: "#FAF9F6",
                },
            });

            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);

            term.open(containerRef.current);
            fitAddon.fit();

            //   term.writeln("Welcome to the terminal");
            //   term.write("$ ");

            // Handle keystrokes
            term.onData((data) => {
                const code = data.charCodeAt(0);

                if (code === 13) {
                    // Enter key
                    const line = lineBufferRef.current;
                    term.write("\r\n");
                    onDataRef.current?.(line);
                    lineBufferRef.current = "";
                    // term.write("$ ");
                } else if (code === 127) {
                    // Backspace
                    if (lineBufferRef.current.length > 0) {
                        lineBufferRef.current = lineBufferRef.current.slice(0, -1);
                        term.write("\b \b");
                    }
                } else if (code < 32) {
                    // ignore other control chars (arrows, ctrl combos, etc.)
                } else {
                    lineBufferRef.current += data;
                    term.write(data);
                }
            });

            xtermRef.current = term;
            fitAddonRef.current = fitAddon;

            const resizeObserver = new ResizeObserver(() => fitAddon.fit());
            resizeObserver.observe(containerRef.current);

            // Resize handling
            const handleResize = () => fitAddon.fit();
            window.addEventListener("resize", handleResize);

            return () => {
                resizeObserver.disconnect();
                window.removeEventListener("resize", handleResize);
                term.dispose();
            };
        }, []);

        // Expose imperative write method to parent
        React.useImperativeHandle(ref, () => ({
            write: (data: string) => {
                xtermRef.current?.write(data);
            },
            clear: () => {
                xtermRef.current?.clear();
                lineBufferRef.current = "";
            },

        }));

        return (
            <div
                ref={containerRef}
                className="h-full w-full p-4 box-border"
            />
        );
    }
);

export default TerminalView;
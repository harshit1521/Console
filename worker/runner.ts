import { spawn, exec } from "child_process";
import fs from "fs";

export interface RunnerOptions {
    command: string;
    args: string[];
    inputChannel: string;
    outputChannel: string;
    cleanup: () => Promise<void> | void;
}

/**
 * Forcefully terminates a child process and its children.
 * Uses taskkill on Windows to clean up process trees (important for JVM/Python processes).
 */
function safeKill(child: any) {
    if (process.platform === "win32") {
        exec(`taskkill /pid ${child.pid} /f /t`, (err) => {
            if (err) {
                console.error(`taskkill error for PID ${child.pid}:`, err);
                child.kill("SIGKILL"); // fallback
            }
        });
    } else {
        child.kill("SIGKILL");
    }
}

/**
 * Handles executing a child process, managing stream backpressure, execution timeouts,
 * stdin inputs, process lifecycle events, and final cleanup.
 */
export async function executeProcess(
    redis: any,
    inputClient: any,
    options: RunnerOptions
): Promise<void> {
    const { command, args, inputChannel, outputChannel, cleanup } = options;
    const child = spawn(command, args);
    let timeout = 20000;
    let isTerminated = false;
    let outputSize = 0;
    const MAX_OUTPUT_SIZE = 5 * 1024 * 1024; // 5MB limit

    // Register stream listeners synchronously (to prevent missing stdout/stderr)
    child.stdout.on("data", async (chunk) => {
        if (isTerminated) return;
        child.stdout.pause();
        try {
            await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() }));
        } catch (err) {
            console.error("Redis publish error on stdout:", err);
        }

        outputSize += chunk.length;
        if (outputSize > MAX_OUTPUT_SIZE) {
            isTerminated = true;
            safeKill(child);
            try {
                await redis.publish(outputChannel, JSON.stringify({ 
                    type: "stderr", 
                    data: "\n[ERROR]: Output limit exceeded." 
                }));
            } catch (err) {
                console.error(err);
            }
        }

        if (!isTerminated) {
            child.stdout.resume();
        }
    });

    child.stderr.on("data", async (chunk) => {
        if (isTerminated) return;
        child.stderr.pause();
        try {
            await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() }));
        } catch (err) {
            console.error("Redis publish error on stderr:", err);
        }

        if (!isTerminated) {
            child.stderr.resume();
        }
    });

    // Timeout setup to prevent hanging processes
    let timer = setTimeout(() => { 
        isTerminated = true;
        safeKill(child); 
    }, timeout);

    let warningTimer = setTimeout(() => {
        redis.publish(outputChannel, JSON.stringify({ 
            type: "warning", 
            data: "Execution taking longer than expected, will be terminated in 5s..." 
        }));
    }, timeout - 5000);

    await new Promise<void>(async (resolve) => {
        child.on("error", async (err) => {
            isTerminated = true;
            console.error(`Runtime spawn error: ${err.message}`);
            await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: `Runtime Error: ${err.message}` }));
            await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
            
            try {
                await inputClient.unsubscribe(inputChannel);
                await cleanup();
            } catch (error) {
                console.log(`cleanup err on error: ${error}`);
            }
            
            clearTimeout(timer);
            clearTimeout(warningTimer);
            resolve();
        });

        child.on("close", async (exitCode) => {
            console.log(`execution completed ...`);

            try {
                await inputClient.unsubscribe(inputChannel);
                await cleanup();
            } catch (error) {
                console.log(`unsubscribe err: ${error}`);
            }

            await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
            clearTimeout(timer);
            clearTimeout(warningTimer);
            resolve();
        });

        // Subscribe to input/kill channel asynchronously after all stream/exit listeners are registered
        try {
            await inputClient.subscribe(inputChannel, (message: any) => {
                const response = JSON.parse(message.toString());

                if (response.type === "kill") {
                    isTerminated = true;
                    safeKill(child);
                } else if (response.type === "stdin") {
                    child.stdin.write(`${response.data}\n`);
                    
                    clearTimeout(timer);
                    clearTimeout(warningTimer);
                    
                    timer = setTimeout(() => {
                        isTerminated = true;
                        safeKill(child);
                    }, timeout);

                    warningTimer = setTimeout(() => {
                        redis.publish(outputChannel, JSON.stringify({ 
                            type: "warning", 
                            data: "Execution taking longer than expected, will be terminated in 5s..." 
                        }));
                    }, timeout - 5000);
                }
            });
        } catch (error) {
            console.log(`input channel err: ${error}`);
        }
    });
}

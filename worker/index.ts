import "dotenv/config"
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "redis";
import { spawn } from "child_process";
import { log } from "console";

// primary redis client for regular operations like , publish , lpush , brpop etc ..
const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

// secondary redis client for subscription only ( no other regular operations are allowed, if its in subscription mode ...)
const subClient = redis.duplicate();
await subClient.connect()
    .then(async () => {
        console.log(`worker started !!`);

        while (1) {

            // ---------------- fetch task from queue ----------------
            const response = await redis.brPop("task", 0);
            if (!response) continue;

            // ---------------- extract data ----------------
            const { code, language, id } = JSON.parse(response.element);

            // ---------------- language selection & exectution ----------------
            if (language === "JAVASCRIPT") {
                console.log(`started javascript code execution ...`);

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const filePath = path.join(__dirname, "code", `${id}.mjs`);
                
                // Write user code to temporary file
                fs.writeFileSync(filePath, code);

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;
                const child = spawn("node", [filePath]);

                let timeout = 20000;
                let isTerminated = false;

                // 1. Immediately register stream listeners synchronously (to prevent missing stdout/stderr)
                let outputSize = 0;
                const MAX_OUTPUT_SIZE = 5 * 1024 * 1024; // 5MB limit

                child.stdout.on("data", async (chunk) => {
                    if (isTerminated) return;
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() }));

                    outputSize += chunk.length;
                    if (outputSize > MAX_OUTPUT_SIZE) {
                        isTerminated = true;
                        child.kill("SIGKILL");
                        await redis.publish(outputChannel, JSON.stringify({ 
                            type: "stderr", 
                            data: "\n[ERROR]: Output limit exceeded." 
                        }));
                    }
                });

                child.stderr.on("data", async (chunk) => {
                    if (isTerminated) return;
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() }));
                });

                // Timeout setup to prevent hanging processes
                let timer = setTimeout(() => { 
                    isTerminated = true;
                    child.kill("SIGKILL"); 
                }, timeout);

                let warningTimer = setTimeout(() => {
                    redis.publish(outputChannel, JSON.stringify({ 
                        type: "warning", 
                        data: "Execution taking longer than expected, will be terminated in 5s..." 
                    }));
                }, timeout - 5000);

                // 2. Wrap process execution lifecycle in a Promise and register process events synchronously inside the executor
                await new Promise<void>(async (resolve) => {
                    child.on("error", async (err) => {
                        isTerminated = true;
                        console.error(`Runtime spawn error: ${err.message}`);
                        await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: `Runtime Error: ${err.message}` }));
                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        
                        try {
                            await subClient.unsubscribe(inputChannel);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
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
                            await subClient.unsubscribe(inputChannel);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        } catch (error) {
                            console.log(`unsubscribe err: ${error}`);
                        }

                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        clearTimeout(timer);
                        clearTimeout(warningTimer);
                        resolve();
                    });

                    // 3. Subscribe to input/kill channel asynchronously after all listeners are safely attached
                    try {
                        await subClient.subscribe(inputChannel, (message) => {
                            const response = JSON.parse(message.toString());

                            if (response.type === "kill") {
                                isTerminated = true;
                                child.kill("SIGKILL");
                            } else if (response.type === "stdin") {
                                child.stdin.write(`${response.data}\n`);
                                
                                // Reset timers on receiving stdin
                                clearTimeout(timer);
                                clearTimeout(warningTimer);
                                
                                timer = setTimeout(() => {
                                    isTerminated = true;
                                    child.kill("SIGKILL");
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

            if (language === "PYTHON") {


                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const filePath = path.join(__dirname, "code", `${id}.py`); // create .py file for each task
                fs.writeFileSync(filePath, code); // write code to file 

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;
                const child = spawn("python", ["-u", filePath]); // start node process 
                console.log(`started python code execution ...`);

                let timeout = 20000;
                let timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout); // kill process if blocks thread 
                let warningTimer = setTimeout(() => {
                    // a few seconds before the hard kill
                    redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                }, timeout - 5000);
                // subscribe to kill channel ONCE (not per-chunk)   
                try {
                    await subClient.subscribe(inputChannel, (message) => {

                        const response = JSON.parse(message.toString());

                        if (response.type === "kill") {

                            child.kill("SIGKILL");
                        } else if (response.type === "stdin") {

                            child.stdin.write(`${response.data}\n`); // that \n is the imp part ...
                            clearTimeout(timer);
                            clearTimeout(warningTimer);
                            timer = setTimeout(() => child.kill("SIGKILL"), timeout);
                            warningTimer = setTimeout(() => {

                                redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                            }, timeout - 5000);
                        }
                    })
                } catch (error) {
                    console.log(`input channel err: ${error}`);
                }

                child.stdout.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() })) // publish each chunk for read
                })

                child.stderr.on("data", async (chunk) => {

                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() })); // publish err for read
                })

                await new Promise<void>((resolve) => {

                    child.on("close", async (exitCode) => {

                        console.log(`execution completed ...`);

                        // cleanup: unsubscribe from kill channel
                        try {
                            await subClient.unsubscribe(inputChannel);
                        } catch (error) {
                            console.log(`unsubscribe err: ${error}`);
                        }

                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        fs.unlinkSync(filePath);

                        clearTimeout(timer);
                        clearTimeout(warningTimer);
                        resolve();
                    })
                })
            }

            if (language === "TYPESCRIPT") {

                console.log(`started typescript code execution ...`);

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const executionDir = path.join(os.tmpdir(), "console-executions");
                fs.mkdirSync(executionDir, { recursive: true });
                const filePath = path.join(executionDir, `${id}.ts`);
                fs.writeFileSync(filePath, code);

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;
                console.log("starting child process");
                const tsxCliPath = path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs");
                const child = spawn(process.execPath, [tsxCliPath, filePath]); // tsx runs ts directly, no separate compile step
                console.log("started process");

                let timeout = 20000;
                let timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout);
                let warningTimer = setTimeout(() => {
                    redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                }, timeout - 5000);

                try {
                    await subClient.subscribe(inputChannel, (message) => {
                        const response = JSON.parse(message.toString());

                        if (response.type === "kill") {
                            child.kill("SIGKILL");
                        } else if (response.type === "stdin") {
                            child.stdin.write(`${response.data}\n`);
                            clearTimeout(timer);
                            clearTimeout(warningTimer);
                            timer = setTimeout(() => child.kill("SIGKILL"), timeout);
                            warningTimer = setTimeout(() => {
                                redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                            }, timeout - 5000);
                        }
                    });
                } catch (error) {
                    console.log(`input channel err: ${error}`);
                }
                console.log("done with subscription .....")
                child.stdout.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() }));
                });

                child.stderr.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() }));
                });

                await new Promise<void>((resolve) => {
                    child.on("close", async (exitCode) => {
                        console.log(`execution completed ...`);

                        try {
                            await subClient.unsubscribe(inputChannel);
                        } catch (error) {
                            console.log(`unsubscribe err: ${error}`);
                        }

                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        fs.unlinkSync(filePath);
                        clearTimeout(timer);
                        clearTimeout(warningTimer);
                        resolve();
                    });
                });
            }

            if (language === "C++") {

                console.log(`started cpp code execution ...`);

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const sourcePath = path.join(__dirname, "code", `${id}.cpp`);
                const outPath = path.join(__dirname, "code", `${id}.out`);
                fs.writeFileSync(sourcePath, code);

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;

                // ---------------- compile step ----------------
                const compile = spawn("g++", [sourcePath, "-o", outPath, "-O0", "-pipe", "-s"]);
                let compileErr = "";

                compile.stderr.on("data", (chunk) => { compileErr += chunk.toString(); });

                const compileExitCode = await new Promise<number>((resolve) => {
                    compile.on("close", (code) => resolve(code ?? 1));
                });

                if (compileExitCode !== 0) {
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: compileErr }));
                    await redis.publish(outputChannel, JSON.stringify({ type: "done", status: "COMPILE_ERROR" }));
                    fs.unlinkSync(sourcePath);
                    continue; // skip execution entirely, move to next job in queue
                }

                // ---------------- execution step ----------------
                const child = spawn(outPath, []);

                let timeout = 20000;
                let timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout);
                let warningTimer = setTimeout(() => {
                    redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                }, timeout - 5000);

                try {
                    await subClient.subscribe(inputChannel, (message) => {
                        const response = JSON.parse(message.toString());

                        if (response.type === "kill") {
                            child.kill("SIGKILL");
                        } else if (response.type === "stdin") {
                            child.stdin.write(`${response.data}\n`);
                            clearTimeout(timer);
                            clearTimeout(warningTimer);
                            timer = setTimeout(() => child.kill("SIGKILL"), timeout);
                            warningTimer = setTimeout(() => {
                                redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                            }, timeout - 5000);
                        }
                    });
                } catch (error) {
                    console.log(`input channel err: ${error}`);
                }

                child.stdout.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() }));
                });

                child.stderr.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() }));
                });

                await new Promise<void>((resolve) => {
                    child.on("close", async (exitCode) => {
                        console.log(`execution completed ...`);

                        try {
                            await subClient.unsubscribe(inputChannel);
                        } catch (error) {
                            console.log(`unsubscribe err: ${error}`);
                        }

                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        fs.unlinkSync(sourcePath);
                        if (fs.existsSync(outPath)) fs.unlinkSync(outPath); // clean up compiled binary too
                        clearTimeout(timer);
                        clearTimeout(warningTimer);
                        resolve();
                    });
                });
            }

            if (language === "JAVA") {

                console.log(`started java code execution ...`);

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                // Java requires the file name to match the public class name exactly.
                // Safest bet: force the class name to "Main" and require users to name their public class Main,
                // OR extract the class name from the code. Simpler approach shown here: fixed "Main".
                const className = "Main";
                const codeDir = path.join(__dirname, "code", id); // separate folder per job since javac drops a .class file alongside
                fs.mkdirSync(codeDir, { recursive: true });
                const sourcePath = path.join(codeDir, `${className}.java`);
                fs.writeFileSync(sourcePath, code);

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;

                // ---------------- compile step ----------------
                const compile = spawn("javac", [sourcePath]);
                let compileErr = "";

                compile.stderr.on("data", (chunk) => { compileErr += chunk.toString(); });

                const compileExitCode = await new Promise<number>((resolve) => {
                    compile.on("close", (code) => resolve(code ?? 1));
                });

                if (compileExitCode !== 0) {
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: compileErr }));
                    await redis.publish(outputChannel, JSON.stringify({ type: "done", status: "COMPILE_ERROR" }));
                    fs.rmSync(codeDir, { recursive: true, force: true });
                    continue;
                }

                // ---------------- execution step ----------------
                const child = spawn("java", ["-cp", codeDir, className]);

                let timeout = 20000;
                let timer = setTimeout(() => { child.kill("SIGKILL"); }, timeout);
                let warningTimer = setTimeout(() => {
                    redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                }, timeout - 5000);

                try {
                    await subClient.subscribe(inputChannel, (message) => {
                        const response = JSON.parse(message.toString());

                        if (response.type === "kill") {
                            child.kill("SIGKILL");
                        } else if (response.type === "stdin") {
                            child.stdin.write(`${response.data}\n`);
                            clearTimeout(timer);
                            clearTimeout(warningTimer);
                            timer = setTimeout(() => child.kill("SIGKILL"), timeout);
                            warningTimer = setTimeout(() => {
                                redis.publish(outputChannel, JSON.stringify({ type: "warning", data: "Execution taking longer than expected, will be terminated in 5s..." }));
                            }, timeout - 5000);
                        }
                    });
                } catch (error) {
                    console.log(`input channel err: ${error}`);
                }

                child.stdout.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stdout", data: chunk.toString() }));
                });

                child.stderr.on("data", async (chunk) => {
                    console.log(chunk.toString());
                    await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: chunk.toString() }));
                });

                await new Promise<void>((resolve) => {
                    child.on("close", async (exitCode) => {
                        console.log(`execution completed ...`);

                        try {
                            await subClient.unsubscribe(inputChannel);
                        } catch (error) {
                            console.log(`unsubscribe err: ${error}`);
                        }

                        await redis.publish(outputChannel, JSON.stringify({ type: "done" }));
                        fs.rmSync(codeDir, { recursive: true, force: true }); // removes .java and .class files together
                        clearTimeout(timer);
                        clearTimeout(warningTimer);
                        resolve();
                    });
                });
            }

        }
    })

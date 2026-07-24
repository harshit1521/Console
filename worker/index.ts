import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { redis, inputClient } from "./redis.ts";
import { spawn } from "child_process";
import { executeProcess } from "./runner.js";


// Primary redis client for regular operations like publish, lpush, brpop etc.
await redis.connect();

// Secondary redis client for subscription only
await inputClient.connect();
console.log(`worker started !!`);

while (1) {
    // ---------------- fetch task from queue ----------------
    const response = await redis.brPop("task", 0);
    if (!response) continue;

    // ---------------- extract data ----------------
    const { code, language, id } = JSON.parse(response.element);

    // Check if the connection session is still active
    const isActive = await redis.get(`active:${id}`);
    if (!isActive) {
        console.log(`Task ${id} is no longer active (client disconnected). Skipping execution.`);
        continue;
    }

    const inputChannel = `input:${id}`;
    const outputChannel = `output:${id}`;

    // ---------------- language selection & execution ----------------

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const hostCodeDir = path.resolve(__dirname, "code");

    if (language === "JAVASCRIPT") {
        console.log(`started sandboxed javascript code execution ...`);

        const filePath = path.join(hostCodeDir, `${id}.mjs`);
        fs.writeFileSync(filePath, code);

        await executeProcess(redis, inputClient, {
            command: "docker",
            args: [
                "run", "--rm", "-i",
                "--network", "none",
                "--memory=256m",
                "--cpus=0.5",
                "-v", `${hostCodeDir}:/app`,
                "-w", "/app",
                "node:20-slim",
                "node", `${id}.mjs`
            ],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "PYTHON") {
        console.log(`started sandboxed python code execution ...`);

        const filePath = path.join(hostCodeDir, `${id}.py`);
        fs.writeFileSync(filePath, code);

        await executeProcess(redis, inputClient, {
            command: "docker",
            args: [
                "run", "--rm", "-i",
                "--network", "none",
                "--memory=256m",
                "--cpus=0.5",
                "-v", `${hostCodeDir}:/app`,
                "-w", "/app",
                "python:3.11-slim",
                "python3", "-u", `${id}.py`
            ],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "TYPESCRIPT") {
        console.log(`started sandboxed typescript code execution ...`);

        const filePath = path.join(hostCodeDir, `${id}.ts`);
        fs.writeFileSync(filePath, code);

        await executeProcess(redis, inputClient, {
            command: "docker",
            args: [
                "run", "--rm", "-i",
                "--network", "none",
                "--memory=256m",
                "--cpus=0.5",
                "-v", `${hostCodeDir}:/app`,
                "-w", "/app",
                "node:20-slim",
                "npx", "-y", "tsx", `${id}.ts`
            ],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "C++") {
        console.log(`started sandboxed cpp code execution ...`);

        const sourcePath = path.join(hostCodeDir, `${id}.cpp`);
        const outPath = path.join(hostCodeDir, `${id}.out`);

        fs.writeFileSync(sourcePath, code);

        // Compile step in a compiler container
        const compile = spawn("docker", [
            "run", "--rm",
            "-v", `${hostCodeDir}:/app`,
            "-w", "/app",
            "gcc:13",
            "g++", `${id}.cpp`, "-o", `${id}.out`, "-O0", "-pipe", "-s"
        ]);
        let compileErr = "";

        compile.stderr.on("data", (chunk) => { compileErr += chunk.toString(); });

        const compileExitCode = await new Promise<number>((resolve) => {
            compile.on("close", (code) => resolve(code ?? 1));
        });

        if (compileExitCode !== 0) {
            await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: compileErr }));
            await redis.publish(outputChannel, JSON.stringify({ type: "done", status: "COMPILE_ERROR" }));
            try {
                if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
            } catch (e) {
                console.error("Compile cleanup error:", e);
            }
            continue;
        }

        // Execution step in isolated container
        await executeProcess(redis, inputClient, {
            command: "docker",
            args: [
                "run", "--rm", "-i",
                "--network", "none",
                "--memory=256m",
                "--cpus=0.5",
                "-v", `${hostCodeDir}:/app`,
                "-w", "/app",
                "gcc:13",
                `./${id}.out`
            ],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }
        });
    }

    if (language === "JAVA") {
        console.log(`started sandboxed java code execution ...`);

        const className = "Main";
        const taskDir = path.join(hostCodeDir, id);
        fs.mkdirSync(taskDir, { recursive: true });
        const sourcePath = path.join(taskDir, `${className}.java`);

        fs.writeFileSync(sourcePath, code);

        // Compile step
        const compile = spawn("docker", [
            "run", "--rm",
            "-v", `${hostCodeDir}:/app`,
            "-w", "/app",
            "eclipse-temurin:21-jdk-jammy",
            "javac", `${id}/${className}.java`
        ]);
        let compileErr = "";

        compile.stderr.on("data", (chunk) => { compileErr += chunk.toString(); });

        const compileExitCode = await new Promise<number>((resolve) => {
            compile.on("close", (code) => resolve(code ?? 1));
        });

        if (compileExitCode !== 0) {
            await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: compileErr }));
            await redis.publish(outputChannel, JSON.stringify({ type: "done", status: "COMPILE_ERROR" }));
            try {
                if (fs.existsSync(taskDir)) fs.rmSync(taskDir, { recursive: true, force: true });
            } catch (e) {
                console.error("Compile cleanup error:", e);
            }
            continue;
        }

        // Execution step
        await executeProcess(redis, inputClient, {
            command: "docker",
            args: [
                "run", "--rm", "-i",
                "--network", "none",
                "--memory=512m",
                "--cpus=0.5",
                "-v", `${hostCodeDir}:/app`,
                "-w", "/app",
                "eclipse-temurin:21-jdk-jammy",
                "java", "-cp", id, className
            ],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(taskDir)) fs.rmSync(taskDir, { recursive: true, force: true });
            }
        });
    }
}

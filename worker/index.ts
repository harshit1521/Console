import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "redis";
import { spawn } from "child_process";
import { executeProcess } from "./runner.js";

// Primary redis client for regular operations like publish, lpush, brpop etc.
const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

// Secondary redis client for subscription only
const inputClient = redis.duplicate();
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

    if (language === "JAVASCRIPT") {
        console.log(`started javascript code execution ...`);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const filePath = path.join(__dirname, "code", `${id}.mjs`);
        
        fs.writeFileSync(filePath, code);

        await executeProcess(redis, inputClient, {
            command: "node",
            args: [filePath],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "PYTHON") {
        console.log(`started python code execution ...`);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const filePath = path.join(__dirname, "code", `${id}.py`);
        
        fs.writeFileSync(filePath, code);

        await executeProcess(redis, inputClient, {
            command: "python",
            args: ["-u", filePath],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "TYPESCRIPT") {
        console.log(`started typescript code execution ...`);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        const executionDir = path.join(os.tmpdir(), "console-executions");
        fs.mkdirSync(executionDir, { recursive: true });
        const filePath = path.join(executionDir, `${id}.ts`);
        
        fs.writeFileSync(filePath, code);

        const tsxCliPath = path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs");

        await executeProcess(redis, inputClient, {
            command: process.execPath,
            args: [tsxCliPath, filePath],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });
    }

    if (language === "C++") {
        console.log(`started cpp code execution ...`);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const sourcePath = path.join(__dirname, "code", `${id}.cpp`);
        const outPath = path.join(__dirname, "code", `${id}.out`);
        
        fs.writeFileSync(sourcePath, code);

        // Compile step
        const compile = spawn("g++", [sourcePath, "-o", outPath, "-O0", "-pipe", "-s"]);
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

        // Execution step
        await executeProcess(redis, inputClient, {
            command: outPath,
            args: [],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
                if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
            }
        });
    }

    if (language === "JAVA") {
        console.log(`started java code execution ...`);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        
        const className = "Main";
        const codeDir = path.join(__dirname, "code", id); 
        fs.mkdirSync(codeDir, { recursive: true });
        const sourcePath = path.join(codeDir, `${className}.java`);
        
        fs.writeFileSync(sourcePath, code);

        // Compile step
        const compile = spawn("javac", [sourcePath]);
        let compileErr = "";

        compile.stderr.on("data", (chunk) => { compileErr += chunk.toString(); });

        const compileExitCode = await new Promise<number>((resolve) => {
            compile.on("close", (code) => resolve(code ?? 1));
        });

        if (compileExitCode !== 0) {
            await redis.publish(outputChannel, JSON.stringify({ type: "stderr", data: compileErr }));
            await redis.publish(outputChannel, JSON.stringify({ type: "done", status: "COMPILE_ERROR" }));
            try {
                if (fs.existsSync(codeDir)) fs.rmSync(codeDir, { recursive: true, force: true });
            } catch (e) {
                console.error("Compile cleanup error:", e);
            }
            continue;
        }

        // Execution step
        await executeProcess(redis, inputClient, {
            command: "java",
            args: ["-cp", codeDir, className],
            inputChannel,
            outputChannel,
            cleanup: () => {
                if (fs.existsSync(codeDir)) fs.rmSync(codeDir, { recursive: true, force: true });
            }
        });
    }
}

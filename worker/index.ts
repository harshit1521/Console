import "dotenv/config"
import fs from "fs";
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

                const filePath = path.join(__dirname, "code", `${id}.mjs`); // create js file for each task
                fs.writeFileSync(filePath, code); // write code to file 

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;
                const child = spawn("node", [filePath]); // start node process 

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
                        clearTimeout(timer)
                        clearTimeout(warningTimer)
                        resolve();
                    })
                })
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



        }
    })
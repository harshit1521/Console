import "dotenv/config"
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "redis";
import { spawn } from "child_process";

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

                console.log(`started code execution ...`);

                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const filePath = path.join(__dirname, "code", `${id}.js`); // create js file for each task
                fs.writeFileSync(filePath, code); // write code to file 

                const inputChannel = `input:${id}`;
                const outputChannel = `output:${id}`;
                const child = spawn("node", [filePath]); // start node process 

                // subscribe to kill channel ONCE (not per-chunk)
                try {
                    await subClient.subscribe(inputChannel, (message) => {
                        const response = JSON.parse(message.toString());
                        if (response.type === "kill") {
                            child.kill("SIGKILL");
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

                        resolve();
                    })
                })
            }




        }
    })
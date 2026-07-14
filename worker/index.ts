import "dotenv/config"
import { prisma } from "./db";
import { createClient } from "redis";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { exitCode, stdout } from "process";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect()
    .then(async () => {
        console.log(`worker started !!`);
        
        while (1) {
            // fetch task from queue 
            const response = await redis.brPop("task", 0);
            if (!response) continue;

            const { code , language , id } = JSON.parse(response.element);

            if (language === "JAVASCRIPT") {

                console.log(`started code execution ...`);
                
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const filePath = path.join(__dirname, "code", `${id}.js`); // create js file for each task
                fs.writeFileSync(filePath, code); // write code to file 

                const channel = `output:${id}`;
                const child = spawn("node", [filePath]); // start node process 

                child.stdout.on("data", async (chunk) => {

                    console.log(chunk.toString());
                    
                    await redis.publish(channel, JSON.stringify({ type: "stdout", data: chunk.toString() })) // publish each chunk for read
                })

                child.stderr.on("data", async (chunk) => {
                    
                    console.log(chunk.toString());
                    await redis.publish(channel, JSON.stringify({ type: "stderr", data: chunk.toString() })) // publish err for read
                })

                await new Promise<void>((resolve) => {

                    child.on("close", async (exitCode) => {

                        console.log(`execution completed ...`);
                        
                        await redis.publish(channel, JSON.stringify({ type: "done", data: `Execution completed` }));
                        fs.unlinkSync(filePath);

                        resolve();
                    })
                })
            }




        }
    })
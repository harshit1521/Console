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

            const { submissionId } = JSON.parse(response.element);

            // fetch code from db by using submissionId
            const submission = await prisma.submission.findUnique({ where: { id: submissionId } })
            if (!submission) throw new Error("no submission data available...");

            const { code, language } = submission;
            let Output = "";

            if (language === "JAVASCRIPT") {

                console.log(`started code execution ...`);
                
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);

                const filePath = path.join(__dirname, "code", `${submissionId}.js`); // create js file for each task
                fs.writeFileSync(filePath, code); // write code to file 

                const channel = `submission:${submissionId}`;
                const child = spawn("node", [filePath]); // start node process 

                // const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10000); // kill process if blocks thread 

                child.stdout.on("data", async (chunk) => {

                    Output += chunk.toString();
                    console.log(chunk.toString());
                    
                    await redis.publish(channel, JSON.stringify({ type: "stdout", data: chunk.toString() })) // publish each chunk for read
                })

                child.stderr.on("data", async (chunk) => {
                    
                    console.log(chunk.toString());
                    await redis.publish(channel, JSON.stringify({ type: "stderr", data: chunk.toString() })) // publish err for read
                })

                await new Promise<void>((resolve) => {

                    child.on("close", async (exitCode) => {

                        // clearTimeout(timer); // clears proccess timer killer 
                        const status = exitCode === 0 ? "SUCCESS" : "INTERNAL_ERROR";

                        // update database
                        await prisma.submission.update({ 
                            where: { id: submissionId },
                            data: { status, output: Output }
                        })

                        console.log(`execution completed ...`);
                        
                        await redis.publish(channel, JSON.stringify({ type: "done", data: `Execution completed` }));
                        fs.unlinkSync(filePath);

                        resolve();
                    })
                })
            }




        }
    })
import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { createClient } from "redis";
import { stat } from "node:fs";
import { WebSocketServer } from "ws";
import { Socket } from "node:dgram";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

const subClient = redis.duplicate();
await subClient.connect();

const app = express();

app.use(express.json());
app.use(cors());

app.post("/submission", async (req, res) => {
    const { code, language } = req.body;

    const response = await prisma.submission.create({
        data: {
            code,
            language,
            status: "PROCESSING"
        }
    })

    res.json({
        submissionId: response.id,
        status: response.status
    })
})

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", async (socket) => {
    console.log("new client connected");

    let activeSubmissionId: string | null = null;
    socket.on("message", async (data) => {
        const submissionId = data.toString().trim();
        activeSubmissionId = submissionId;
        console.log(submissionId);

        try {

            await redis.subscribe(`submission:${submissionId}`, (message) => {

                let response = JSON.parse(message);
                socket.send(response.data);
                console.log(response.data);


                if (response.type === "done") {
                    socket.close();
                }

            })

            await redis.lPush("task", JSON.stringify({ submissionId }));
        } catch (error) {
            console.log(error)
        }
    });

    socket.on("close", async () => {
        console.log("WebSocket connection closed, cleaning up Redis client");
        try {

            subClient.unsubscribe(`submission:${activeSubmissionId}`);
        } catch (error) {
            console.error(`Failed to unsubscribe from channel submission:${activeSubmissionId}:`, error);
        }
    })

})






app.listen("3000", () => {
    console.log(`server is listening at port: 3000`)
})
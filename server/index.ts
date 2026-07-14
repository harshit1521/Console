import "dotenv/config";
import { WebSocketServer } from "ws";
import { createClient } from "redis";
import { randomUUID } from "node:crypto";
// import express from "express";
// import cors from "cors";
// import { prisma } from "./db";
// import { stat } from "node:fs";
// import { Socket } from "node:dgram";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

const subClient = redis.duplicate();
await subClient.connect();

// const app = express();

// app.use(express.json());
// app.use(cors());

// app.post("/submission", async (req, res) => {
//     const { code, language } = req.body;

//     const response = await prisma.submission.create({
//         data: {
//             code,
//             language,
//             status: "PROCESSING"
//         }
//     })

//     res.json({
//         submissionId: response.id,
//         status: response.status
//     })
// })

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", async (socket) => {
    console.log("new client connected");
    const id = randomUUID();

    socket.on("message", async (data) => {

        const { code, language } = JSON.parse(data.toString());

        console.log(code);
        try {

            await redis.subscribe(`output:${id}`, (message) => {

                let response = JSON.parse(message);
                socket.send(response.data);
                console.log(response.data);


                if (response.type === "done") {
                    socket.close();
                }

            })

            await redis.lPush("task", JSON.stringify({ code, language, id }));
        } catch (error) {
            console.log(error)
        }   
    });

    socket.on("close", async () => {
        console.log("WebSocket connection closed, cleaning up Redis client");
        try {

            subClient.unsubscribe(`submission:${id}`);
        } catch (error) {
            console.error(`Failed to unsubscribe from channel submission:${id}:`, error);
        }
    })

})






// app.listen("3000", () => {
//     console.log(`server is listening at port: 3000`)
// })
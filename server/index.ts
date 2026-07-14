import "dotenv/config";
import { WebSocketServer } from "ws";
import { createClient } from "redis";
import { randomUUID } from "node:crypto";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

const subClient = redis.duplicate();
await subClient.connect();

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

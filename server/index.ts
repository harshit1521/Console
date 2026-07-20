import "dotenv/config";
import { createClient } from "redis";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

// primary redis client for regular operations like , publish , lpush , brpop etc ..
const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect();

// secondary redis client for subscription only ( no other regular operations are allowed, if its in subscription mode ...)
const subClient = redis.duplicate();
await subClient.connect();

// --------------------- create ws server instance ---------------------
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", async (socket) => {

    console.log("new client connected");
    const id = randomUUID(); // generates random uuid 

    socket.on("message", async (data) => {

        const res = JSON.parse(data.toString());

        if (res.type === "start") {

            const { code, language } = res;
            try {
                await subClient.subscribe(`output:${id}`, (message) => {

                    const response = JSON.parse(message);

                    if (response.type === "done") {
                        console.log("execution done");
                        socket.close();
                        return;
                    }

                    console.log(response.data);
                    socket.send(response.data);
                });

                await redis.lPush("task", JSON.stringify({ code, language, id }));
            } catch (error) {

                console.log(error);
            }
        } else if (res.type === "kill") {
            try {
                await redis.publish(`input:${id}`, JSON.stringify({ type: "kill" }));
            } catch (error) {
                console.log(error);
            }
        }else if(res.type === "stdin") {
            try {
                console.log(res.data)
                await subClient.publish(`input:${id}`, JSON.stringify({ type: "stdin" , data: res.data }));
            } catch (error) {
                console.log(error);
            }
        }

    });


    socket.on("close", async () => {
        console.log("WebSocket connection closed, cleaning up Redis client");
        try {
            await subClient.unsubscribe(`output:${id}`);
        } catch (error) {
            console.error(`Failed to unsubscribe from channel output:${id}:`, error);
        }
    });

})

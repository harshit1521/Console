import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { createClient } from "redis";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await client.connect();

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

    await redis.lPush("task", JSON.stringify({ submissionId: response.id, code, language }));
    


})
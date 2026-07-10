import "dotenv/config"
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { createClient } from "redis";

const redis = createClient({
    url: process.env.REDIS_URL!,
});
await redis.connect()
    .then(async () => {
        while(1) {
            
        }
    })
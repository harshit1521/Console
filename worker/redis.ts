import "dotenv/config"
import { createClient } from "redis"

export const redis = createClient({
    url: process.env.REDIS_URL!
});
export const inputClient = redis.duplicate();

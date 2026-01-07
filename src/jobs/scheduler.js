import cron from "node-cron";
import runNightlyCleanup from "./nightlyCleanup.js";

process.env.TZ = "Asia/Kolkata";

// ✅ THIS FIXES RESTART ISSUE
cron.schedule("0 0 * * *", async () => {
    const now = new Date();

    // Double safety check – ensures it runs only around 12 AM
    if (now.getHours() === 0 && now.getMinutes() === 0) {
        await runNightlyCleanup();
    } else {
        console.log("Cron triggered but not 12 AM IST – skipped");
    }
});

// console.log("⏰ Nightly Cron Scheduler Initialized");

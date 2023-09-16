import * as fs from "fs";
import * as path from "path";
import * as http from "http"
import * as analysis from "./analysis";
import * as bundle from "./bundle";
import * as csv from "./site/js/misc";
import * as chokidar from "chokidar";
import * as express from "express";
import * as compression from "compression";
import { min } from "moment";

function copyItemsToSite(dataDir: string) {
    const items = analysis.readJSON(`${dataDir}/latest-canonical.json.${analysis.FILE_COMPRESSOR}`);
    analysis.writeJSON(`site/output/data/latest-canonical.json`, items);
    for (const store of analysis.STORE_KEYS) {
        const storeItems = items.filter((item: { store: string; }) => item.store === store);
        analysis.writeJSON(`site/output/data/latest-canonical.${store}.compressed.json`, storeItems, false, 0, true);
    }
    const csvItems = csv.itemsToCSV(items);
    fs.writeFileSync("site/output/data/latest-canonical.csv", csvItems, "utf-8");
    console.log("Copied latest items to site.");
}

function scheduleFunction(hour: number, minute: number, second: number, func: () => any) {
    const now = new Date();

    const scheduledTime = new Date();
    scheduledTime.setHours(hour);
    scheduledTime.setMinutes(minute);
    scheduledTime.setSeconds(second);

    if (now > scheduledTime) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
    }
    const delay = scheduledTime.getTime() - now.getTime();

    console.log("Scheduling next function call: " + scheduledTime.toString());

    setTimeout(async () => {
        await func();
        scheduleFunction(hour, minute, second, func);
    }, delay);
}

function parseArguments() {
    const args = process.argv.slice(2);
    let port = process.env.PORT !== undefined && process.env.PORT != "" ? parseInt(process.env.PORT) : 3000;
    let liveReload = process.env.NODE_ENV === "development" || false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "-p" || args[i] === "--port") {
            port = parseInt(args[i + 1]);
        } else if (args[i] === "-l" || args[i] === "--live-reload") {
            if (process.env.NODE_ENV !== "development") {
                throw new Error("Live reload is only supported in development mode");
            }
            liveReload = true;
        } else if (args[i] === "-h" || args[i] === "--help") {
            console.log("Usage: node server.js [-p|--port PORT] [-l|--live-reload]");
            console.log();
            console.log("Options:");
            console.log("  -p, --port PORT      Port to listen on (default: 3000)");
            console.log("  -l, --live-reload    Enable live reload (automatically enabled if NODE_ENV is development)");
            process.exit(0);
        }
    }

    return { port, liveReload };
}

function setupLogging() {
    // Poor man's logging framework, wooh...
    const originalConsoleLog = console.log;
    const logStream = fs.createWriteStream("site/output/data/log.txt", { flags: "a" });
    logStream.write("===========================================\n\n");
    console.log = (message: any) => {
        const formattedMessage = `[${new Date().toISOString()}] ${message}\n`;
        logStream.write(formattedMessage);
        originalConsoleLog.apply(console, [message]);
    };
}

(async () => {
    const dataDir = "data";
    const { port, liveReload } = parseArguments();

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }

    const outputDir = "site/output";

    if (fs.existsSync("site/output/data/log.txt")) {
        fs.copyFileSync("site/output/data/log.txt", "site/log.txt");
    }
    bundle.deleteDirectory(outputDir);
    fs.mkdirSync(outputDir);
    fs.mkdirSync(outputDir + "/data");
    if (fs.existsSync("site/log.txt")) {
        fs.copyFileSync("site/log.txt", "site/output/data/log.txt");
        fs.unlinkSync("site/log.txt");
    }
    setupLogging();
    bundle.bundle("site", outputDir, liveReload);

    analysis.migrateCompression(dataDir, ".json", ".json.br");
    analysis.migrateCompression(dataDir, ".json.gz", ".json.br");

    if (fs.existsSync(`${dataDir}/latest-canonical.json.${analysis.FILE_COMPRESSOR}`)) {
        copyItemsToSite(dataDir);
        analysis.updateData(dataDir, (_newItems: any) => {
            copyItemsToSite(dataDir);
        });
    } else {
        await analysis.updateData(dataDir);
        copyItemsToSite(dataDir);
    }
    scheduleFunction(5, 0, 0, async () => {
        items = await analysis.updateData(dataDir);
        copyItemsToSite(dataDir);
    });

    const app = express();
    app.use(compression());
    app.use(express.static("site/output"));
    const server = http.createServer(app).listen(port, () => {
        console.log(`App listening on port ${port}`);
    });
    if (liveReload) {
        const socketIO = require("socket.io");
        const sockets = [];
        const io = socketIO(server);
        io.on("connection", (socket: any) => sockets.push(socket));
        let timeoutId: number | NodeJS.Timeout = 0;
        chokidar.watch("site/output").on("all", () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                const lastChangeTimestamp = Date.now();
                for (const element of sockets) {
                    element.send(`${lastChangeTimestamp}`);
                }
            }, 500);
        });
    }
})();

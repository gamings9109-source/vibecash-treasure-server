const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!DATABASE_URL || !SERVICE_ACCOUNT_JSON) {
    console.error("Firebase environment variables are missing");
    process.exit(1);
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
    serviceAccount.private_key =
        String(serviceAccount.private_key).replace(/\\n/g, "\n");
} catch (error) {
    console.error("Invalid Firebase service account configuration");
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
});

const db = admin.database();

const TARGET_DIAMONDS = 50000;
const TIME_ZONE = "Asia/Kolkata";

function getIndiaDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};

    parts.forEach(part => {
        values[part.type] = part.value;
    });

    return `${values.year}-${values.month}-${values.day}`;
}

async function verifyUser(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        throw new Error("Authorization token required");
    }

    return admin.auth().verifyIdToken(header.substring(7));
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        server: "VibeCash Treasure Server",
        status: "online"
    });
});

app.get("/treasure/room/:roomId", async (req, res) => {
    try {
        await verifyUser(req);

        const roomId = String(req.params.roomId || "");

        if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) {
            return res.status(400).json({
                success: false,
                error: "Invalid room ID"
            });
        }

        const date = getIndiaDate();

        const snapshot = await db.ref(
            `treasure_daily/${date}/${roomId}`
        ).once("value");

        const data = snapshot.val() || {};
        const leaderboard = data.leaderboard || {};

        const top3 = Object.keys(leaderboard)
            .map(uid => ({
                uid,
                ...leaderboard[uid]
            }))
            .sort((a, b) =>
                Number(b.diamonds || 0) -
                Number(a.diamonds || 0)
            )
            .slice(0, 3);

        const progress = Math.max(
            0,
            Number(data.progress_diamonds || 0)
        );

        res.json({
            success: true,
            roomId,
            date,
            targetDiamonds: TARGET_DIAMONDS,
            progressDiamonds: progress,
            progressPercent: Math.min(
                100,
                progress / TARGET_DIAMONDS * 100
            ),
            boxOpened: Boolean(data.boxOpened),
            top3
        });
    } catch (error) {
        console.error("Treasure read failed:", error.message);

        res.status(401).json({
            success: false,
            error: "Unable to authenticate or read treasure data"
        });
    }
});

app.listen(PORT, () => {
    console.log("VibeCash Treasure Server running on port", PORT);
});

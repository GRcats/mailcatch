require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authRouter = require("./cloud/routes/auth");
const documentRouter = require("./routes/document");
const mailRouter = require("./routes/mail");
const folderRouter = require("./routes/folder");
const settingsRouter = require("./routes/settings");
const settingsController = require("./controllers/settingsController");
const { connectMail } = require("./services/mailService");

const app = express();
connectMail();

app.use(cors({
    origin(origin, callback) {
        if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
            || /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)[^/]+(:\d+)?$/i.test(origin)) return callback(null, true);
        callback(new Error("허용되지 않은 접속 주소입니다."));
    }
}));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/documents", documentRouter);
app.use("/api/mail", mailRouter);
app.use("/api/folder", folderRouter);
app.use("/api/settings", settingsRouter);

app.get("/", (req, res) => {
    res.send("전자결재 Backend Running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running : ${PORT}`);
    dbReadyThenBackup();
});

function dbReadyThenBackup() {
    const db = require("./db/database");
    Promise.resolve(db.ready).then(() => settingsController.runScheduledBackup());
}

setInterval(dbReadyThenBackup, 60 * 60 * 1000).unref();

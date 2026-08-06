const express = require("express");
const router = express.Router();

const mailController = require("../controllers/mailController");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", mailController.getMails);
router.post("/sync", mailController.syncMails);
router.post("/move", mailController.moveMail);
router.post("/move-folder", mailController.movefolder
);
router.patch("/:uid/status", mailController.updateMailStatus);
router.get("/:uid/attachments", mailController.getMailAttachments);
router.get("/:uid/attachments/:index/preview", mailController.previewMailAttachment);


module.exports = router;

const express = require("express");
const folderController = require("../controllers/folderController");

const router = express.Router();
const { authenticate } = require("../middleware/auth");
router.use(authenticate);

router.post("/", folderController.createFolder);
router.get("/", folderController.getFolders);
router.get("/browse/local-folder", folderController.browseLocalFolder);
router.get("/:id/settings", folderController.getFolderSettings);
router.put("/:id/settings", folderController.updateFolderSettings);
router.get("/:id/attachment-categories", folderController.getAttachmentCategories);
router.put("/:id/attachment-categories", folderController.updateAttachmentCategories);
router.post("/:id/save-attachments", folderController.saveFolderAttachments);
router.get("/:id", folderController.getFolderMails);

module.exports = router;

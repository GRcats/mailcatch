const express = require("express");

const router = express.Router();
const { authenticate, allowRoles } = require("../middleware/auth");


const {
    getDocuments,
    createDocument,
    getDocument,
    getPendingApprovals,
    decideDocument,
    getPayments,
    completePayment,
    savePaymentHistoryCsv,
    uploadDocumentAttachment,
    openDocumentAttachment,
    getGlobalAttachmentCategories,
    updateGlobalAttachmentCategories,
    recallDocument
} = require("../controllers/documentController");



router.use(authenticate);
router.get("/", getDocuments);
router.get("/approval/pending", allowRoles("approver", "finance", "admin"), getPendingApprovals);
router.get("/payments", allowRoles("finance", "admin"), getPayments);
router.post("/payments/export-csv", allowRoles("finance", "admin"), savePaymentHistoryCsv);
router.post("/attachments/upload", express.raw({ type: "*/*", limit: "25mb" }), uploadDocumentAttachment);
router.get("/attachment-categories", getGlobalAttachmentCategories);
router.put("/attachment-categories", updateGlobalAttachmentCategories);
router.patch("/:id/payment", allowRoles("finance", "admin"), completePayment);
router.get("/:id/attachments/:index", openDocumentAttachment);
router.patch("/:id/decision", allowRoles("approver", "admin"), decideDocument);
router.patch("/:id/recall", recallDocument);
router.get("/:id", getDocument);

router.post("/", createDocument);



module.exports = router;
